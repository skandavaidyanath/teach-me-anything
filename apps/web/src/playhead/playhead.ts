import {
  headerFromLesson,
  normalizeAnswer,
  sameRef,
  type AskContext,
  type AsideTiming,
  type Beat,
  type CheckOp,
  type ElementRef,
  type Lesson,
  type LessonHeader,
  type NavCommand,
  type Op,
  type PlayheadEvent,
  type Resume,
} from "@tma/schema";
import { applyOp, emptyBoard, replay, type BoardState } from "./board-reducer";
import { dispatchInput } from "./dispatcher";
import { createSpeaker, speechAvailable, type SpeakHandle, type Speaker } from "./speaker";

/**
 * The playhead executes ops in order, owns the local interrupt path, and
 * exposes a snapshot for React. It is the client-side runtime from the plan:
 * no model calls, and pause, seek, and resume are all local.
 *
 * Content arrives as a header plus beats appended over time, which is the
 * shape a streaming Planner produces. Board state is always `replay(history)`.
 * Rewind pops history back to a sentence boundary and requeues what it popped.
 * Asides run on a swapped-in queue; a remote aside's queue fills as the
 * Responder streams.
 */

export type Mode = "calibrating" | "idle" | "playing" | "paused" | "awaiting_check" | "finished";
export type Origin = "beat" | "reaction" | "aside" | "bridge";
export type SpeakerKind = "voice" | "silent";

type QueueItem = { op: Op; origin: Origin };

export type Caption = { text: string; spokenChars: number; origin: Origin };
export type CheckState = { op: CheckOp; result: { correct: boolean; answer: string } | null };

export type AskTelemetry = {
  requestId: string;
  sentAt: number;
  firstOpMs: number | null;
  firstAudioMs: number | null;
  doneMs: number | null;
  server: AsideTiming | null;
};

export type Telemetry = {
  rttMs: number | null;
  tts: { fetchMs: number; cached: boolean; synthMs: number } | null;
  ask: AskTelemetry | null;
};

export type PlayheadState = {
  mode: Mode;
  title: string;
  calibration: { prompt: string; options: string[] } | null;
  beatIndex: number;
  outline: Array<{ id: string; title: string }>;
  loadedBeats: number;
  completedBeats: string[];
  board: BoardState;
  caption: Caption | null;
  check: CheckState | null;
  aside: { title: string } | null;
  /** The loop is idle because content has not arrived yet. */
  waiting: "beat" | "aside" | null;
  pointed: ElementRef | null;
  typingArmed: boolean;
  calibrationAnswer: string | null;
  speakerKind: SpeakerKind;
  speechAvailable: boolean;
  toast: string | null;
  pinSpotlight: { pinId: string } | null;
  telemetry: Telemetry;
};

type Listener = () => void;

const SETTLE_MS: Partial<Record<Op["op"], number>> = {
  show: 420,
  update: 520,
  move: 560,
  highlight: 320,
  clear_highlights: 120,
  clear: 240,
};

const FILLERS = ["Good question.", "Let me think about that for a second.", "Right, let me answer that."];
const PREFETCH_AHEAD = 3;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function firstSays(ops: Op[], n: number): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.op === "say") out.push(op.text);
    if (out.length >= n) break;
  }
  return out;
}

export type PlayheadOptions = {
  /** The voice speaker to use when voice is on: a server speaker, or a manual one in tests. Browser speech is detected otherwise. */
  speaker?: Speaker;
  /** Multiplier on settle delays between board ops. 0 in tests. */
  settleScale?: number;
};

export type AskRequest = { requestId: string; text: string; pointed: string | null; context: AskContext };

export class Playhead {
  private state: PlayheadState;
  private listeners = new Set<Listener>();
  private readonly settleScale: number;

  private readonly header: LessonHeader;
  private beats: Beat[] = [];

  private history: QueueItem[] = [];
  private beatStarts: number[] = [];
  private queue: QueueItem[] = [];

  private runToken = 0;
  private inFlight: QueueItem | null = null;
  private speakHandle: SpeakHandle | null = null;

