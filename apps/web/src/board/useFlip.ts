"use client";

import { useLayoutEffect, useRef, type DependencyList, type RefObject } from "react";

/**
 * FLIP animation over everything with a `data-flip-id` under `root`. After each
 * render in `deps`, any node whose id was seen at a different place last time
 * animates from where it was to where it is now. Works across DOM nodes, so a
 * cell removed from one row and re-created in another appears to travel, and
 * a pin spotlight on the stage flies into its slot in the rail.
 */
export function useFlip(root: RefObject<HTMLElement | null>, deps: DependencyList, durationMs = 520): void {
  const prevRects = useRef<Map<string, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const nodes = el.querySelectorAll<HTMLElement>("[data-flip-id]");
    const next = new Map<string, DOMRect>();
    for (const node of nodes) {
      const id = node.dataset.flipId;
      if (!id) continue;
      const rect = node.getBoundingClientRect();
      next.set(id, rect);
      const old = prevRects.current.get(id);
      if (!old || reduce) continue;
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      const sx = rect.width > 0 ? old.width / rect.width : 1;
      const sy = rect.height > 0 ? old.height / rect.height : 1;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue;
      node.style.transformOrigin = "top left";
      node.animate(
        [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: "translate(0, 0) scale(1, 1)" }],
        { duration: durationMs, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", composite: "replace" },
      );
    }
    prevRects.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
