import { describe, expect, it } from "vitest";
import { mergeSortLesson } from "@tma/content";
import { headerFromLesson } from "@tma/schema";
import { Playhead } from "./playhead";
import type { SpeakHandle, SpeakOutcome, Speaker } from "./speaker";

/** A speaker the test drives by hand: nothing finishes until `finish()`. */
class ManualSpeaker implements Speaker {
  readonly kind = "silent" as const;
  spoken: string[] = [];
  private pending: Array<{ text: string; resolve: (o: SpeakOutcome) => void }> = [];

  get current(): string | null {
    return this.pending[0]?.text ?? null;
  }

  speak(text: string, onProgress: (chars: number) => void): SpeakHandle {
    this.spoken.push(text);
    let resolve!: (o: SpeakOutcome) => void;
    const done = new Promise<SpeakOutcome>((r) => (resolve = r));
    const entry = { text, resolve };
    this.pending.push(entry);
    onProgress(0);
    return {
      done,
      cancel: () => {
        this.pending = this.pending.filter((p) => p !== entry);
        resolve("cancelled");
      },
    };
  }

  finish(): void {
    const e = this.pending.shift();
    if (!e) throw new Error("nothing is being spoken");
    e.resolve("ended");
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function until(cond: () => boolean, label: string, tries = 500): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${label}`);
}

function make() {
  const speaker = new ManualSpeaker();
  const ph = Playhead.fromLesson(mergeSortLesson, { speaker, settleScale: 0 });
  return { speaker, ph };
}

/** Streaming mode: header only, beats appended by the test. */
function makeStreaming() {
  const speaker = new ManualSpeaker();
  const ph = new Playhead(headerFromLesson(mergeSortLesson), { speaker, settleScale: 0 });
  return { speaker, ph };
}

/** Right after an answer is graded the mode is still awaiting_check for one tick. */
function settled(ph: Playhead): boolean {
  const s = ph.getState();
  if (s.mode === "playing") return false;
  if (s.mode === "awaiting_check" && s.check && s.check.result !== null) return false;
  return true;
}

/** Wait until the given sentence is the one being spoken, finishing earlier ones. */
async function speakTo(speaker: ManualSpeaker, ph: Playhead, text: string): Promise<void> {
  for (let i = 0; i < 80; i++) {
    await until(() => speaker.current !== null || settled(ph), "next sentence or stop");
    if (speaker.current === text) return;
    if (speaker.current === null) throw new Error(`stopped in mode ${ph.getState().mode} before "${text}"`);
    speaker.finish();
  }
  throw new Error(`never reached "${text}"`);
}

/** Finish sentences until the lesson is waiting on a check. */
async function playToCheck(speaker: ManualSpeaker, ph: Playhead): Promise<void> {
  for (let i = 0; i < 80; i++) {
    await until(() => speaker.current !== null || settled(ph), "next sentence or check");
    if (ph.getState().mode === "awaiting_check") return;
    if (speaker.current === null) throw new Error(`stopped in mode ${ph.getState().mode}`);
    speaker.finish();
  }
  throw new Error("never reached a check");
}

const S1 = "Let's start with the one trick that makes merge sort work.";
const S2 = "Here are two lists that are already sorted.";
const S3 = "To merge them, you only ever compare the two front elements.";
const B2_S1 = "So where do sorted lists come from in the first place?";

describe("Playhead", () => {
  it("starts on calibration and plays beat 1 to its check with the board built up", async () => {
    const { speaker, ph } = make();
    expect(ph.getState().mode).toBe("calibrating");
    ph.start("Sort of");
    await playToCheck(speaker, ph);
    const s = ph.getState();
    expect(s.check?.op.id).toBe("b1.k1");
    expect(s.board.elements["A"]).toMatchObject({ values: [5, 8] });
    expect(s.board.elements["B"]).toMatchObject({ values: [4, 9] });
    expect(s.board.elements["OUT"]).toMatchObject({ values: [1, 2] });
    expect(s.board.pins.map((p) => p.pinId)).toEqual(["T1"]);
    expect(s.calibrationAnswer).toBe("Sort of");
  });

  it("grades a clicked cell, plays the reaction, then moves to beat 2", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await playToCheck(speaker, ph);
    ph.answerCheck({ id: "B", index: 0 });
    expect(ph.getState().check?.result).toEqual({ correct: true, answer: "4" });
    await speakTo(speaker, ph, "Exactly, four is smaller than five.");
    speaker.finish();
    await speakTo(speaker, ph, B2_S1);
    const s = ph.getState();
    expect(s.beatIndex).toBe(1);
    expect(s.completedBeats).toEqual(["b1"]);
    expect(s.board.elements["OUT"]).toMatchObject({ values: [1, 2, 4, 5, 8, 9] });
    // The verdict belongs to the reaction; the lesson's own next sentence clears it.
    expect(s.check).toBeNull();
  });

  it("grades a wrong click and plays the remediation", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await playToCheck(speaker, ph);
    ph.answerCheck({ id: "A", index: 0 });
    expect(ph.getState().check?.result?.correct).toBe(false);
    await speakTo(speaker, ph, "Not quite. Compare the fronts: five against four.");
  });

  it("answers a predicted question, then bridges back and replays the interrupted sentence", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S2);
    ph.submitInput("what if one list runs out?");
    expect(ph.getState().aside?.title).toBe("What if one list runs out?");
    await speakTo(speaker, ph, "When one list runs out, everything left in the other list is already sorted, so it is copied straight to the output.");
    speaker.finish();
    await speakTo(speaker, ph, "Okay, back to it.");
    expect(ph.getState().aside).toBeNull();
    speaker.finish();
    await speakTo(speaker, ph, S2);
    expect(ph.getState().board.order).toEqual(["A", "B", "OUT"]);
  });

  it("falls back for an unpredicted question and resumes", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S3);
    ph.submitInput("is this how python sorts things?");
    await speakTo(speaker, ph, mergeSortLesson.fallback.ops[0]!.op === "say" ? mergeSortLesson.fallback.ops[0]!.text : "");
    speaker.finish();
    await speakTo(speaker, ph, "Let's pick up where we left off.");
    speaker.finish();
    await speakTo(speaker, ph, S3);
  });

  it("uses the pointed element to choose a branch and cleans the aside off the stage", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.skipBeat();
    await speakTo(speaker, ph, B2_S1);
    ph.setPointed({ id: "T1" });
    ph.submitInput("explain this");
    expect(ph.getState().aside?.title).toBe("How does merge pick?");
    expect(ph.getState().pointed).toBeNull();
    await playToCheck(speaker, ph);
    expect(ph.getState().board.order).toEqual(expect.arrayContaining(["A2", "B2", "OUT2"]));
    ph.answerCheck({ id: "B2", index: 0 });
    await speakTo(speaker, ph, "Right. Take the smaller front, then compare the new fronts, and repeat. That is the whole rule.");
    speaker.finish();
    await speakTo(speaker, ph, "Back to where we were.");
    const s = ph.getState();
    expect(s.board.order).not.toEqual(expect.arrayContaining(["A2"]));
    expect(s.board.highlights).toEqual([]);
    expect(s.check).toBeNull();
    speaker.finish();
    await speakTo(speaker, ph, B2_S1);
  });

  it("skip fast-forwards the board, keeps pins, and starts the next beat", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.skipBeat();
    const s = ph.getState();
    expect(s.beatIndex).toBe(1);
    expect(s.board.pins.map((p) => p.pinId)).toEqual(["T1"]);
    expect(s.board.elements["OUT"]).toMatchObject({ values: [1, 2, 4, 5, 8, 9] });
    expect(s.board.highlights).toEqual([]);
    await speakTo(speaker, ph, B2_S1);
  });

  it("jumping forward applies every skipped beat silently", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.jumpToBeat(3);
    const s = ph.getState();
    expect(s.beatIndex).toBe(3);
    expect(s.completedBeats).toEqual(["b1", "b2", "b3"]);
    expect(s.board.pins.map((p) => p.pinId)).toEqual(["T1", "T2", "E1"]);
    expect(s.board.elements["T"]).toMatchObject({ revealDepth: 3, sortedFromDepth: 0 });
    await speakTo(speaker, ph, "Why is this fast? Look at the work done on each level.");
  });

  it("jumping back truncates history and replays from the beat start", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.jumpToBeat(2);
    await speakTo(speaker, ph, "Now we merge our way back up using the trick from the start.");
    ph.jumpToBeat(0);
    const s = ph.getState();
    expect(s.beatIndex).toBe(0);
    expect(s.completedBeats).toEqual([]);
    expect(s.board.order).toEqual([]);
    expect(s.board.pins).toEqual([]);
    await speakTo(speaker, ph, S1);
  });

  it("soft interrupt pauses at the end of the sentence and clearing the input resumes", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.setTyping(true);
    expect(ph.getState().typingArmed).toBe(true);
    speaker.finish();
    await until(() => ph.getState().mode === "paused", "paused at boundary");
    expect(speaker.current).toBeNull();
    ph.setTyping(false);
    await until(() => ph.getState().mode === "playing", "resumed");
    await speakTo(speaker, ph, S2);
  });

  it("go back replays the previous sentence with the board rewound", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, "One is smaller than two, so one goes to the output.");
    speaker.finish();
    await speakTo(speaker, ph, "Now the fronts are two and four, so two goes next.");
    expect(ph.getState().board.elements["OUT"]).toMatchObject({ values: [1] });
    ph.rewind();
    await speakTo(speaker, ph, "One is smaller than two, so one goes to the output.");
    expect(ph.getState().board.elements["OUT"]).toMatchObject({ values: [] });
    speaker.finish();
    await speakTo(speaker, ph, "Now the fronts are two and four, so two goes next.");
    expect(ph.getState().board.elements["OUT"]).toMatchObject({ values: [1] });
  });

  it("navigation words typed into the input are commands, not questions", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.submitInput("skip");
    expect(ph.getState().beatIndex).toBe(1);
    expect(ph.getState().aside).toBeNull();
    await speakTo(speaker, ph, B2_S1);
    ph.submitInput("wait");
    expect(ph.getState().mode).toBe("paused");
    ph.submitInput("ok");
    expect(ph.getState().mode).toBe("playing");
  });

  it("a typed answer that matches a choice grades the check", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.skipBeat();
    await playToCheck(speaker, ph);
    expect(ph.getState().check?.op.id).toBe("b2.k1");
    ph.submitInput("3");
    expect(ph.getState().check?.result).toEqual({ correct: true, answer: "3" });
  });

  it("finishes after the last beat", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    for (let i = 0; i < 5; i++) {
      await until(() => speaker.current !== null || ph.getState().mode !== "playing", "progress");
      ph.skipBeat();
    }
    await until(() => ph.getState().mode === "finished", "finished");
    expect(ph.getState().board.pins.map((p) => p.pinId)).toEqual(["T1", "T2", "E1", "E2", "T3"]);
  });

  it("waits for beats that have not arrived and continues when they do", async () => {
    const { speaker, ph } = makeStreaming();
    ph.start("Yes");
    expect(ph.getState().waiting).toBe("beat");
    expect(speaker.current).toBeNull();
    ph.appendBeat(mergeSortLesson.beats[0]!, 0);
    await speakTo(speaker, ph, S1);
    expect(ph.getState().waiting).toBeNull();
    ph.skipBeat();
    expect(ph.getState().beatIndex).toBe(1);
    expect(ph.getState().waiting).toBe("beat");
    ph.appendBeat(mergeSortLesson.beats[1]!, 1);
    await speakTo(speaker, ph, B2_S1);
    expect(ph.getState().loadedBeats).toBe(2);
  });

  it("routes an unpredicted question to the host and plays the streamed answer, then resumes", async () => {
    const { speaker, ph } = make();
    const asks: Array<{ requestId: string; text: string }> = [];
    ph.onAsk = (req) => asks.push({ requestId: req.requestId, text: req.text });
    ph.start(null);
    await speakTo(speaker, ph, S2);
    ph.submitInput("is this how python sorts things?");
    expect(asks).toHaveLength(1);
    expect(ph.getState().aside?.title).toBe("Answering");
    await until(() => ph.getState().waiting === "aside", "waiting on the responder");
    const id = asks[0]!.requestId;
    ph.appendAsideOps(id, [{ op: "say", id: "r.s1", text: "Python uses Timsort, which is built on merging runs." }]);
    await speakTo(speaker, ph, "Python uses Timsort, which is built on merging runs.");
    expect(ph.getState().telemetry.ask?.firstOpMs).not.toBeNull();
    speaker.finish();
    await until(() => ph.getState().waiting === "aside", "waiting for more");
    ph.appendAsideOps(id, [{ op: "highlight", id: "r.h1", targets: [{ id: "A", index: 0 }] }]);
    ph.completeAside(id, { mode: "continue", bridge: "Back to our two lists." }, null);
    await speakTo(speaker, ph, "Back to our two lists.");
    expect(ph.getState().aside).toBeNull();
    expect(ph.getState().board.highlights).toEqual([]);
    speaker.finish();
    await speakTo(speaker, ph, S2);
  });

  it("falls back to the canned apology when the responder fails", async () => {
    const { speaker, ph } = make();
    let id = "";
    ph.onAsk = (req) => (id = req.requestId);
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.submitInput("tell me about quantum sorting");
    await until(() => ph.getState().waiting === "aside", "waiting");
    ph.failAside(id, "boom");
    const fallbackText = mergeSortLesson.fallback.ops[0]!.op === "say" ? mergeSortLesson.fallback.ops[0]!.text : "";
    await speakTo(speaker, ph, fallbackText);
    speaker.finish();
    await speakTo(speaker, ph, mergeSortLesson.fallback.resume.bridge!);
  });

  it("reports events to the host", async () => {
    const { speaker, ph } = make();
    const kinds: string[] = [];
    ph.onEvent = (e) => kinds.push(e.kind);
    ph.start("No");
    await speakTo(speaker, ph, S1);
    ph.submitInput("skip");
    await speakTo(speaker, ph, B2_S1);
    expect(kinds).toEqual(["lesson_started", "beat_started", "nav", "beat_started"]);
  });

  it("plays a callback left by an answer when that beat starts, and layers the tutor's drawings", async () => {
    const { speaker, ph } = make();
    let id = "";
    ph.onAsk = (req) => (id = req.requestId);
    ph.start(null);
    await speakTo(speaker, ph, S2);
    ph.submitInput("how do we get two sorted lists in the first place?");
    await until(() => ph.getState().waiting === "aside", "waiting");
    expect(ph.getState().asideBaseIds).toEqual(["A", "B", "OUT"]);
    ph.appendAsideOps(id, [
      { op: "show", id: "r.e1", element: { kind: "split_tree", id: "T9", values: [8, 3, 5, 1], revealDepth: 1 } },
      { op: "update", id: "r.u1", target: "A", patch: { values: [] } },
      { op: "say", id: "r.s1", text: "We split the list in half until every piece has one element." },
    ]);
    await speakTo(speaker, ph, "We split the list in half until every piece has one element.");
    const s = ph.getState();
    expect(s.board.order).toContain("T9");
    expect(s.board.elements["A"]).toMatchObject({ values: [2, 5, 8] });
    speaker.finish();
    await until(() => ph.getState().waiting === "aside", "waiting for more");
    ph.completeAside(id, { mode: "continue", bridge: "Back to merging." }, null, [{ beatId: "b2", text: "This is the splitting I sketched earlier, now step by step." }]);
    await speakTo(speaker, ph, "Back to merging.");
    expect(ph.getState().board.order).not.toContain("T9");
    expect(ph.getState().asideBaseIds).toBeNull();
    ph.skipBeat();
    await speakTo(speaker, ph, "This is the splitting I sketched earlier, now step by step.");
    speaker.finish();
    await speakTo(speaker, ph, B2_S1);
  });
});

