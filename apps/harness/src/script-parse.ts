import type { Element, ElementRef, Op } from "@tma/schema";

/**
 * Parses what the Tutor writes: a script, one item per line.
 *
 *   keep 7                          play line 7 of the pending script as written
 *   plain text                      new spoken sentences (split at sentence ends)
 *   @highlight A[0] B[0]            and the other drawing directives
 *   @replan from=b3 reason=...      ask the Planner to rewrite from a beat
 *
 * Sentences stream out as soon as they are complete so TTS can start early.
 */

export type ParsedChunk =
  | { kind: "op"; op: Op }
  | { kind: "keep"; line: number }
  | { kind: "replan"; fromBeatId: string; reason: string };

// A sentence ends at . ! or ? (plus closing quotes/brackets) followed by whitespace and more text.
const SENTENCE_END = /([.!?]["')\]]*)\s+(?=\S)/g;

export function parseRef(token: string): ElementRef | null {
  const m = /^([A-Za-z][\w-]*)(?:\[(\d+)\])?$/.exec(token.trim());
  if (!m) return null;
  const ref: ElementRef = { id: m[1]! };
  if (m[2] !== undefined) ref.index = Number(m[2]);
  return ref;
}

function parseValues(raw: string): Array<number | string> {
  return raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((t) => (/^-?\d+(\.\d+)?$/.test(t) ? Number(t) : t));
}

function join(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  return x && y ? `${x} ${y}` : x || y;
}

function splitComplete(text: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let lastEnd = 0;
  SENTENCE_END.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END.exec(text)) !== null) {
    const sentence = text.slice(lastEnd, m.index + m[1]!.length).trim();
    lastEnd = m.index + m[0].length;
    if (sentence) sentences.push(sentence);
  }
  return { sentences, rest: text.slice(lastEnd) };
}

const isControlLine = (t: string) => t.startsWith("@") || /^keep\b/i.test(t);

export class ScriptParser {
  private textBuffer = "";
  private lineBuffer = "";
  private sayCount = 0;
  private highlightCount = 0;
  private pinCount = 0;
  private showCount = 0;

  constructor(private readonly idPrefix: string) {}

  push(delta: string): ParsedChunk[] {
    const out: ParsedChunk[] = [];
    this.lineBuffer += delta;
    let nl: number;
    while ((nl = this.lineBuffer.indexOf("\n")) !== -1) {
      const line = this.lineBuffer.slice(0, nl);
      this.lineBuffer = this.lineBuffer.slice(nl + 1);
      out.push(...this.completeLine(line));
    }
    // A partial line that is not a control line may already hold finished sentences.
    // Buffers are only rewritten when something was emitted, so no trailing space is lost mid-token.
    if (this.lineBuffer.length > 0 && !isControlLine(this.lineBuffer.trimStart())) {
      const combined = this.textBuffer ? `${this.textBuffer} ${this.lineBuffer}` : this.lineBuffer;
      const { sentences, rest } = splitComplete(combined);
      if (sentences.length > 0) {
        out.push(...sentences.map((s) => this.say(s)));
        this.textBuffer = "";
        this.lineBuffer = rest;
      }
    }
    return out;
  }

  private completeLine(line: string): ParsedChunk[] {
    const trimmed = line.trim();
    if (isControlLine(trimmed)) {
      const flushed = this.flushText();
      const control = this.parseControl(trimmed);
      return control ? [...flushed, control] : flushed;
    }
    this.textBuffer = join(this.textBuffer, trimmed.replace(/^say\s*:?\s*/i, ""));
    const { sentences, rest } = splitComplete(this.textBuffer);
    this.textBuffer = rest;
    return sentences.map((s) => this.say(s));
  }

  private flushText(): ParsedChunk[] {
    const { sentences, rest } = splitComplete(this.textBuffer);
    this.textBuffer = "";
    const out = sentences.map((s) => this.say(s));
    const tail = rest.trim();
    if (tail) out.push(this.say(tail));
    return out;
  }

  private say(text: string): ParsedChunk {
    this.sayCount++;
    return { kind: "op", op: { op: "say", id: `${this.idPrefix}.s${this.sayCount}`, text } };
  }