  private voiceSpeaker: Speaker | null;
  private readonly silentSpeaker: Speaker = createSpeaker("silent");
  private speaker: Speaker;
  private speakerInjected: boolean;

  private pauseAtBoundary = false;
  private softPaused = false;
  private waitingForBeat = false;

  private asideFrame: {
    savedQueue: QueueItem[];
    savedCheck: CheckState | null;
    stageIdsBefore: Set<string>;
    resume: Resume | null;
    keepStage: boolean;
    open: boolean;
    requestId: string | null;
    receivedOps: number;
  } | null = null;
  private fillerTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set by the host to route unpredicted questions to the harness. */
  onAsk: ((req: AskRequest) => void) | null = null;
  /** Set by the host to forward playhead events for the replay log. */
  onEvent: ((event: PlayheadEvent) => void) | null = null;

  constructor(header: LessonHeader, opts: PlayheadOptions = {}) {
    this.header = header;
    this.voiceSpeaker = opts.speaker ?? null;
    this.speakerInjected = !!opts.speaker;
    this.speaker = this.voiceSpeaker ?? this.silentSpeaker;
    this.settleScale = opts.settleScale ?? 1;
    this.state = {
      mode: header.calibration ? "calibrating" : "idle",
      title: header.title,
      calibration: header.calibration ?? null,
      beatIndex: 0,
      outline: header.outline,
      loadedBeats: 0,
      completedBeats: [],
      board: emptyBoard,
      caption: null,
      check: null,
      aside: null,
      waiting: null,
      pointed: null,
      typingArmed: false,
      calibrationAnswer: null,
      speakerKind: this.voiceSpeaker ? "voice" : "silent",
      speechAvailable: !!this.voiceSpeaker,
      toast: null,
      pinSpotlight: null,
      telemetry: { rttMs: null, tts: null, ask: null },
    };
  }

  /** Local mode: the whole lesson is already here. */
  static fromLesson(lesson: Lesson, opts: PlayheadOptions = {}): Playhead {
    const ph = new Playhead(headerFromLesson(lesson), opts);
    lesson.beats.forEach((b, i) => ph.appendBeat(b, i));
    return ph;
  }

  // ---- store plumbing -----------------------------------------------------

  getState = (): PlayheadState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<PlayheadState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  private setTelemetry(patch: Partial<Telemetry>): void {
    this.set({ telemetry: { ...this.state.telemetry, ...patch } });
  }

  private emit(event: PlayheadEvent): void {
    this.onEvent?.(event);
  }

