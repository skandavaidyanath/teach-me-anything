"use client";

import type { Pin } from "@tma/schema";
import type { Playhead, PlayheadState } from "@/playhead/playhead";
import { Tex } from "./elements/LatexView";

const EDGE: Record<Pin["kind"], string> = {
  takeaway: "border-l-pin-takeaway",
  definition: "border-l-pin-definition",
  equation: "border-l-pin-equation",
  code: "border-l-pin-code",
};

export function PinnedRail({ state, playhead }: { state: PlayheadState; playhead: Playhead }) {
  const pins = state.board.pins;
  return (
    <aside aria-label="Pinned" className="flex min-h-0 flex-col rounded-lg bg-rail p-3">
      <div className="mb-2 flex items-baseline justify-between px-1">
        <h2 className="text-[13px] font-bold text-ink-soft">Pinned</h2>
        {pins.length > 0 && <span className="text-[12px] text-ink-mute">click one to ask about it</span>}
      </div>
      <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
        {pins.length === 0 && <li className="px-1 text-[13px] text-ink-mute">Key facts land here as the lesson goes.</li>}
        {pins.map((pin) => {
          const pointed = state.pointed?.id === pin.pinId;
          return (
            <li key={pin.pinId} className="settle-in">
              <button
                type="button"
                onClick={() => playhead.setPointed(pointed ? null : { id: pin.pinId })}
                aria-pressed={pointed}
                className={[
                  "w-full rounded-md border-l-4 bg-surface px-3 py-2 text-left text-[14px] leading-snug shadow-[0_1px_0_rgba(23,36,58,0.06)]",
                  EDGE[pin.kind],
                  pointed ? "outline outline-2 outline-ink" : "hover:bg-board",
                ].join(" ")}
              >
                {pin.title && <div className="text-[12px] text-ink-soft">{pin.title}</div>}
                {pin.text && (
                  <div className={pin.kind === "code" ? "whitespace-pre font-mono text-[12.5px] leading-relaxed" : ""}>{pin.text}</div>
                )}
                {pin.tex && (
                  <div className="py-1">
                    <Tex tex={pin.tex} display />
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
