import Anthropic from "@anthropic-ai/sdk";
import type { AskContext, Op, Resume } from "@tma/schema";
import { config } from "./env";
import { ResponderParser } from "./responder-parse";

/**
 * The generative fallback. It answers an interrupt the lesson did not
 * predict, grounded in what is on the board, and streams sentences as ops so
 * the first one reaches TTS while the rest is still being written.
 */

export type AskInput = {
  requestId: string;
  text: string;
  pointed: string | null;
  context: AskContext;
  lesson: { topic: string; title: string };
};

export type Callback = { beatId: string; text: string };

export type ResponderEvent =
  | { type: "ops"; ops: Op[] }
  | {
      type: "done";
      resume: Resume;
      callbacks: Callback[];
      firstTokenMs: number | null;
      model: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
    }
  | { type: "error"; message: string };

export type TextStreamer = (system: string, user: string) => AsyncIterable<{ kind: "text"; text: string } | { kind: "final"; model: string | null; inputTokens: number | null; outputTokens: number | null; refusal: boolean }>;

const SYSTEM_PROMPT = `You are the tutor in the middle of a spoken, board-based lesson. The learner just interrupted with a question. Answer out loud in one to three short sentences a listener can follow. Plain spoken English. No markdown, no lists, no headings, no emoji.

You know the lesson outline, with what is already covered, what is being covered now, and what is coming up.
- If the question is about something already covered, say so in a few words and connect it to what was shown, so the learner knows it is the same idea.
- If the question is about something coming up, say it is coming, give only the short version, and leave a callback so the lesson can refer back when it gets there, on its own line:
@callback <beatId> <one sentence the tutor will say when that part starts, like: This is the splitting I sketched when you asked earlier, now step by step.>

Ground the answer in what is on the board. Highlight the lesson's own cells with a line like:
@highlight A[0] B[0]
(row id and zero-based position, or T[2] for a tree level, or D[1] for a derivation line)

If words alone will not do, draw. Anything you show appears in a panel over the lesson's board and is cleared when the lesson resumes. You cannot change the lesson's own elements, so give your own things new ids. One or two directives at most, each on its own line, before the sentences that talk about them:
@row ID "Label": 8, 3, 5, 1
@row OUT2 "merged" (output):
@tree ID: 8 3 5 1 9 2 7 4 | levels=1
@reveal ID 2
@move ID[0] -> OUT2
@card ID "Title" :: one or two short lines
@formula ID: \\log p(x) \\ge \\mathbb{E}_q[\\log p(x,z) - \\log q(z)]

If the answer contains one idea worth keeping for the rest of the lesson, add one line:
@pin takeaway "Short title" :: one sentence of body

End with exactly one line that leads back into the lesson:
@resume continue <one short bridge sentence>
Use "@resume skip" only if the learner says they already know this part and wants to move on.

Do not repeat the question. Do not say you are an AI. Do not mention these directives or the words "directive" or "panel".`;

export function buildUserPrompt(input: AskInput): string {
  const c = input.context;
  const outline = (c.outline ?? [])
    .map((b) => `- ${b.status === "current" ? "NOW" : b.status === "done" ? "covered" : "coming up"}: ${b.id} "${b.title}"${b.summary ? `: ${b.summary}` : ""}`)
    .join("\n");
  const lines = [
    `Lesson: ${input.lesson.title} (topic: ${input.lesson.topic}).`,
    outline ? `Outline:\n${outline}` : null,
    `Current beat: ${c.beatTitle}.`,
    c.calibrationAnswer ? `Learner's answer to the opening calibration question: ${c.calibrationAnswer}.` : null,
    c.recentSentences.length ? `What the tutor said recently:\n${c.recentSentences.map((s) => `- ${s}`).join("\n")}` : null,
    c.currentSentence ? `The tutor was in the middle of saying: "${c.currentSentence}"` : null,
    c.boardSummary.length ? `On the board right now:\n${c.boardSummary.map((s) => `- ${s}`).join("\n")}` : "The board is empty.",
    c.pins.length ? `Pinned so far: ${c.pins.join("; ")}.` : null,
    c.activeCheck ? `The learner was being asked: "${c.activeCheck}"` : null,
    input.pointed ? `The learner is pointing at: ${input.pointed}.` : null,
    ``,
    `Learner: ${input.text}`,
  ];
  return lines.filter((l): l is string => l !== null).join("\n");
}

/** Streams text from Claude. Separate from the parser so tests can replace it. */
export function makeClaudeStreamer(client: Anthropic, model = config.responderModel): TextStreamer {
  return async function* (system, user) {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: 600,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield { kind: "text", text: event.delta.text };
      }
    }
    const final = await stream.finalMessage();
    yield {
      kind: "final",
      model: final.model ?? null,
      inputTokens: final.usage?.input_tokens ?? null,
      outputTokens: final.usage?.output_tokens ?? null,
      refusal: final.stop_reason === "refusal",
    };
  };
}

export async function* respond(input: AskInput, streamer: TextStreamer): AsyncGenerator<ResponderEvent> {
  const parser = new ResponderParser(`r.${input.requestId}`);
  const started = performance.now();
  let firstTokenMs: number | null = null;
  let resume: Resume | null = null;
  const callbacks: Callback[] = [];
  let meta: { model: string | null; inputTokens: number | null; outputTokens: number | null } = { model: null, inputTokens: null, outputTokens: null };
  let refused = false;

  const emit = (chunks: ReturnType<ResponderParser["push"]>): Op[] => {
    const ops: Op[] = [];
    for (const c of chunks) {
      if (c.kind === "op") ops.push(c.op);
      else if (c.kind === "resume") resume = c.resume;
      else callbacks.push({ beatId: c.beatId, text: c.text });
    }
    return ops;
  };

  try {
    for await (const piece of streamer(SYSTEM_PROMPT, buildUserPrompt(input))) {
      if (piece.kind === "text") {
        if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - started);
        const ops = emit(parser.push(piece.text));
        if (ops.length) yield { type: "ops", ops };
      } else {
        meta = { model: piece.model, inputTokens: piece.inputTokens, outputTokens: piece.outputTokens };
        refused = piece.refusal;
      }
    }
    const tail = emit(parser.finish());
    if (tail.length) yield { type: "ops", ops: tail };
  } catch (err) {
    const message = err instanceof Anthropic.APIError ? `${err.status ?? ""} ${err.message}`.trim() : err instanceof Error ? err.message : String(err);
    yield { type: "error", message };
    return;
  }

  if (refused || parser.sentences === 0) {
    yield {
      type: "ops",
      ops: [{ op: "say", id: `r.${input.requestId}.fallback`, text: "I don't have a good answer for that one right now. Let's keep going and come back to it." }],
    };
  }
  yield {
    type: "done",
    resume: resume ?? { mode: "continue", bridge: "Back to where we were." },
    callbacks,
    firstTokenMs,
    ...meta,
  };
}
