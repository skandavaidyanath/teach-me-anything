import { describe, expect, it } from "vitest";
import { ScriptParser, parseRef } from "./script-parse";

function run(deltas: string[]) {
  const p = new ScriptParser("r1");
  const out = deltas.flatMap((d) => p.push(d));
  return [...out, ...p.finish()];
}

describe("ScriptParser", () => {
  it("streams a sentence as soon as the next one starts", () => {
    const p = new ScriptParser("r1");
    expect(p.push("Good question. You could stop at pairs")).toEqual([{ kind: "op", op: { op: "say", id: "r1.s1", text: "Good question." } }]);
    const b = p.push(", but one is simpler. That");
    expect(b).toEqual([{ kind: "op", op: { op: "say", id: "r1.s2", text: "You could stop at pairs, but one is simpler." } }]);
    expect(p.finish()).toEqual([{ kind: "op", op: { op: "say", id: "r1.s3", text: "That" } }]);
  });

  it("does not split on decimals", () => {
    const texts = run(["The cost is about 3.5 units. Then it stops."]).map((c) => (c.kind === "op" && c.op.op === "say" ? c.op.text : null));
    expect(texts).toEqual(["The cost is about 3.5 units.", "Then it stops."]);
  });

  it("parses keep lines, drawing directives, and replan", () => {
    const out = run(['Here it is.\n@row L "list": 8, 3\nkeep 2\nkeep 3\n@replan from=b3 reason=the learner never met recursion\n']);
    expect(out).toEqual([
      { kind: "op", op: { op: "say", id: "r1.s1", text: "Here it is." } },
      { kind: "op", op: { op: "show", id: "r1.e1", element: { kind: "array_row", id: "L", label: "list", values: [8, 3] } } },
      { kind: "keep", line: 2 },
      { kind: "keep", line: 3 },
      { kind: "replan", fromBeatId: "b3", reason: "the learner never met recursion" },
    ]);
  });

  it("accepts a 'say:' prefix and a keep without trailing newline", () => {
    const out = run(["say: One is smaller.\nkeep 4"]);
    expect(out).toEqual([{ kind: "op", op: { op: "say", id: "r1.s1", text: "One is smaller." } }, { kind: "keep", line: 4 }]);
  });

  it("parses the rest of the directive family", () => {
    const out = run(['@tree T2: 8 3 5 1 | levels=1\n@reveal T2 2\n@move L[0] -> OUT2\n@card C "Base case" :: One element is sorted.\n@formula F: \\log p(x)\n@highlight correct A[0]\n@pin takeaway "Title" :: body\n']);
    expect(out.map((c) => (c.kind === "op" ? c.op.op : c.kind))).toEqual(["show", "update", "move", "show", "show", "highlight", "pin"]);
    expect(out[5]).toMatchObject({ kind: "op", op: { op: "highlight", tone: "correct", targets: [{ id: "A", index: 0 }] } });
  });

  it("ignores unknown directives and bad refs", () => {
    expect(run(["Hello there.\n@sparkle now\n@highlight ???\n"])).toEqual([{ kind: "op", op: { op: "say", id: "r1.s1", text: "Hello there." } }]);
  });

  it("parseRef reads ids and indices", () => {
    expect(parseRef("A[0]")).toEqual({ id: "A", index: 0 });
    expect(parseRef("T")).toEqual({ id: "T" });
    expect(parseRef("[1]")).toBeNull();
  });

  it("survives a chunk boundary inside a keep line", () => {
    const p = new ScriptParser("r1");
    const out = [...p.push("Done.\nkeep "), ...p.push("1\nkeep 2\n"), ...p.finish()];
    expect(out).toEqual([{ kind: "op", op: { op: "say", id: "r1.s1", text: "Done." } }, { kind: "keep", line: 1 }, { kind: "keep", line: 2 }]);
  });
});


describe("ScriptParser: figures as code", () => {
  it("collects a component block as one show op and speaks none of it", () => {
    const code = ['<svg id="s"><circle id="ball" r="5"/></svg>', "<script>", '  tma.onFrame(function (t) { document.getElementById("ball").setAttribute("cx", 10 * t); });', "</script>"];
    const out = run(["Watch this.\n@component R \"A rider\" 500x300 parts=ball state={\"frame\":\"ball\"}\n" + code.join("\n") + "\n@end\nkeep 2\n"]);
    expect(out.map((c) => (c.kind === "op" ? c.op.op : c.kind))).toEqual(["say", "show", "keep"]);
    const show = out[1];
    expect(show).toMatchObject({
      kind: "op",
      op: { op: "show", id: "r1.e1", element: { kind: "component", id: "R", title: "A rider", width: 500, height: 300, parts: ["ball"], state: { frame: "ball" }, code: code.join("\n") } },
    });
  });

  it("does not split code into sentences across chunk boundaries", () => {
    const p = new ScriptParser("r1");
    const a = p.push("@component C 400x200\n<p>Hello. World. Again.</p>\n<script>var x = 1. ");
    const b = p.push("5; </script>\n@end\n");
    expect(a).toEqual([]);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ kind: "op", op: { op: "show", element: { kind: "component", code: "<p>Hello. World. Again.</p>\n<script>var x = 1. 5; </script>" } } });
  });

  it("closes a block the model forgot to end, and discards one with a bad header", () => {
    expect(run(["@component Z 300x300\n<b>x</b>\n"])).toMatchObject([{ kind: "op", op: { op: "show", element: { kind: "component", id: "Z", code: "<b>x</b>" } } }]);
    expect(run(["@component\n<b>x</b>\n@end\nDone.\n"])).toEqual([{ kind: "op", op: { op: "say", id: "r1.s1", text: "Done." } }]);
  });

  it("parses state updates and one-line scenes", () => {
    const out = run(['@update P: {"frame":"ball","speed":2}\n@scene S "forces" 420x300: [{"id":"b","type":"dot","cx":1,"cy":2},{"bogus":true}]\n@update P {"x":1}\n@update P nope\n']);
    expect(out).toEqual([
      { kind: "op", op: { op: "update", id: "r1.u1", target: "P", patch: { state: { frame: "ball", speed: 2 } } } },
      { kind: "op", op: { op: "show", id: "r1.e2", element: { kind: "scene", id: "S", label: "forces", width: 420, height: 300, items: [{ id: "b", type: "dot", cx: 1, cy: 2 }] } } },
      { kind: "op", op: { op: "update", id: "r1.u3", target: "P", patch: { state: { x: 1 } } } },
    ]);
  });
});
