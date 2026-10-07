import {
  headerFromLesson,
  normalizeAnswer,
  sameRef,
  type Beat,
  type Branch,
  type CheckOp,
  type ElementRef,
  type Lesson,
  type LessonHeader,
  type NavCommand,
  type Op,
  type OutlineEntry,
  type PlayheadEvent,
  type RecordEntry,
  type TutorContext,
  type TutorTiming,
  type TutorWindow,
} from "@tma/schema";
import { applyOp, emptyBoard, replay, type BoardState } from "./board-reducer";
import { dispatchInput } from "./dispatcher";
import { createSpeaker, speechAvailable, type SpeakHandle, type Speaker } from "./speaker";

/**
 * The playhead executes ops in order, owns the local interrupt path, and
 * exposes a snapshot for React. No model calls happen here; pause, seek,
 * and resume are local.
 *
 * Content arrives as a header plus beats appended over time. Board state is
 * always `replay(history)`. A question holds the pending lesson ops while the
 * Tutor's answer streams in ahead of them; when the Tutor's edited window
 * arrives it replaces the pending ops and the opening of the next beat. At
 * a check, if anything happened since the next beat was written, the Tutor
 * reviews it before it plays.
 */

export type Mode = "calibrating" | "idle" | "playing" | "paused" | "awaiting_check" | "finished";
export type Origin = "beat" | "reaction" | "answer" | "bridge";
export type SpeakerKind = "voice" | "silent";

type QueueItem = { op: Op; origin: Origin };

export type Caption = { text: string; spokenChars: number; origin: Origin };
export type CheckState = { op: CheckOp; result: { correct: boolean; answer: string } | null };

export type AskTelemetry = {
  requestId: string;
  kind: "ask" | "review";
  sentAt: number;
  firstOpMs: number | null;
  firstAudioMs: number | null;
  doneMs: number | null;
  server: TutorTiming | null;
};

export type Telemetry = {
  rttMs: number | null;
  tts: { fetchMs: number; cached: boolean; synthMs: number } | null;
  ask: AskTelemetry | null;
  reviews: number;
};

export type PlayheadState = {
  mode: Mode;
  title: string;
  calibration: { prompt: string; options: string[] } | null;
  beatIndex: number;
  outline: OutlineEntry[];
  loadedBeats: number;
  completedBeats: string[];
  board: BoardState;
  caption: Caption | null;
  check: CheckState | null;
  /** The Tutor is answering, or a prepared branch is playing. */
  answering: { title: string } | null;
  /** Element ids on the board before the answer began; anything else is the Tutor's drawing. */
  layerBaseIds: string[] | null;
  /** The loop is idle because content has not arrived yet. */
  waiting: "beat" | "answer" | null;
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

const SETTLE_MS: Partial<Record<Op["op"], number>> = { show: 420, update: 520, move: 560, highlight: 320, clear_highlights: 120, clear: 240 };
const FILLERS = ["Good question.", "Let me think about that for a second.", "Right, let me answer that."];
const PREFETCH_AHEAD = 3;
/** How much of the next beat the Tutor may edit. */
const NEXT_PREFIX_OPS = 5;

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
  speaker?: Speaker;
  settleScale?: number;
};

export type TutorAskRequest = { requestId: string; text: string; pointed: string | null; context: TutorContext; window: TutorWindow };
export type TutorReviewRequest = { requestId: string; context: TutorContext; window: TutorWindow };

export class Playhead {
  private state: PlayheadState;
  private listeners = new Set<Listener>();
  private readonly settleScale: number;

  private header: LessonHeader;
  private beats: Beat[] = [];
  /** Event count at which each beat was last written or reviewed. */
  private reviewedAt: number[] = [];
  private eventCount = 0;
  private record: RecordEntry[] = [];

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

