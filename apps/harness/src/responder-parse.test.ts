import { describe, expect, it } from "vitest";
import { ResponderParser, parseRef } from "./responder-parse";

function run(deltas: string[]): ReturnType<ResponderParser["push"]> {
  const p = new ResponderParser("r1");
  const out = deltas.flatMap((d) => p.push(d));
  return [...out, ...p.finish()];
}

describe("ResponderParser", () => {
  it("emits a sentence as soon as the next one starts", () => {
    const p = new ResponderParser("r1");
    const a = p.push("Good question. You could stop at pairs");
    expect(a).toEqual([{ kind: "op", op: { op: "say", id: "r1.s1", text: "Good question." } }]);
    const b = p.push(", but going to one keeps the base case trivial. That");
    expect(b.map((c) => (c.kind === "op" && c.op.op === "say" ? c.op.text : ""))).toEqual([
      "You could stop at pairs, but going to one keeps the base case trivial.",
    ]);
    const c = p.finish();
    expect(c).toEqual([{ kind: "op", op: { op: "say", id: "r1.s3", text: "That" } }]);
  });

  it("does not split on decimals or mid-token periods", () => {
    const out = run(["The cost is about 3.5 units per level. Then it stops."]);
    const texts = out.map((c) => (c.kind === "op" && c.op.op === "say" ? c.op.text : null)).filter(Boolean);
    expect(texts).toEqual(["The cost is about 3.5 units per level.", "Then it stops."]);
  });

  it("parses highlight, pin, and resume directives on their own lines", () => {
    const out = run(["Look at the fronts.\n@highlight A[0] B[0]\n@pin takeaway \"Compare fronts\" :: Always take the smaller front.\n@resume continue Back to the tree.\n"]);
    expect(out).toEqual([
      { kind: "op", op: { op: "say", id: "r1.s1", text: "Look at the fronts." } },
      { kind: "op", op: { op: "highlight", id: "r1.h1", targets: [{ id: "A", index: 0 }, { id: "B", index: 0 }], tone: "marker" } },
      {
        kind: "op",
        op: { op: "pin", id: "r1.p1", pin: { pinId: "r1.pin1", kind: "takeaway", title: "Compare fronts", text: "Always take the smaller front." } },
      },
      { kind: "resume", resume: { mode: "continue", bridge: "Back to the tree." } },
    ]);
  });

  it("handles a directive split across deltas and a trailing resume without newline", () => {
    const out = run(["Sure.\n@high", "light T[3]\n", "@resume skip"]);
    expect(out.map((c) => c.kind + ":" + (c.kind === "op" ? c.op.op : c.kind === "resume" ? c.resume.mode : c.beatId))).toEqual(["op:say", "op:highlight", "resume:skip"]);
  });

  it("ignores unknown directives and bad refs", () => {
    const out = run(["Hello there.\n@sparkle now\n@highlight ???\n"]);
    expect(out).toEqual([{ kind: "op", op: { op: "say", id: "r1.s1", text: "Hello there." } }]);
  });

  it("parseRef reads ids and indices", () => {
    expect(parseRef("A[0]")).toEqual({ id: "A", index: 0 });
    expect(parseRef("T")).toEqual({ id: "T" });
    expect(parseRef("OUT2[3]")).toEqual({ id: "OUT2", index: 3 });
    expect(parseRef("[1]")).toBeNull();
  });

  it("parses drawing directives into show, update, and move ops", () => {
    const out = run([
      'Here is a small list.\n@row L "list": 8, 3, 5, 1\n@row OUT2 "merged" (output):\n@tree T2: 8 3 5 1 | levels=1\n@reveal T2 2\n@move L[0] -> OUT2\n@card C "Base case" :: One element is already sorted.\n@formula F: \\log p(x)\n',
    ]);
    const ops = out.filter((c) => c.kind === "op").map((c) => (c.kind === "op" ? c.op : null));
    expect(ops.map((o) => o?.op)).toEqual(["say", "show", "show", "show", "update", "move", "show", "show"]);
    expect(ops[1]).toMatchObject({ op: "show", element: { kind: "array_row", id: "L", label: "list", values: [8, 3, 5, 1] } });
    expect(ops[2]).toMatchObject({ op: "show", element: { kind: "array_row", id: "OUT2", label: "merged", role: "output", values: [] } });
    expect(ops[3]).toMatchObject({ op: "show", element: { kind: "split_tree", id: "T2", values: [8, 3, 5, 1], revealDepth: 1 } });
    expect(ops[4]).toMatchObject({ op: "update", target: "T2", patch: { revealDepth: 2, revealed: 2 } });
    expect(ops[5]).toMatchObject({ op: "move", from: { id: "L", index: 0 }, to: { id: "OUT2" } });
    expect(ops[6]).toMatchObject({ op: "show", element: { kind: "text_card", id: "C", title: "Base case", body: "One element is already sorted." } });
    expect(ops[7]).toMatchObject({ op: "show", element: { kind: "latex", id: "F", tex: "\\log p(x)" } });
  });

  it("parses callbacks for later beats", () => {
    const out = run(["Short version: we split in half until singles.\n@callback b2 This is the splitting I sketched when you asked earlier, now step by step.\n@resume continue Back to the merge.\n"]);
    expect(out).toContainEqual({ kind: "callback", beatId: "b2", text: "This is the splitting I sketched when you asked earlier, now step by step." });
  });
});

