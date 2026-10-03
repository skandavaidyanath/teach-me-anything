"use client";

import { useMemo } from "react";
import type { SplitTree } from "@tma/schema";
import { toneFor } from "@/playhead/board-reducer";
import type { ElementViewProps } from "../Stage";

type Node = { values: number[]; depth: number };

function buildLevels(values: number[]): Node[][] {
  const levels: Node[][] = [[{ values, depth: 0 }]];
  for (;;) {
    const last = levels[levels.length - 1]!;
    if (last.every((n) => n.values.length <= 1)) break;
    const next: Node[] = [];
    for (const n of last) {
      if (n.values.length <= 1) {
        next.push({ values: n.values, depth: n.depth + 1 });
        continue;
      }
      const mid = Math.floor(n.values.length / 2);
      next.push({ values: n.values.slice(0, mid), depth: n.depth + 1 });
      next.push({ values: n.values.slice(mid), depth: n.depth + 1 });
    }
    levels.push(next);
  }
  return levels;
}

export function SplitTreeView({ element, state, onCell }: ElementViewProps<SplitTree>) {
  const levels = useMemo(() => buildLevels(element.values), [element.values]);
  const maxDepth = levels.length - 1;
  const reveal = Math.min(element.revealDepth, maxDepth);
  const sortedFrom = element.sortedFromDepth;
  const n = element.values.length;

  return (
    <div className="settle-in flex flex-col items-stretch gap-3">
      {levels.slice(0, reveal + 1).map((nodes, depth) => {
        const tone = toneFor(state.board, { id: element.id, index: depth });
        const sorted = sortedFrom !== undefined && depth >= sortedFrom;
        // Once a level has merged upward, the levels beneath it recede.
        const receded = sortedFrom !== undefined && depth > sortedFrom;
        const pointed = state.pointed?.id === element.id && state.pointed.index === depth;
        return (
          <div key={depth} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
            <button
              type="button"
              onClick={() => onCell({ id: element.id, index: depth })}
              aria-label={`level ${depth}`}
              className={[
                "cell flex items-center gap-2 justify-self-center rounded-md px-2 py-1.5",
                receded ? "opacity-40" : "",
                pointed ? "outline outline-2 outline-ink" : "",
              ].join(" ")}
              data-tone={tone}
            >
              {nodes.map((node, i) => (
                <span
                  key={i}
                  className={[
                    "flex items-center gap-1 rounded-md border px-1.5 py-1",
                    sorted ? "border-correct/40 bg-correct-soft/60" : "border-line bg-surface",
                  ].join(" ")}
                >
                  {(sorted ? [...node.values].sort((a, b) => a - b) : node.values).map((v, j) => (
                    <span key={j} className="inline-flex h-8 min-w-8 items-center justify-center rounded px-1 text-[17px] tabular-nums">
                      {v}
                    </span>
                  ))}
                </span>
              ))}
            </button>
            {element.showWork ? (
              <div className="w-36 text-[13px] text-ink-soft">{n} elements touched</div>
            ) : (
              <div className="w-0" aria-hidden />
            )}
          </div>
        );
      })}
      {element.showWork && (
        <div className="mt-1 text-center text-[14px] text-ink-soft">
          {reveal} merge levels × {n} elements each
        </div>
      )}
    </div>
  );
}
