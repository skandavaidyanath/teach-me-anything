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
      {element.label && <div className="w-20 text-right text-[17px] text-ink-soft">{element.label}</div>}
      <div
        className={[
          "flex min-h-[4.25rem] items-center gap-2 rounded-md p-2",
          isOutput ? "border border-dashed border-line" : "",
        ].join(" ")}
      >
        {element.values.length === 0 && (
          <div className="px-4 text-[16px] text-ink-mute">{isOutput ? "nothing merged yet" : "empty"}</div>
        )}
        {element.values.map((v, i) => {
          const ref = { id: element.id, index: i };
          const tone = toneFor(state.board, ref);
          const clickableCell = isClickable(ref);
          const cellId = element.cellIds?.[i] ?? `${element.id}:${i}`;
          return (
            <button
              key={cellId}
              data-flip-id={`cell:${cellId}`}
              type="button"
              className={[
                "cell flex h-14 min-w-14 items-center justify-center rounded-md border px-4 text-[26px] tabular-nums",
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
