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

  it("plays a prepared branch ahead of the lesson, then replays the interrupted sentence", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S2);
    ph.submitInput("what if one list runs out?");
    expect(ph.getState().answering?.title).toBe("What if one list runs out?");
    await speakTo(speaker, ph, "When one list runs out, everything left in the other list is already sorted, so it is copied straight to the output.");
    speaker.finish();
    await speakTo(speaker, ph, "Okay, back to it.");
    speaker.finish();
    await speakTo(speaker, ph, S2);
    expect(ph.getState().answering).toBeNull();
    expect(ph.getState().board.order).toEqual(["A", "B", "OUT"]);
  });

  it("offline, an unpredicted question gets the canned line and the lesson continues", async () => {
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

  it("a branch with a check: the check is asked inside the answer and its drawings clear afterwards", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.skipBeat();
    await speakTo(speaker, ph, B2_S1);
    ph.setPointed({ id: "T1" });
    ph.submitInput("explain this");
    expect(ph.getState().answering?.title).toBe("How does merge pick?");
    expect(ph.getState().pointed).toBeNull();
    await playToCheck(speaker, ph);
    expect(ph.getState().board.order).toEqual(expect.arrayContaining(["A2", "B2", "OUT2"]));
    // Asked at the first sentence of beat 2, before it clears beat 1's rows.
    expect(ph.getState().layerBaseIds).toEqual(["A", "B", "OUT"]);
    ph.answerCheck({ id: "B2", index: 0 });
    await speakTo(speaker, ph, "Right. Take the smaller front, then compare the new fronts, and repeat. That is the whole rule.");
    speaker.finish();
    await speakTo(speaker, ph, "Back to where we were.");
    speaker.finish();
    await speakTo(speaker, ph, B2_S1);
    const s = ph.getState();
    expect(s.board.order).not.toEqual(expect.arrayContaining(["A2"]));
    expect(s.board.highlights).toEqual([]);
    expect(s.answering).toBeNull();
    expect(s.layerBaseIds).toBeNull();
  });

  it("a question goes to the tutor with the pending window; the answer plays ahead and the edited window replaces the script", async () => {
    const { speaker, ph } = make();
    const asks: Array<Parameters<NonNullable<Playhead["onAsk"]>>[0]> = [];
    ph.onAsk = (req) => asks.push(req);
    ph.start(null);
    await speakTo(speaker, ph, S2);
    ph.submitInput("how do we get two sorted lists in the first place?");
    expect(asks).toHaveLength(1);
    const req = asks[0]!;
    expect(req.window.currentBeatId).toBe("b1");
    expect(req.window.current[0]).toMatchObject({ op: "say", text: S2 });
    expect(req.window.nextBeatId).toBe("b2");
    expect(req.window.nextPrefix[0]).toMatchObject({ op: "say", text: B2_S1 });
    expect(req.context.outline.map((b) => b.status)).toEqual(["current", "upcoming", "upcoming", "upcoming", "upcoming"]);
    expect(ph.getState().answering?.title).toBe("Answering");
    await until(() => ph.getState().waiting === "answer", "holding the lesson");

    ph.appendAnswerOps(req.requestId, [
      { op: "say", id: "t.s1", text: "That is coming up next; we split the list in half until every piece has one element." },
      { op: "show", id: "t.e1", element: { kind: "split_tree", id: "T9", values: [8, 3, 5, 1], revealDepth: 1 } },
      { op: "update", id: "t.u1", target: "A", patch: { values: [] } },
    ]);
    await speakTo(speaker, ph, "That is coming up next; we split the list in half until every piece has one element.");
    expect(ph.getState().telemetry.ask?.firstOpMs).not.toBeNull();
    speaker.finish();
    await until(() => ph.getState().board.order.includes("T9"), "drawing shown");
    expect(ph.getState().board.elements["A"]).toMatchObject({ values: [2, 5, 8] });
    await until(() => ph.getState().waiting === "answer", "holding for the window");

    const editedNext = [{ op: "say" as const, id: "t.s9", text: "Here is where those sorted lists come from, the thing you asked about." }, ...req.window.nextPrefix.slice(1)];
    ph.applyWindow(req.requestId, req.window.current, editedNext, null);
    await speakTo(speaker, ph, S2);
    const s = ph.getState();
    expect(s.answering).toBeNull();
    expect(s.board.order).not.toContain("T9");
    expect(s.layerBaseIds).toBeNull();
    ph.skipBeat();
    await speakTo(speaker, ph, "Here is where those sorted lists come from, the thing you asked about.");
  });

  it("a tutor failure falls back to the canned line and releases the lesson", async () => {
    const { speaker, ph } = make();
    let id = "";
    ph.onAsk = (req) => (id = req.requestId);
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.submitInput("tell me about quantum sorting");
    await until(() => ph.getState().waiting === "answer", "holding");
    ph.failTutor(id, "boom");
    await speakTo(speaker, ph, mergeSortLesson.fallback.ops[0]!.op === "say" ? mergeSortLesson.fallback.ops[0]!.text : "");
    speaker.finish();
    await speakTo(speaker, ph, S1);
  });

  it("a wrong check answer asks the tutor to review the next beat, and the edit lands before it plays", async () => {
    const { speaker, ph } = make();
    const reviews: Array<Parameters<NonNullable<Playhead["onReview"]>>[0]> = [];
    ph.onReview = (req) => reviews.push(req);
    ph.start("No");
    await playToCheck(speaker, ph);
    expect(reviews).toHaveLength(0);
    ph.answerCheck({ id: "A", index: 0 });
    expect(reviews).toHaveLength(1);
    const req = reviews[0]!;
    expect(req.window.current).toEqual([]);
    expect(req.window.nextBeatId).toBe("b2");
    expect(req.context.record.map((r) => r.kind)).toEqual(["calibration", "check"]);
    ph.applyWindow(req.requestId, [], [{ op: "say", id: "t.r1", text: "Since that merge step was tricky, we will go slowly here." }, ...req.window.nextPrefix.slice(1)], null);
    await speakTo(speaker, ph, "Not quite. Compare the fronts: five against four.");
    speaker.finish();
    await speakTo(speaker, ph, "Since that merge step was tricky, we will go slowly here.");
    expect(ph.getState().beatIndex).toBe(1);
  });

  it("does not review when nothing happened", async () => {
    const { speaker, ph } = make();
    let reviews = 0;
    ph.onReview = () => reviews++;
    ph.start(null);
    await playToCheck(speaker, ph);
    ph.answerCheck({ id: "B", index: 0 });
    expect(reviews).toBe(0);
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

  it("a replan replaces the outline from a future beat and waits for the new beats", async () => {
    const { speaker, ph } = make();
    ph.start(null);
    await speakTo(speaker, ph, S1);
    ph.replaceFrom(2, [{ id: "n3", title: "A gentler path" }, { id: "n4", title: "Wrap up" }]);
    expect(ph.getState().outline.map((b) => b.id)).toEqual(["b1", "b2", "n3", "n4"]);
    ph.skipBeat();
    ph.skipBeat();
    await until(() => ph.getState().waiting === "beat", "waiting for the replanned beat");
    expect(ph.getState().beatIndex).toBe(2);
    ph.appendBeat({ id: "n3", title: "A gentler path", ops: [{ op: "say", id: "n3.s1", text: "Let us take this slowly." }, { op: "check", id: "n3.k1", kind: "choice", prompt: "Ok?", options: ["Yes"], graded: false }] }, 2);
    await speakTo(speaker, ph, "Let us take this slowly.");
  });
});
