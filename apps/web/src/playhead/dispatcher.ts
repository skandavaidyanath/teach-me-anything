import type { Branch, NavCommand } from "@tma/schema";

type Routable = { branches: Branch[] };

/**
 * v0.0 dispatcher. Navigation commands resolve locally and never reach a
 * model. Everything else matches against the lesson's pre-authored branches,
 * then falls back. Later this becomes the Dispatcher role: same inputs, same
 * outputs, a classifier behind it.
 */

export type Dispatch =
  | { kind: "nav"; command: NavCommand }
  | { kind: "branch"; branch: Branch }
  | { kind: "fallback" };

const NAV: Array<[NavCommand, RegExp]> = [
  ["pause", /^(stop|pause|wait|hold on|hang on|hold up|one sec(ond)?)\b/i],
  ["resume", /^(go on|continue|resume|play|carry on|keep going|go ahead|ok(ay)?|yes|yep|sure)$/i],
  ["back", /^(go back|back|back up|rewind|previous|what did you say)\b/i],
  ["repeat", /^(repeat|again|say that again|one more time|once more|pardon|what\??)$/i],
  ["skip", /^(skip|next|move on|i know this|got it|i get it|understood)\b/i],
  ["restart", /^(start over|restart|from the top|from the beginning)\b/i],
];

const MAX_NAV_WORDS = 5;

export function matchNav(text: string): NavCommand | null {
  const t = text.trim();
  if (!t) return null;
  if (t.split(/\s+/).length > MAX_NAV_WORDS) return null;
  for (const [command, re] of NAV) {
    if (re.test(t)) return command;
  }
  return null;
}

export type DispatchContext = {
  beatId: string;
  /** Element id or pin id the learner clicked before asking. */
  pointed: string | null;
};

export function matchBranch(lesson: Routable, text: string, ctx: DispatchContext): Branch | null {
  const t = text.trim();
  let best: { branch: Branch; score: number } | null = null;
  for (const branch of lesson.branches) {
    if (branch.match.beats && !branch.match.beats.includes(ctx.beatId)) continue;
    const textHit = t.length > 0 && branch.match.patterns.some((p) => new RegExp(p, "i").test(t));
    const pointedHit = ctx.pointed !== null && (branch.match.pointed ?? []).includes(ctx.pointed);
    const score = (textHit ? 2 : 0) + (pointedHit ? 1 : 0);
    if (score === 0) continue;
    if (!best || score > best.score) best = { branch, score };
  }
  return best?.branch ?? null;
}

export function dispatchInput(lesson: Routable, text: string, ctx: DispatchContext): Dispatch {
  const nav = matchNav(text);
  if (nav) return { kind: "nav", command: nav };
  const branch = matchBranch(lesson, text, ctx);
  if (branch) return { kind: "branch", branch };
  return { kind: "fallback" };
}
