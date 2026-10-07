import crypto from "node:crypto";
import type WebSocket from "ws";
import { getLesson } from "@tma/content";
import { ClientMessageSchema, headerFromLesson, type Beat, type ClientMessage, type LessonHeader, type RecordEntry, type ServerMessage } from "@tma/schema";
import { planLesson, replanLesson, type PlannerStreamer } from "./planner";
import { ReplayLog } from "./replay";
import { tutor, type TextStreamer, type TutorInput } from "./tutor";

export type SessionDeps = {
  tutorStreamer: TextStreamer | null;
  plannerStreamer: PlannerStreamer | null;
  tts: { available: boolean; voiceId: string | null };
  logDir: string;
  /** Milliseconds between beats when streaming a bundled lesson, to stand in for the Planner. */
  beatStaggerMs?: number;
};

type Sender = { send(data: string): void; readyState: number; OPEN: number };

/**
 * One connection, one lesson. Streams the lesson (bundled, or written by the
 * Planner), runs the Tutor for questions and reviews, keeps the record of
 * what happened, and writes everything to the replay log.
 */
export class Session {
  readonly id = crypto.randomUUID();
  private readonly log: ReplayLog;
  private header: LessonHeader | null = null;
  private beats: Beat[] = [];
  private topic: string | null = null;
  private record: RecordEntry[] = [];
  private currentBeatIndex = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private closed = false;
  private replanning = false;

  constructor(
    private readonly socket: Sender,
    private readonly deps: SessionDeps,
  ) {
    this.log = new ReplayLog(deps.logDir, this.id);
    this.send({ type: "session.ready", sessionId: this.id, tts: deps.tts });
  }

