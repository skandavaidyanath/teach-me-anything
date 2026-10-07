import crypto from "node:crypto";
import type WebSocket from "ws";
import { getLesson } from "@tma/content";
import { ClientMessageSchema, headerFromLesson, type ClientMessage, type ServerMessage } from "@tma/schema";
import { ReplayLog } from "./replay";
import { respond, type AskInput, type TextStreamer } from "./responder";

export type SessionDeps = {
  streamer: TextStreamer | null;
  tts: { available: boolean; voiceId: string | null };
  logDir: string;
  /** Milliseconds between beats when streaming the canned lesson, to stand in for a Planner. */
  beatStaggerMs?: number;
  now?: () => number;
};

type Sender = { send(data: string): void; readyState: number; OPEN: number };

/**
 * One connection, one lesson. Streams the lesson header then beats one at a
 * time, answers asks through the Responder, and writes everything to the
 * replay log. Navigation never arrives here; the client handles it.
 */
export class Session {
  readonly id = crypto.randomUUID();
  private readonly log: ReplayLog;
  private lesson: ReturnType<typeof getLesson> = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private closed = false;

  constructor(
    private readonly socket: Sender,
    private readonly deps: SessionDeps,
  ) {
    this.log = new ReplayLog(deps.logDir, this.id);
    this.send({ type: "session.ready", sessionId: this.id, tts: deps.tts });
  }

  private send(msg: ServerMessage): void {
    if (this.closed) return;
    this.log.write("out", msg.type === "lesson.beat" ? { type: msg.type, index: msg.index, beatId: msg.beat.id } : msg);
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
    this.log.write("in", msg);
    switch (msg.type) {
      case "session.start":
        this.start(msg.lessonId);
        return;
      case "ping":
        this.send({ type: "pong", t: msg.t, serverTime: Date.now() });
        return;
      case "event":
        return;
      case "ask":
        await this.ask(msg);
        return;
    }
  }

  private start(lessonId: string): void {
    const lesson = getLesson(lessonId);
    if (!lesson) {
      this.send({ type: "error", message: `unknown lesson "${lessonId}"` });
      return;
    }
    this.lesson = lesson;
    this.send({ type: "lesson.header", header: headerFromLesson(lesson) });
    const stagger = this.deps.beatStaggerMs ?? 250;
    lesson.beats.forEach((beat, index) => {
      const timer = setTimeout(() => {
        this.send({ type: "lesson.beat", index, beat });
        if (index === lesson.beats.length - 1) this.send({ type: "lesson.complete" });
      }, stagger * (index + 1));
      this.timers.push(timer);
    });
  }

  private async ask(msg: Extract<ClientMessage, { type: "ask" }>): Promise<void> {
    const receivedAt = Date.now();
    const started = performance.now();
    if (!this.deps.streamer) {
      this.send({ type: "aside.error", requestId: msg.requestId, message: "no responder configured" });
      return;
    }
    const input: AskInput = {
      requestId: msg.requestId,
      text: msg.text,
      pointed: msg.pointed,
      context: msg.context,
      lesson: { topic: this.lesson?.topic ?? "", title: this.lesson?.title ?? "" },
    };
    let firstOpMs: number | null = null;
    for await (const ev of respond(input, this.deps.streamer)) {
      if (ev.type === "ops") {
        if (firstOpMs === null) firstOpMs = Math.round(performance.now() - started);
        this.send({ type: "aside.partial", requestId: msg.requestId, ops: ev.ops });
      } else if (ev.type === "done") {
        const timing = {
          requestReceivedAt: receivedAt,
          firstTokenMs: ev.firstTokenMs,
          firstOpMs,
          doneMs: Math.round(performance.now() - started),
          model: ev.model,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
        };
        this.log.write("responder", { requestId: msg.requestId, text: msg.text, timing });
        this.send({ type: "aside.done", requestId: msg.requestId, resume: ev.resume, timing, callbacks: ev.callbacks });
      } else {
        this.log.write("responder_error", { requestId: msg.requestId, message: ev.message });
        this.send({ type: "aside.error", requestId: msg.requestId, message: ev.message });
      }
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
