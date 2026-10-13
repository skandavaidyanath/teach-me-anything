import { describe, expect, it } from "vitest";
import type { Op, TutorContext, TutorWindow } from "@tma/schema";
import { applyEdit, renderScript, tutor, type TextStreamer } from "./tutor";

const say = (id: string, text: string): Op => ({ op: "say", id, text });
const window: TutorWindow = {
  currentBeatId: "b1",
  current: [
    say("b1.s6", "Every step looks at just two elements."),
    { op: "pin", id: "b1.p1", pin: { pinId: "T1", kind: "takeaway", title: "Merging is one pass" } },
    { op: "highlight", id: "b1.h3", targets: [{ id: "A", index: 0 }, { id: "B", index: 0 }] },
    { op: "check", id: "b1.k1", kind: "click_cell", prompt: "Click the element that goes next.", targets: [{ id: "A", index: 0 }], expected: { id: "A", index: 0 } },
  ],
  nextBeatId: "b2",
  nextPrefix: [say("b2.s1", "So where do sorted lists come from in the first place?"), { op: "clear", id: "b2.c1" }, say("b2.s2", "Take an unsorted list and cut it in half.")],
};
const context: TutorContext = {
  beatId: "b1",
  beatTitle: "The merge trick",
  outline: [
    { id: "b1", title: "The merge trick", status: "current" },
    { id: "b2", title: "Split it down", status: "upcoming" },
  ],
  record: [],
  recentSentences: ["Now the fronts are two and four."],
  currentSentence: "Every step looks at just two elements.",
  boardSummary: ["A (id A): [5, 8]", "B (id B): [4, 9]"],
  pins: [],
  activeCheck: null,
};

const scripted =
  (text: string): TextStreamer =>
  async function* () {
    for (const piece of text.match(/.{1,23}/gs) ?? []) yield { kind: "text", text: piece };
    yield { kind: "final", model: "fake", inputTokens: 10, outputTokens: 5, refusal: false };
  };

describe("renderScript", () => {
  it("numbers lines across both parts and marks anchors", () => {
    const r = renderScript(window);
    expect(r.total).toBe(7);
    expect(r.currentCount).toBe(4);
    expect([...r.anchors]).toEqual([2, 3, 4, 6]);
    expect(r.lines).toContain('[1] SAY "Every step looks at just two elements."');
    expect(r.lines).toContain("[4] ANCHOR check (click_cell)");
    expect(r.lines).toContain("Next part (b2)");
  });
});

describe("applyEdit", () => {
  it("rebuilds the window with anchors kept and wording replaced", () => {
    const r = applyEdit(window, [
      { kind: "keep", line: 1 },
      { kind: "keep", line: 2 },
      { kind: "keep", line: 3 },
      { kind: "keep", line: 4 },
      { kind: "op", op: say("t.s9", "Now, the splitting you asked about.") },
      { kind: "keep", line: 6 },
      { kind: "keep", line: 7 },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.current.map((o) => o.id)).toEqual(["b1.s6", "b1.p1", "b1.h3", "b1.k1"]);
      expect(r.nextPrefix?.map((o) => o.id)).toEqual(["t.s9", "b2.c1", "b2.s2"]);
    }
  });

  it("rejects a dropped anchor, a repeat, and out-of-order keeps", () => {
    expect(applyEdit(window, [{ kind: "keep", line: 1 }, { kind: "keep", line: 2 }, { kind: "keep", line: 4 }, { kind: "keep", line: 6 }])).toMatchObject({ ok: false, reason: "anchor line 3 was dropped" });
    expect(applyEdit(window, [{ kind: "keep", line: 2 }, { kind: "keep", line: 2 }])).toMatchObject({ ok: false, reason: "line 2 kept twice" });
    expect(applyEdit(window, [{ kind: "keep", line: 3 }, { kind: "keep", line: 2 }])).toMatchObject({ ok: false, reason: "line 2 kept out of order" });
  });
});