  private parseControl(line: string): ParsedChunk | null {
    const keep = /^keep\s+(\d+)\s*$/i.exec(line);
    if (keep) return { kind: "keep", line: Number(keep[1]) };
    const m = /^@(\w+)\s*(.*)$/.exec(line);
    if (!m) return null;
    const name = m[1]!.toLowerCase();
    const rest = (m[2] ?? "").trim();
    if (name === "highlight") {
      let tone: "marker" | "correct" | "incorrect" = "marker";
      const refs: ElementRef[] = [];
      for (const t of rest.split(/[\s,]+/).filter(Boolean)) {
        if (t === "correct" || t === "incorrect" || t === "marker") tone = t;
        else {
          const ref = parseRef(t);
          if (ref) refs.push(ref);
        }
      }
      if (refs.length === 0) return null;
      this.highlightCount++;
      return { kind: "op", op: { op: "highlight", id: `${this.idPrefix}.h${this.highlightCount}`, targets: refs, tone } };
    }
    if (name === "pin") {
      const pm = /^(takeaway|definition|equation|code)?\s*"([^"]+)"\s*(?:::\s*(.*))?$/.exec(rest);
      if (!pm) return null;
      this.pinCount++;
      const kind = (pm[1] as "takeaway" | "definition" | "equation" | "code" | undefined) ?? "takeaway";
      const body = (pm[3] ?? "").trim();
      return {
        kind: "op",
        op: {
          op: "pin",
          id: `${this.idPrefix}.p${this.pinCount}`,
          pin: { pinId: `${this.idPrefix}.pin${this.pinCount}`, kind, title: pm[2]!.trim(), ...(body ? { text: body } : {}) },
        },
      };
    }
    if (name === "row" || name === "tree" || name === "card" || name === "formula") {
      const element = this.parseShow(name, rest);
      if (!element) return null;
      this.showCount++;
      return { kind: "op", op: { op: "show", id: `${this.idPrefix}.e${this.showCount}`, element } };
    }
    if (name === "reveal") {
      const rm = /^([A-Za-z][\w-]*)\s+(?:levels=|lines=)?(\d+)$/.exec(rest);
      if (!rm) return null;
      const n = Number(rm[2]);
      this.showCount++;
      return { kind: "op", op: { op: "update", id: `${this.idPrefix}.u${this.showCount}`, target: rm[1]!, patch: { revealDepth: n, revealed: n } } };
    }
    if (name === "move") {
      const mm = /^(\S+)\s*(?:->|to)\s*([A-Za-z][\w-]*)(?:\[(\d+)\])?$/.exec(rest);
      if (!mm) return null;
      const from = parseRef(mm[1]!);
      if (!from || from.index === undefined) return null;
      this.showCount++;
      const to: { id: string; index?: number } = { id: mm[2]! };
      if (mm[3] !== undefined) to.index = Number(mm[3]);
      return { kind: "op", op: { op: "move", id: `${this.idPrefix}.m${this.showCount}`, from, to } };
    }
    if (name === "replan") {
      const fm = /from=([A-Za-z][\w-]*)/.exec(rest);
      const rm = /reason=(.*)$/.exec(rest);
      if (!fm) return null;
      return { kind: "replan", fromBeatId: fm[1]!, reason: (rm?.[1] ?? "").trim().replace(/^"|"$/g, "") };
    }
    return null;
  }

  private parseShow(name: string, rest: string): Element | null {
    if (name === "row") {
      const m = /^([A-Za-z][\w-]*)\s*(?:"([^"]*)")?\s*(\(output\))?\s*:\s*(.*)$/.exec(rest);
      if (!m) return null;
      const el: Element = { kind: "array_row", id: m[1]!, values: parseValues(m[4] ?? "") };
      if (m[2]) el.label = m[2];
      if (m[3]) el.role = "output";
      return el;
    }
    if (name === "tree") {
      const m = /^([A-Za-z][\w-]*)\s*:\s*([^|]*)(?:\|(.*))?$/.exec(rest);
      if (!m) return null;
      const values = parseValues(m[2] ?? "").filter((v): v is number => typeof v === "number");
      if (values.length === 0) return null;
      const opts = m[3] ?? "";
      const levels = /levels=(\d+)/.exec(opts);
      const merged = /merged=(\d+)/.exec(opts);
      const el: Element = { kind: "split_tree", id: m[1]!, values, revealDepth: levels ? Number(levels[1]) : 0 };
      if (merged) el.sortedFromDepth = Number(merged[1]);
      return el;
    }
    if (name === "card") {
      const m = /^([A-Za-z][\w-]*)\s*(?:"([^"]*)")?\s*(?:::\s*(.*))?$/.exec(rest);
      if (!m || (!m[2] && !m[3])) return null;
      const el: Element = { kind: "text_card", id: m[1]!, body: (m[3] ?? "").trim() || (m[2] ?? "") };
      if (m[2] && m[3]) el.title = m[2];
      return el;
    }
    if (name === "formula") {
      const m = /^([A-Za-z][\w-]*)\s*:\s*(.+)$/.exec(rest);
      if (!m) return null;
      return { kind: "latex", id: m[1]!, tex: m[2]!.trim() };
    }
    return null;
  }

  finish(): ParsedChunk[] {
    const tail = this.lineBuffer.trim();
    this.lineBuffer = "";
    if (isControlLine(tail)) {
      const flushed = this.flushText();
      const control = this.parseControl(tail);
      return control ? [...flushed, control] : flushed;
    }
    this.textBuffer = join(this.textBuffer, tail.replace(/^say\s*:?\s*/i, ""));
    return this.flushText();
  }

  get sentences(): number {
    return this.sayCount;
  }
}
