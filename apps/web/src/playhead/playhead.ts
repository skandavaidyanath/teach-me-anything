import { normalizeAnswer, sameRef, type CheckOp, type ElementRef, type Lesson, type NavCommand, type Op, type Resume } from "@tma/schema";
import { applyOp, emptyBoard, replay, type BoardState } from "./board-reducer";
import { dispatchInput } from "./dispatcher";
import { createSpeaker, speechAvailable, type SpeakHandle, type Speaker, type SpeakerKind } from "./speaker";

/**
 * The playhead executes ops in order, owns the local interrupt path, and
 * exposes a snapshot for React. It is the client-side runtime from the plan:
 * no model calls, and pause, seek, and resume are all local.
 *
 * Board state is always `replay(history)`. Rewind pops history back to a
 * sentence boundary and requeues what it popped. Asides run on a swapped-in
 * queue and resume by restoring the saved one.
 */

export type Mode = "calibrating" | "idle" | "playing" | "paused" | "awaiting_check" | "finished";

export type Origin = "beat" | "reaction" | "aside" | "bridge";

type QueueItem = { op: Op; origin: Origin };

export type Caption = { text: string; spokenChars: number; origin: Origin };

export type CheckState = {
  op: CheckOp;
  result: { correct: boolean; answer: string } | null;
};

export type PlayheadState = {
  mode: Mode;
  beatIndex: number;
  completedBeats: string[];
  board: BoardState;
  caption: Caption | null;
  check: CheckState | null;
  aside: { title: string } | null;
  pointed: ElementRef | null;
  typingArmed: boolean;
  calibrationAnswer: string | null;
  speakerKind: SpeakerKind;
  speechAvailable: boolean;
  toast: string | null;
};

type Listener = () => void;

