"use client";

import type { ArrayRow, ElementRef } from "@tma/schema";
import { toneFor } from "@/playhead/board-reducer";
import type { ElementViewProps } from "../Stage";

export function ArrayRowView({ element, state, clickable, onCell }: ElementViewProps<ArrayRow>) {
  const isOutput = element.role === "output";
  const isClickable = (ref: ElementRef) => clickable.some((c) => c.id === ref.id && (c.index ?? null) === (ref.index ?? null));
  const isPointed = (ref: ElementRef) => !!state.pointed && state.pointed.id === ref.id && (state.pointed.index ?? null) === (ref.index ?? null);

  return (
    <div className="settle-in flex items-center gap-4">
      {element.label && <div className="w-16 text-right text-[14px] text-ink-soft">{element.label}</div>}
      <div
        className={[
          "flex min-h-[3.25rem] items-center gap-1.5 rounded-md p-1.5",
          isOutput ? "border border-dashed border-line" : "",
        ].join(" ")}
      >
        {element.values.length === 0 && (
          <div className="px-3 text-[14px] text-ink-mute">{isOutput ? "nothing merged yet" : "empty"}</div>
        )}
        {element.values.map((v, i) => {
          const ref = { id: element.id, index: i };
          const tone = toneFor(state.board, ref);
          const clickableCell = isClickable(ref);
          return (
            <button
              key={`${element.id}-${i}-${String(v)}`}
              type="button"
              className={[
                "cell flex h-11 min-w-11 items-center justify-center rounded-md border px-3 text-[20px] tabular-nums",
                tone ? "border-transparent" : "border-line bg-surface",
                isPointed(ref) ? "outline outline-2 outline-ink" : "",
                clickableCell ? "ring-2 ring-ink/30 ring-offset-1" : "",
              ].join(" ")}
              data-tone={tone}
              data-clickable={clickableCell}
              onClick={() => onCell(ref)}
              aria-label={`${element.label ?? element.id} position ${i + 1}, value ${String(v)}`}
            >
              {String(v)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
