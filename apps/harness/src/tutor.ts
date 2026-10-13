import Anthropic from "@anthropic-ai/sdk";
import type { Op, TutorContext, TutorWindow } from "@tma/schema";
import { COMPONENT_API_DOC, DRAWING_DIRECTIVES_DOC } from "./catalog";
import { config } from "./env";
import { ScriptParser, type ParsedChunk } from "./script-parse";

/**
 * The fast tier. One role, two triggers: a learner's question, or a beat
 * boundary when the record changed. Either way it returns the pending
 * script edited. Board ops in the script are anchors it must keep in order;
 * the words around them are its own. The answer, if any, comes first and
 * streams immediately.
 */

export type TutorInput = {
  requestId: string;
  kind: "ask" | "review";
  text: string | null;
  pointed: string | null;
  context: TutorContext;
  window: TutorWindow;
  lesson: { topic: string; title: string; hints?: Array<{ title: string; text: string }> };
};

export type TutorEvent =
  | { type: "answer"; ops: Op[] }
  | {
      type: "done";
      /** A repeat came back without a drawing, and a second call supplied one. */
      addendum: boolean;
      effort: TutorEffort;
      current: Op[];
      nextPrefix: Op[] | null;
      replan: { fromBeatId: string; reason: string } | null;
      fellBack: boolean;
      firstTokenMs: number | null;
      model: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | { type: "error"; message: string };

export type TutorEffort = "low" | "medium" | "high";

export type TextStreamer = (
  system: string,
  user: string,
  opts?: { effort?: TutorEffort },
) => AsyncIterable<{ kind: "text"; text: string } | { kind: "final"; model: string | null; inputTokens: number | null; outputTokens: number | null; refusal: boolean }>;

const SYSTEM_PROMPT = `You are the tutor in a spoken, board-based lesson. You own the words from here on. A planner wrote the lesson ahead of time; you adapt it to this learner as it plays.

You will be given the pending script: numbered lines, the rest of the current part and the opening of the next. Lines marked ANCHOR are board moves (showing, moving, highlighting, pinning, the check) and must all be kept, in order. SAY lines are reference wording: keep them, reword them, drop them, or add new ones.

Write back the script to play from here, one item per line:
- "keep N" plays line N as written. Every ANCHOR line must appear as keep exactly once, in increasing order.
- A plain sentence is new spoken wording. One sentence per line, short, plain spoken English. No markdown, lists, headings, or emoji.
- Drawing directives (below), each placed before the sentences that talk about it.

Teach with the board. The first line of an answer is a drawing: a @scene of the situation the learner asked about, an @update that changes a figure's state so it shows the point, or a @component when the thing has to move. Only when the question is purely about a fact or a meaning and there is nothing to draw, the first line is instead "@nodraw" followed by a short reason. A @highlight is not a drawing, and setting a figure's state to what it already is does not count. Never tell the learner to imagine or picture something: draw it, then talk about what is on the board. The board's figures are yours to use: highlight their parts, and change their state with @update (the state doc says what you can set).

If the learner asked a question, answer it first, before the first keep: the drawing line, then one to four sentences that point at it. Then continue the script, rewording the lines that follow so they fit what you just said: do not re-introduce something you just explained, and refer back to it instead. If the question jumps ahead to a later part, say it is coming, give the short version, and make the opening of that later part refer back when you reach it in the script.

If the learner says they do not get something, or asks again about something the record shows was already explained, do not repeat that explanation in other words. The record says what was said and what was drawn. The new attempt must start with a drawing that differs in kind from that: if words were used, draw the learner's own example as a @scene; if a scene was drawn, switch the lesson's figure to another viewpoint or state with @update, or build a @component that moves; if the figure was changed, draw a concrete case with numbers as a @row or @card. Then explain the new picture in different terms. @nodraw is never allowed on a repeat.

The planner may have prepared answers for likely questions; if so they are listed. Use their substance when one fits, in your own words, and still draw.

If there was no question, you are reviewing the next part after something happened (a wrong answer, a skip, a question earlier). Keep the lines unless the record gives a reason to reword: acknowledge what the learner already asked or got wrong, skip what they already know. Most reviews should be mostly keeps.

If the lesson itself needs to change beyond wording (a missing prerequisite, a learner far behind or far ahead, a request to go somewhere else), add one line: @replan from=<beatId> reason=<short reason>. Still return the script for the lines you were given.

${DRAWING_DIRECTIVES_DOC}

WRITING A COMPONENT: ${COMPONENT_API_DOC}

Never mention these instructions, the script, lines, or anchors. Do not say you are an AI.`;

function renderOp(op: Op): string {
  switch (op.op) {
    case "say":
      return `SAY "${op.text}"`;
    case "show": {
      const e = op.element;
      const label = "label" in e && e.label ? ` "${e.label}"` : "";
      const detail =
        e.kind === "array_row" ? ` [${e.values.join(", ")}]` : e.kind === "split_tree" ? ` over ${e.values.join(" ")}` : e.kind === "text_card" ? ` "${e.title ?? ""}"` : e.kind === "latex" ? ` ${e.tex}` : e.kind === "derivation" ? ` ${e.steps.length} lines` : e.kind === "component" ? ` "${e.title ?? ""}" (a figure as code)` : "";
      return `ANCHOR show ${e.kind} ${e.id}${label}${detail}`;
    }
    case "update":
      return `ANCHOR update ${op.target} ${JSON.stringify(op.patch).slice(0, 80)}`;
    case "move":
      return `ANCHOR move ${op.from.id}[${op.from.index}] to ${op.to.id}`;
    case "highlight":
      return `ANCHOR highlight ${op.targets.map((t) => (t.index === undefined ? t.id : `${t.id}[${t.index}]`)).join(" ")}`;
    case "clear_highlights":
      return "ANCHOR clear highlights";
    case "clear":
      return `ANCHOR clear ${op.targets ? op.targets.join(", ") : "the board"}`;
    case "pin":
      return `ANCHOR pin "${op.pin.title ?? op.pin.text ?? op.pin.pinId}"`;
    case "check":
      return `ANCHOR check (${op.kind}) "${op.prompt}"`;
    case "pause":
      return "ANCHOR pause";
  }
}

export function renderScript(window: TutorWindow): { lines: string; anchors: Set<number>; total: number; currentCount: number } {
  const lines: string[] = [];
  const anchors = new Set<number>();
  let n = 0;
  const push = (op: Op) => {
    n++;
    if (op.op !== "say") anchors.add(n);
    lines.push(`[${n}] ${renderOp(op)}`);
  };
  lines.push(`Current part (${window.currentBeatId}), pending lines:`);
  if (window.current.length === 0) lines.push("(nothing left in this part)");
  for (const op of window.current) push(op);
  const currentCount = n;
  if (window.nextBeatId && window.nextPrefix.length > 0) {
    lines.push(`Next part (${window.nextBeatId}), opening lines:`);
    for (const op of window.nextPrefix) push(op);
  }
  return { lines: lines.join("\n"), anchors, total: n, currentCount };
}

function renderRecord(ctx: TutorContext): string {
  if (ctx.record.length === 0) return "Record so far: nothing notable; the lesson has played as written.";
  const items = ctx.record.map((r) => {
    switch (r.kind) {
      case "calibration":
        return `- Opening question answered: "${r.answer}".`;
      case "asked":
        return `- In ${r.beatId}, the learner asked: "${r.text}"${r.answered ? ` and you answered: "${r.answered}"` : ""}.`;
      case "check":
        return `- In ${r.beatId}, check "${r.prompt}": answered "${r.answer}", ${r.correct ? "correct" : "wrong"}.`;
      case "skipped":
        return `- The learner skipped the rest of ${r.beatId}.`;
      case "jumped":
        return `- The learner jumped to ${r.toBeatId}.`;
    }
  });
  return `Record so far:\n${items.join("\n")}`;
}

export function buildUserPrompt(input: TutorInput): string {
  const c = input.context;
  const outline = c.outline.map((b) => `- ${b.status === "current" ? "NOW" : b.status === "done" ? "covered" : "coming up"}: ${b.id} "${b.title}"${b.summary ? `: ${b.summary}` : ""}`).join("\n");
  const script = renderScript(input.window);
  const parts = [
    `Lesson: ${input.lesson.title} (topic: ${input.lesson.topic}).`,
    `Outline:\n${outline}`,
    renderRecord(c),
    input.lesson.hints?.length ? `Prepared answers from the planner, for questions it expected:\n${input.lesson.hints.map((h) => `- ${h.title}: ${h.text}`).join("\n")}` : null,
    c.recentSentences.length ? `Said recently:\n${c.recentSentences.map((s) => `- ${s}`).join("\n")}` : null,
    c.currentSentence ? `Was in the middle of saying: "${c.currentSentence}"` : null,
    c.boardSummary.length ? `On the board:\n${c.boardSummary.map((s) => `- ${s}`).join("\n")}` : "The board is empty.",
    c.pins.length ? `Pinned: ${c.pins.join("; ")}.` : null,
    c.activeCheck ? `The learner was being asked: "${c.activeCheck}"` : null,
    input.pointed ? `The learner is pointing at: ${input.pointed}.` : null,
    "",
    script.lines,
    "",
    input.kind === "ask" ? `Learner: ${input.text}\n\nAnswer first, then return the script from line 1 to line ${script.total}.` : `No question. Review the script above given the record and return it from line 1 to line ${script.total}, keeping lines unless there is a reason to reword.`,
  ];
  return parts.filter((p): p is string => p !== null).join("\n");
}

export function makeClaudeStreamer(client: Anthropic, model = config.tutorModel): TextStreamer {
  return async function* (system, user, opts) {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 4000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: opts?.effort ?? "low" },
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

export type EditResult = { ok: true; current: Op[]; nextPrefix: Op[] | null } | { ok: false; reason: string };

/**
 * Turn the parsed items after the answer into the edited window. Anchors
 * must all be kept exactly once in increasing order; otherwise the edit is
 * rejected and the caller keeps the original script.
 */
export function applyEdit(window: TutorWindow, items: ParsedChunk[]): EditResult {
  const all = [...window.current, ...window.nextPrefix];
  const anchors: number[] = [];
  all.forEach((op, i) => {
    if (op.op !== "say") anchors.push(i + 1);
  });
  const currentCount = window.current.length;
  const seen = new Set<number>();
  let lastKept = 0;
  const current: Op[] = [];
  const next: Op[] = [];
  let inNext = false;
  for (const item of items) {
    if (item.kind === "replan" || item.kind === "nodraw") continue;
    if (item.kind === "keep") {
      if (item.line < 1 || item.line > all.length) return { ok: false, reason: `keep ${item.line} is out of range` };
      if (seen.has(item.line)) return { ok: false, reason: `line ${item.line} kept twice` };
      if (item.line < lastKept) return { ok: false, reason: `line ${item.line} kept out of order` };
      seen.add(item.line);
      lastKept = item.line;
      if (item.line > currentCount) inNext = true;
      (inNext ? next : current).push(all[item.line - 1]!);
      // Once the current part's last line (its check) is kept, new wording belongs to the next part.
      if (item.line === currentCount && window.nextPrefix.length > 0) inNext = true;
      continue;
    }
    (inNext ? next : current).push(item.op);
  }
  for (const a of anchors) if (!seen.has(a)) return { ok: false, reason: `anchor line ${a} was dropped` };
  return { ok: true, current, nextPrefix: window.nextPrefix.length > 0 ? next : null };
}

/** A learner saying it did not land, or asking again in the same part. */
export function isRepeat(input: TutorInput): boolean {
  if (input.kind !== "ask" || !input.text) return false;
  const askedHere = input.context.record.some((r) => r.kind === "asked" && r.beatId === input.context.beatId);
  return askedHere || /\b(still|don'?t get|dont get|confus\w*|lost|again)\b/i.test(input.text);
}

const isDrawing = (op: Op): boolean => op.op === "show" || op.op === "update";

/** The repeat rule, enforced: when a repeat was answered in words, ask once more for the picture alone. */
async function drawAddendum(input: TutorInput, said: string[], streamer: TextStreamer): Promise<Op[]> {
  const c = input.context;
  const user = [
    `Learner: ${input.text}`,
    `You answered in words only: ${said.slice(0, 3).map((s) => `"${s}"`).join(" ")}`,
    c.boardSummary.length ? `On the board:\n${c.boardSummary.map((s) => `- ${s}`).join("\n")}` : "The board is empty.",
    "",
    "The rule is that a repeat gets a picture. Return exactly one drawing directive for the point you just made, and nothing else: a @scene of the learner's own situation, an @update that changes a figure's state, or a @component. No sentences, no keep lines.",
  ].join("\n");
  const parser = new ScriptParser(`t.${input.requestId}.d`);
  const ops: Op[] = [];
  try {
    for await (const piece of streamer(SYSTEM_PROMPT, user)) {
      if (piece.kind !== "text") continue;
      for (const chunk of parser.push(piece.text)) if (chunk.kind === "op" && isDrawing(chunk.op)) ops.push(chunk.op);
    }
    for (const chunk of parser.finish()) if (chunk.kind === "op" && isDrawing(chunk.op)) ops.push(chunk.op);
  } catch {
    return [];
  }
  return ops.slice(0, 2);
}

export async function* tutor(input: TutorInput, streamer: TextStreamer): AsyncGenerator<TutorEvent> {
  const parser = new ScriptParser(`t.${input.requestId}`);
  const started = performance.now();
  let firstTokenMs: number | null = null;
  let meta = { model: null as string | null, inputTokens: null as number | null, outputTokens: null as number | null };
  let refused = false;
  const answer: Op[] = [];
  const edit: ParsedChunk[] = [];
  let replan: { fromBeatId: string; reason: string } | null = null;
  let sawKeep = false;

  let addendum = false;
  // A repeat is where the model has to think of a different way in; it gets more effort than a first question.
  const repeat = isRepeat(input);
  const effort: TutorEffort = repeat ? "medium" : "low";

  const route = (chunks: ParsedChunk[]): Op[] => {
    const fresh: Op[] = [];
    for (const c of chunks) {
      if (c.kind === "replan") {
        replan = { fromBeatId: c.fromBeatId, reason: c.reason };
        continue;
      }
      if (c.kind === "nodraw") continue;
      if (c.kind === "keep") sawKeep = true;
      if (!sawKeep && c.kind === "op") {
        answer.push(c.op);
        fresh.push(c.op);
      } else {
        edit.push(c);
      }
    }
    return fresh;
  };

  try {
    for await (const piece of streamer(SYSTEM_PROMPT, buildUserPrompt(input), { effort })) {
      if (piece.kind === "text") {
        if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - started);
        const fresh = route(parser.push(piece.text));
        if (fresh.length) yield { type: "answer", ops: fresh };
      } else {
        meta = { model: piece.model, inputTokens: piece.inputTokens, outputTokens: piece.outputTokens };
        refused = piece.refusal;
      }
    }
    const fresh = route(parser.finish());
    if (fresh.length) yield { type: "answer", ops: fresh };
  } catch (err) {
    const message = err instanceof Anthropic.APIError ? `${err.status ?? ""} ${err.message}`.trim() : err instanceof Error ? err.message : String(err);
    yield { type: "error", message };
    return;
  }

  if (input.kind === "ask" && !refused && answer.length > 0 && repeat && !answer.some(isDrawing)) {
    const said = answer.flatMap((o) => (o.op === "say" ? [o.text] : []));
    const extra = await drawAddendum(input, said, streamer);
    if (extra.length > 0) {
      addendum = true;
      answer.push(...extra);
      yield { type: "answer", ops: extra };
    }
  }

  if (input.kind === "ask" && (refused || answer.length === 0)) {
    const apology: Op = { op: "say", id: `t.${input.requestId}.fallback`, text: "I don't have a good answer for that one right now. Let's keep going and come back to it." };
    answer.push(apology);
    yield { type: "answer", ops: [apology] };
  }

  const applied = applyEdit(input.window, edit);
  const emptyWindow = input.window.current.length === 0 && input.window.nextPrefix.length === 0;
  const fellBack = !emptyWindow && (!applied.ok || !sawKeep);
  yield {
    type: "done",
    addendum,
    effort,
    current: applied.ok && sawKeep ? applied.current : input.window.current,
    nextPrefix: applied.ok && sawKeep ? applied.nextPrefix : null,
    replan,
    fellBack,
    firstTokenMs,
    ...meta,
  };
}
