import Anthropic from "@anthropic-ai/sdk";

/** An API failure in words a learner can act on; the raw error stays in the harness log. */
export function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    if (/credit balance/i.test(err.message)) return "The Anthropic account behind this tutor is out of credits. Top it up under Plans & Billing, then reload.";
    if (err.status === 401) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.";
    if (err.status === 429) return "The Anthropic API is rate limiting this account right now. Try again in a moment.";
    if (err.status === 529 || (err.status ?? 0) >= 500) return "The Anthropic API is having trouble right now. Try again in a moment.";
    return `${err.status ?? ""} ${err.message}`.trim();
  }
  return err instanceof Error ? err.message : String(err);
}
import { mergeSortLesson } from "@tma/content";
import { BeatSchema, type Beat, type LessonHeader, type Op, type OutlineEntry, type RecordEntry, ComponentSchema, type Component } from "@tma/schema";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { PRIMITIVES_DOC, STYLE_GUIDE } from "./catalog";
import { config } from "./env";

/**
 * The slow tier. Writes a lesson for a topic in two calls: a fast opening
 * (header, calibration, outline, beat 1) so the learner can start, then the
 * remaining beats at high effort while beat 1 plays. Beats stream as blocks
 * and are validated one by one; a broken beat gets one repair attempt.
 */

export type PlannerStreamer = (
  system: string,
  user: string,
  effort: "low" | "medium" | "high",
) => AsyncIterable<{ kind: "text"; text: string } | { kind: "final"; model: string | null; inputTokens: number | null; outputTokens: number | null; refusal: boolean }>;

export type SayStats = { says: number; avgWords: number; maxWords: number; keys: number; longestStillRun: number };

export type PlannerEvent =
  | { type: "header"; header: LessonHeader }
  | { type: "diagnostic"; message: string; raw: string }
  | { type: "beat"; index: number; beat: Beat; issues: string[]; stats?: SayStats; calibrationSeen?: boolean }
  /** The lesson's figure, ready after a beat that shows it by reference was already sent. */
  | { type: "component"; element: Component }
  | { type: "outline"; fromIndex: number; outline: OutlineEntry[] }
  | { type: "error"; message: string }
  | { type: "done"; model: string | null; inputTokens: number | null; outputTokens: number | null };

const RULES = `You write short, spoken, board-based lessons. A lesson is 4 to 6 parts called beats. Structural rules:
- One idea per beat. Every beat ends with exactly one check, and the check is the last op.
- One sentence per say op, plain, written to be spoken aloud. No markdown. Spell out symbols the way a person would say them.
- Shape the delivery where it matters: "key": true on a sentence the listener needs to land (spoken slowly, with a breath after, set apart in the caption), "pace" on a sentence that should go slower or quicker, a pause op where silence does work. You decide which and how often.
- Every say op refers to something the learner can see. Highlight what you are talking about. When a value moves, use a move op so it travels. Use the derivation element for step-by-step math, the split_tree for halving, rows for lists, a scene for a still diagram, and a component for anything that moves, changes viewpoint, or has parts that interact.
- In demo mode, the lesson has one figure (a simulation or mechanism with state), specified in the header as "figure" and implemented in its own call: it is on the board from the first sentence of beat 1, alive, and every later beat drives it with update ops rather than adding new figures. Its stateDoc must say what each field means and what it may be set to, because the tutor will change it when the learner asks. In write-along mode, the lines are a derivation element shown with revealed:1 and revealed one more line per update as it is spoken. In case mode, the numbers live in one chart component whose state picks the factor shown, with rows and cards for the framework. Beat 1 uses only the instant elements (rows, cards, formulas, derivations, scenes) so the lesson starts at once.
- The reaction to a check shows the answer on the board, with an update or a highlight, before the sentence that explains it.
- Pin one idea per beat with a short bold title and one sentence of body. Pin formulas as kind "equation" with "tex".
- Checks have a known answer: choice with 3 options and an "expected" list of accepted answers (include the exact option text), or click_cell with targets and an expected target. The last beat's check may be an ungraded "want to go deeper?" prompt. Reactions: onCorrect one sentence; onIncorrect a highlight or update, one or two sentences that teach, then clear_highlights.
- Each beat has a "summary": one sentence of what it teaches, so the tutor can place questions in the lesson.
- Ids: beats b1..bN; ops "<beatId>.<letter><n>" (s for say, e show, u update, m move, h highlight, c clear, p pin, k check); elements short like A, B, OUT, T, D, S, P.
- Elements referenced by update, move, or highlight must have been shown earlier in the lesson.
- The opening question, 3 options, asks what the learner already has that this lesson can start from, and each option names it in their words ("I've used PyTorch", "I've written a kernel", "Neither"). Beat 1 is written before the answer arrives and must work for every option; its first lines are then reshaped to the answer, so write them as the place a tutor would adapt. Beats written after the answer start from it.
- Beat 1 is the opening, written while the learner reads the opening question, so it is the short beat: the hook on the figure, the orientation, one prediction. The work of the lesson starts in beat 2. The opening has no key line: a key line marks a reveal the learner has just watched, and while the stage is being set there is nothing to mark yet.`;

