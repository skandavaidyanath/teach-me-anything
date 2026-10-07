import { TtsResponseSchema, type TtsWord } from "@tma/schema";
import type { SpeakHandle, SpeakOutcome, Speaker } from "./speaker";

export type TtsStats = { text: string; fetchMs: number; cached: boolean; synthMs: number };

type Clip = { buffer: AudioBuffer; words: TtsWord[]; durationMs: number };

/** Map each timestamped word to the index in `text` where it ends, so progress is in characters. */
export function charEnds(text: string, words: TtsWord[]): Array<{ end: number; charEnd: number }> {
  const out: Array<{ end: number; charEnd: number }> = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  for (const w of words) {
    const token = w.text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!token) continue;
    const at = lower.indexOf(token, cursor);
    if (at === -1) {
      // Fall back to proportional placement so the caption keeps moving.
      const frac = words.length ? (out.length + 1) / words.length : 1;
      out.push({ end: w.end, charEnd: Math.round(frac * text.length) });
      continue;
    }
    let charEnd = at + token.length;
    while (charEnd < text.length && /[^\s]/.test(text[charEnd]!) && !/[\p{L}\p{N}]/u.test(text[charEnd]!)) charEnd++;
    cursor = charEnd;
    out.push({ end: w.end, charEnd });
  }
  return out;
}

/**
 * Speaks through the harness: real TTS with word timestamps, decoded with the
 * Web Audio API for precise timing. Upcoming sentences are prefetched so the
 * next one starts the instant the previous ends.
 */
export class ServerSpeaker implements Speaker {
  readonly kind = "voice" as const;
  private ctx: AudioContext | null = null;
  private cache = new Map<string, Promise<Clip>>();

  constructor(
    private readonly baseUrl: string,
    public voiceId: string,
    private readonly onStats?: (s: TtsStats) => void,
  ) {}

  setVoice(voiceId: string): void {
    if (voiceId === this.voiceId) return;
    this.voiceId = voiceId;
    this.cache.clear();
  }

  private context(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  prefetch(texts: string[]): void {
    for (const t of texts) this.load(t).catch(() => {});
  }

  private load(text: string): Promise<Clip> {
    const key = `${this.voiceId}|${text}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const job = (async (): Promise<Clip> => {
      const started = performance.now();
      const res = await fetch(`${this.baseUrl}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voiceId: this.voiceId }),
      });
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const data = TtsResponseSchema.parse(await res.json());
      const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
      const buffer = await this.context().decodeAudioData(bytes.buffer.slice(0));
      this.onStats?.({ text, fetchMs: Math.round(performance.now() - started), cached: data.cached, synthMs: data.synthMs });
      return { buffer, words: data.words, durationMs: data.durationMs };
    })();
    this.cache.set(key, job);
    job.catch(() => this.cache.delete(key));
    return job;
  }

  speak(text: string, onProgress: (chars: number) => void): SpeakHandle {
    let cancelled = false;
    let source: AudioBufferSourceNode | null = null;
    let raf = 0;
    let resolveEarly: ((o: SpeakOutcome) => void) | null = null;

    const done = new Promise<SpeakOutcome>((resolve) => {
      resolveEarly = resolve;
      void (async () => {
        let clip: Clip;
        try {
          clip = await this.load(text);
        } catch {
          // Keep the lesson moving at reading speed if a sentence fails to synthesize.
          const ms = Math.max(900, (text.split(/\s+/).length / 165) * 60_000);
          const t0 = performance.now();
          const tick = () => {
            if (cancelled) return resolve("cancelled");
            const frac = Math.min(1, (performance.now() - t0) / ms);
            onProgress(Math.round(frac * text.length));
            if (frac >= 1) return resolve("ended");
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
          return;
        }
        if (cancelled) return resolve("cancelled");
        const ctx = this.context();
        source = ctx.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(ctx.destination);
        const ends = charEnds(text, clip.words);
        const t0 = ctx.currentTime;
        source.onended = () => {
          cancelAnimationFrame(raf);
          if (!cancelled) {
            onProgress(text.length);
            resolve("ended");
          }
        };
        source.start();
        const tick = () => {
          if (cancelled) return;
          const t = ctx.currentTime - t0;
          let chars = 0;
          for (const w of ends) {
            if (w.end <= t) chars = w.charEnd;
            else break;
          }
          if (chars > 0) onProgress(chars);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      })();
    });

    return {
      done,
      cancel: () => {
        if (cancelled) return;
        cancelled = true;
        cancelAnimationFrame(raf);
        try {
          source?.stop();
        } catch {
          // already stopped
        }
        resolveEarly?.("cancelled");
      },
    };
  }
}
