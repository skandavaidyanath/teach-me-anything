"use client";

import { useEffect, useRef } from "react";
import type { Element, ElementRef } from "@tma/schema";
import type { Playhead, PlayheadState } from "@/playhead/playhead";
import { ArrayRowView } from "./elements/ArrayRowView";
import { TextCardView } from "./elements/TextCardView";
import { LatexView } from "./elements/LatexView";
import { SplitTreeView } from "./elements/SplitTreeView";
import { SceneView } from "./elements/SceneView";
import { DerivationView } from "./elements/DerivationView";
import { ComponentView } from "./elements/ComponentView";
import { PinSpotlight } from "./PinSpotlight";

export type ElementViewProps<E extends Element> = {
  element: E;
  state: PlayheadState;
  clickable: ElementRef[];
  onCell: (ref: ElementRef) => void;
};

export function Stage({ state, playhead }: { state: PlayheadState; playhead: Playhead }) {
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

  // While the tutor answers, anything it draws sits in a layer over the lesson's own board.
  const base = state.layerBaseIds ? new Set(state.layerBaseIds) : null;
  const layerIds = base ? state.board.order.filter((id) => !base.has(id)) : [];
  const baseIds = base ? state.board.order.filter((id) => base.has(id)) : state.board.order;

  // The board scrolls; the stage keeps whatever the last op touched in view, since that is what the words are about.
  const stageRef = useRef<HTMLDivElement>(null);
  const touched = state.board.lastTouched;
  useEffect(() => {
    if (!touched || !stageRef.current) return;
    const node = stageRef.current.querySelector<HTMLElement>(`[data-element-id="${CSS.escape(touched)}"]`);
    node?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [touched, state.board.order.length, state.board.highlights]);

  const render = (id: string) => {
    const el = state.board.elements[id];
    if (!el) return null;
    const props = { state, clickable, onCell };
    const view = (() => {
      switch (el.kind) {
        case "array_row":
          return <ArrayRowView element={el} {...props} />;
        case "text_card":
          return <TextCardView element={el} {...props} />;
        case "latex":
          return <LatexView element={el} {...props} />;
        case "split_tree":
          return <SplitTreeView element={el} {...props} />;
        case "scene":
          return <SceneView element={el} {...props} />;
        case "derivation":
          return <DerivationView element={el} {...props} />;
        case "component":
          return <ComponentView element={el} {...props} />;
      }
    })();
    return (
      <div key={id} data-element-id={id} className="flex justify-center">
        {view}
      </div>
    );
  };

  return (
    <section
      aria-label="Board"
      className="relative flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface"
    >
      <div
        ref={stageRef}
        className={[
          "flex flex-1 flex-col items-center justify-center gap-9 overflow-auto p-8 transition-opacity duration-300",
          layerIds.length > 0 ? "opacity-35" : "",
        ].join(" ")}
      >
        {state.board.order.length === 0 && state.mode !== "calibrating" && state.mode !== "idle" && state.mode !== "finished" && (
          <div className="text-ink-mute">{state.waiting === "beat" ? "The next part is on its way…" : "Listening…"}</div>
        )}
        {baseIds.map(render)}
      </div>

      {layerIds.length > 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
          <div
            aria-label="While answering"
            className="spotlight-in pointer-events-auto flex max-h-full max-w-[min(56rem,92%)] flex-col items-center gap-7 overflow-auto rounded-lg border-t-[6px] border-marker bg-surface px-10 py-8 shadow-[0_18px_48px_rgba(0,0,0,0.55)]"
          >
            {layerIds.map(render)}
          </div>
        </div>
      )}

      {state.pinSpotlight && (() => {
        const pin = state.board.pins.find((p) => p.pinId === state.pinSpotlight?.pinId);
        return pin ? <PinSpotlight pin={pin} /> : null;
      })()}

      {state.mode === "calibrating" && state.calibration && (
        <Overlay>
          <p className="max-w-md text-balance text-center text-[22px] leading-snug">{state.calibration.prompt}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {state.calibration.options.map((o) => (
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
