import type { Element, ElementRef, HighlightTone, Op, Pin } from "@tma/schema";

export type Highlight = { ref: ElementRef; tone: HighlightTone };

export type BoardState = {
  elements: Record<string, Element>;
  order: string[];
  highlights: Highlight[];
  pins: Pin[];
};

export const emptyBoard: BoardState = { elements: {}, order: [], highlights: [], pins: [] };

/**
 * Pure reducer. Board ops produce a new state; say, pause, and check leave it
 * untouched. Because every executed op is kept in history, the board at any
 * point in time is `replay(history)`, which makes seek and rewind trivial.
 */
export function applyOp(state: BoardState, op: Op): BoardState {
  switch (op.op) {
    case "show": {
      const exists = op.element.id in state.elements;
      return {
        ...state,
        elements: { ...state.elements, [op.element.id]: op.element },
        order: exists ? state.order : [...state.order, op.element.id],
      };
    }
    case "update": {
      const current = state.elements[op.target];
      if (!current) return state;
      const next = { ...current, ...op.patch } as Element;
      return { ...state, elements: { ...state.elements, [op.target]: next } };
    }
    case "highlight": {
      const tone = op.tone ?? "marker";
      return { ...state, highlights: op.targets.map((ref) => ({ ref, tone })) };
    }
    case "clear_highlights":
      return state.highlights.length === 0 ? state : { ...state, highlights: [] };
    case "clear": {
      if (!op.targets) {
        return { ...state, elements: {}, order: [], highlights: [] };
      }
      const drop = new Set(op.targets);
      const elements = { ...state.elements };
      for (const id of drop) delete elements[id];
      return {
        ...state,
        elements,
        order: state.order.filter((id) => !drop.has(id)),
        highlights: state.highlights.filter((h) => !drop.has(h.ref.id)),
      };
    }
    case "pin": {
      const idx = state.pins.findIndex((p) => p.pinId === op.pin.pinId);
      if (idx === -1) return { ...state, pins: [...state.pins, op.pin] };
      const pins = state.pins.slice();
      pins[idx] = op.pin;
      return { ...state, pins };
    }
    case "say":
    case "pause":
    case "check":
      return state;
  }
}

export function replay(ops: Iterable<Op>): BoardState {
  let state = emptyBoard;
  for (const op of ops) state = applyOp(state, op);
  return state;
}

/** Tone for a whole element (no index) or one of its cells. */
export function toneFor(state: BoardState, ref: ElementRef): HighlightTone | undefined {
  for (const h of state.highlights) {
    if (h.ref.id !== ref.id) continue;
    if ((h.ref.index ?? null) === (ref.index ?? null)) return h.tone;
  }
  return undefined;
}
