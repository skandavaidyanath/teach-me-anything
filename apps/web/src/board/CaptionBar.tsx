"use client";

import { useMemo } from "react";
import type { Playhead, PlayheadState } from "@/playhead/playhead";

/**
 * The spoken sentence, at the top of the board where the eye starts. Words
 * darken as they are spoken. When the lesson is waiting on a check, the
 * question and its chips take this spot.
 */
export function CaptionBar({ state, playhead }: { state: PlayheadState; playhead: Playhead }) {
  const caption = state.caption;
  const check = state.check;
  const awaiting = state.mode === "awaiting_check" && check && check.result === null;

  const words = useMemo(() => {
    if (!caption) return [];
    const out: Array<{ text: string; end: number }> = [];
    const re = /\S+\s*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(caption.text)) !== null) out.push({ text: m[0], end: m.index + m[0].length });
    return out;
  }, [caption?.text]);

  let status: string | null = null;
  if (state.mode === "paused") status = state.typingArmed ? "Paused while you type" : "Paused";
  else if (state.waiting === "aside") status = "Thinking…";
  else if (state.waiting === "beat") status = "Loading the next part…";
  else if (state.aside) status = state.aside.title;
  else if (state.typingArmed) status = "Pausing at the end of this sentence";
  else if (awaiting) status = "Your turn";
  else if (check?.result) status = check.result.correct ? "Right" : "Not quite";

  const idle = state.mode === "calibrating" || state.mode === "idle";

  return (
    <div className="px-5 pb-3 pt-1" aria-live="polite">
      <div className="flex min-h-[1.25rem] items-center gap-3 text-[13px] text-ink-soft">
        {status && <span className={state.aside ? "rounded-full bg-marker-soft px-2 py-0.5 text-ink" : ""}>{status}</span>}
        {state.toast && <span className={state.toast.startsWith("Pinned") ? "rounded-full bg-marker-soft px-2 py-0.5 text-ink" : "text-ink-mute"}>{state.toast}</span>}
      </div>
      <div className="mt-1 min-h-[4.5rem]">
        {awaiting ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <p className="max-w-[60ch] text-[26px] leading-snug text-ink">{check.op.prompt}</p>
            {check.op.kind === "choice" && (
              <div className="flex flex-wrap gap-2">
                {(check.op.options ?? []).map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => playhead.answerCheck(o)}
                    className="rounded-full border border-ink px-4 py-1.5 text-[16px] hover:bg-ink hover:text-surface"
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}
            {check.op.kind === "click_cell" && <span className="text-[15px] text-ink-soft">Click it on the board.</span>}
            {check.op.kind === "free_text" && <span className="text-[15px] text-ink-soft">Type your answer below.</span>}
          </div>
        ) : caption ? (
          <p className="max-w-[70ch] text-[26px] leading-snug">
            {words.map((w, i) => (
              <span key={i} className="caption-word" data-spoken={caption.spokenChars >= w.end || caption.spokenChars >= caption.text.length}>
                {w.text}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-[26px] leading-snug text-ink-mute">{state.mode === "finished" ? "Lesson complete." : idle ? "" : "…"}</p>
        )}
      </div>
    </div>
  );
}
