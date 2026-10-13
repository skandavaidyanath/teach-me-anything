import { describe, expect, it } from "vitest";
import type { Op } from "@tma/schema";
import { applyOp, emptyBoard, replay, toneFor } from "./board-reducer";

const ops: Op[] = [
  { op: "show", id: "1", element: { kind: "array_row", id: "A", values: [2, 5] } },
  { op: "show", id: "2", element: { kind: "array_row", id: "B", values: [1, 4] } },
  { op: "highlight", id: "3", targets: [{ id: "A", index: 0 }] },
  { op: "say", id: "4", text: "hi" },
  { op: "update", id: "5", target: "A", patch: { values: [5] } },
  { op: "pin", id: "6", pin: { pinId: "T1", kind: "takeaway", text: "x" } },
];

describe("board reducer", () => {
  it("replays into the expected state", () => {
    const s = replay(ops);
    expect(s.order).toEqual(["A", "B"]);
    expect(s.elements["A"]).toMatchObject({ values: [5] });
    expect(toneFor(s, { id: "A", index: 0 })).toBe("marker");
    expect(toneFor(s, { id: "A", index: 1 })).toBeUndefined();
    expect(s.pins.map((p) => p.pinId)).toEqual(["T1"]);
  });

  it("is deterministic: replaying a prefix gives the earlier state", () => {
    const full = replay(ops);
    const prefix = replay(ops.slice(0, 3));
    expect(prefix.elements["A"]).toMatchObject({ values: [2, 5] });
    expect(full.elements["A"]).toMatchObject({ values: [5] });
  });

  it("clear without targets empties the stage but keeps pins", () => {
    const s = applyOp(replay(ops), { op: "clear", id: "7" });
    expect(s.order).toEqual([]);
    expect(s.highlights).toEqual([]);
    expect(s.pins).toHaveLength(1);
  });

  it("clear with targets removes only those and their highlights", () => {
    const s = applyOp(replay(ops), { op: "clear", id: "7", targets: ["A"] });
    expect(s.order).toEqual(["B"]);
    expect(s.highlights).toEqual([]);
  });

  it("re-pinning the same id replaces instead of duplicating", () => {
    const s = applyOp(replay(ops), { op: "pin", id: "8", pin: { pinId: "T1", kind: "takeaway", text: "y" } });
    expect(s.pins).toHaveLength(1);
    expect(s.pins[0]?.text).toBe("y");
  });

  it("ignores updates to unknown elements and non-board ops", () => {
    const s = replay(ops);
    expect(applyOp(s, { op: "update", id: "9", target: "ghost", patch: {} })).toBe(s);
    expect(applyOp(s, { op: "pause", id: "10", ms: 5 })).toBe(s);
    expect(applyOp(emptyBoard, { op: "say", id: "11", text: "x" })).toBe(emptyBoard);
  });

  it("move carries a cell and its identity to another row", () => {
    const s0 = replay(ops.slice(0, 2));
    const a = s0.elements["A"];
    const idOfTwo = a && a.kind === "array_row" ? a.cellIds?.[0] : undefined;
    expect(idOfTwo).toBeDefined();
    const s1 = applyOp(s0, { op: "move", id: "m", from: { id: "A", index: 0 }, to: { id: "B" } });
    expect(s1.elements["A"]).toMatchObject({ values: [5] });
    expect(s1.elements["B"]).toMatchObject({ values: [1, 4, 2] });
    const b = s1.elements["B"];
    expect(b && b.kind === "array_row" ? b.cellIds?.[2] : undefined).toBe(idOfTwo);
  });

  it("move respects an explicit target index and ignores bad indices", () => {
    const s0 = replay(ops.slice(0, 2));
    const s1 = applyOp(s0, { op: "move", id: "m", from: { id: "B", index: 1 }, to: { id: "A", index: 0 } });
    expect(s1.elements["A"]).toMatchObject({ values: [4, 2, 5] });
    expect(applyOp(s0, { op: "move", id: "m2", from: { id: "A", index: 9 }, to: { id: "B" } })).toBe(s0);
  });
});

describe("component state", () => {
  it("merges a state patch instead of replacing the state", () => {
    const s = replay([
      { op: "show", id: "1", element: { kind: "component", id: "P", width: 600, height: 360, code: "<svg/>", state: { length: 1, showForces: true } } },
      { op: "update", id: "2", target: "P", patch: { state: { length: 2 } } },
    ]);
    expect(s.elements["P"]).toMatchObject({ state: { length: 2, showForces: true } });
    const t = applyOp(s, { op: "update", id: "3", target: "P", patch: { title: "Renamed" } });
    expect(t.elements["P"]).toMatchObject({ title: "Renamed", state: { length: 2, showForces: true } });
  });
});