const FORMAT = `OUTPUT FORMAT. Write blocks, nothing else. Each block is a line "===HEADER===", "===BEAT===", or "===COMPONENT===", then its content, then a line "===END===". HEADER and BEAT content is one JSON object, strictly valid: double-quoted keys and strings, a comma between every pair of items, no trailing commas, no comments, no text outside the braces. Inside strings, escape backslashes (write \\\\log for \\log) and double quotes.
The header JSON: {"topic":"...","title":"...","style":"demo" or "write-along" or "case","calibration":{"prompt":"...","options":["...","...","..."]},"outline":[{"id":"b1","title":"...","summary":"..."}, ...],"figure":{"id":"P","title":"...","width":960,"height":540,"state":{...},"stateDoc":"each field, what it means and what it may be set to","parts":["..."],"brief":"what it shows, how it moves at rest, how it changes with each state field, what it sounds like"}}. The figure is the one object the lesson is about, designed here so every beat can drive it; omit it only when the lesson has nothing to show that moves.
Each beat JSON: {"id":"b1","title":"...","summary":"...","ops":[...]}
A COMPONENT block carries a figure's code unescaped. Its first line is a JSON object with every field but "code" ({"id":"P","title":"A pendulum","width":600,"height":360,"state":{"length":1},"stateDoc":"length: 0.5 to 2","parts":["bob","string","gravity"]}), and the lines after it up to ===END=== are the code. Write the block before the first beat that shows the figure, and show it with {"op":"show","id":"b2.e1","element":{"kind":"component","id":"P"}}; the code is attached from the block.`;


const EXAMPLE_COMPONENT = `===COMPONENT===
{"id":"P","title":"A pendulum","width":600,"height":360,"state":{"length":1,"showForces":true},"stateDoc":"length: 0.5 to 2, the string length relative to the start; showForces: true | false, whether the gravity arrow is drawn","parts":["bob","string","gravity"]}
<svg viewBox="0 0 600 360" width="600" height="360">
  <defs><marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="var(--correct)"/></marker></defs>
  <line x1="200" y1="40" x2="400" y2="40" stroke="var(--ink-mute)" stroke-width="3"/>
  <line id="string" x1="300" y1="40" x2="300" y2="240" stroke="var(--ink)" stroke-width="2"/>
  <circle id="bob" cx="300" cy="240" r="16" fill="var(--blue)"/>
  <line id="gravity" x1="300" y1="240" x2="300" y2="300" stroke="var(--correct)" stroke-width="3" marker-end="url(#head)"/>
  <text id="period" x="20" y="340" font-size="14" fill="var(--ink-soft)"></text>
</svg>
<script>
  var angle = 0.6, velocity = 0, L = 200, g = 9.8;
  var str = document.getElementById("string"), bob = document.getElementById("bob"), grav = document.getElementById("gravity");
  tma.onState(function (s, prev) {
    var target = 200 * (s.length || 1);
    if (!prev) L = target;
    else { var from = L; tma.tween(600, function (p) { L = tma.lerp(from, target, p); }); }
    grav.style.display = s.showForces === false ? "none" : "";
  });
  tma.onFrame(function (t, dt) {
    velocity += -(g / (L / 100)) * Math.sin(angle) * dt;
    angle += velocity * dt;
    var x = 300 + L * Math.sin(angle), y = 40 + L * Math.cos(angle);
    str.setAttribute("x2", x); str.setAttribute("y2", y);
    bob.setAttribute("cx", x); bob.setAttribute("cy", y);
    grav.setAttribute("x1", x); grav.setAttribute("y1", y); grav.setAttribute("x2", x); grav.setAttribute("y2", y + 60);
    document.getElementById("period").textContent = "period about " + (2 * Math.PI * Math.sqrt(L / 100 / g)).toFixed(1) + " s";
  });
</script>
===END===
===BEAT===
{"id":"b2","title":"What sets the period","summary":"The period depends on the string length, not the mass.","ops":[{"op":"show","id":"b2.e1","element":{"kind":"component","id":"P"}},{"op":"say","id":"b2.s1","text":"Here is a pendulum swinging, with gravity drawn as the green arrow."},{"op":"highlight","id":"b2.h1","targets":[{"id":"P","index":2}]},{"op":"say","id":"b2.s2","text":"Gravity is the only thing pulling it back toward the middle."},{"op":"clear_highlights","id":"b2.c1"},{"op":"say","id":"b2.s3","text":"Now watch what a longer string does to the swing."},{"op":"update","id":"b2.u1","target":"P","patch":{"state":{"length":2}}},{"op":"say","id":"b2.s4","text":"Longer string, slower swing, and the period in the corner goes up."},{"op":"pin","id":"b2.p1","pin":{"pinId":"period","kind":"takeaway","title":"Length sets the period","text":"A longer string swings more slowly; the mass does not matter."}},{"op":"check","id":"b2.k1","kind":"choice","prompt":"Halve the string. The period…","options":["Gets shorter","Stays the same","Gets longer"],"expected":["Gets shorter","shorter"],"onCorrect":[{"op":"update","id":"b2.k1.u1","target":"P","patch":{"state":{"length":0.5}}},{"op":"say","id":"b2.k1.y1","text":"Shorter string, quicker swing, as you can see."}],"onIncorrect":[{"op":"update","id":"b2.k1.u2","target":"P","patch":{"state":{"length":0.5}}},{"op":"say","id":"b2.k1.n1","text":"Watch it: with half the string, the swing speeds up."}]}]}
===END===`;

function exampleBlocks(): string {
  const l = mergeSortLesson;
  const header = {
    topic: l.topic,
    title: l.title,
    calibration: l.calibration,
    outline: l.beats.map((b) => ({ id: b.id, title: b.title, summary: b.summary })),
  };
  const beat1 = l.beats[0]!;
  const beat2 = l.beats[1]!;
  return [
    "===HEADER===",
    JSON.stringify(header),
    "===END===",
    "===BEAT===",
    JSON.stringify({ id: beat1.id, title: beat1.title, summary: beat1.summary, ops: beat1.ops }),
    "===END===",
    "===BEAT===",
    JSON.stringify({ id: beat2.id, title: beat2.title, summary: beat2.summary, ops: beat2.ops }),
    "===END===",
  ].join("\n");
}