describe("tutor", () => {
  it("streams the answer first, then returns the edited window", async () => {
    const script = 'That is coming up next: we split in half until singles.\nFor now, look at the two fronts.\n@highlight A[0] B[0]\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nHere is where those sorted lists come from, the thing you asked about.\nkeep 6\nkeep 7\n';
    const events = [];
    for await (const ev of tutor({ requestId: "q1", kind: "ask", text: "how do we get two sorted lists?", pointed: null, context, window, lesson: { topic: "merge sort", title: "How merge sort works" } }, scripted(script))) events.push(ev);
    const answers = events.filter((e) => e.type === "answer").flatMap((e) => (e.type === "answer" ? e.ops : []));
    expect(answers.map((o) => o.op)).toEqual(["say", "say", "highlight"]);
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({ type: "done", fellBack: false, replan: null });
    if (done?.type === "done") {
      expect(done.current.map((o) => o.id)).toEqual(["b1.s6", "b1.p1", "b1.h3", "b1.k1"]);
      expect(done.nextPrefix?.[0]).toMatchObject({ op: "say", text: "Here is where those sorted lists come from, the thing you asked about." });
      expect(done.nextPrefix?.map((o) => o.id).slice(1)).toEqual(["b2.c1", "b2.s2"]);
    }
  });

  it("keeps the original script when the edit breaks an anchor, and surfaces a replan", async () => {
    const script = "Short answer.\nkeep 1\nkeep 2\nkeep 4\nkeep 6\nkeep 7\n@replan from=b2 reason=learner has never seen recursion\n";
    const events = [];
    for await (const ev of tutor({ requestId: "q2", kind: "ask", text: "x", pointed: null, context, window, lesson: { topic: "t", title: "t" } }, scripted(script))) events.push(ev);
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({ type: "done", fellBack: true, replan: { fromBeatId: "b2", reason: "learner has never seen recursion" } });
    if (done?.type === "done") {
      expect(done.current.map((o) => o.id)).toEqual(["b1.s6", "b1.p1", "b1.h3", "b1.k1"]);
      expect(done.nextPrefix).toBeNull();
    }
  });

  it("a review with all keeps returns the window unchanged and no answer", async () => {
    const script = "keep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nkeep 7\n";
    const events = [];
    for await (const ev of tutor({ requestId: "r1", kind: "review", text: null, pointed: null, context, window, lesson: { topic: "t", title: "t" } }, scripted(script))) events.push(ev);
    expect(events.filter((e) => e.type === "answer")).toHaveLength(0);
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({ type: "done", fellBack: false });
    if (done?.type === "done") expect(done.nextPrefix?.map((o) => o.id)).toEqual(["b2.s1", "b2.c1", "b2.s2"]);
  });

  it("apologizes when a question gets no answer", async () => {
    const script = "keep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nkeep 7\n";
    const events = [];
    for await (const ev of tutor({ requestId: "q3", kind: "ask", text: "hm?", pointed: null, context, window, lesson: { topic: "t", title: "t" } }, scripted(script))) events.push(ev);
    const answers = events.filter((e) => e.type === "answer").flatMap((e) => (e.type === "answer" ? e.ops : []));
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ op: "say", id: "t.q3.fallback" });
  });
});

describe("the repeat rule, enforced", () => {
  const repeatContext: TutorContext = {
    ...context,
    record: [{ kind: "asked", beatId: "b1", text: "why does it keep going straight?", answered: 'Nothing pushes it. [drew: scene "a car"]' }],
  };
  const wordsThenPicture: TextStreamer = async function* (_system, user) {
    const text = /Return exactly one drawing directive/.test(user)
      ? '@scene car2 400x300: [{"id":"you","type":"dot","cx":10,"cy":10,"label":"you"}]\n'
      : "Let me say it another way.\nThe door pushes you inward.\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nkeep 7\n";
    for (const piece of text.match(/.{1,23}/gs) ?? []) yield { kind: "text", text: piece };
    yield { kind: "final", model: "fake", inputTokens: 10, outputTokens: 5, refusal: false };
  };

  it("asks once more for a picture when a repeat was answered in words", async () => {
    const events = [];
    for await (const ev of tutor({ requestId: "r9", kind: "ask", text: "no i still dont get it", pointed: null, context: repeatContext, window, lesson: { topic: "t", title: "T" } }, wordsThenPicture)) events.push(ev);
    const answers = events.filter((e) => e.type === "answer").flatMap((e) => (e.type === "answer" ? e.ops : []));
    expect(answers.map((o) => o.op)).toEqual(["say", "say", "show"]);
    expect(answers[2]).toMatchObject({ op: "show", element: { kind: "scene", id: "car2" } });
    const done = events.find((e) => e.type === "done");
    expect(done).toMatchObject({ type: "done", addendum: true, fellBack: false });
  });

  it("leaves a first question alone, and a repeat that drew", async () => {
    const first = [];
    for await (const ev of tutor({ requestId: "r10", kind: "ask", text: "why does it keep going straight?", pointed: null, context, window, lesson: { topic: "t", title: "T" } }, wordsThenPicture)) first.push(ev);
    expect(first.filter((e) => e.type === "answer").flatMap((e) => (e.type === "answer" ? e.ops.map((o) => o.op) : []))).toEqual(["say", "say"]);
    expect(first.find((e) => e.type === "done")).toMatchObject({ addendum: false });
    const drew: TextStreamer = async function* () {
      yield { kind: "text", text: '@update P: {"frame":"rotating"}\nFrom the seat it looks still.\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nkeep 7\n' };
      yield { kind: "final", model: "fake", inputTokens: 10, outputTokens: 5, refusal: false };
    };
    const second = [];
    for await (const ev of tutor({ requestId: "r11", kind: "ask", text: "still lost", pointed: null, context: repeatContext, window, lesson: { topic: "t", title: "T" } }, drew)) second.push(ev);
    expect(second.find((e) => e.type === "done")).toMatchObject({ addendum: false });
  });

  it("ignores a @nodraw line", async () => {
    const out = [];
    const nodraw: TextStreamer = async function* () {
      yield { kind: "text", text: "@nodraw it is a definition\nIt means the pull toward the center.\nkeep 1\nkeep 2\nkeep 3\nkeep 4\nkeep 5\nkeep 6\nkeep 7\n" };
      yield { kind: "final", model: "fake", inputTokens: 10, outputTokens: 5, refusal: false };
    };
    for await (const ev of tutor({ requestId: "r12", kind: "ask", text: "what does centripetal mean?", pointed: null, context, window, lesson: { topic: "t", title: "T" } }, nodraw)) out.push(ev);
    expect(out.filter((e) => e.type === "answer").flatMap((e) => (e.type === "answer" ? e.ops.map((o) => o.op) : []))).toEqual(["say"]);
    expect(out.find((e) => e.type === "done")).toMatchObject({ fellBack: false });
  });
});
