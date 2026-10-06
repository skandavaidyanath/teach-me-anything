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

const KIND_LABEL: Record<Pin["kind"], string> = {
  takeaway: "takeaway",
  definition: "definition",
  equation: "formula",
  code: "code",
};

/**
 * What the tutor has pinned so far. Pins arrive with a stamp animation and
 * stay for the rest of the lesson. Click one to point at it before asking.
 */
export function PinnedRail({ state, playhead }: { state: PlayheadState; playhead: Playhead }) {
  const pins = state.board.pins;
  return (
    <aside aria-label="Pinned" className="flex min-h-0 flex-col rounded-lg bg-rail p-4">
      <div className="mb-3 flex items-baseline justify-between px-1">
        <h2 className="text-[15px] font-bold text-ink">{pins.length === 0 ? "Pinned" : `${pins.length} pinned`}</h2>
        {pins.length > 0 && <span className="text-[12.5px] text-ink-soft">click one to ask about it</span>}
      </div>
      <ol className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {pins.length === 0 && (
          <li className="px-1 text-[14px] leading-snug text-ink-soft">
            When the tutor says something worth keeping, it lands here and stays for the whole lesson.
          </li>
        )}
        {pins.map((pin) => {
          const pointed = state.pointed?.id === pin.pinId;
          return (
            <li key={pin.pinId} className="pin-in">
              <button
                type="button"
                onClick={() => playhead.setPointed(pointed ? null : { id: pin.pinId })}
                aria-pressed={pointed}
                className={[
                  "w-full rounded-md border-l-[6px] bg-surface px-4 py-3 text-left leading-snug shadow-[0_1px_0_rgba(23,36,58,0.06)]",
                  EDGE[pin.kind],
                  pointed ? "outline outline-2 outline-ink" : "hover:bg-board",
                ].join(" ")}
              >
                <div className="mb-1 flex items-baseline justify-between gap-3">
                  {pin.title ? <div className="text-[16px] font-bold text-ink">{pin.title}</div> : <span />}
                  <span className="shrink-0 text-[12px] text-ink-mute">{KIND_LABEL[pin.kind]}</span>
                </div>
                {pin.text && (
                  <div className={pin.kind === "code" ? "whitespace-pre font-mono text-[13px] leading-relaxed text-ink" : "text-[15.5px] text-ink-soft"}>
                    {pin.text}
                  </div>
                )}
                {pin.tex && (
                  <div className="py-1 text-[18px]">
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