  private send(msg: ServerMessage): void {
    if (this.closed) return;
    this.log.write("out", msg.type === "lesson.beat" ? { type: msg.type, index: msg.index, beatId: msg.beat.id, ops: msg.beat.ops.length } : msg);
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  async handleRaw(raw: string): Promise<void> {
    let parsed: ClientMessage;
    try {
      parsed = ClientMessageSchema.parse(JSON.parse(raw));
    } catch (err) {
      this.log.write("bad_message", { raw: raw.slice(0, 500), error: String(err) });
      this.send({ type: "error", message: "unrecognized message" });
      return;
    }
    await this.handle(parsed);
  }

  async handle(msg: ClientMessage): Promise<void> {
    this.log.write("in", msg.type === "tutor.ask" || msg.type === "tutor.review" ? { ...msg, window: { current: msg.window.current.length, nextPrefix: msg.window.nextPrefix.length } } : msg);
    switch (msg.type) {
      case "session.start":
        await this.start(msg.lessonId, msg.topic);
        return;
      case "ping":
        this.send({ type: "pong", t: msg.t, serverTime: Date.now() });
        return;
      case "event":
        this.onEvent(msg.event);
        return;
      case "tutor.ask":
      case "tutor.review":
        await this.runTutor(msg);
        return;
    }
  }

  private onEvent(event: Extract<ClientMessage, { type: "event" }>["event"]): void {
    const beatId = this.beats[this.currentBeatIndex]?.id ?? this.header?.outline[this.currentBeatIndex]?.id ?? "";
    switch (event.kind) {
      case "lesson_started":
        this.record = [];
        this.currentBeatIndex = 0;
        if (event.calibrationAnswer) this.record.push({ kind: "calibration", answer: event.calibrationAnswer });
        return;
      case "beat_started":
        if (event.index > this.currentBeatIndex + 1) this.record.push({ kind: "jumped", toBeatId: event.beatId });
        this.currentBeatIndex = event.index;
        return;
      case "check_answered": {
        const prompt = this.findCheckPrompt(event.checkId) ?? event.checkId;
        this.record.push({ kind: "check", beatId, prompt, answer: event.answer, correct: event.correct });
        return;
      }
      case "nav":
        if (event.command === "skip") this.record.push({ kind: "skipped", beatId });
        return;
      case "branch_played":
        this.record.push({ kind: "asked", beatId, text: event.text, answered: `(a prepared answer: ${event.branchId})` });
        return;
      default:
        return;
    }
  }

  private findCheckPrompt(checkId: string): string | null {
    for (const b of this.beats) for (const op of b.ops) if (op.op === "check" && op.id === checkId) return op.prompt;
    return null;
  }

  private async start(lessonId: string | null, topic: string | null): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.beats = [];
    if (lessonId) {
      const lesson = getLesson(lessonId);
      if (!lesson) {
        this.send({ type: "error", message: `unknown lesson "${lessonId}"` });
        return;
      }
      this.header = headerFromLesson(lesson);
      this.topic = lesson.topic;
      this.beats = [...lesson.beats];
      this.send({ type: "lesson.header", header: this.header, source: "bundled" });
      const stagger = this.deps.beatStaggerMs ?? 250;
      lesson.beats.forEach((beat, index) => {
        const timer = setTimeout(() => {
          this.send({ type: "lesson.beat", index, beat });
          if (index === lesson.beats.length - 1) this.send({ type: "lesson.complete" });
        }, stagger * (index + 1));
        this.timers.push(timer);
      });
      return;
    }
    if (!topic) {
      this.send({ type: "error", message: "nothing to teach: no lesson id and no topic" });
      return;
    }
    if (!this.deps.plannerStreamer) {
      this.send({ type: "lesson.error", message: "the planner is not configured; add ANTHROPIC_API_KEY" });
      return;
    }
    this.topic = topic;
    const started = performance.now();
    const plannedId = `plan-${this.id.slice(0, 8)}`;
    for await (const ev of planLesson(topic, plannedId, this.deps.plannerStreamer)) {
      if (this.closed) return;
      if (ev.type === "header") {
        this.header = ev.header;
        this.log.write("planner", { phase: "header", ms: Math.round(performance.now() - started), outline: ev.header.outline.map((b) => b.id) });
        this.send({ type: "lesson.header", header: ev.header, source: "planner" });
      } else if (ev.type === "beat") {
        this.beats[ev.index] = ev.beat;
        this.log.write("planner", { phase: "beat", index: ev.index, ms: Math.round(performance.now() - started), issues: ev.issues, ops: ev.beat.ops.length });
        this.send({ type: "lesson.beat", index: ev.index, beat: ev.beat });
      } else if (ev.type === "diagnostic") {
        this.log.write("planner_diagnostic", { message: ev.message, raw: ev.raw });
      } else if (ev.type === "error") {
        this.log.write("planner_error", { message: ev.message });
        if (!this.header) {
          this.send({ type: "lesson.error", message: ev.message });
          return;
        }
      } else if (ev.type === "done") {
        this.log.write("planner", { phase: "done", ms: Math.round(performance.now() - started), model: ev.model, inputTokens: ev.inputTokens, outputTokens: ev.outputTokens });
        // Any outline entry without a beat gets a minimal stand-in so the lesson can finish.
        this.header?.outline.forEach((entry, index) => {
          if (this.beats[index]) return;
          const beat: Beat = {
            id: entry.id,
            title: entry.title,
            ...(entry.summary ? { summary: entry.summary } : {}),
            ops: [
              { op: "say", id: `${entry.id}.s_auto`, text: entry.summary ?? entry.title },
              { op: "check", id: `${entry.id}.k_auto`, kind: "choice", prompt: "Ready to go on?", options: ["Yes"], graded: false },
            ],
          };
          this.beats[index] = beat;
          this.send({ type: "lesson.beat", index, beat });
        });
        this.send({ type: "lesson.complete" });
      }
    }
  }

