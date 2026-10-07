import Anthropic from "@anthropic-ai/sdk";
import { mergeSortLesson } from "@tma/content";
import { BeatSchema, type Beat, type LessonHeader, type Op, type OutlineEntry, type RecordEntry } from "@tma/schema";
import { jsonrepair } from "jsonrepair";
import { z } from "zod";
import { PRIMITIVES_DOC } from "./catalog";
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
  effort: "low" | "high",
) => AsyncIterable<{ kind: "text"; text: string } | { kind: "final"; model: string | null; inputTokens: number | null; outputTokens: number | null; refusal: boolean }>;

export type PlannerEvent =
  | { type: "header"; header: LessonHeader }
  | { type: "diagnostic"; message: string; raw: string }
  | { type: "beat"; index: number; beat: Beat; issues: string[] }
  | { type: "outline"; fromIndex: number; outline: OutlineEntry[] }
  | { type: "error"; message: string }
  | { type: "done"; model: string | null; inputTokens: number | null; outputTokens: number | null };

const RULES = `You write short, spoken, board-based lessons. A lesson is 4 to 6 parts called beats. Rules:
- One idea per beat. Every beat ends with exactly one check, and the check is the last op.
- One sentence per say op, short and plain, written to be spoken aloud. No markdown. Spell out symbols the way a person would say them.
- Show, don't just tell: every beat has something on the board that the words refer to. Highlight what you are talking about. When a value moves, use a move op so it travels. Use the derivation element for step-by-step math, the scene element for physical pictures, the split_tree for halving, rows for lists.
- Beat 1 must use only rows, cards, formulas, derivations, or scenes that render instantly; keep it simple.
- Pin one idea per beat with a short bold title and one sentence of body. Pin formulas as kind "equation" with "tex".
- Checks have a known answer: choice with 3 options and an "expected" list of accepted answers (include the exact option text), or click_cell with targets and an expected target. The last beat's check may be an ungraded "want to go deeper?" prompt. Reactions: onCorrect one sentence; onIncorrect a highlight, one or two sentences that teach, then clear_highlights.
- Each beat has a "summary": one sentence of what it teaches, so the tutor can place questions in the lesson.
- Ids: beats b1..bN; ops "<beatId>.<letter><n>" (s for say, e show, u update, m move, h highlight, c clear, p pin, k check); elements short like A, B, OUT, T, D, S.
- Elements referenced by update, move, or highlight must have been shown earlier in the lesson.
- A short calibration question with 3 options opens the lesson; beat 1 must work regardless of the answer.`;

const FORMAT = `OUTPUT FORMAT. Write blocks, nothing else. Each block is a line "===HEADER===" or "===BEAT===", then one JSON object, then a line "===END===". The JSON must be strictly valid: double-quoted keys and strings, a comma between every pair of items, no trailing commas, no comments, no text outside the braces. Inside strings, escape backslashes (write \\\\log for \\log) and double quotes.
The header JSON: {"topic":"...","title":"...","calibration":{"prompt":"...","options":["...","...","..."]},"outline":[{"id":"b1","title":"...","summary":"..."}, ...]}
Each beat JSON: {"id":"b1","title":"...","summary":"...","ops":[...]}`;

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

export const PLANNER_SYSTEM = `${RULES}\n\n${PRIMITIVES_DOC}\n\n${FORMAT}\n\nEXAMPLE of the format, from a lesson on merge sort (header and the first two beats):\n${exampleBlocks()}`;

const HeaderBlockSchema = z.object({
  topic: z.string().min(1),
  title: z.string().min(1),
  calibration: z.object({ prompt: z.string().min(1), options: z.array(z.string().min(1)).min(2) }).optional(),
  outline: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), summary: z.string().optional() })).min(2),
});
const OutlineBlockSchema = z.object({ outline: HeaderBlockSchema.shape.outline });

const BLOCK_RE = /===(HEADER|BEAT|OUTLINE)===\s*([\s\S]*?)\s*===END===/g;