  private toast(message: string, ms = 1600): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.set({ toast: message });
    this.toastTimer = setTimeout(() => this.set({ toast: null }), ms);
  }

  get beat(): Beat | undefined {
    return this.beats[this.state.beatIndex];
  }

  private get beatId(): string {
    return this.beat?.id ?? this.header.outline[this.state.beatIndex]?.id ?? "";
  }

  // ---- content arrival ----------------------------------------------------

  appendBeat(beat: Beat, index?: number): void {
    const at = index ?? this.beats.length;
    if (this.beats[at]) return;
    this.beats[at] = beat;
    this.set({ loadedBeats: this.beats.filter(Boolean).length });
    // The calibration question is the latency mask: warm the opening sentences while the learner reads it.
    if (at === 0 && (this.state.mode === "calibrating" || this.state.mode === "idle")) {
      this.speaker.prefetch?.([...FILLERS, ...firstSays(beat.ops, PREFETCH_AHEAD)]);
    }
    if (this.waitingForBeat && at === this.state.beatIndex) {
      this.waitingForBeat = false;
      this.loadBeatQueue(at);
      this.set({ waiting: null });
      if (this.state.mode === "playing") void this.run();
    }
  }

  private loadBeatQueue(index: number): void {
    const beat = this.beats[index]!;
    this.beatStarts[index] = this.history.length;
    this.queue = beat.ops.map((op) => ({ op, origin: "beat" as const }));
    this.prefetchUpcoming();
    this.emit({ kind: "beat_started", beatId: beat.id, index });
  }

  // ---- speakers -----------------------------------------------------------

  /** Client-only: use the browser's voice when no server voice was injected. Call once after mount. */
  detectSpeech(): void {
    if (this.speakerInjected || this.voiceSpeaker) return;
    if (!speechAvailable()) return;
    this.voiceSpeaker = createSpeaker("voice");
    this.speaker = this.voiceSpeaker;
    this.set({ speechAvailable: true, speakerKind: "voice" });
  }

  setSpeaker(kind: SpeakerKind): void {
    if (kind === this.state.speakerKind) return;
    if (kind === "voice" && !this.voiceSpeaker) return;
    const wasSpeaking = this.inFlight?.op.op === "say" && this.state.mode === "playing";
    if (wasSpeaking) this.stopCurrent();
    this.speaker = kind === "voice" ? this.voiceSpeaker! : this.silentSpeaker;
    this.set({ speakerKind: kind });
    if (wasSpeaking) void this.run();
  }

  recordTts(stats: { fetchMs: number; cached: boolean; synthMs: number }): void {
    this.setTelemetry({ tts: stats });
  }

  recordRtt(ms: number): void {
    this.setTelemetry({ rttMs: ms });
  }

  private prefetchUpcoming(): void {
    const texts: string[] = [];
    for (const item of this.queue) {
      if (item.op.op === "say") texts.push(item.op.text);
      if (texts.length >= PREFETCH_AHEAD) break;
    }
    if (texts.length < PREFETCH_AHEAD && !this.asideFrame) {
      const next = this.beats[this.state.beatIndex + 1];
      if (next) texts.push(...firstSays(next.ops, PREFETCH_AHEAD - texts.length));
    }
    if (texts.length) this.speaker.prefetch?.(texts);
  }

  // ---- lifecycle ----------------------------------------------------------

  start(calibrationAnswer: string | null = null): void {
    this.stopCurrent();
    this.history = [];
    this.beatStarts = [];
    this.asideFrame = null;
    this.waitingForBeat = false;
    this.set({
      mode: "playing",
      beatIndex: 0,
      completedBeats: [],
      board: emptyBoard,
      caption: null,
      check: null,
      aside: null,
      waiting: null,
      calibrationAnswer,
    });
    this.emit({ kind: "lesson_started", calibrationAnswer });
    this.speaker.prefetch?.(FILLERS);
    if (this.beats[0]) {
      this.loadBeatQueue(0);
      void this.run();
    } else {
      this.queue = [];
      this.waitingForBeat = true;
      this.set({ waiting: "beat" });
    }
  }

  // ---- the loop -----------------------------------------------------------

  private async run(): Promise<void> {
    const token = ++this.runToken;
    while (token === this.runToken && this.state.mode === "playing") {
      const item = this.queue.shift();
      if (!item) {
        if (this.asideFrame) {
          if (this.asideFrame.open) {
            this.set({ waiting: "aside" });
            return;
          }
          this.finishAside();
          continue;
        }
        const next = this.advanceBeat();
        if (next === "finished") {
          this.set({ mode: "finished", caption: null, waiting: null });
          this.emit({ kind: "lesson_finished" });
        } else if (next === "waiting") {
          return;
        }
        continue;
      }
      this.history.push(item);
      await this.execute(item, token);
    }
  }

  private async execute(item: QueueItem, token: number): Promise<void> {
    const { op } = item;
    switch (op.op) {
      case "say": {
        this.inFlight = item;
        const staleVerdict = item.origin !== "reaction" && this.state.check?.result ? { check: null } : {};
        this.set({ caption: { text: op.text, spokenChars: 0, origin: item.origin }, waiting: null, ...staleVerdict });
        this.prefetchUpcoming();
        let audioMarked = false;
        const handle = this.speaker.speak(op.text, (chars) => {
          if (token !== this.runToken) return;
          if (!audioMarked && chars > 0) {
            audioMarked = true;
            const ask = this.state.telemetry.ask;
            if (item.origin === "aside" && ask && ask.firstAudioMs === null) {
              this.setTelemetry({ ask: { ...ask, firstAudioMs: Math.round(performance.now() - ask.sentAt) } });
            }
          }
          const caption = this.state.caption;
          if (caption && caption.text === op.text) this.set({ caption: { ...caption, spokenChars: chars } });
        });
        this.speakHandle = handle;
        const outcome = await handle.done;
        if (token !== this.runToken) return;
        this.speakHandle = null;
        this.inFlight = null;
        if (outcome === "cancelled") return;
        if (this.pauseAtBoundary) {
          this.pauseAtBoundary = false;
          this.softPaused = true;
          this.set({ mode: "paused" });
        }
        return;
      }
      case "pause": {
        await sleep(op.ms * this.settleScale);
        return;
      }
      case "check": {
        this.set({ mode: "awaiting_check", check: { op, result: null } });
        return;
      }
      case "pin": {
        // The moment of pinning: the idea appears large on the stage, holds, then flies to the rail.
        this.set({ board: applyOp(this.state.board, op), pinSpotlight: { pinId: op.pin.pinId } });
        await sleep(1300 * this.settleScale);
        this.set({ pinSpotlight: null });
        if (token !== this.runToken) return;
        await sleep(700 * this.settleScale);
        return;
      }
      default: {
        this.set({ board: applyOp(this.state.board, op) });
        const ms = SETTLE_MS[op.op] ?? 200;
        await sleep(ms * this.settleScale);
        return;
      }
    }
  }

  private advanceBeat(): "advanced" | "waiting" | "finished" {
    const next = this.state.beatIndex + 1;
    const completed = this.beat && !this.state.completedBeats.includes(this.beat.id) ? [...this.state.completedBeats, this.beat.id] : this.state.completedBeats;
    if (next >= this.header.outline.length) {
      this.set({ completedBeats: completed });
      return "finished";
    }
    this.set({ beatIndex: next, completedBeats: completed, check: null });
    if (!this.beats[next]) {
      this.waitingForBeat = true;
      this.queue = [];
      this.set({ waiting: "beat" });
      return "waiting";
    }
    this.loadBeatQueue(next);
    return "advanced";
  }

  private recomputeBoard(): void {
    this.set({ board: replay(this.history.map((h) => h.op)) });
  }

  /** Cancel speech, put an in-flight sentence back at the front, invalidate the loop. */
  private stopCurrent(): void {
    this.runToken++;
    if (this.state.pinSpotlight) this.set({ pinSpotlight: null });
    if (this.speakHandle) {
      this.speakHandle.cancel();
      this.speakHandle = null;
    }
    if (this.inFlight) {
      const last = this.history[this.history.length - 1];
      if (last === this.inFlight) this.history.pop();
      this.queue.unshift(this.inFlight);
      this.inFlight = null;
    }
    this.pauseAtBoundary = false;
  }

  // ---- interrupts ---------------------------------------------------------

  setTyping(typing: boolean): void {
    if (typing) {
      if (this.state.mode === "playing" && !this.state.typingArmed) {
        this.pauseAtBoundary = true;
        this.emit({ kind: "interrupt", mode: "soft", beatId: this.beatId, opId: this.inFlight?.op.id ?? null });
      }
      this.set({ typingArmed: this.state.mode === "playing" });
      return;
    }
    this.pauseAtBoundary = false;
    const resumeFromSoft = this.softPaused && this.state.mode === "paused";
    this.softPaused = false;
    this.set({ typingArmed: false });
    if (resumeFromSoft) this.resume();
  }

  pause(): void {
    if (this.state.mode !== "playing") return;
    this.stopCurrent();
    this.softPaused = false;
    this.set({ mode: "paused", typingArmed: false });
  }

  resume(): void {
    if (this.state.mode !== "paused") return;
    this.softPaused = false;
    this.set({ mode: "playing", typingArmed: false });
    void this.run();
  }

  togglePause(): void {
    if (this.state.mode === "playing") {
      this.pause();
      this.toast("Paused");
    } else if (this.state.mode === "paused") {
      this.resume();
    }
  }

  setPointed(ref: ElementRef | null): void {
    this.set({ pointed: ref });
  }

  submitInput(raw: string): void {
    const text = raw.trim();
    if (!text) return;
    const check = this.state.check;
    if (this.state.mode === "awaiting_check" && check && check.result === null) {
      const kind = check.op.kind;
      const looksLikeAnswer =
        kind === "free_text" ||
        (kind === "choice" && (check.op.options ?? []).some((o) => normalizeAnswer(o) === normalizeAnswer(text)));
      if (looksLikeAnswer) {
        this.answerCheck(text);
        return;
      }
    }
    const pointed = this.state.pointed?.id ?? null;
    const dispatch = dispatchInput(this.header, text, { beatId: this.beatId, pointed });
    this.set({ pointed: null, typingArmed: false });
    this.pauseAtBoundary = false;
    if (dispatch.kind === "nav") {
      this.emit({ kind: "nav", command: dispatch.command });
      this.nav(dispatch.command);
      return;
    }
    if (this.state.mode === "finished" || this.state.mode === "calibrating" || this.state.mode === "idle") return;
    this.emit({ kind: "interrupt", mode: "hard", beatId: this.beatId, opId: this.inFlight?.op.id ?? null });
    if (dispatch.kind === "branch") {
      const b = dispatch.branch;
      this.emit({ kind: "aside_started", source: "branch", title: b.title ?? b.id, text });
      this.startAside(b.ops, b.resume, b.title ?? "Aside", b.keepStage ?? false);
      return;
    }
    if (this.onAsk) {
      const requestId = `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      this.emit({ kind: "aside_started", source: "remote", title: "Thinking", text });
      const context = this.buildAskContext();
      this.startAside([], null, "Answering", false, requestId);
      this.setTelemetry({ ask: { requestId, sentAt: performance.now(), firstOpMs: null, firstAudioMs: null, doneMs: null, server: null } });
      this.onAsk({ requestId, text, pointed, context });
      this.fillerTimer = setTimeout(() => {
        const frame = this.asideFrame;
        if (!frame || frame.requestId !== requestId || frame.receivedOps > 0) return;
        const filler = FILLERS[Math.floor(Math.random() * FILLERS.length)]!;
        this.queue.push({ op: { op: "say", id: `${requestId}.filler`, text: filler }, origin: "aside" });
        if (this.state.waiting === "aside") {
          this.set({ waiting: null });
          void this.run();
        }
      }, 900 * this.settleScale);
      return;
    }
    this.emit({ kind: "aside_started", source: "fallback", title: "Aside", text });
    this.startAside(this.header.fallback.ops, this.header.fallback.resume, "Aside", false);
  }

  nav(command: NavCommand): void {
    switch (command) {
      case "pause":
        this.pause();
        this.toast("Paused");
        return;
      case "resume":
        if (this.state.mode === "paused") this.resume();
        return;
      case "back":
        this.rewind();
        return;
      case "repeat":
        this.repeat();
        return;
      case "skip":
        this.skipBeat();
        return;
      case "restart":
        this.toast("Starting over");
        this.start(this.state.calibrationAnswer);
        return;
    }
  }

  // ---- asides -------------------------------------------------------------

  private startAside(ops: Op[], resume: Resume | null, title: string, keepStage: boolean, requestId: string | null = null): void {
    if (this.fillerTimer) clearTimeout(this.fillerTimer);
    if (this.asideFrame) {
      // A question during an aside replaces the aside; the lesson position is kept.
      this.stopCurrent();
      this.queue = [];
      this.asideFrame.resume = resume;
      this.asideFrame.keepStage = keepStage;
      this.asideFrame.open = resume === null;
      this.asideFrame.requestId = requestId;
      this.asideFrame.receivedOps = 0;
    } else {
      this.stopCurrent();
      this.asideFrame = {
        savedQueue: this.queue,
        savedCheck: this.state.mode === "awaiting_check" ? this.state.check : null,
        stageIdsBefore: new Set(this.state.board.order),
        resume,
        keepStage,
        open: resume === null,
        requestId,
        receivedOps: 0,
      };
      this.queue = [];
    }
    this.queue = ops.map((op) => ({ op, origin: "aside" as const }));
    this.softPaused = false;
    this.set({ mode: "playing", aside: { title }, check: null, typingArmed: false, waiting: null });
    void this.run();
  }

  /** Ops streamed from the Responder for the open remote aside. */
  appendAsideOps(requestId: string, ops: Op[]): void {
    const frame = this.asideFrame;
    if (!frame || frame.requestId !== requestId) return;
    if (frame.receivedOps === 0) {
      if (this.fillerTimer) clearTimeout(this.fillerTimer);
      const ask = this.state.telemetry.ask;
      if (ask && ask.requestId === requestId) this.setTelemetry({ ask: { ...ask, firstOpMs: Math.round(performance.now() - ask.sentAt) } });
    }
    frame.receivedOps += ops.length;
    this.queue.push(...ops.map((op) => ({ op, origin: "aside" as const })));
    this.prefetchUpcoming();
    if (this.state.waiting === "aside" && this.state.mode === "playing") {
      this.set({ waiting: null });
      void this.run();
    }
  }

  completeAside(requestId: string, resume: Resume, timing: AsideTiming | null = null): void {
    const frame = this.asideFrame;
    if (!frame || frame.requestId !== requestId) return;
    frame.resume = resume;
    frame.open = false;
    const ask = this.state.telemetry.ask;
    if (ask && ask.requestId === requestId) this.setTelemetry({ ask: { ...ask, doneMs: Math.round(performance.now() - ask.sentAt), server: timing } });
    if (this.state.waiting === "aside" && this.state.mode === "playing") {
      this.set({ waiting: null });
      void this.run();
    }
  }

  failAside(requestId: string, _message: string): void {
    const frame = this.asideFrame;
    if (!frame || frame.requestId !== requestId) return;
    if (frame.receivedOps === 0) {
      this.queue.push(...this.header.fallback.ops.map((op) => ({ op, origin: "aside" as const })));
    }
    this.completeAside(requestId, this.header.fallback.resume);
  }

  private cleanupAsideStage(frame: NonNullable<typeof this.asideFrame>): void {
    const cleanup: QueueItem[] = [{ op: { op: "clear_highlights", id: `aside.clear.${this.history.length}` }, origin: "aside" }];
    if (!frame.keepStage) {
      const shown = this.state.board.order.filter((id) => !frame.stageIdsBefore.has(id));
      if (shown.length > 0) cleanup.push({ op: { op: "clear", id: `aside.remove.${this.history.length}`, targets: shown }, origin: "aside" });
    }
    for (const item of cleanup) {
      this.history.push(item);
      this.set({ board: applyOp(this.state.board, item.op) });
    }
  }

  private fastForward(ops: Iterable<Op>): void {
    for (const op of ops) {
      switch (op.op) {
        case "show":
        case "update":
        case "move":
        case "clear":
        case "clear_highlights":
        case "pin": {
          const item: QueueItem = { op, origin: "beat" };
          this.history.push(item);
          this.set({ board: applyOp(this.state.board, op) });
          break;
        }
        case "check":
          this.fastForward(op.onCorrect ?? []);
          break;
        default:
          break;
      }
    }
    if (this.state.board.highlights.length > 0) {
      const item: QueueItem = { op: { op: "clear_highlights", id: `ff.clear.${this.history.length}` }, origin: "beat" };
      this.history.push(item);
      this.set({ board: applyOp(this.state.board, item.op) });
    }
  }

  private pendingLessonOps(): Op[] {
    const queue = this.asideFrame ? this.asideFrame.savedQueue : this.queue;
    const ops = queue.filter((i) => i.origin === "beat").map((i) => i.op);
    const check = this.state.check;
    if (this.state.mode === "awaiting_check" && check && check.result === null) {
      return [...(check.op.onCorrect ?? []), ...ops];
    }
    return ops;
  }

  private finishAside(): void {
    const frame = this.asideFrame;
    if (!frame) return;
    this.asideFrame = null;
    this.cleanupAsideStage(frame);
    const resume = frame.resume ?? { mode: "continue" as const };
    this.emit({ kind: "aside_finished", resume: resume.mode });

    const bridge: QueueItem[] = resume.bridge
      ? [{ op: { op: "say", id: `bridge.${this.history.length}`, text: resume.bridge }, origin: "bridge" }]
      : [];

    switch (resume.mode) {
      case "continue": {
        this.queue = frame.savedQueue;
        if (frame.savedCheck) this.queue.unshift({ op: frame.savedCheck.op, origin: "beat" });
        this.queue.unshift(...bridge);
        break;
      }
      case "rewind": {
        this.queue = frame.savedQueue;
        if (frame.savedCheck) this.queue.unshift({ op: frame.savedCheck.op, origin: "beat" });
        this.popToPreviousSentence();
        this.queue.unshift(...bridge);
        break;
      }
      case "skip": {
        this.queue = [];
        this.queue.unshift(...bridge);
        break;
      }
    }
    this.prefetchUpcoming();
    this.set({ aside: null });
  }

  private buildAskContext(): AskContext {
    const says = this.history.filter((i) => i.op.op === "say" && i.origin !== "aside").map((i) => (i.op as Extract<Op, { op: "say" }>).text);
    const board = this.state.board;
    const summary = board.order.map((id) => {
      const el = board.elements[id]!;
      switch (el.kind) {
        case "array_row":
          return `${el.label ? `${el.label} ` : ""}(id ${el.id}): [${el.values.join(", ")}]${el.role === "output" ? " (the output)" : ""}`;
        case "split_tree":
          return `${el.id}: split tree over ${el.values.join(" ")}, ${el.revealDepth} levels of splitting shown${el.sortedFromDepth !== undefined ? `, merged back up to level ${el.sortedFromDepth}` : ""}`;
        case "text_card":
          return `${el.id}: card${el.title ? ` "${el.title}"` : ""}: ${el.body.replace(/\n/g, " / ")}`;
        case "latex":
          return `${el.id}: formula ${el.tex}`;
      }
    });
    const activeCheck = this.asideFrame?.savedCheck?.op.prompt ?? (this.state.mode === "awaiting_check" ? (this.state.check?.op.prompt ?? null) : null);
    return {
      beatId: this.beatId,
      beatTitle: this.beat?.title ?? this.header.outline[this.state.beatIndex]?.title ?? "",
      currentSentence: this.state.caption?.text ?? null,
      recentSentences: says.slice(-4),
      boardSummary: summary,
      pins: board.pins.map((p) => p.title ?? p.text ?? p.pinId),
      activeCheck,
      calibrationAnswer: this.state.calibrationAnswer,
    };
  }

  // ---- navigation ---------------------------------------------------------

  private popToPreviousSentence(): void {
    const requeue: QueueItem[] = [];
    while (this.history.length > 0) {
      const item = this.history.pop()!;
      const currentBeatStart = this.beatStarts[this.state.beatIndex] ?? 0;
      if (this.history.length < currentBeatStart && this.state.beatIndex > 0) {
        const prev = this.state.beatIndex - 1;
        this.set({
          beatIndex: prev,
          completedBeats: this.state.completedBeats.filter((id) => id !== this.beats[prev]?.id),
        });
      }
      if (item.origin === "beat") requeue.unshift(item);
      if (item.op.op === "say" && item.origin === "beat") break;
    }
    this.queue.unshift(...requeue);
    this.recomputeBoard();
  }

  rewind(): void {
    if (this.state.mode === "finished") this.set({ mode: "paused" });
    this.stopCurrent();
    if (this.asideFrame) {
      this.set({ mode: "playing", check: null });
      void this.run();
      return;
    }
    this.popToPreviousSentence();
    this.toast("Going back");
    this.set({ mode: "playing", check: null, aside: null, waiting: null });
    void this.run();
  }

  repeat(): void {
    const wasInFlight = this.inFlight !== null;
    this.stopCurrent();
    if (!wasInFlight) {
      const requeue: QueueItem[] = [];
      while (this.history.length > 0) {
        const item = this.history.pop()!;
        requeue.unshift(item);
        if (item.op.op === "say") break;
      }
      this.queue.unshift(...requeue);
      this.recomputeBoard();
    }
    this.toast("Once more");
    this.set({ mode: "playing", check: null, waiting: null });
    void this.run();
  }

  skipBeat(): void {
    if (this.state.mode === "finished") return;
    this.stopCurrent();
    const remaining = this.pendingLessonOps();
    if (this.asideFrame) {
      this.cleanupAsideStage(this.asideFrame);
      this.asideFrame = null;
    }
    this.fastForward(remaining);
    this.queue = [];
    this.set({ mode: "playing", aside: null, check: null, caption: null, waiting: null });
    this.toast("Skipping ahead");
    void this.run();
  }

  jumpToBeat(index: number): void {
    if (index < 0 || index >= this.header.outline.length) return;
    if (this.state.mode === "calibrating" || this.state.mode === "idle") return;
    this.stopCurrent();
    if (index <= this.state.beatIndex) {
      this.asideFrame = null;
      const start = this.beatStarts[index] ?? 0;
      this.history.length = start;
      this.beatStarts.length = index + 1;
      this.set({
        completedBeats: this.state.completedBeats.filter((id) => this.header.outline.findIndex((b) => b.id === id) < index),
      });
    } else {
      const remaining = this.pendingLessonOps();
      if (this.asideFrame) {
        this.cleanupAsideStage(this.asideFrame);
        this.asideFrame = null;
      }
      this.fastForward(remaining);
      const completed = [...this.state.completedBeats];
      const markDone = (id: string) => {
        if (!completed.includes(id)) completed.push(id);
      };
      markDone(this.beatId);
      for (let i = this.state.beatIndex + 1; i < index; i++) {
        const b = this.beats[i];
        this.beatStarts[i] = this.history.length;
        if (b) {
          this.fastForward(b.ops);
          markDone(b.id);
        }
      }
      this.set({ completedBeats: completed });
    }
    this.recomputeBoard();
    this.set({ mode: "playing", beatIndex: index, check: null, aside: null, caption: null, waiting: null });
    if (this.beats[index]) {
      this.waitingForBeat = false;
      this.loadBeatQueue(index);
      void this.run();
    } else {
      this.queue = [];
      this.waitingForBeat = true;
      this.set({ waiting: "beat" });
    }
  }

  // ---- checks -------------------------------------------------------------

  answerCheck(answer: string | ElementRef): void {
    const check = this.state.check;
    if (!check || this.state.mode !== "awaiting_check" || check.result !== null) return;
    const op = check.op;
    const graded = op.graded ?? true;
    let correct = true;
    let answerText: string;
    if (typeof answer === "string") {
      answerText = answer;
      if (graded) {
        const expected = Array.isArray(op.expected) ? op.expected : [];
        correct = expected.some((e) => normalizeAnswer(e) === normalizeAnswer(answer));
      }
    } else {
      const el = this.state.board.elements[answer.id];
      const value = el && el.kind === "array_row" && answer.index !== undefined ? el.values[answer.index] : undefined;
      answerText = value !== undefined ? String(value) : answer.id;
      if (graded) {
        const expected = op.expected;
        correct = !!expected && !Array.isArray(expected) && sameRef(expected, answer);
      }
    }
    this.set({ check: { op, result: { correct, answer: answerText } } });
    this.emit({ kind: "check_answered", checkId: op.id, answer: answerText, correct });
    const reactions = (graded && !correct ? op.onIncorrect : op.onCorrect) ?? [];
    if (graded && typeof answer !== "string") {
      const mark: QueueItem = {
        op: { op: "highlight", id: `grade.${this.history.length}`, targets: [answer], tone: correct ? "correct" : "incorrect" },
        origin: "reaction",
      };
      this.history.push(mark);
      this.set({ board: applyOp(this.state.board, mark.op) });
    }
    this.queue.unshift(...reactions.map((r) => ({ op: r, origin: "reaction" as const })));
    this.prefetchUpcoming();
    setTimeout(() => {
      if (this.state.mode !== "awaiting_check") return;
      this.set({ mode: "playing" });
      void this.run();
    }, 550 * this.settleScale);
  }
}