const SETTLE_MS: Partial<Record<Op["op"], number>> = {
  show: 420,
  update: 520,
  highlight: 320,
  clear_highlights: 120,
  clear: 240,
  pin: 360,
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type PlayheadOptions = {
  /** Replace the speaker, e.g. a manual one in tests. */
  speaker?: Speaker;
  /** Multiplier on settle delays between board ops. 0 in tests. */
  settleScale?: number;
};

export class Playhead {
  private state: PlayheadState;
  private listeners = new Set<Listener>();
  private readonly settleScale: number;

  private history: QueueItem[] = [];
  private beatStarts: number[] = [];
  private queue: QueueItem[] = [];

  private runToken = 0;
  private inFlight: QueueItem | null = null;
  private speakHandle: SpeakHandle | null = null;
  private speaker: Speaker;

  private pauseAtBoundary = false;
  private softPaused = false;

  private asideFrame: {
    savedQueue: QueueItem[];
    savedCheck: CheckState | null;
    stageIdsBefore: Set<string>;
    resume: Resume;
    keepStage: boolean;
  } | null = null;

  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly lesson: Lesson,
    opts: PlayheadOptions = {},
  ) {
    // Start silent on both server and client so the first render matches;
    // detectSpeech() upgrades to voice after mount when the browser has it.
    this.injectedSpeaker = opts.speaker ?? null;
    this.speaker = opts.speaker ?? createSpeaker("silent");
    this.settleScale = opts.settleScale ?? 1;
    this.state = {
      mode: lesson.calibration ? "calibrating" : "idle",
      beatIndex: 0,
      completedBeats: [],
      board: emptyBoard,
      caption: null,
      check: null,
      aside: null,
      pointed: null,
      typingArmed: false,
      calibrationAnswer: null,
      speakerKind: this.speaker.kind,
      speechAvailable: false,
      toast: null,
    };
  }

  private readonly injectedSpeaker: Speaker | null;

  /** Client-only: switch to the browser's voice if it has one. Call once after mount. */
  detectSpeech(): void {
    if (this.injectedSpeaker) return;
    const available = speechAvailable();
    if (!available || this.state.speechAvailable) return;
    this.speaker = createSpeaker("voice");
    this.set({ speechAvailable: true, speakerKind: this.speaker.kind });
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

  private toast(message: string, ms = 1600): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.set({ toast: message });
    this.toastTimer = setTimeout(() => this.set({ toast: null }), ms);
  }

  get beat() {
    return this.lesson.beats[this.state.beatIndex]!;
  }

  // ---- lifecycle ----------------------------------------------------------

  start(calibrationAnswer: string | null = null): void {
    this.history = [];
    this.beatStarts = [0];
    this.queue = this.lesson.beats[0]!.ops.map((op) => ({ op, origin: "beat" as const }));
    this.asideFrame = null;
    this.set({
      mode: "playing",
      beatIndex: 0,
      completedBeats: [],
      board: emptyBoard,
      caption: null,
      check: null,
      aside: null,
      calibrationAnswer,
    });
    void this.run();
  }

  setSpeaker(kind: SpeakerKind): void {
    if (kind === this.speaker.kind) return;
    const wasSpeaking = this.inFlight?.op.op === "say" && this.state.mode === "playing";
    if (wasSpeaking) this.stopCurrent();
    this.speaker = createSpeaker(kind);
    this.set({ speakerKind: this.speaker.kind });
    if (wasSpeaking) void this.run();
  }

  // ---- the loop -----------------------------------------------------------

  private async run(): Promise<void> {
    const token = ++this.runToken;
    while (token === this.runToken && this.state.mode === "playing") {
      const item = this.queue.shift();
      if (!item) {
        if (this.asideFrame) {
          this.finishAside();
          continue;
        }
        if (!this.advanceBeat()) {
          this.set({ mode: "finished", caption: null });
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
        // A verdict ("Right" / "Not quite") belongs to the reaction that follows a check.
        // Once the lesson itself speaks again, it is stale.
        const staleVerdict = item.origin !== "reaction" && this.state.check?.result ? { check: null } : {};
        this.set({ caption: { text: op.text, spokenChars: 0, origin: item.origin }, ...staleVerdict });
        const handle = this.speaker.speak(op.text, (chars) => {
          if (token !== this.runToken) return;
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
      default: {
        this.set({ board: applyOp(this.state.board, op) });
        if (op.op === "pin") this.toast(`Pinned: ${op.pin.title ?? op.pin.text ?? op.pin.pinId}`, 2600);
        const ms = SETTLE_MS[op.op] ?? 200;
        await sleep(ms * this.settleScale);
        return;
      }
    }
  }

  private advanceBeat(): boolean {
    const next = this.state.beatIndex + 1;
    const completed = [...this.state.completedBeats, this.beat.id];
    if (next >= this.lesson.beats.length) {
      this.set({ completedBeats: completed });
      return false;
    }
    this.beatStarts[next] = this.history.length;
    this.queue = this.lesson.beats[next]!.ops.map((op) => ({ op, origin: "beat" as const }));
    this.set({ beatIndex: next, completedBeats: completed, check: null });
    return true;
  }

  private recomputeBoard(): void {
    this.set({ board: replay(this.history.map((h) => h.op)) });
  }

  /** Cancel speech, put an in-flight sentence back at the front, invalidate the loop. */
  private stopCurrent(): void {
    this.runToken++;
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

  /** Soft interrupt: the learner started (or stopped) typing. */
  setTyping(typing: boolean): void {
    if (typing) {
      if (this.state.mode === "playing") this.pauseAtBoundary = true;
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

  /** The learner submitted text. Checks first, then navigation, then branches. */
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
    const dispatch = dispatchInput(this.lesson, text, { beatId: this.beat.id, pointed });
    this.set({ pointed: null, typingArmed: false });
    this.pauseAtBoundary = false;
    if (dispatch.kind === "nav") {
      this.nav(dispatch.command);
      return;
    }
    if (this.state.mode === "finished" || this.state.mode === "calibrating" || this.state.mode === "idle") return;
    if (dispatch.kind === "branch") {
      this.startAside(dispatch.branch.ops, dispatch.branch.resume, dispatch.branch.title ?? "Aside", dispatch.branch.keepStage ?? false);
    } else {
      this.startAside(this.lesson.fallback.ops, this.lesson.fallback.resume, "Aside", false);
    }
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

  private startAside(ops: Op[], resume: Resume, title: string, keepStage: boolean): void {
    if (this.asideFrame) {
      // A question during an aside replaces the aside; the original lesson position is kept.
      this.stopCurrent();
      this.queue = [];
    } else {
      this.stopCurrent();
      this.asideFrame = {
        savedQueue: this.queue,
        savedCheck: this.state.mode === "awaiting_check" ? this.state.check : null,
        stageIdsBefore: new Set(this.state.board.order),
        resume,
        keepStage,
      };
      this.queue = [];
    }
    this.asideFrame.resume = resume;
    this.asideFrame.keepStage = keepStage;
    this.queue = ops.map((op) => ({ op, origin: "aside" as const }));
    this.softPaused = false;
    this.set({ mode: "playing", aside: { title }, check: null, typingArmed: false });
    void this.run();
  }

  /** Remove what an aside put on the stage, unless the branch asked to keep it. */
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

  /**
   * Apply the board effects of content the learner is skipping past, without
   * speaking it: shows, updates, clears, pins. Checks follow their correct path.
   * Highlights are transient and are dropped. The stage ends up where the
   * lesson would have left it.
   */
  private fastForward(ops: Iterable<Op>): void {
    for (const op of ops) {
      switch (op.op) {
        case "show":
        case "update":
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

  /** The lesson's own pending ops, whether or not an aside is on top of them. */
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

    const bridge: QueueItem[] = frame.resume.bridge
      ? [{ op: { op: "say", id: `bridge.${this.history.length}`, text: frame.resume.bridge }, origin: "bridge" }]
      : [];

    switch (frame.resume.mode) {
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
    this.set({ aside: null });
  }

  // ---- navigation ---------------------------------------------------------

  /** Move history back past the previous sentence, requeueing lesson ops; spliced ops are dropped. */
  private popToPreviousSentence(): void {
    const requeue: QueueItem[] = [];
    while (this.history.length > 0) {
      const item = this.history.pop()!;
      const currentBeatStart = this.beatStarts[this.state.beatIndex] ?? 0;
      if (this.history.length < currentBeatStart && this.state.beatIndex > 0) {
        // Crossed into the previous beat.
        const prev = this.state.beatIndex - 1;
        this.set({
          beatIndex: prev,
          completedBeats: this.state.completedBeats.filter((id) => id !== this.lesson.beats[prev]!.id),
        });
      }
      if (item.origin === "beat") requeue.unshift(item);
      if (item.op.op === "say" && item.origin === "beat") break;
    }
    this.queue.unshift(...requeue);
    this.recomputeBoard();
  }

  rewind(): void {
    if (this.state.mode === "finished") {
      this.set({ mode: "paused" });
    }
    const wasPlaying = this.state.mode === "playing";
    this.stopCurrent();
    if (this.asideFrame) {
      // Rewinding inside an aside: just restart the aside's current sentence.
      this.set({ mode: "playing", check: null });
      void this.run();
      return;
    }
    // The in-flight sentence (if any) is already requeued by stopCurrent; go one further back.
    this.popToPreviousSentence();
    this.toast("Going back");
    this.set({ mode: "playing", check: null, aside: null });
    void this.run();
    void wasPlaying;
  }

  repeat(): void {
    const wasInFlight = this.inFlight !== null;
    this.stopCurrent();
    if (!wasInFlight) {
      // Nothing mid-sentence: requeue back to and including the last sentence of any origin.
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
    this.set({ mode: "playing", check: null });
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
    this.set({ mode: "playing", aside: null, check: null, caption: null });
    this.toast("Skipping ahead");
    void this.run();
  }

  jumpToBeat(index: number): void {
    if (index < 0 || index >= this.lesson.beats.length) return;
    if (this.state.mode === "calibrating" || this.state.mode === "idle") return;
    this.stopCurrent();
    if (index <= this.state.beatIndex) {
      this.asideFrame = null;
      const start = this.beatStarts[index] ?? 0;
      this.history.length = start;
      this.beatStarts.length = index + 1;
      this.set({
        completedBeats: this.state.completedBeats.filter((id) => this.lesson.beats.findIndex((b) => b.id === id) < index),
      });
    } else {
      // Jumping forward: the board catches up with everything skipped, silently.
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
      markDone(this.beat.id);
      for (let i = this.state.beatIndex + 1; i < index; i++) {
        this.beatStarts[i] = this.history.length;
        this.fastForward(this.lesson.beats[i]!.ops);
        markDone(this.lesson.beats[i]!.id);
      }
      this.beatStarts[index] = this.history.length;
      this.set({ completedBeats: completed });
    }
    this.queue = this.lesson.beats[index]!.ops.map((op) => ({ op, origin: "beat" as const }));
    this.recomputeBoard();
    this.set({ mode: "playing", beatIndex: index, check: null, aside: null, caption: null });
    void this.run();
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
    const reactions = (graded && !correct ? op.onIncorrect : op.onCorrect) ?? [];
    if (graded) {
      const tone = correct ? "correct" : "incorrect";
      if (typeof answer !== "string") {
        const mark: QueueItem = {
          op: { op: "highlight", id: `grade.${this.history.length}`, targets: [answer], tone },
          origin: "reaction",
        };
        this.history.push(mark);
        this.set({ board: applyOp(this.state.board, mark.op) });
      }
    }
    this.queue.unshift(...reactions.map((r) => ({ op: r, origin: "reaction" as const })));
    // Let the tick land before the tutor reacts.
    setTimeout(() => {
      if (this.state.mode !== "awaiting_check") return;
      this.set({ mode: "playing" });
      void this.run();
    }, 550 * this.settleScale);
  }
}