export const PLANNER_SYSTEM = `${RULES}\n\n${STYLE_GUIDE}\n\n${PRIMITIVES_DOC}\n\n${FORMAT}\n\nEXAMPLE of the format (the format only; its wording predates the style rules above), from a lesson on merge sort, header and the first two beats:\n${exampleBlocks()}\n\nEXAMPLE of a COMPONENT block and a beat that uses it, from a different lesson, on pendulums:\n${EXAMPLE_COMPONENT}`;

const FigureSpecSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  state: z.record(z.string(), z.unknown()).optional(),
  stateDoc: z.string().optional(),
  parts: z.array(z.string()).optional(),
  brief: z.string().optional(),
});
export type FigureSpec = z.infer<typeof FigureSpecSchema>;

const HeaderBlockSchema = z.object({
  topic: z.string().min(1),
  title: z.string().min(1),
  style: z.enum(["demo", "write-along", "case"]).optional(),
  calibration: z.object({ prompt: z.string().min(1), options: z.array(z.string().min(1)).min(2) }).optional(),
  outline: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), summary: z.string().optional() })).min(2),
  figure: FigureSpecSchema.optional(),
});

/** Common slips in a header: the whole thing wrapped in an array, the figure given as a list, its state as a list. */
export function coerceHeader(raw: unknown): unknown {
  let h: unknown = raw;
  if (Array.isArray(h)) h = h.find((x) => x && typeof x === "object" && !Array.isArray(x)) ?? h;
  if (!h || typeof h !== "object" || Array.isArray(h)) return h;
  const out: Record<string, unknown> = { ...(h as Record<string, unknown>) };
  if (Array.isArray(out["figure"])) out["figure"] = (out["figure"] as unknown[]).find((x) => x && typeof x === "object" && !Array.isArray(x));
  const fig = out["figure"];
  if (fig && typeof fig === "object" && !Array.isArray(fig)) {
    const f: Record<string, unknown> = { ...(fig as Record<string, unknown>) };
    if (Array.isArray(f["state"])) f["state"] = {};
    if (typeof f["parts"] === "string") f["parts"] = (f["parts"] as string).split(/[\s,]+/).filter(Boolean);
    if (typeof f["stateDoc"] !== "string" && f["stateDoc"] !== undefined) f["stateDoc"] = JSON.stringify(f["stateDoc"]);
    out["figure"] = f;
  }
  const cal = out["calibration"];
  if (Array.isArray(cal) && cal.every((x) => typeof x === "string")) out["calibration"] = { prompt: "Before we start, which of these sounds most like you?", options: cal };
  if (Array.isArray(out["outline"])) out["outline"] = (out["outline"] as unknown[]).map((b, i) => (typeof b === "string" ? { id: `b${i + 1}`, title: b } : b));
  return out;
}

const describeIssues = (error: z.ZodError): string => error.issues.map((i) => `${i.path.join(".") || "header"}: ${i.message}`).join("; ");

const figureNote = (spec: FigureSpec | null): string =>
  spec
    ? `\n\nThe lesson's figure, ${spec.id}${spec.title ? ` ("${spec.title}")` : ""}, is being implemented separately from this spec: state ${JSON.stringify(spec.state ?? {})}; ${spec.stateDoc ?? ""}${spec.parts ? `; parts ${spec.parts.join(", ")}` : ""}. ${spec.brief ?? ""} Show it with {"kind":"component","id":"${spec.id}"} (the code is attached for you), drive it with update ops on those state fields, and highlight its parts.`
    : "";
const OutlineBlockSchema = z.object({ outline: HeaderBlockSchema.shape.outline });

export type BlockType = "HEADER" | "BEAT" | "OUTLINE" | "COMPONENT";
const BLOCK_RE = /===(HEADER|BEAT|OUTLINE|COMPONENT)===\s*([\s\S]*?)\s*===END===/g;

/** Pull completed blocks off the front of a text buffer. */
export function extractBlocks(buffer: string): { blocks: Array<{ type: BlockType; body: string }>; rest: string } {
  const blocks: Array<{ type: BlockType; body: string }> = [];
  let lastEnd = 0;
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(buffer)) !== null) {
    blocks.push({ type: m[1] as BlockType, body: m[2]! });
    lastEnd = m.index + m[0].length;
  }
  return { blocks, rest: buffer.slice(lastEnd).replace(/^\s+/, "") };
}

/** Parse model-written JSON, repairing the usual slips (missing commas, trailing commas, comments, stray text). */
export function parseLooseJson(body: string): { ok: true; value: unknown; repaired: boolean } | { ok: false; error: string } {
  const trimmed = body.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return { ok: true, value: JSON.parse(trimmed), repaired: false };
  } catch (first) {
    const stray = dropStrayClosers(trimmed);
    if (stray !== null) return { ok: true, value: stray, repaired: true };
    try {
      return { ok: true, value: JSON.parse(jsonrepair(trimmed)), repaired: true };
    } catch {
      return { ok: false, error: (first as Error).message };
    }
  }
}

/**
 * The model's commonest slip in a deeply nested op is one closing brace too many after an
 * element's item list, which jsonrepair does not fix. JSON.parse says where it choked; if the
 * offending character is a closer, drop it and try again, a few times at most.
 */
export function dropStrayClosers(text: string, attempts = 3): unknown | null {
  let current = text;
  for (let i = 0; i < attempts; i++) {
    try {
      return JSON.parse(current);
    } catch (err) {
      const m = /position (\d+)/.exec((err as Error).message);
      if (!m) return null;
      const at = Number(m[1]);
      if (current[at] !== "}" && current[at] !== "]") return null;
      current = current.slice(0, at) + current.slice(at + 1);
    }
  }
  try {
    return JSON.parse(current);
  } catch {
    return null;
  }
}

const ComponentHeadSchema = ComponentSchema.omit({ kind: true, code: true });

