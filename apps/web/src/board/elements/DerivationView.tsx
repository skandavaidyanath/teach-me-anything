"use client";

import type { Derivation } from "@tma/schema";
import { toneFor } from "@/playhead/board-reducer";
import type { ElementViewProps } from "../Stage";
import { Tex } from "./LatexView";

/** Equations stacked and revealed one line at a time. The focused line carries the highlighter. */
export function DerivationView({ element, state, onCell }: ElementViewProps<Derivation>) {
  const shown = element.steps.slice(0, Math.min(element.revealed, element.steps.length));
  return (
    <div className="settle-in flex max-w-3xl flex-col gap-2">
      {element.label && <div className="text-[16px] text-ink-soft">{element.label}</div>}
      {shown.map((step, i) => {
        const tone = toneFor(state.board, { id: element.id, index: i });
        const focused = element.focus === i;
        const pointed = state.pointed?.id === element.id && state.pointed.index === i;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCell({ id: element.id, index: i })}
            className={[
              "cell settle-in grid grid-cols-[minmax(0,1fr)_auto] items-center gap-6 rounded-md px-5 py-2 text-left text-[22px]",
              tone || focused ? "" : "hover:bg-board",
              pointed ? "outline outline-2 outline-ink" : "",
            ].join(" ")}
            data-tone={tone ?? (focused ? "marker" : undefined)}
            aria-label={`line ${i + 1}`}
          >
            <Tex tex={step.tex} display />
            {step.note && <span className="text-[14px] text-ink-soft">{step.note}</span>}
          </button>
        );
      })}
    </div>
  );
}
