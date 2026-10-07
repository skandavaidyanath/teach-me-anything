import { describe, expect, it } from "vitest";
import { mergeSortLesson } from "@tma/content";
import { extractBlocks, normalizeBeat, parseLooseJson, planLesson, type PlannerStreamer } from "./planner";

const header = {
  topic: "binary search",
  title: "How binary search works",
  calibration: { prompt: "Have you seen a sorted list searched before?", options: ["Yes", "Sort of", "No"] },
  outline: [
    { id: "b1", title: "Guess the middle", summary: "Compare with the middle element." },
    { id: "b2", title: "Halve the search", summary: "Each step throws away half." },
  ],
};
const beat1 = {
  id: "b1",
  title: "Guess the middle",
  summary: "Compare with the middle element.",
  ops: [
    { op: "say", id: "b1.s1", text: "Here is a sorted list." },
    { op: "show", id: "b1.e1", element: { kind: "array_row", id: "L", label: "list", values: [1, 3, 5, 7, 9, 11, 13] } },
    { op: "highlight", id: "b1.h1", targets: [{ id: "L", index: 3 }] },
    { op: "check", id: "b1.k1", kind: "choice", prompt: "Which element do we compare first?", options: ["7", "1", "13"], expected: ["7"], onCorrect: [{ op: "say", id: "b1.k1.y1", text: "Yes." }], onIncorrect: [] },
  ],
};
const beat2 = {
  id: "b2",
  title: "Halve the search",
  summary: "Each step throws away half.",
  ops: [
    { op: "say", id: "b2.s1", text: "Say we want eleven." },
    { op: "highlight", id: "b2.h1", targets: [{ id: "GHOST", index: 0 }] },
    { op: "highlight", id: "b2.h2", targets: [{ id: "L", index: 5 }] },
    { op: "say", id: "b2.s2", text: "Half the list is gone." },
  ],
};

const block = (type: string, body: unknown) => `===${type}===\n${JSON.stringify(body)}\n===END===\n`;

function scripted(responses: Record<"low" | "high", string>): PlannerStreamer {
  return async function* (_system, user, effort) {
    // The fast tier is asked for the header, then one beat per call; the slow tier gets the rest.
    const text =
      effort === "low"
        ? /HEADER block only/.test(user)
          ? responses.low.split("===BEAT===")[0]!
          : /for b1 only/.test(user)
            ? "===BEAT===" + (responses.low.split("===BEAT===")[1] ?? "")
            : responses.high
        : responses.high;
    for (const piece of text.match(/.{1,40}/gs) ?? []) yield { kind: "text", text: piece };
    yield { kind: "final", model: "fake", inputTokens: 1, outputTokens: 1, refusal: false };
  };
}

describe("extractBlocks", () => {
  it("returns completed blocks and keeps the unfinished tail", () => {
    const text = block("HEADER", { a: 1 }) + "===BEAT===\n{\"id\":\"b1\"";
    const { blocks, rest } = extractBlocks(text);
    expect(blocks).toEqual([{ type: "HEADER", body: '{"a":1}' }]);
    expect(rest.startsWith("===BEAT===")).toBe(true);
  });
});

describe("normalizeBeat", () => {
  it("drops references to unknown elements and appends a missing check", () => {
    const r = normalizeBeat(beat2, 1, new Set(["L"]), "b2");
    expect(r.beat).not.toBeNull();
    if (r.beat) {
      expect(r.beat.ops.map((o) => o.id)).toEqual(["b2.s1", "b2.h2", "b2.s2", "b2.k_auto"]);
      expect(r.issues.some((i) => i.includes("unknown element"))).toBe(true);
      expect(r.issues.some((i) => i.includes("no check"))).toBe(true);
    }
  });

  it("renames to the outline id and dedupes op ids", () => {
    const dup = { ...beat1, id: "beat-one", ops: [...beat1.ops.slice(0, 1), { ...beat1.ops[0]! }, ...beat1.ops.slice(1)] };
    const r = normalizeBeat(dup, 0, new Set(), "b1");
    expect(r.beat?.id).toBe("b1");
    expect(r.beat?.ops.map((o) => o.id).slice(0, 2)).toEqual(["b1.s1", "b1.s1_2"]);
  });

  it("reports schema errors instead of a beat", () => {
    const r = normalizeBeat({ id: "x" }, 0, new Set(), "b1");
    expect(r.beat).toBeNull();
    if (!r.beat) expect(r.errors.length).toBeGreaterThan(0);
  });

  it("accepts every bundled beat as already valid", () => {
    const known = new Set<string>();
    mergeSortLesson.beats.forEach((b, i) => {
      const r = normalizeBeat(b, i, known, b.id);
      expect(r.beat).not.toBeNull();
      if (r.beat) {
        expect(r.issues).toEqual([]);
        for (const op of r.beat.ops) if (op.op === "show") known.add(op.element.id);
      }
    });
  });
});

describe("planLesson", () => {
  it("streams the header and beat 1 from the fast call, then the rest from the slow call", async () => {
    const streamer = scripted({ low: block("HEADER", header) + block("BEAT", beat1), high: block("BEAT", beat2) });
    const events = [];
    for await (const ev of planLesson("binary search", "plan-1", streamer)) events.push(ev);
    expect(events.map((e) => e.type)).toEqual(["header", "beat", "beat", "done"]);
    const h = events[0];
    if (h?.type === "header") {
      expect(h.header.id).toBe("plan-1");
      expect(h.header.outline).toHaveLength(2);
      expect(h.header.branches).toEqual([]);
    }
    const b2 = events[2];
    if (b2?.type === "beat") {
      expect(b2.index).toBe(1);
      expect(b2.beat.ops[b2.beat.ops.length - 1]?.op).toBe("check");
      expect(b2.issues.length).toBeGreaterThan(0);
    }
  });

  it("stops with an error when the opening has no header", async () => {
    const streamer = scripted({ low: block("BEAT", beat1), high: "" });
    const events = [];
    for await (const ev of planLesson("x", "p", streamer)) events.push(ev);
    expect(events[events.length - 1]).toMatchObject({ type: "error" });
  });
});

describe("parseLooseJson", () => {
  it("accepts valid JSON untouched and repairs the usual slips", () => {
    expect(parseLooseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 }, repaired: false });
    const missingComma = parseLooseJson('{"ops":[{"op":"say","id":"x","text":"Hi."} {"op":"say","id":"y","text":"There."}]}');
    expect(missingComma.ok && missingComma.value).toMatchObject({ ops: [{ id: "x" }, { id: "y" }] });
    expect(missingComma.ok && missingComma.repaired).toBe(true);
    const fenced = parseLooseJson('```json\n{"a":[1,2,]}\n```');
    expect(fenced.ok && fenced.value).toEqual({ a: [1, 2] });
    expect(parseLooseJson("not json at all {{{").ok).toBe(false);
  });
});

