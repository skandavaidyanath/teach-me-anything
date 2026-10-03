"use client";

import type { Element, ElementRef, Lesson } from "@tma/schema";
import type { Playhead, PlayheadState } from "@/playhead/playhead";
import { ArrayRowView } from "./elements/ArrayRowView";
import { TextCardView } from "./elements/TextCardView";
import { LatexView } from "./elements/LatexView";
import { SplitTreeView } from "./elements/SplitTreeView";

export type ElementViewProps<E extends Element> = {
  element: E;
  state: PlayheadState;
  clickable: ElementRef[];
  onCell: (ref: ElementRef) => void;
};

export function Stage({ lesson, state, playhead }: { lesson: Lesson; state: PlayheadState; playhead: Playhead }) {
  const activeCheck = state.mode === "awaiting_check" && state.check && state.check.result === null ? state.check.op : null;
  const clickable: ElementRef[] = activeCheck?.kind === "click_cell" ? (activeCheck.targets ?? []) : [];

  const onCell = (ref: ElementRef) => {
    if (clickable.some((c) => c.id === ref.id && (c.index ?? null) === (ref.index ?? null))) {
      playhead.answerCheck(ref);
      return;
    }
    const same = state.pointed && state.pointed.id === ref.id && (state.pointed.index ?? null) === (ref.index ?? null);
    playhead.setPointed(same ? null : ref);
  };

  return (
    <section
      aria-label="Board"
      className="relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface"
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-7 overflow-auto p-8">
        {state.board.order.length === 0 && state.mode !== "calibrating" && state.mode !== "idle" && state.mode !== "finished" && (
          <div className="text-ink-mute">Listening…</div>
        )}
        {state.board.order.map((id) => {
          const el = state.board.elements[id];
          if (!el) return null;
          const props = { state, clickable, onCell };
          switch (el.kind) {
            case "array_row":
              return <ArrayRowView key={id} element={el} {...props} />;
            case "text_card":
              return <TextCardView key={id} element={el} {...props} />;
            case "latex":
              return <LatexView key={id} element={el} {...props} />;
            case "split_tree":
              return <SplitTreeView key={id} element={el} {...props} />;
          }
        })}
      </div>

      {state.mode === "calibrating" && lesson.calibration && (
        <Overlay>
          <p className="max-w-md text-balance text-center text-[22px] leading-snug">{lesson.calibration.prompt}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {lesson.calibration.options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => playhead.start(o)}
                className="rounded-full border border-ink px-5 py-2 text-[15px] hover:bg-ink hover:text-surface"
              >
                {o}
              </button>
            ))}
          </div>
          <p className="text-[13px] text-ink-mute">Your answer also turns the sound on.</p>
        </Overlay>
      )}

      {state.mode === "idle" && (
        <Overlay>
          <button
            type="button"
            onClick={() => playhead.start(null)}
            className="rounded-full border border-ink px-6 py-2 text-[15px] hover:bg-ink hover:text-surface"
          >
            Start the lesson
          </button>
        </Overlay>
      )}

      {state.mode === "finished" && (
        <Overlay>
          <p className="text-[22px]">That's the lesson.</p>
          <p className="max-w-sm text-center text-ink-soft">
            The pinned rail keeps what matters. Click any pin to ask about it, or start over.
          </p>
          <button
            type="button"
            onClick={() => playhead.start(state.calibrationAnswer)}
            className="rounded-full border border-ink px-5 py-2 text-[15px] hover:bg-ink hover:text-surface"
          >
            Start over
          </button>
        </Overlay>
      )}
    </section>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-surface/92 p-8 backdrop-blur-[2px]">
      {children}
    </div>
  );
}
