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
/** Cells need stable identity to animate between rows. Ids are derived from the op stream, so replay is deterministic. */
function withCellIds(el: Element, tag: string): Element {
  if (el.kind !== "array_row") return el;
  if (el.cellIds && el.cellIds.length === el.values.length) return el;
  return { ...el, cellIds: el.values.map((_, i) => `${el.id}:${tag}:${i}`) };
}

export function applyOp(state: BoardState, op: Op): BoardState {
  switch (op.op) {
    case "show": {
      const exists = op.element.id in state.elements;
      const element = withCellIds(op.element, op.id);
      return {
        ...state,
        elements: { ...state.elements, [element.id]: element },
        order: exists ? state.order : [...state.order, element.id],
      };
    }
    case "update": {
      const current = state.elements[op.target];
      if (!current) return state;
      let next = { ...current, ...op.patch } as Element;
      if (current.kind === "component" && next.kind === "component") {
        // A figure's state is patched, not replaced, so a beat can change one field.
        const patchState = op.patch["state"];
        if (patchState && typeof patchState === "object" && !Array.isArray(patchState)) {
          next = { ...next, state: { ...(current.state ?? {}), ...(patchState as Record<string, unknown>) } };
        }
      }
      if (next.kind === "array_row" && "values" in op.patch) {
        // New values have no relation to the old cells; give them fresh identity.
        next = withCellIds({ ...next, cellIds: undefined }, op.id);
      }
      return { ...state, elements: { ...state.elements, [op.target]: next } };
    }
    case "move": {
      const src = state.elements[op.from.id];
      const dst = state.elements[op.to.id];
      const i = op.from.index;
      if (!src || src.kind !== "array_row" || !dst || dst.kind !== "array_row" || i === undefined) return state;
      if (i < 0 || i >= src.values.length) return state;
      const srcWithIds = withCellIds(src, op.id) as typeof src;
      const value = srcWithIds.values[i]!;
      const cellId = srcWithIds.cellIds![i]!;
      const removedValues = srcWithIds.values.filter((_, k) => k !== i);
      const removedIds = srcWithIds.cellIds!.filter((_, k) => k !== i);
      const target = (op.from.id === op.to.id ? { ...srcWithIds, values: removedValues, cellIds: removedIds } : withCellIds(dst, op.id)) as typeof dst;
      const at = Math.min(op.to.index ?? target.values.length, target.values.length);
      const inserted = {
        ...target,
        values: [...target.values.slice(0, at), value, ...target.values.slice(at)],
        cellIds: [...(target.cellIds ?? []).slice(0, at), cellId, ...(target.cellIds ?? []).slice(at)],
      };
      const elements = { ...state.elements, [op.to.id]: inserted };
      if (op.from.id !== op.to.id) elements[op.from.id] = { ...srcWithIds, values: removedValues, cellIds: removedIds };
      // Indices in the touched rows shifted, so highlights on them no longer point at the same cells.
      const highlights = state.highlights.filter((h) => h.ref.id !== op.from.id && h.ref.id !== op.to.id);
      return { ...state, elements, highlights };
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
