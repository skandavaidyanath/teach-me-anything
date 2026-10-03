"use client";

import type { Lesson } from "@tma/schema";
import type { Playhead, PlayheadState } from "@/playhead/playhead";

export function OutlineStrip({ lesson, state, playhead }: { lesson: Lesson; state: PlayheadState; playhead: Playhead }) {
  const started = state.mode !== "calibrating" && state.mode !== "idle";
  return (
    <header className="flex items-center gap-6 px-5 py-3">
      <h1 className="text-[15px] font-bold leading-none tracking-tight">{lesson.title}</h1>
      <ol className="flex flex-1 items-center" aria-label="Lesson outline">
        {lesson.beats.map((beat, i) => {
          const isCurrent = started && i === state.beatIndex;
          const isDone = state.completedBeats.includes(beat.id);
          return (
            <li key={beat.id} className="flex items-center">
              {i > 0 && <span className={`h-px w-6 ${isDone || isCurrent ? "bg-ink-soft" : "bg-line"}`} aria-hidden />}
              <button
                type="button"
                onClick={() => playhead.jumpToBeat(i)}
                disabled={!started}
                aria-current={isCurrent ? "step" : undefined}
                className={[
                  "flex items-center gap-2 rounded-full px-3 py-1 text-[13px] transition-colors",
                  isCurrent ? "bg-ink text-surface" : isDone ? "text-ink-soft hover:bg-rail" : "text-ink-mute hover:bg-rail",
                  !started ? "cursor-default" : "",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-block h-2 w-2 rounded-full",
                    isCurrent ? "bg-marker" : isDone ? "bg-ink-soft" : "border border-ink-mute",
                  ].join(" ")}
                  aria-hidden
                />
                {beat.title}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-3 text-[13px] text-ink-soft">
        {started && (
          <span>
            beat {state.beatIndex + 1} of {lesson.beats.length}
          </span>
        )}
        <div className="flex overflow-hidden rounded-full border border-line" role="radiogroup" aria-label="Narration">
          <button
            type="button"
            role="radio"
            aria-checked={state.speakerKind === "voice"}
            disabled={!state.speechAvailable}
            onClick={() => playhead.setSpeaker("voice")}
            title={state.speechAvailable ? "Spoken narration" : "Speech is not available in this browser"}
            className={`px-3 py-1 ${state.speakerKind === "voice" ? "bg-ink text-surface" : "text-ink-soft hover:bg-rail"} disabled:opacity-40`}
          >
            Voice
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={state.speakerKind === "silent"}
            onClick={() => playhead.setSpeaker("silent")}
            className={`px-3 py-1 ${state.speakerKind === "silent" ? "bg-ink text-surface" : "text-ink-soft hover:bg-rail"}`}
          >
            Captions
          </button>
        </div>
      </div>
    </header>
  );
}