/** Pull completed blocks off the front of a text buffer. */
export function extractBlocks(buffer: string): { blocks: Array<{ type: "HEADER" | "BEAT" | "OUTLINE"; body: string }>; rest: string } {
  const blocks: Array<{ type: "HEADER" | "BEAT" | "OUTLINE"; body: string }> = [];
  let lastEnd = 0;
  BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BLOCK_RE.exec(buffer)) !== null) {
    blocks.push({ type: m[1] as "HEADER" | "BEAT" | "OUTLINE", body: m[2]! });
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
    try {
      return { ok: true, value: JSON.parse(jsonrepair(trimmed)), repaired: true };
    } catch {
      return { ok: false, error: (first as Error).message };
    }
  }
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
export function normalizeBeat(raw: unknown, index: number, knownBefore: Set<string>, outlineId: string | undefined): { beat: Beat; issues: string[] } | { beat: null; errors: string[] } {
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
  return { beat: { ...beat, ops }, issues };
}

function headerFromBlock(block: z.infer<typeof HeaderBlockSchema>, id: string): LessonHeader {
  return {
    id,
    topic: block.topic,
    title: block.title,
    ...(block.calibration ? { calibration: block.calibration } : {}),
    outline: block.outline.map((b) => ({ id: b.id, title: b.title, ...(b.summary ? { summary: b.summary } : {}) })),
    branches: [],
    fallback: {
      ops: [{ op: "say", id: "fb.offline", text: "I can't answer that while I'm offline. Try again when the tutor is connected." }],
      resume: { mode: "continue", bridge: "Let's pick up where we left off." },
    },
  };
}

