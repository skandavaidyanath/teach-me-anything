import { describe, expect, it } from "vitest";
import { normalizeAnswer, validateLesson, type Lesson } from "./index";

const tiny: Lesson = {
  id: "t",
  topic: "t",
  title: "Tiny",
  beats: [
    {
      id: "b1",
      title: "One",
      ops: [
        { op: "show", id: "s1", element: { kind: "array_row", id: "a", values: [1, 2] } },
        { op: "say", id: "y1", text: "Hello." },
        { op: "highlight", id: "h1", targets: [{ id: "a", index: 0 }] },
        {
          op: "check",
          id: "c1",
          kind: "choice",
          prompt: "Pick",
          options: ["1", "2"],
          expected: ["1"],
          onCorrect: [{ op: "say", id: "y2", text: "Yes." }],
        },
      ],
    },
  ],
  branches: [
    {
      id: "br1",
      match: { patterns: ["why"] },
      ops: [{ op: "say", id: "y3", text: "Because." }],
      resume: { mode: "continue", bridge: "Back to it." },
    },
  ],
  fallback: { ops: [{ op: "say", id: "y4", text: "Dunno." }], resume: { mode: "continue" } },
};

describe("validateLesson", () => {
  it("accepts a well-formed lesson", () => {
    const { lesson, issues } = validateLesson(tiny);
    expect(lesson).not.toBeNull();
    expect(issues).toEqual([]);
  });

  it("requires every beat to end in a check", () => {
    const bad = structuredClone(tiny);
    bad.beats[0]!.ops.pop();
    const { issues } = validateLesson(bad);
    expect(issues.some((i) => i.message.includes("must end in a check"))).toBe(true);
  });

  it("rejects updates to elements never shown", () => {
    const bad = structuredClone(tiny);
    bad.beats[0]!.ops.splice(2, 0, { op: "update", id: "u1", target: "ghost", patch: {} });
    const { issues } = validateLesson(bad);
    expect(issues.some((i) => i.message.includes('unknown element "ghost"'))).toBe(true);
  });

  it("rejects duplicate op ids, including inside reactions", () => {
    const bad = structuredClone(tiny);
    const check = bad.beats[0]!.ops[3]!;
    if (check.op === "check") check.onCorrect = [{ op: "say", id: "y1", text: "dup" }];
    const { issues } = validateLesson(bad);
    expect(issues.some((i) => i.message.includes("duplicate op id"))).toBe(true);
  });

  it("rejects graded checks without an expected answer", () => {
    const bad = structuredClone(tiny);
    const check = bad.beats[0]!.ops[3]!;
    if (check.op === "check") delete check.expected;
    const { issues } = validateLesson(bad);
    expect(issues.some((i) => i.message.includes("no expected answer"))).toBe(true);
  });

  it("rejects invalid regex in branch patterns", () => {
    const bad = structuredClone(tiny);
    bad.branches[0]!.match.patterns = ["("];
    const { issues } = validateLesson(bad);
    expect(issues.some((i) => i.message.includes("invalid regex"))).toBe(true);
  });

  it("reports schema errors with paths", () => {
    const { lesson, issues } = validateLesson({ id: "x" });
    expect(lesson).toBeNull();
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("normalizeAnswer", () => {
  it("trims, lowercases, strips trailing punctuation, collapses spaces", () => {
    expect(normalizeAnswer("  Three  levels. ")).toBe("three levels");
    expect(normalizeAnswer("4!")).toBe("4");
  });
});
