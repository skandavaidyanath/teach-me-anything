"use client";

import type { TextCard } from "@tma/schema";
import type { ElementViewProps } from "../Stage";

export function TextCardView({ element, state, onCell }: ElementViewProps<TextCard>) {
  const pointed = state.pointed?.id === element.id;
  return (
    <button
      type="button"
      onClick={() => onCell({ id: element.id })}
      className={[
        "settle-in max-w-xl rounded-lg border border-line bg-surface px-6 py-5 text-left",
        pointed ? "outline outline-2 outline-ink" : "hover:bg-board",
      ].join(" ")}
    >
      {element.title && <div className="mb-2 text-[14px] text-ink-soft">{element.title}</div>}
      <div className="space-y-1.5 text-[18px] leading-snug">
        {element.body.split("\n").map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </button>
  );
}