async function* streamBlocks(streamer: PlannerStreamer, system: string, user: string, effort: "low" | "high"): AsyncGenerator<{ type: "HEADER" | "BEAT" | "OUTLINE"; body: string } | { type: "final"; model: string | null; inputTokens: number | null; outputTokens: number | null; refusal: boolean }> {
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

export async function* planLesson(topic: string, lessonId: string, streamer: PlannerStreamer): AsyncGenerator<PlannerEvent> {
  const known = new Set<string>();
  let header: LessonHeader | null = null;
  const fastBeats: Beat[] = [];
  let meta = { model: null as string | null, inputTokens: null as number | null, outputTokens: null as number | null };
  /** How many beats the fast tier writes before the slow tier takes over. */
  const FAST_BEATS = 2;

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
    let result = normalizeBeat(raw, index, known, header?.outline[index]?.id);
    if (!result.beat) {
      const fixed = await repairBeat(streamer, body, result.errors);
      result = fixed ? normalizeBeat(fixed, index, known, header?.outline[index]?.id) : result;
    }
    if (!result.beat) {
      yield { type: "error", message: `beat ${index + 1} could not be repaired: ${(result as { errors: string[] }).errors.join("; ")}` };
      return;
    }
    collectShown(result.beat.ops, known);
    yield { type: "beat", index, beat: result.beat, issues: result.issues };
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
      if (block.type === "HEADER") {
        const loose = parseLooseJson(block.body);
        if (!loose.ok) {
          yield { type: "error", message: `header: invalid JSON (${loose.error})` };
          return;
        }
        const parsed = HeaderBlockSchema.safeParse(loose.value);
        if (!parsed.success) {
          yield { type: "error", message: `header: ${parsed.error.issues.map((i) => i.message).join("; ")}` };
          return;
        }
        header = headerFromBlock(parsed.data, lessonId);
        yield { type: "header", header };
      }
    }
    if (!header) {
      yield { type: "error", message: "the planner produced no header" };
      return;
    }
    const headerBlock = `===HEADER===\n${JSON.stringify({ topic: header.topic, title: header.title, calibration: header.calibration, outline: header.outline })}\n===END===`;
    const total = header.outline.length;

    // Fast tier, one call per beat at low effort: beat 1 while the learner reads the
    // calibration question, beat 2 while beat 1 plays. Enough runway for the slow tier.
    for (let index = 0; index < Math.min(FAST_BEATS, total); index++) {
      const entry = header.outline[index]!;
      const soFar = fastBeats.map((b) => `===BEAT===\n${JSON.stringify(b)}\n===END===`).join("\n");
      const ask =
        index === 0
          ? `Topic: ${topic}\n\nHere is the header you wrote:\n${headerBlock}\n\nWrite the BEAT block for ${entry.id} only. It must use only instantly rendered elements and work regardless of the calibration answer.`
          : `Topic: ${topic}\n\nHere is the header and the beats you already wrote:\n${headerBlock}\n${soFar}\n\nWrite the BEAT block for ${entry.id} only, following the outline. Elements shown in earlier beats stay on the board unless you clear them.`;
      let got = false;
      for await (const block of streamBlocks(streamer, PLANNER_SYSTEM, ask, "low")) {
        if (block.type === "final") {
          meta = { model: block.model, inputTokens: (meta.inputTokens ?? 0) + (block.inputTokens ?? 0), outputTokens: (meta.outputTokens ?? 0) + (block.outputTokens ?? 0) };
          continue;
        }
        if (block.type === "BEAT" && !got) {
          for await (const ev of handleBeat(block.body, index)) {
            if (ev.type === "beat") {
              fastBeats.push(ev.beat);
              got = true;
            }
            yield ev;
          }
        }
      }
      if (index === 0 && !got) {
        yield { type: "error", message: "the planner produced no first beat" };
        return;
      }
      if (!got) break;
    }

    if (total > fastBeats.length) {
      // Slow tier: the rest at high effort, while the first beats play.
      const written = fastBeats.map((b) => `===BEAT===\n${JSON.stringify(b)}\n===END===`).join("\n");
      const rest = `Topic: ${topic}\n\nHere is the header and the beats you already wrote:\n${headerBlock}\n${written}\n\nNow write BEAT blocks for ${header.outline
        .slice(fastBeats.length)
        .map((b) => b.id)
        .join(", ")}, in order, one block each, following the outline. Elements shown in earlier beats stay on the board unless you clear them.`;
      let index = fastBeats.length;
      for await (const block of streamBlocks(streamer, PLANNER_SYSTEM, rest, "high")) {
        if (block.type === "final") {
          meta = { model: block.model, inputTokens: (meta.inputTokens ?? 0) + (block.inputTokens ?? 0), outputTokens: (meta.outputTokens ?? 0) + (block.outputTokens ?? 0) };
          continue;
        }
        if (block.type !== "BEAT") continue;
        if (index >= total) break;
        yield* handleBeat(block.body, index);
        index++;
      }
    }
    yield { type: "done", ...meta };
  } catch (err) {
    const message = err instanceof Anthropic.APIError ? `${err.status ?? ""} ${err.message}`.trim() : err instanceof Error ? err.message : String(err);
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
  const done = header.outline.slice(0, fromIndex).map((b) => `- ${b.id} "${b.title}": ${b.summary ?? ""}`).join("\n");
  const rec = record.map((r) => `- ${JSON.stringify(r)}`).join("\n");
  const user = `Topic: ${topic}\nLesson so far (already played, do not rewrite):\n${done}\n\nRecord of what happened:\n${rec || "- nothing notable"}\n\nThe tutor asked for a replan from ${header.outline[fromIndex]?.id ?? `beat ${fromIndex + 1}`} because: ${reason}\n\nWrite an OUTLINE block for the remaining beats (ids continuing from ${header.outline[fromIndex]?.id ?? "the next id"}, 2 to 4 beats), then a BEAT block for each, in order. Elements shown in earlier beats are still on the board: ${[...known].join(", ") || "none"}.`;
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
      if (block.type !== "BEAT") continue;
      const loose = parseLooseJson(block.body);
      if (!loose.ok) continue;
      const raw = loose.value;
      const outlineId = outline?.[index - fromIndex]?.id;
      let result = normalizeBeat(raw, index, known, outlineId);
      if (!result.beat) {
        const fixed = await repairBeat(streamer, block.body, result.errors);
        result = fixed ? normalizeBeat(fixed, index, known, outlineId) : result;
      }
      if (!result.beat) {
        yield { type: "error", message: `replan beat ${index + 1} could not be repaired` };
        continue;
      }
      collectShown(result.beat.ops, known);
      yield { type: "beat", index, beat: result.beat, issues: result.issues };
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
