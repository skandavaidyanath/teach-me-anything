import type { ElementRef, Op, Resume } from "@tma/schema";

/**
 * The Responder speaks in plain sentences with a few directive lines. This
 * parser turns a token stream into ops as soon as each sentence is complete,
 * so the first sentence can be on its way to TTS while the model is still
 * writing the second.
 *
 *   plain text                      -> say ops, one per sentence
 *   @highlight A[0] B[0]            -> highlight op (optional tone word: correct | incorrect)
 *   @pin takeaway "Title" :: body   -> pin op
 *   @resume continue Bridge text.   -> resume decision (continue | rewind | skip)
 */

export type ParsedChunk = { kind: "op"; op: Op } | { kind: "resume"; resume: Resume };

// A sentence ends at . ! or ? (plus closing quotes/brackets) followed by whitespace and more text.
const SENTENCE_END = /([.!?]["')\]]*)\s+(?=\S)/g;

export function parseRef(token: string): ElementRef | null {
  const m = /^([A-Za-z][\w-]*)(?:\[(\d+)\])?$/.exec(token.trim());
  if (!m) return null;
  const ref: ElementRef = { id: m[1]! };
  if (m[2] !== undefined) ref.index = Number(m[2]);
  return ref;
}

function join(a: string, b: string): string {
  const x = a.trim();
  const y = b.trim();
  return x && y ? `${x} ${y}` : x || y;
}

/** Complete sentences at the front of `text`, and the unfinished remainder. */
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

export class ResponderParser {
  /** Plain text from completed lines, not yet emitted. */
  private textBuffer = "";
  /** Text since the last newline. */
  private lineBuffer = "";
  private sayCount = 0;
  private highlightCount = 0;
  private pinCount = 0;
  private resume: Resume | null = null;

  constructor(private readonly idPrefix: string) {}

  /** Feed a delta; returns whatever became complete. */
  push(delta: string): ParsedChunk[] {
    const out: ParsedChunk[] = [];
    this.lineBuffer += delta;
    let nl: number;
    while ((nl = this.lineBuffer.indexOf("\n")) !== -1) {
      const line = this.lineBuffer.slice(0, nl);
      this.lineBuffer = this.lineBuffer.slice(nl + 1);
      out.push(...this.completeLine(line));
    }
    // A partial line that is not a directive may already hold finished sentences.
    if (this.lineBuffer.length > 0 && !this.lineBuffer.trimStart().startsWith("@")) {
      const { sentences, rest } = splitComplete(join(this.textBuffer, this.lineBuffer));
      out.push(...sentences.map((s) => this.say(s)));
      this.textBuffer = "";
      this.lineBuffer = rest;
    }
    return out;
  }

  private completeLine(line: string): ParsedChunk[] {
    const trimmed = line.trim();
    if (trimmed.startsWith("@")) {
      const flushed = this.flushText();
      const directive = this.parseDirective(trimmed);
      return directive ? [...flushed, directive] : flushed;
    }
    this.textBuffer = join(this.textBuffer, trimmed);
    const { sentences, rest } = splitComplete(this.textBuffer);
    this.textBuffer = rest;
    return sentences.map((s) => this.say(s));
  }

  /** Emit everything buffered as sentences, including an unfinished tail. */
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

  private parseDirective(line: string): ParsedChunk | null {
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
      const title = pm[2]!.trim();
      const body = (pm[3] ?? "").trim();
      return {
        kind: "op",
        op: {
          op: "pin",
          id: `${this.idPrefix}.p${this.pinCount}`,
          pin: { pinId: `${this.idPrefix}.pin${this.pinCount}`, kind, title, ...(body ? { text: body } : {}) },
        },
      };
    }
    if (name === "resume") {
      const rm = /^(continue|rewind|skip)\b\s*(.*)$/.exec(rest);
      const mode = (rm?.[1] as Resume["mode"] | undefined) ?? "continue";
      const bridge = (rm ? rm[2] ?? "" : rest).trim();
      this.resume = { mode, ...(bridge ? { bridge } : {}) };
      return { kind: "resume", resume: this.resume };
    }
    return null;
  }

  /** End of stream: emit whatever is left. */
  finish(): ParsedChunk[] {
    const tail = this.lineBuffer.trim();
    this.lineBuffer = "";
    if (tail.startsWith("@")) {
      const flushed = this.flushText();
      const directive = this.parseDirective(tail);
      return directive ? [...flushed, directive] : flushed;
    }
    this.textBuffer = join(this.textBuffer, tail);
    return this.flushText();
  }

  get sawResume(): boolean {
    return this.resume !== null;
  }

  get sentences(): number {
    return this.sayCount;
  }
}