  /** Lesson ops wait behind this request until its window arrives. */
  private holdFor: string | null = null;
  private pendingRequest: { requestId: string; kind: "ask" | "review"; nextBeatIndex: number | null; nextPrefixCount: number; beatIndexAtSend: number } | null = null;
  private answerDone = false;
  private skipAfterAnswer = false;
  private fillerTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  onAsk: ((req: TutorAskRequest) => void) | null = null;
  onReview: ((req: TutorReviewRequest) => void) | null = null;
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
      answering: null,
      layerBaseIds: null,
      waiting: null,
      pointed: null,
      typingArmed: false,
      calibrationAnswer: null,
      speakerKind: this.voiceSpeaker ? "voice" : "silent",
      speechAvailable: !!this.voiceSpeaker,
      toast: null,
      pinSpotlight: null,
      telemetry: { rttMs: null, tts: null, ask: null, reviews: 0 },
    };
  }

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
  /** Record what happened. Only things worth adapting to bump the review counter; a correct answer is just recorded. */
  private note(entry: RecordEntry): void {
    this.record.push(entry);
    const matters = entry.kind !== "check" || !entry.correct;
    if (matters) this.eventCount++;
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
    this.reviewedAt[at] = this.eventCount;
    this.set({ loadedBeats: this.beats.filter(Boolean).length });
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

  /** A replan: the outline changes from `fromIndex`, and beats from there will arrive again. */
  replaceFrom(fromIndex: number, outline: OutlineEntry[]): void {
    if (fromIndex <= this.state.beatIndex) return;
    this.beats.length = Math.min(this.beats.length, fromIndex);
    this.reviewedAt.length = Math.min(this.reviewedAt.length, fromIndex);
    const newOutline = [...this.header.outline.slice(0, fromIndex), ...outline];
    this.header = { ...this.header, outline: newOutline };
    this.set({ outline: newOutline, loadedBeats: this.beats.filter(Boolean).length });
    this.toast("Adjusting the rest of the lesson");
  }

  private loadBeatQueue(index: number): void {
    const beat = this.beats[index]!;
    this.beatStarts[index] = this.history.length;
    this.queue = beat.ops.map((op) => ({ op, origin: "beat" as const }));
    this.prefetchUpcoming();
    this.emit({ kind: "beat_started", beatId: beat.id, index });
  }

  // ---- speakers -----------------------------------------------------------

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
    if (texts.length < PREFETCH_AHEAD) {
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
    this.waitingForBeat = false;
    this.holdFor = null;
    this.pendingRequest = null;
    this.record = [];
    this.eventCount = 0;
    this.reviewedAt = this.beats.map(() => 0);
    this.set({
      mode: "playing",
      beatIndex: 0,
      completedBeats: [],
      board: emptyBoard,
      caption: null,
      check: null,
      answering: null,
      layerBaseIds: null,
      waiting: null,
      calibrationAnswer,
    });
    if (calibrationAnswer) this.note({ kind: "calibration", answer: calibrationAnswer });
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
      const item = this.queue[0];
      if (!item) {
        if (this.holdFor) {
          this.set({ waiting: "answer" });
          return;
        }
        if (this.state.answering) {
          // Ending an answer may hand control back to a pending check; let the loop condition see the new mode.
          this.endAnswer();
          continue;
        }
        const next = this.advanceBeat();
        if (next === "finished") {
          this.set({ mode: "finished", caption: null, waiting: null });
          this.emit({ kind: "lesson_finished" });
        } else if (next === "waiting") return;
        continue;
      }
      if (item.origin === "beat" || item.origin === "reaction") {
        if (this.holdFor) {
          this.set({ waiting: "answer" });
          return;
        }
        if (this.state.answering) {
          this.endAnswer();
          if (this.skipAfterAnswer) {
            this.skipAfterAnswer = false;
            this.skipBeat();
            return;
          }
          if (this.state.mode !== "playing") return;
        }
      }
      this.queue.shift();
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
            if (item.origin === "answer" && ask && ask.firstAudioMs === null) this.setTelemetry({ ask: { ...ask, firstAudioMs: Math.round(performance.now() - ask.sentAt) } });
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
      case "pause":
        await sleep(op.ms * this.settleScale);
        return;
      case "check":
        this.set({ mode: "awaiting_check", check: { op, result: null } });
        return;
      case "pin": {
        this.set({ board: applyOp(this.state.board, op), pinSpotlight: { pinId: op.pin.pinId } });
        await sleep(1300 * this.settleScale);
        this.set({ pinSpotlight: null });
        if (token !== this.runToken) return;
        await sleep(700 * this.settleScale);
        return;
      }
      default: {
        this.set({ board: applyOp(this.state.board, op) });
        await sleep((SETTLE_MS[op.op] ?? 200) * this.settleScale);
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
    } else if (this.state.mode === "paused") this.resume();
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
      const looksLikeAnswer = kind === "free_text" || (kind === "choice" && (check.op.options ?? []).some((o) => normalizeAnswer(o) === normalizeAnswer(text)));
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
      this.playBranch(dispatch.branch, text);
      return;
    }
    if (this.onAsk) {
      this.ask(text, pointed);
      return;
    }
    // Offline: the lesson's canned line.
    this.beginAnswer("Aside");
    this.insertAnswerOps(this.header.fallback.ops);
    if (this.header.fallback.resume.bridge) this.insertAnswerOps([{ op: "say", id: `fb.bridge.${this.history.length}`, text: this.header.fallback.resume.bridge }], "bridge");
    void this.run();
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
        this.note({ kind: "skipped", beatId: this.beatId });
        this.skipBeat();
        return;
      case "restart":
        this.toast("Starting over");
        this.start(this.state.calibrationAnswer);
        return;
    }
  }

  // ---- answers: the Tutor, or a prepared branch ---------------------------

  /** Where the next answer op goes: after answer ops already queued, before the lesson's. */
  private answerInsertIndex(): number {
    let i = 0;
    while (i < this.queue.length && (this.queue[i]!.origin === "answer" || this.queue[i]!.origin === "bridge")) i++;
    return i;
  }

  private beginAnswer(title: string): void {
    if (this.fillerTimer) clearTimeout(this.fillerTimer);
    const wasAnswering = this.state.answering !== null;
    this.stopCurrent();
    if (wasAnswering) {
      // A new question replaces the answer in progress; the lesson's pending ops are untouched.
      this.queue = this.queue.filter((i) => i.origin !== "answer" && i.origin !== "bridge");
    }
    this.answerDone = false;
    this.skipAfterAnswer = false;
    this.softPaused = false;
    this.set({
      mode: "playing",
      answering: { title },
      layerBaseIds: this.state.layerBaseIds ?? [...this.state.board.order],
      check: this.state.mode === "awaiting_check" ? this.state.check : null,
      typingArmed: false,
      waiting: null,
    });
  }

  private guardOps(ops: Op[], base: Set<string>): Op[] {
    return ops.filter((op) => {
      switch (op.op) {
        case "show":
          return !base.has(op.element.id);
        case "update":
          return !base.has(op.target);
        case "move":
          return !base.has(op.from.id) && !base.has(op.to.id);
        case "clear":
          return false;
        default:
          return true;
      }
    });
  }

  private insertAnswerOps(ops: Op[], origin: Origin = "answer"): void {
    const base = new Set(this.state.layerBaseIds ?? []);
    const allowed = this.guardOps(ops, base);
    this.queue.splice(this.answerInsertIndex(), 0, ...allowed.map((op) => ({ op, origin })));
    this.prefetchUpcoming();
  }

  private playBranch(branch: Branch, text: string): void {
    this.beginAnswer(branch.title ?? "Aside");
    this.insertAnswerOps(branch.ops);
    if (branch.resume.bridge) this.insertAnswerOps([{ op: "say", id: `br.bridge.${this.history.length}`, text: branch.resume.bridge }], "bridge");
    this.skipAfterAnswer = branch.resume.mode === "skip";
    this.note({ kind: "asked", beatId: this.beatId, text, answered: branch.title ?? branch.id });
    this.emit({ kind: "branch_played", branchId: branch.id, text });
    void this.run();
  }

  private pendingLessonItems(): QueueItem[] {
    return this.queue.filter((i) => i.origin === "beat");
  }

  private buildWindow(): { window: TutorWindow; nextBeatIndex: number | null; nextPrefixCount: number } {
    const nextIndex = this.state.beatIndex + 1;
    const next = this.beats[nextIndex];
    const nextPrefix = next ? next.ops.slice(0, NEXT_PREFIX_OPS) : [];
    return {
      window: {
        currentBeatId: this.beatId,
        current: this.pendingLessonItems().map((i) => i.op),
        nextBeatId: next?.id ?? null,
        nextPrefix,
      },
      nextBeatIndex: next ? nextIndex : null,
      nextPrefixCount: nextPrefix.length,
    };
  }

  private ask(text: string, pointed: string | null): void {
    const requestId = `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this.beginAnswer("Answering");
    const { window, nextBeatIndex, nextPrefixCount } = this.buildWindow();
    const context = this.buildContext();
    this.holdFor = requestId;
    this.pendingRequest = { requestId, kind: "ask", nextBeatIndex, nextPrefixCount, beatIndexAtSend: this.state.beatIndex };
    this.setTelemetry({ ask: { requestId, kind: "ask", sentAt: performance.now(), firstOpMs: null, firstAudioMs: null, doneMs: null, server: null } });
    this.note({ kind: "asked", beatId: this.beatId, text, answered: null });
    this.onAsk?.({ requestId, text, pointed, context, window });
    this.fillerTimer = setTimeout(() => {
      if (this.holdFor !== requestId || this.answerInsertIndex() > 0) return;
      const filler = FILLERS[Math.floor(Math.random() * FILLERS.length)]!;
      this.insertAnswerOps([{ op: "say", id: `${requestId}.filler`, text: filler }]);
      if (this.state.waiting === "answer" && this.state.mode === "playing") {
        this.set({ waiting: null });
        void this.run();
      }
    }, 900 * this.settleScale);
    void this.run();
  }

  /** At a check, review the next beat if anything happened since it was written. */
  private maybeReview(): void {
    if (!this.onReview || this.holdFor) return;
    const nextIndex = this.state.beatIndex + 1;
    const next = this.beats[nextIndex];
    if (!next) return;
    if ((this.reviewedAt[nextIndex] ?? 0) >= this.eventCount) return;
    const requestId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const { window, nextPrefixCount } = this.buildWindow();
    this.pendingRequest = { requestId, kind: "review", nextBeatIndex: nextIndex, nextPrefixCount, beatIndexAtSend: this.state.beatIndex };
    this.reviewedAt[nextIndex] = this.eventCount;
    this.setTelemetry({ ask: { requestId, kind: "review", sentAt: performance.now(), firstOpMs: null, firstAudioMs: null, doneMs: null, server: null }, reviews: this.state.telemetry.reviews + 1 });
    this.onReview({ requestId, context: this.buildContext(), window });
  }

  appendAnswerOps(requestId: string, ops: Op[]): void {
    if (this.holdFor !== requestId) return;
    if (this.fillerTimer) clearTimeout(this.fillerTimer);
    const ask = this.state.telemetry.ask;
    if (ask && ask.requestId === requestId && ask.firstOpMs === null) this.setTelemetry({ ask: { ...ask, firstOpMs: Math.round(performance.now() - ask.sentAt) } });
    this.insertAnswerOps(ops);
    if (this.state.waiting === "answer" && this.state.mode === "playing") {
      this.set({ waiting: null });
      void this.run();
    }
  }

  applyWindow(requestId: string, current: Op[], nextPrefix: Op[] | null, timing: TutorTiming | null = null): void {
    const req = this.pendingRequest;
    if (!req || req.requestId !== requestId) return;
    this.pendingRequest = null;
    const ask = this.state.telemetry.ask;
    if (ask && ask.requestId === requestId) this.setTelemetry({ ask: { ...ask, doneMs: Math.round(performance.now() - ask.sentAt), server: timing } });
    const stillHere = this.state.beatIndex === req.beatIndexAtSend;
    if (stillHere && req.kind === "ask") {
      // Replace the pending lesson ops of this beat with the edited ones; answer ops stay in front.
      const kept = this.queue.filter((i) => i.origin !== "beat");
      this.queue = [...kept, ...current.map((op) => ({ op, origin: "beat" as const }))];
    }
    if (nextPrefix && req.nextBeatIndex !== null && this.beats[req.nextBeatIndex] && req.nextBeatIndex > this.state.beatIndex) {
      const beat = this.beats[req.nextBeatIndex]!;
      this.beats[req.nextBeatIndex] = { ...beat, ops: [...nextPrefix, ...beat.ops.slice(req.nextPrefixCount)] };
      this.reviewedAt[req.nextBeatIndex] = this.eventCount;
    }
    if (this.holdFor === requestId) {
      this.holdFor = null;
      this.answerDone = true;
    }
    this.prefetchUpcoming();
    if (this.state.waiting === "answer" && this.state.mode === "playing") {
      this.set({ waiting: null });
      void this.run();
    }
  }

  failTutor(requestId: string, _message: string): void {
    const req = this.pendingRequest;
    if (!req || req.requestId !== requestId) return;
    if (req.kind === "ask" && this.answerInsertIndex() === 0) this.insertAnswerOps(this.header.fallback.ops);
    this.applyWindow(requestId, this.pendingLessonItems().map((i) => i.op), null, null);
  }

  /** The answer span has played; clear what the Tutor drew and go back to the lesson. */
  private endAnswer(): void {
    const base = this.state.layerBaseIds ? new Set(this.state.layerBaseIds) : null;
    const cleanup: QueueItem[] = [{ op: { op: "clear_highlights", id: `answer.clear.${this.history.length}` }, origin: "answer" }];
    if (base) {
      const drawn = this.state.board.order.filter((id) => !base.has(id));
      if (drawn.length > 0) cleanup.push({ op: { op: "clear", id: `answer.remove.${this.history.length}`, targets: drawn }, origin: "answer" });
    }
    for (const item of cleanup) {
      this.history.push(item);
      this.set({ board: applyOp(this.state.board, item.op) });
    }
    const last = this.record[this.record.length - 1];
    if (last && last.kind === "asked" && last.answered === null) {
      const said = [...this.history].reverse().find((h) => h.origin === "answer" && h.op.op === "say");
      if (said && said.op.op === "say") last.answered = said.op.text;
    }
    this.set({ answering: null, layerBaseIds: null });
    const check = this.state.check;
    if (check && check.result === null && this.state.mode === "playing") {
      // The question came during a check that was never answered: ask it again.
      this.set({ mode: "awaiting_check" });
    }
  }

  private buildContext(): TutorContext {
    const says = this.history.filter((i) => i.op.op === "say" && i.origin !== "answer").map((i) => (i.op as Extract<Op, { op: "say" }>).text);
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
        case "scene":
          return `${el.id}: diagram${el.label ? ` "${el.label}"` : ""} with ${el.items.map((it, i) => `[${i}] ${it.type}${it.label ? ` "${it.label}"` : ""}`).join(", ")}`;
        case "derivation": {
          const shown = el.steps.slice(0, el.revealed).map((st, i) => `[${i}] ${st.tex}${st.note ? ` (${st.note})` : ""}`);
          return `${el.id}: derivation${el.label ? ` "${el.label}"` : ""}, ${el.revealed} of ${el.steps.length} lines shown: ${shown.join(" ; ")}`;
        }
      }
    });
    const outline = this.header.outline.map((b, i) => ({
      id: b.id,
      title: b.title,
      ...(b.summary ? { summary: b.summary } : {}),
      status: (i < this.state.beatIndex || this.state.completedBeats.includes(b.id) ? "done" : i === this.state.beatIndex ? "current" : "upcoming") as "done" | "current" | "upcoming",
    }));
    return {
      beatId: this.beatId,
      beatTitle: this.beat?.title ?? this.header.outline[this.state.beatIndex]?.title ?? "",
      outline,
      record: [...this.record],
      recentSentences: says.slice(-4),
      currentSentence: this.state.caption?.text ?? null,
      boardSummary: summary,
      pins: board.pins.map((p) => p.title ?? p.text ?? p.pinId),
      activeCheck: this.state.check && this.state.check.result === null ? this.state.check.op.prompt : null,
    };
  }

  // ---- navigation ---------------------------------------------------------

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
    const ops = this.pendingLessonItems().map((i) => i.op);
    const check = this.state.check;
    if (this.state.mode === "awaiting_check" && check && check.result === null) return [...(check.op.onCorrect ?? []), ...ops];
    return ops;
  }

  private dropAnswer(): void {
    if (this.fillerTimer) clearTimeout(this.fillerTimer);
    this.holdFor = null;
    this.pendingRequest = null;
    this.queue = this.queue.filter((i) => i.origin !== "answer" && i.origin !== "bridge");
    if (this.state.answering) this.endAnswer();
  }

  private popToPreviousSentence(): void {
    const requeue: QueueItem[] = [];
    while (this.history.length > 0) {
      const item = this.history.pop()!;
      const currentBeatStart = this.beatStarts[this.state.beatIndex] ?? 0;
      if (this.history.length < currentBeatStart && this.state.beatIndex > 0) {
        const prev = this.state.beatIndex - 1;
        this.set({ beatIndex: prev, completedBeats: this.state.completedBeats.filter((id) => id !== this.beats[prev]?.id) });
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
    if (this.state.answering) {
      this.set({ mode: "playing", check: null });
      void this.run();
      return;
    }
    this.popToPreviousSentence();
    this.toast("Going back");
    this.set({ mode: "playing", check: null, waiting: null });
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
    this.dropAnswer();
    this.fastForward(remaining);
    this.queue = [];
    this.set({ mode: "playing", check: null, caption: null, waiting: null });
    this.toast("Skipping ahead");
    void this.run();
  }

  jumpToBeat(index: number): void {
    if (index < 0 || index >= this.header.outline.length) return;
    if (this.state.mode === "calibrating" || this.state.mode === "idle") return;
    this.stopCurrent();
    this.dropAnswer();
    if (index <= this.state.beatIndex) {
      const start = this.beatStarts[index] ?? 0;
      this.history.length = start;
      this.beatStarts.length = index + 1;
      this.set({ completedBeats: this.state.completedBeats.filter((id) => this.header.outline.findIndex((b) => b.id === id) < index) });
    } else {
      const remaining = this.pendingLessonOps();
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
      this.note({ kind: "jumped", toBeatId: this.header.outline[index]?.id ?? String(index) });
    }
    this.recomputeBoard();
    this.set({ mode: "playing", beatIndex: index, check: null, caption: null, waiting: null });
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
      if (graded) correct = (Array.isArray(op.expected) ? op.expected : []).some((e) => normalizeAnswer(e) === normalizeAnswer(answer));
    } else {
      const el = this.state.board.elements[answer.id];
      answerText = answer.id;
      if (el && answer.index !== undefined) {
        if (el.kind === "array_row" && el.values[answer.index] !== undefined) answerText = String(el.values[answer.index]);
        else if (el.kind === "scene") answerText = el.items[answer.index]?.label ?? el.items[answer.index]?.id ?? answer.id;
        else if (el.kind === "derivation") answerText = `line ${answer.index + 1}`;
      }
      if (graded) correct = !!op.expected && !Array.isArray(op.expected) && sameRef(op.expected, answer);
    }
    this.set({ check: { op, result: { correct, answer: answerText } } });
    this.emit({ kind: "check_answered", checkId: op.id, answer: answerText, correct });
    if (graded) this.note({ kind: "check", beatId: this.beatId, prompt: op.prompt, answer: answerText, correct });
    const reactions = (graded && !correct ? op.onIncorrect : op.onCorrect) ?? [];
    if (graded && typeof answer !== "string") {
      const mark: QueueItem = { op: { op: "highlight", id: `grade.${this.history.length}`, targets: [answer], tone: correct ? "correct" : "incorrect" }, origin: "reaction" };
      this.history.push(mark);
      this.set({ board: applyOp(this.state.board, mark.op) });
    }
    this.queue.unshift(...reactions.map((r) => ({ op: r, origin: "reaction" as const })));
    this.prefetchUpcoming();
    this.maybeReview();
    setTimeout(() => {
      if (this.state.mode !== "awaiting_check") return;
      this.set({ mode: "playing" });
      void this.run();
    }, 550 * this.settleScale);
  }
}