  private async runTutor(msg: Extract<ClientMessage, { type: "tutor.ask" | "tutor.review" }>): Promise<void> {
    const receivedAt = Date.now();
    const started = performance.now();
    if (!this.deps.tutorStreamer) {
      this.send({ type: "tutor.error", requestId: msg.requestId, message: "no tutor configured" });
      return;
    }
    const input: TutorInput = {
      requestId: msg.requestId,
      kind: msg.type === "tutor.ask" ? "ask" : "review",
      text: msg.type === "tutor.ask" ? msg.text : null,
      pointed: msg.type === "tutor.ask" ? msg.pointed : null,
      context: msg.context,
      window: msg.window,
      lesson: { topic: this.header?.topic ?? this.topic ?? "", title: this.header?.title ?? "" },
    };
    let firstOpMs: number | null = null;
    let firstAnswer: string | null = null;
    for await (const ev of tutor(input, this.deps.tutorStreamer)) {
      if (this.closed) return;
      if (ev.type === "answer") {
        if (firstOpMs === null) firstOpMs = Math.round(performance.now() - started);
        const firstSay = ev.ops.find((o) => o.op === "say");
        if (!firstAnswer && firstSay && firstSay.op === "say") firstAnswer = firstSay.text;
        this.send({ type: "tutor.answer", requestId: msg.requestId, ops: ev.ops });
      } else if (ev.type === "done") {
        const timing = {
          requestReceivedAt: receivedAt,
          firstTokenMs: ev.firstTokenMs,
          firstOpMs,
          doneMs: Math.round(performance.now() - started),
          model: ev.model,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          fellBack: ev.fellBack,
        };
        if (msg.type === "tutor.ask") this.record.push({ kind: "asked", beatId: msg.context.beatId, text: msg.text, answered: firstAnswer });
        this.log.write("tutor", { requestId: msg.requestId, kind: input.kind, text: input.text, timing, replan: ev.replan, current: ev.current.length, nextPrefix: ev.nextPrefix?.length ?? null });
        this.send({ type: "tutor.done", requestId: msg.requestId, current: ev.current, nextPrefix: ev.nextPrefix, timing, replan: ev.replan });
        if (ev.replan) void this.replan(ev.replan.fromBeatId, ev.replan.reason);
      } else {
        this.log.write("tutor_error", { requestId: msg.requestId, message: ev.message });
        this.send({ type: "tutor.error", requestId: msg.requestId, message: ev.message });
      }
    }
  }

  private async replan(fromBeatId: string, reason: string): Promise<void> {
    if (!this.header || !this.deps.plannerStreamer || this.replanning) return;
    const fromIndex = this.header.outline.findIndex((b) => b.id === fromBeatId);
    if (fromIndex <= this.currentBeatIndex) {
      this.log.write("replan_skipped", { fromBeatId, reason, why: "beat already playing or played" });
      return;
    }
    this.replanning = true;
    const started = performance.now();
    try {
      for await (const ev of replanLesson({ topic: this.topic ?? this.header.topic, header: this.header, beats: this.beats, fromIndex, reason, record: this.record }, this.deps.plannerStreamer)) {
        if (this.closed) return;
        if (ev.type === "outline") {
          this.header = { ...this.header, outline: [...this.header.outline.slice(0, fromIndex), ...ev.outline] };
          this.beats = this.beats.slice(0, fromIndex);
          this.send({ type: "lesson.replace", fromIndex, outline: ev.outline, reason });
        } else if (ev.type === "beat") {
          this.beats[ev.index] = ev.beat;
          this.send({ type: "lesson.beat", index: ev.index, beat: ev.beat });
        } else if (ev.type === "diagnostic") {
          this.log.write("planner_diagnostic", { message: ev.message, raw: ev.raw, replan: true });
        } else if (ev.type === "error") {
          this.log.write("planner_error", { message: ev.message, replan: true });
        } else if (ev.type === "done") {
          this.log.write("planner", { phase: "replan_done", fromIndex, ms: Math.round(performance.now() - started) });
          this.send({ type: "lesson.complete" });
        }
      }
    } finally {
      this.replanning = false;
    }
  }

  close(): void {
    this.closed = true;
    for (const t of this.timers) clearTimeout(t);
    this.log.write("closed", {});
    this.log.close();
  }
}

export function attachSession(ws: WebSocket, deps: SessionDeps): Session {
  const session = new Session(ws, deps);
  ws.on("message", (data) => {
    void session.handleRaw(data.toString());
  });
  ws.on("close", () => session.close());
  ws.on("error", () => session.close());
  return session;
}