/** A COMPONENT block: one line of JSON (every field but the code), then the code. */
export function parseComponentBlock(body: string): { element: Component } | { error: string } {
  const text = body.trim();
  const nl = text.indexOf("\n");
  const headLine = (nl === -1 ? text : text.slice(0, nl)).trim();
  const code = nl === -1 ? "" : text.slice(nl + 1).trim();
  const loose = parseLooseJson(headLine);
  if (!loose.ok) return { error: `component head: ${loose.error}` };
  const head = ComponentHeadSchema.safeParse(loose.value);
  if (!head.success) return { error: `component head: ${head.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  if (!code) return { error: `component ${head.data.id}: no code` };
  return { element: { kind: "component", ...head.data, code } };
}

/** Fill in the code of components a beat shows by reference; drop a show whose code never arrived. */
export function attachComponents(raw: unknown, components: Map<string, Component>): { raw: unknown; dropped: string[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { raw, dropped: [] };
  const dropped: string[] = [];
  const fix = (ops: unknown): unknown => {
    if (!Array.isArray(ops)) return ops;
    const out: unknown[] = [];
    for (const op of ops) {
      if (op && typeof op === "object" && !Array.isArray(op)) {
        const o = op as Record<string, unknown>;
        if (o["op"] === "show" && o["element"] && typeof o["element"] === "object") {
          const el = o["element"] as Record<string, unknown>;
          if (el["kind"] === "component" && typeof el["code"] !== "string") {
            const known = typeof el["id"] === "string" ? components.get(el["id"]) : undefined;
            if (!known) {
              // Shown by reference before its code exists: it stays, and the code follows when it is ready.
              dropped.push(String(el["id"] ?? "?"));
              out.push(op);
              continue;
            }
            out.push({ ...o, element: { ...known, ...el, code: known.code } });
            continue;
          }
        }
        if (o["op"] === "check") {
          out.push({ ...o, onCorrect: fix(o["onCorrect"]), onIncorrect: fix(o["onIncorrect"]) });
          continue;
        }
      }
      out.push(op);
    }
    return out;
  };
  const r = raw as Record<string, unknown>;
  return { raw: { ...r, ops: fix(r["ops"]) }, dropped };
}

function collectComponents(beats: Beat[]): Map<string, Component> {
  const out = new Map<string, Component>();
  const walk = (ops: Op[]) => {
    for (const op of ops) {
      if (op.op === "show" && op.element.kind === "component") out.set(op.element.id, op.element);
      if (op.op === "check") {
        walk(op.onCorrect ?? []);
        walk(op.onIncorrect ?? []);
      }
    }
  };
  for (const b of beats) walk(b.ops);
  return out;
}

const SENTENCE_END = /(?<=[.!?]["')\]]*)\s+(?=\S)/;
const wordCount = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Split any say op that holds several sentences into one op per sentence; the key mark stays on the first. */
export function splitSays(ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    if (op.op === "check") {
      out.push({ ...op, onCorrect: splitSays(op.onCorrect ?? []), onIncorrect: splitSays(op.onIncorrect ?? []) });
      continue;
    }
    if (op.op !== "say") {
      out.push(op);
      continue;
    }
    const parts = op.text.split(SENTENCE_END).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2 || parts.some((p) => wordCount(p) < 2)) {
      out.push(op);
      continue;
    }
    parts.forEach((text, i) => {
      const piece: Op = { ...op, id: i === 0 ? op.id : `${op.id}_${i + 1}`, text };
      if (i > 0 && piece.op === "say") delete piece.key;
      out.push(piece);
    });
  }
  return out;
}

function allSays(ops: Op[]): Array<Extract<Op, { op: "say" }>> {
  const out: Array<Extract<Op, { op: "say" }>> = [];
  for (const op of ops) {
    if (op.op === "say") out.push(op);
    if (op.op === "check") out.push(...allSays(op.onCorrect ?? []), ...allSays(op.onIncorrect ?? []));
  }
  return out;
}

export function sayStats(ops: Op[]): SayStats {
  const says = allSays(ops);
  const counts = says.map((s) => wordCount(s.text));
  // How many sentences in a row play with nothing changing on the board, at the longest.
  let run = 0;
  let longestStillRun = 0;
  for (const op of ops) {
    if (op.op === "say" || op.op === "pause") run++;
    else run = 0;
    longestStillRun = Math.max(longestStillRun, run);
  }
  return {
    says: says.length,
    avgWords: counts.length ? Math.round((counts.reduce((a, b) => a + b, 0) / counts.length) * 10) / 10 : 0,
    maxWords: counts.length ? Math.max(...counts) : 0,
    keys: ops.filter((o) => o.op === "say" && o.key).length,
    longestStillRun,
  };
}

function collectShown(ops: Op[], into: Set<string>): void {
  for (const op of ops) {
    if (op.op === "show") into.add(op.element.id);
    if (op.op === "check") {
      collectShown(op.onCorrect ?? [], into);
      collectShown(op.onIncorrect ?? [], into);
    }
  }
}

function refsKnown(op: Op, known: Set<string>): boolean {
  switch (op.op) {
    case "update":
      return known.has(op.target);
    case "move":
      return known.has(op.from.id) && known.has(op.to.id);
    case "highlight":
      return op.targets.every((t) => known.has(t.id));
    default:
      return true;
  }
}

/**
 * Make a beat safe to play: unique op ids, exactly one check at the end,
 * no references to elements never shown. Returns the issues it fixed.
 */
export function normalizeBeat(raw: unknown, index: number, knownBefore: Set<string>, outlineId: string | undefined): { beat: Beat; issues: string[]; stats: SayStats } | { beat: null; errors: string[] } {
  const parsed = BeatSchema.safeParse(raw);
  if (!parsed.success) return { beat: null, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const issues: string[] = [];
  const beat = { ...parsed.data };
  if (outlineId && beat.id !== outlineId) {
    issues.push(`beat id ${beat.id} renamed to ${outlineId}`);
    beat.id = outlineId;
  }
  const known = new Set(knownBefore);
  const seenIds = new Set<string>();
  const fixIds = (ops: Op[]): Op[] =>
    ops.map((op) => {
      let id = op.id;
      let n = 2;
      while (seenIds.has(id)) id = `${op.id}_${n++}`;
      if (id !== op.id) issues.push(`duplicate op id ${op.id} renamed`);
      seenIds.add(id);
      const fixed = { ...op, id } as Op;
      if (fixed.op === "check") {
        fixed.onCorrect = fixIds(fixed.onCorrect ?? []);
        fixed.onIncorrect = fixIds(fixed.onIncorrect ?? []);
      }
      return fixed;
    });
  let ops = fixIds(beat.ops);

  // One sentence per say op, so pacing and captions work per sentence.
  ops = splitSays(ops);

  // References must point at shown elements, in play order.
  const filter = (list: Op[]): Op[] => {
    const out: Op[] = [];
    for (const op of list) {
      if (op.op === "show") known.add(op.element.id);
      if (!refsKnown(op, known)) {
        issues.push(`dropped ${op.op} ${op.id}: unknown element`);
        continue;
      }
      if (op.op === "check") {
        out.push({ ...op, onCorrect: filter(op.onCorrect ?? []), onIncorrect: filter(op.onIncorrect ?? []) });
      } else out.push(op);
    }
    return out;
  };
  ops = filter(ops);

  const checks = ops.filter((o) => o.op === "check");
  if (checks.length === 0) {
    issues.push("no check; appended an ungraded prompt");
    ops.push({ op: "check", id: `${beat.id}.k_auto`, kind: "choice", prompt: "Ready to go on?", options: ["Yes", "Say that again"], graded: false });
  } else if (checks.length > 1 || ops[ops.length - 1]!.op !== "check") {
    issues.push(`${checks.length} checks; kept the last one at the end`);
    const last = checks[checks.length - 1]!;
    ops = [...ops.filter((o) => o.op !== "check"), last];
  }
  return { beat: { ...beat, ops }, issues, stats: sayStats(ops) };
}

function headerFromBlock(block: z.infer<typeof HeaderBlockSchema>, id: string): LessonHeader {
  return {
    id,
    topic: block.topic,
    title: block.title,
    ...(block.style ? { style: block.style } : {}),
    ...(block.calibration ? { calibration: block.calibration } : {}),
    outline: block.outline.map((b) => ({ id: b.id, title: b.title, ...(b.summary ? { summary: b.summary } : {}) })),
    branches: [],
    fallback: {
      ops: [{ op: "say", id: "fb.offline", text: "I can't answer that while I'm offline. Try again when the tutor is connected." }],
      resume: { mode: "continue", bridge: "Let's pick up where we left off." },
    },
  };
}

type StreamItem = { type: BlockType; body: string } | { type: "final"; model: string | null; inputTokens: number | null; outputTokens: number | null; refusal: boolean };

/** Start consuming a stream now and hand its items over as they arrive, so a call can run while another is processed. */
function eager<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  const buffer: T[] = [];
  let done = false;
  let error: unknown = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };
  void (async () => {
    try {
      for await (const item of source) {
        buffer.push(item);
        notify();
      }
    } catch (e) {
      error = e;
    } finally {
      done = true;
      notify();
    }
  })();
  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (buffer.length > 0) {
          yield buffer.shift()!;
          continue;
        }
        if (done) {
          if (error) throw error;
          return;
        }
        await new Promise<void>((r) => (wake = r));
      }
    },
  };
}

async function* streamBlocks(streamer: PlannerStreamer, system: string, user: string, effort: "low" | "medium" | "high"): AsyncGenerator<StreamItem> {
  let buffer = "";
  for await (const piece of streamer(system, user, effort)) {
    if (piece.kind === "text") {
      buffer += piece.text;
      const { blocks, rest } = extractBlocks(buffer);
      buffer = rest;
      for (const b of blocks) yield b;
    } else yield { type: "final", ...piece };
  }
  const { blocks } = extractBlocks(buffer + "\n===END===");
  for (const b of blocks) yield b;
}

async function repairHeader(streamer: PlannerStreamer, body: string, why: string): Promise<unknown | null> {
  const user = `This HEADER JSON failed validation:\n${body}\n\nProblems:\n${why}\n\nReturn the corrected header as a single ===HEADER=== block, following the header format exactly: "figure" is one object, its "state" is an object, "parts" is an array of strings.`;
  let buffer = "";
  try {
    for await (const piece of streamer(PLANNER_SYSTEM, user, "low")) if (piece.kind === "text") buffer += piece.text;
  } catch {
    return null;
  }
  const { blocks } = extractBlocks(buffer + "\n===END===");
  const block = blocks.find((b) => b.type === "HEADER");
  if (!block) return null;
  const parsed = parseLooseJson(block.body);
  return parsed.ok ? parsed.value : null;
}

async function repairBeat(streamer: PlannerStreamer, body: string, errors: string[]): Promise<unknown | null> {
  const user = `This beat JSON failed validation:\n${body}\n\nErrors:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nReturn the corrected beat as a single ===BEAT=== block.`;
  let buffer = "";
  for await (const piece of streamer(PLANNER_SYSTEM, user, "low")) if (piece.kind === "text") buffer += piece.text;
  const { blocks } = extractBlocks(buffer + "\n===END===");
  const block = blocks.find((b) => b.type === "BEAT");
  if (!block) return null;
  const parsed = parseLooseJson(block.body);
  return parsed.ok ? parsed.value : null;
}

/** The learner's answer to the opening question, which arrives while the lesson is being written. */
export type CalibrationHandle = { readonly answer: string | null; readonly promise: Promise<string | null>; resolve(answer: string | null): void };

export function calibrationHandle(): CalibrationHandle {
  let answer: string | null = null;
  let resolveFn: (a: string | null) => void = () => {};
  const promise = new Promise<string | null>((r) => (resolveFn = r));
  return {
    get answer() {
      return answer;
    },
    promise,
    resolve(a) {
      answer = a;
      resolveFn(a);
    },
  };
}

const calibrationNote = (header: LessonHeader, answer: string | null): string =>
  answer ? `\n\nThe learner answered the opening question "${header.calibration?.prompt ?? ""}" with "${answer}". Start from what they already have, in their words, and do not re-teach it.` : "";

export async function* planLesson(topic: string, lessonId: string, streamer: PlannerStreamer, calibration: CalibrationHandle = calibrationHandle(), opts: { figureGraceMs?: number; figureStreamer?: PlannerStreamer | null } = {}): AsyncGenerator<PlannerEvent> {
  const known = new Set<string>();
  const components = new Map<string, Component>();
  let header: LessonHeader | null = null;
  let figureSpec: FigureSpec | null = null;
  const fastBeats: Beat[] = [];
  let meta = { model: null as string | null, inputTokens: null as number | null, outputTokens: null as number | null };
  /** How many beats the fast tier writes before the slow tier takes over. */
  const FAST_BEATS = 2;
  /** How long a beat waits for the figure's code before going out without it: the opening is about the figure, so it waits a while. */
  const FIGURE_GRACE_MS = opts.figureGraceMs ?? 25000;
  const figureStreamer = opts.figureStreamer ?? streamer;

  const handleBeat = async function* (body: string, index: number): AsyncGenerator<PlannerEvent> {
    const parsed = parseLooseJson(body);
    let raw: unknown;
    if (!parsed.ok) {
      yield { type: "diagnostic", message: `beat ${index + 1}: invalid JSON (${parsed.error}); asking the planner to fix it`, raw: body.slice(0, 4000) };
      const fixed = await repairBeat(streamer, body, [parsed.error]);
      if (fixed === null) {
        yield { type: "error", message: `beat ${index + 1}: invalid JSON (${parsed.error})` };
        return;
      }
      raw = fixed;
    } else {
      if (parsed.repaired) yield { type: "diagnostic", message: `beat ${index + 1}: JSON needed repair`, raw: body.slice(0, 4000) };
      raw = parsed.value;
    }
    const attached = attachComponents(raw, components);
    let result = normalizeBeat(attached.raw, index, known, header?.outline[index]?.id);
    if (!result.beat) {
      const fixed = await repairBeat(streamer, body, result.errors);
      result = fixed ? normalizeBeat(attachComponents(fixed, components).raw, index, known, header?.outline[index]?.id) : result;
    }
    if (!result.beat) {
      yield { type: "error", message: `beat ${index + 1} could not be repaired: ${(result as { errors: string[] }).errors.join("; ")}` };
      return;
    }
    collectShown(result.beat.ops, known);
    yield { type: "beat", index, beat: result.beat, issues: [...attached.dropped.map((id) => `figure ${id} shown before its code arrived`), ...result.issues], stats: result.stats };
  };

  const handleComponent = function* (body: string): Generator<PlannerEvent> {
    const parsed = parseComponentBlock(body);
    if ("element" in parsed) components.set(parsed.element.id, parsed.element);
    else yield { type: "diagnostic", message: parsed.error, raw: body.slice(0, 4000) };
  };

  try {
    // Call 1: the header alone, so the calibration question is on screen within a few seconds.
    const opening = `Topic: ${topic}\n\nWrite the HEADER block only (with an outline of 4 to 6 beats). No beats yet.`;
    for await (const block of streamBlocks(streamer, PLANNER_SYSTEM, opening, "low")) {
      if (block.type === "final") {
        meta = { model: block.model, inputTokens: block.inputTokens, outputTokens: block.outputTokens };
        if (block.refusal) {
          yield { type: "error", message: "the planner declined this topic" };
          return;
        }
        continue;
      }
      if (block.type === "COMPONENT") {
        yield* handleComponent(block.body);
        continue;
      }
      if (block.type === "HEADER") {
        const loose = parseLooseJson(block.body);
        if (!loose.ok) {
          yield { type: "diagnostic", message: `header: invalid JSON (${loose.error})`, raw: block.body.slice(0, 4000) };
          yield { type: "error", message: `header: invalid JSON (${loose.error})` };
          return;
        }
        let parsed = HeaderBlockSchema.safeParse(coerceHeader(loose.value));
        if (!parsed.success) {
          // One chance to fix it: the header is the whole lesson's shape.
          const why = describeIssues(parsed.error);
          yield { type: "diagnostic", message: `header did not validate (${why}); asking the planner to fix it`, raw: block.body.slice(0, 4000) };
          const fixed = await repairHeader(streamer, block.body, why);
          parsed = HeaderBlockSchema.safeParse(coerceHeader(fixed));
          if (!parsed.success) {
            yield { type: "error", message: `header: ${describeIssues(parsed.error)}` };
            return;
          }
        }
        header = headerFromBlock(parsed.data, lessonId);
        figureSpec = parsed.data.figure ?? null;
        yield { type: "header", header };
      }
    }
    if (!header) {
      yield { type: "error", message: "the planner produced no header" };
      return;
    }
    const headerBlock = `===HEADER===\n${JSON.stringify({ topic: header.topic, title: header.title, style: header.style, calibration: header.calibration, outline: header.outline, ...(figureSpec ? { figure: figureSpec } : {}) })}\n===END===`;
    const total = header.outline.length;

    // The figure is implemented in its own call, concurrently with beat 1, from the spec in the header.
    // Speech never waits long for code: a beat goes out after a short grace period and the figure follows.
    let figureDone = false;
    const figureReady: Promise<void> = figureSpec
      ? (async () => {
          const spec = figureSpec;
          const ask = `Topic: ${topic}\n\nHere is the header you wrote:\n${headerBlock}\n\nImplement the figure "${spec.id}" from its spec in the header: ${spec.brief ?? ""} State ${JSON.stringify(spec.state ?? {})}; ${spec.stateDoc ?? ""}${spec.parts ? `; parts ${spec.parts.join(", ")}` : ""}. Return exactly one COMPONENT block, its first line the spec as JSON (id, title, width, height, state, stateDoc, parts) and the code after it. It must be alive at rest, animate every state change, and sound when the topic sounds.`;
          try {
            for await (const item of streamBlocks(figureStreamer, PLANNER_SYSTEM, ask, "low")) {
              if (item.type === "COMPONENT") {
                const parsed = parseComponentBlock(item.body);
                if ("element" in parsed) components.set(parsed.element.id, parsed.element);
              }
            }
          } catch {
            // Without the figure, beats fall back to their instant elements.
          }
          figureDone = true;
        })()
      : Promise.resolve();
    const figureGrace = (ms: number) => Promise.race([figureReady, new Promise<void>((r) => setTimeout(r, ms))]);
    /** After a beat went out showing the figure by reference, send the code once it exists. */
    const lateFigure = async function* (beat: Beat): AsyncGenerator<PlannerEvent> {
      if (!figureSpec || figureDone) return;
      const refers = beat.ops.some((o) => o.op === "show" && o.element.kind === "component" && o.element.id === figureSpec!.id && !o.element.code);
      if (!refers) return;
      await figureReady;
      const element = components.get(figureSpec.id);
      if (element) yield { type: "component", element };
    };

    // Fast tier at low effort. Beats 1 and 2 are written at the same time, both from the header
    // alone: beat 1 while the learner reads the calibration question, beat 2 (which carries the
    // lesson's figure, the slowest thing to write) while beat 1 plays. Beat 2 is processed after
    // beat 1 so element references resolve in order.
    const askFor = (index: number, answer: string | null = null): string => {
      const entry = header!.outline[index]!;
      if (index === 0) {
        return `Topic: ${topic}\n\nHere is the header you wrote:\n${headerBlock}\n\nWrite the BEAT block for ${entry.id} only. It must work regardless of the answer to the opening question. Besides the figure, use only instantly rendered elements.${figureNote(figureSpec)}`;
      }
      return `Topic: ${topic}\n\nHere is the header you wrote:\n${headerBlock}\n\nWrite the BEAT block for ${entry.id} only, following the outline. ${header!.outline[0]!.id} is being written separately; apart from the figure, do not reference its elements, and start this beat with what it needs on the board.${figureNote(figureSpec).replace("Show it with", "It is already on the board from the first beat, so do not show it again unless you cleared it; drive it with")}${calibrationNote(header!, answer)}`;
    };
    const collect = async (ask: string, effort: "low" | "medium" | "high" = "low"): Promise<StreamItem[]> => {
      const out: StreamItem[] = [];
      try {
        for await (const item of streamBlocks(streamer, PLANNER_SYSTEM, ask, effort)) out.push(item);
      } catch {
        // A failed second beat is written again by the slow tier.
      }
      return out;
    };
    const handleFast = async function* (item: StreamItem, index: number, calibrationSeen: boolean): AsyncGenerator<PlannerEvent, boolean> {
      if (item.type === "final") {
        meta = { model: item.model, inputTokens: (meta.inputTokens ?? 0) + (item.inputTokens ?? 0), outputTokens: (meta.outputTokens ?? 0) + (item.outputTokens ?? 0) };
        return false;
      }
      if (item.type === "COMPONENT") {
        yield* handleComponent(item.body);
        return false;
      }
      if (item.type !== "BEAT") return false;
      await figureGrace(FIGURE_GRACE_MS);
      let got = false;
      let sent: Beat | null = null;
      for await (const ev of handleBeat(item.body, index)) {
        if (ev.type === "beat") {
          fastBeats.push(ev.beat);
          got = true;
          sent = ev.beat;
          yield { ...ev, calibrationSeen };
          continue;
        }
        yield ev;
      }
      if (sent) yield* lateFigure(sent);
      return got;
    };

    // Beat 2 starts once the learner's opening answer is in, or once beat 1 is done, whichever comes first,
    // so it can start from what they have without waiting on them.
    let firstDone: () => void = () => {};
    const firstDonePromise = new Promise<void>((r) => (firstDone = r));
    let secondSawCalibration = false;
    const second =
      total > 1 && FAST_BEATS > 1
        ? (async () => {
            await Promise.race([calibration.promise, firstDonePromise]);
            secondSawCalibration = calibration.answer !== null;
            return collect(askFor(1, calibration.answer));
          })()
        : null;
    let gotFirst = false;
    for await (const item of streamBlocks(streamer, PLANNER_SYSTEM, askFor(0), "low")) {
      if (gotFirst && item.type === "BEAT") continue;
      if (yield* handleFast(item, 0, false)) gotFirst = true;
    }
    firstDone();
    if (!gotFirst) {
      yield { type: "error", message: "the planner produced no first beat" };
      return;
    }
    if (second) {
      let gotSecond = false;
      for (const item of await second) {
        if (gotSecond && item.type === "BEAT") continue;
        if (yield* handleFast(item, 1, secondSawCalibration)) gotSecond = true;
      }
    }

    await figureReady;
    if (total > fastBeats.length) {
      // Slow tier. Beat 3 alone at medium effort, started the moment beat 2 is done, so it lands
      // before beat 2 runs out; the rest at high effort in parallel, processed after beat 3 so
      // element references resolve in order.
      const written = fastBeats.map((b) => `===BEAT===\n${JSON.stringify(b)}\n===END===`).join("\n");
      const third = header.outline[fastBeats.length]!;
      const restIds = header.outline.slice(fastBeats.length + 1).map((b) => b.id);
      const note = calibrationNote(header, calibration.answer);
      const askThird = `Topic: ${topic}\n\nHere is the header and the beats you already wrote:\n${headerBlock}\n${written}\n\nWrite the BEAT block for ${third.id} only, following the outline. Elements shown in earlier beats stay on the board unless you clear them; drive the figure with update ops rather than adding new ones.${note}`;
      const askRest =
        restIds.length > 0
          ? `Topic: ${topic}\n\nHere is the header and the beats you already wrote:\n${headerBlock}\n${written}\n\n${third.id} is being written separately and continues straight from ${fastBeats[fastBeats.length - 1]!.id} without adding new elements. Now write BEAT blocks for ${restIds.join(", ")}, in order, one block each, following the outline. Elements shown in earlier beats stay on the board unless you clear them.${note}`
          : null;
      const rest = askRest ? eager(streamBlocks(streamer, PLANNER_SYSTEM, askRest, "high")) : null;
      let index = fastBeats.length;
      let gotThird = false;
      for (const item of await collect(askThird, "medium")) {
        if (gotThird && item.type === "BEAT") continue;
        if (yield* handleFast(item, index, calibration.answer !== null)) gotThird = true;
      }
      if (gotThird) index++;
      if (rest) {
        for await (const item of rest) {
          if (item.type === "final") {
            meta = { model: item.model, inputTokens: (meta.inputTokens ?? 0) + (item.inputTokens ?? 0), outputTokens: (meta.outputTokens ?? 0) + (item.outputTokens ?? 0) };
            continue;
          }
          if (item.type === "COMPONENT") {
            yield* handleComponent(item.body);
            continue;
          }
          if (item.type !== "BEAT") continue;
          if (index >= total) break;
          yield* handleBeat(item.body, index);
          index++;
        }
      }
    }
    yield { type: "done", ...meta };
  } catch (err) {
    const message = describeApiError(err);
    yield { type: "error", message };
  }
}

export async function* replanLesson(
  args: { topic: string; header: LessonHeader; beats: Beat[]; fromIndex: number; reason: string; record: RecordEntry[] },
  streamer: PlannerStreamer,
): AsyncGenerator<PlannerEvent> {
  const { topic, header, beats, fromIndex, reason, record } = args;
  const known = new Set<string>();
  for (const b of beats.slice(0, fromIndex)) collectShown(b.ops, known);
  const components = collectComponents(beats.slice(0, fromIndex));
  const done = header.outline.slice(0, fromIndex).map((b) => `- ${b.id} "${b.title}": ${b.summary ?? ""}`).join("\n");
  const rec = record.map((r) => `- ${JSON.stringify(r)}`).join("\n");
  const user = `Topic: ${topic}\nLesson so far (already played, do not rewrite):\n${done}\n\nRecord of what happened:\n${rec || "- nothing notable"}\n\nThe tutor asked for a replan from ${header.outline[fromIndex]?.id ?? `beat ${fromIndex + 1}`} because: ${reason}\n\nWrite an OUTLINE block for the remaining beats (ids continuing from ${header.outline[fromIndex]?.id ?? "the next id"}, 2 to 4 beats), then a BEAT block for each, in order. Elements shown in earlier beats are still on the board: ${[...known].join(", ") || "none"}.${components.size ? ` Components already on the board, which later beats can drive with update ops: ${[...components.values()].map((c) => `${c.id} (${c.title ?? "figure"}; state: ${c.stateDoc ?? JSON.stringify(c.state ?? {})})`).join("; ")}.` : ""}`;
  let outline: OutlineEntry[] | null = null;
  let index = fromIndex;
  try {
    for await (const block of streamBlocks(streamer, PLANNER_SYSTEM, user, "high")) {
      if (block.type === "final") continue;
      if (block.type === "OUTLINE" || (block.type === "HEADER" && !outline)) {
        const loose = parseLooseJson(block.body);
        if (!loose.ok) continue;
        const parsed = OutlineBlockSchema.safeParse(loose.value);
        if (!parsed.success) continue;
        outline = parsed.data.outline.map((b) => ({ id: b.id, title: b.title, ...(b.summary ? { summary: b.summary } : {}) }));
        yield { type: "outline", fromIndex, outline };
        continue;
      }
      if (block.type === "COMPONENT") {
        const parsed = parseComponentBlock(block.body);
        if ("element" in parsed) components.set(parsed.element.id, parsed.element);
        else yield { type: "diagnostic", message: parsed.error, raw: block.body.slice(0, 4000) };
        continue;
      }
      if (block.type !== "BEAT") continue;
      const loose = parseLooseJson(block.body);
      if (!loose.ok) continue;
      const raw = attachComponents(loose.value, components).raw;
      const outlineId = outline?.[index - fromIndex]?.id;
      let result = normalizeBeat(raw, index, known, outlineId);
      if (!result.beat) {
        const fixed = await repairBeat(streamer, block.body, result.errors);
        result = fixed ? normalizeBeat(attachComponents(fixed, components).raw, index, known, outlineId) : result;
      }
      if (!result.beat) {
        yield { type: "error", message: `replan beat ${index + 1} could not be repaired` };
        continue;
      }
      collectShown(result.beat.ops, known);
      yield { type: "beat", index, beat: result.beat, issues: result.issues, stats: result.stats };
      index++;
    }
    yield { type: "done", model: null, inputTokens: null, outputTokens: null };
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export function makeClaudePlannerStreamer(client: Anthropic, model = config.plannerModel): PlannerStreamer {
  return async function* (system, user, effort) {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 24000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield { kind: "text", text: event.delta.text };
    }
    const final = await stream.finalMessage();
    yield { kind: "final", model: final.model ?? null, inputTokens: final.usage?.input_tokens ?? null, outputTokens: final.usage?.output_tokens ?? null, refusal: final.stop_reason === "refusal" };
  };
}
