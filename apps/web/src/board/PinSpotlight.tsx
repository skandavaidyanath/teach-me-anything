"use client";

import type { Pin } from "@tma/schema";
import { Tex } from "./elements/LatexView";

const EDGE: Record<Pin["kind"], string> = {
  takeaway: "border-l-pin-takeaway",
  definition: "border-l-pin-definition",
  equation: "border-l-pin-equation",
  code: "border-l-pin-code",
};

/**
 * The moment of pinning. The idea appears large over the stage, holds for a
 * beat, then this card unmounts and the rail card mounts with the same flip
 * id, so it visibly flies from here to there.
 */
export function PinSpotlight({ pin }: { pin: Pin }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/5">
      <div
        data-flip-id={`pin:${pin.pinId}`}
        className={[
          "spotlight-in w-[min(36rem,80%)] rounded-lg border-l-[10px] bg-surface px-8 py-6 shadow-[0_18px_48px_rgba(23,36,58,0.18),0_0_0_4px_var(--color-marker)]",
          EDGE[pin.kind],
        ].join(" ")}
      >
        {pin.title && <div className="mb-2 text-[26px] font-bold leading-tight text-ink">{pin.title}</div>}
        {pin.text && (
          <div className={pin.kind === "code" ? "whitespace-pre font-mono text-[17px] leading-relaxed text-ink" : "text-[20px] leading-snug text-ink-soft"}>
            {pin.text}
          </div>
        )}
        {pin.tex && (
          <div className="py-2 text-[26px]">
            <Tex tex={pin.tex} display />
          </div>
        )}
      </div>
    </div>
  );
}
