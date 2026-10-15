"use client";

import type { ElementRef, Scene, SceneItem } from "@tma/schema";
import { toneFor } from "@/playhead/board-reducer";
import type { ElementViewProps } from "../Stage";

const ARROW_COLOR: Record<NonNullable<Extract<SceneItem, { type: "arrow" }>["role"]>, string> = {
  force: "var(--color-correct)",
  velocity: "var(--color-blue)",
  fictitious: "var(--color-incorrect)",
  neutral: "var(--color-ink-soft)",
};

const TONE_COLOR = {
  marker: "var(--color-marker)",
  correct: "var(--color-correct)",
  incorrect: "var(--color-incorrect)",
} as const;

const GLOW = { marker: "glow-marker", correct: "glow-correct", incorrect: "glow-incorrect" } as const;

/**
 * Declarative SVG diagram. Each item sits in a group translated to its
 * position, so a position change eases. Strokes draw themselves on when they
 * first appear, filled shapes pop, labels follow. Items are clickable for
 * pointing and for click checks.
 */
export function SceneView({ element, state, clickable, onCell }: ElementViewProps<Scene>) {
  const isClickable = (ref: ElementRef) => clickable.some((c) => c.id === ref.id && (c.index ?? null) === (ref.index ?? null));
  const isPointed = (ref: ElementRef) => !!state.pointed && state.pointed.id === ref.id && (state.pointed.index ?? null) === (ref.index ?? null);

  return (
    <figure className="settle-in flex flex-col items-center gap-2">
      <svg
        viewBox={`0 0 ${element.width} ${element.height}`}
        width={Math.min(element.width * 1.3, 720)}
        className="max-w-full overflow-visible"
        role="img"
        aria-label={element.label ?? element.id}
      >
        <defs>
          {(["force", "velocity", "fictitious", "neutral"] as const).map((role) => (
            <marker key={role} id={`arrow-${element.id}-${role}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={ARROW_COLOR[role]} />
            </marker>
          ))}
        </defs>
        {element.items.map((item, i) => {
          const ref = { id: element.id, index: i };
          const tone = toneFor(state.board, ref);
          const ring = tone ? TONE_COLOR[tone] : isPointed(ref) ? "var(--color-ink)" : null;
          const clickableItem = isClickable(ref);
          const common = {
            className: `scene-item ${tone ? GLOW[tone] : ""} ${clickableItem ? "cursor-pointer" : "cursor-default"}`,
            onClick: () => onCell(ref),
            role: "button" as const,
            tabIndex: 0,
            "aria-label": item.label ?? `${item.type} ${i + 1}`,
          };
          // The key carries the item's id, so a new item draws on while a moved one eases.
          return (
            <g key={item.id} {...common}>
              {renderItem(item, ring, clickableItem, element.id)}
            </g>
          );
        })}
      </svg>
      {element.caption && <figcaption className="label-in text-[15px] text-ink-soft">{element.caption}</figcaption>}
    </figure>
  );
}

const move = { transition: "transform 700ms var(--ease-settle)" } as const;

function renderItem(item: SceneItem, ring: string | null, clickable: boolean, sceneId: string) {
  const dash = (dashed?: boolean) => (dashed ? "0.04 0.03" : undefined);
  switch (item.type) {
    case "circle":
      return (
        <g style={{ transform: `translate(${item.cx}px, ${item.cy}px)`, ...move }}>
          <circle className={item.dashed ? "label-in" : "draw-on"} pathLength={1} r={item.r} fill="none" stroke="var(--color-ink-soft)" strokeWidth={1.6} strokeDasharray={dash(item.dashed)} />
          {ring && <circle className="ring-pulse" r={item.r + 6} fill="none" stroke={ring} strokeWidth={3} />}
          {item.label && (
            <text className="label-in" x={0} y={-item.r - 10} fontSize={13} fill="var(--color-ink-soft)" textAnchor="middle">
              {item.label}
            </text>
          )}
        </g>
      );
    case "dot": {
      const r = item.r ?? 9;
      return (
        <g style={{ transform: `translate(${item.cx}px, ${item.cy}px)`, ...move }}>
          {ring && <circle className="ring-pulse" r={r + 7} fill={ring} opacity={0.35} />}
          <circle className="pop-in" r={r} fill="var(--color-ink)" />
          {item.label && (
            <text className="label-in" x={r + 8} y={5} fontSize={13} fill="var(--color-ink-soft)">
              {item.label}
            </text>
          )}
        </g>
      );
    }
    case "arrow": {
      const role = item.role ?? "neutral";
      const dx = item.x2 - item.x1;
      const dy = item.y2 - item.y1;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len;
      const ny = dx / len;
      const midX = dx / 2 + nx * 16;
      const midY = dy / 2 + ny * 16;
      return (
        <g style={{ transform: `translate(${item.x1}px, ${item.y1}px)`, ...move }}>
          {(ring || clickable) && <line x1={0} y1={0} x2={dx} y2={dy} stroke={ring ?? "var(--color-ink)"} strokeWidth={ring ? 10 : 8} strokeLinecap="round" opacity={ring ? 0.35 : 0.12} className={ring ? "ring-pulse" : ""} />}
          <line className="draw-on" pathLength={1} x1={0} y1={0} x2={dx} y2={dy} stroke={ARROW_COLOR[role]} strokeWidth={2.8} strokeLinecap="round" />
          <line className="marker-in" x1={dx * 0.96} y1={dy * 0.96} x2={dx} y2={dy} stroke={ARROW_COLOR[role]} strokeWidth={2.8} markerEnd={`url(#arrow-${sceneId}-${role})`} />
          {item.label && (
            <text className="label-in" x={midX} y={midY} fontSize={13} fill={ARROW_COLOR[role]} textAnchor="middle" dominantBaseline="middle">
              {item.label}
            </text>
          )}
        </g>
      );
    }
    case "line":
      return (
        <g>
          <line className={item.dashed ? "label-in" : "draw-on"} pathLength={1} x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke={ring ?? "var(--color-ink-soft)"} strokeWidth={ring ? 3 : 1.6} strokeDasharray={dash(item.dashed)} strokeLinecap="round" />
          {item.label && (
            <text className="label-in" x={(item.x1 + item.x2) / 2} y={(item.y1 + item.y2) / 2 - 8} fontSize={13} fill="var(--color-ink-soft)" textAnchor="middle">
              {item.label}
            </text>
          )}
        </g>
      );
    case "path":
      return <path className={item.dashed ? "label-in" : "draw-on"} pathLength={1} d={item.d} fill="none" stroke={ring ?? "var(--color-ink)"} strokeWidth={ring ? 3.5 : 2.2} strokeDasharray={dash(item.dashed)} strokeLinecap="round" strokeLinejoin="round" />;
    case "text":
      return (
        <text className="label-in" x={item.x} y={item.y} fontSize={item.size ?? 14} fill={ring ?? "var(--color-ink-soft)"} style={{ fontWeight: ring ? 700 : 400 }}>
          {item.text}
        </text>
      );
  }
}
