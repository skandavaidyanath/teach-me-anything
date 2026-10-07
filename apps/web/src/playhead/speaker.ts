/**
 * Voice output. v0.0 uses the browser's speech synthesis so there is nothing
 * to configure. The interface is what matters: a real TTS provider with word
 * timestamps slots in behind it in v0.1.
 */

export type SpeakOutcome = "ended" | "cancelled";

export type SpeakHandle = {
  done: Promise<SpeakOutcome>;
  cancel: () => void;
};

export type SpeakerKind = "voice" | "silent";

export interface Speaker {
  readonly kind: SpeakerKind;
  /** `onProgress` receives the number of characters spoken so far. */
  speak(text: string, onProgress: (chars: number) => void): SpeakHandle;
  /** Warm up upcoming sentences, if the speaker has anything to fetch. */
  prefetch?(texts: string[]): void;
}

const WORDS_PER_MINUTE = 165;

function estimateMs(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(900, (words / WORDS_PER_MINUTE) * 60_000);
}

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

/** Captions only, paced at reading speed. Also the fallback when speech is unavailable. */
export class SilentSpeaker implements Speaker {
  readonly kind = "silent" as const;

  speak(text: string, onProgress: (chars: number) => void): SpeakHandle {
    const total = estimateMs(text);
    const started = performance.now();
    let settled = false;
    let resolveDone: (o: SpeakOutcome) => void = () => {};
    const done = new Promise<SpeakOutcome>((resolve) => {
      resolveDone = resolve;
    });
    const tick = () => {
      if (settled) return;
      const frac = Math.min(1, (performance.now() - started) / total);
      onProgress(Math.round(frac * text.length));
      if (frac >= 1) {
        settled = true;
        resolveDone("ended");
        return;
      }
      timer = setTimeout(tick, 50);
    };
    let timer = setTimeout(tick, 50);
    return {
      done,
      cancel: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveDone("cancelled");
      },
    };
  }
}

const PREFERRED_VOICES = [
  "Samantha",
  "Google US English",
  "Microsoft Aria Online (Natural) - English (United States)",
  "Microsoft Jenny Online (Natural) - English (United States)",
  "Karen",
  "Daniel",
  "Alex",
];

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  for (const name of PREFERRED_VOICES) {
    const v = voices.find((x) => x.name === name);
    if (v) return v;
  }
  return voices.find((v) => v.lang.startsWith("en") && v.default) ?? voices.find((v) => v.lang.startsWith("en")) ?? null;
}

export class WebSpeechSpeaker implements Speaker {
  readonly kind = "voice" as const;

  speak(text: string, onProgress: (chars: number) => void): SpeakHandle {
    const synth = window.speechSynthesis;
    // A lingering utterance from a previous page state would otherwise queue behind ours.
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    const voice = pickVoice();
    if (voice) utterance.voice = voice;

    let settled = false;
    let resolveDone: (o: SpeakOutcome) => void = () => {};
    const done = new Promise<SpeakOutcome>((resolve) => {
      resolveDone = resolve;
    });

    // Boundary events are the real signal. Some engines never fire them, so a
    // reading-speed estimate runs alongside and the caption takes the max.
    // If the engine never even starts (blocked audio, no voices, headless),
    // a watchdog turns the estimate into the clock so the lesson never hangs.
    let progress = 0;
    let engineStarted = false;
    let stalled = false;
    const total = estimateMs(text);
    const started = performance.now();
    const report = (chars: number) => {
      progress = Math.max(progress, Math.min(text.length, chars));
      onProgress(progress);
    };
    const estimator = setInterval(() => {
      if (settled) return;
      const raw = (performance.now() - started) / total;
      const frac = stalled ? Math.min(1, raw) : Math.min(0.95, raw);
      report(Math.round(frac * text.length));
      if (stalled && raw >= 1) finish("ended");
    }, 80);
    const watchdog = setTimeout(() => {
      if (settled || engineStarted) return;
      stalled = true;
      synth.cancel();
    }, 2500);
    const hardCap = setTimeout(() => finish("ended"), total * 2 + 4000);

    const finish = (outcome: SpeakOutcome) => {
      if (settled) return;
      settled = true;
      clearInterval(estimator);
      clearTimeout(watchdog);
      clearTimeout(hardCap);
      if (outcome === "ended") onProgress(text.length);
      resolveDone(outcome);
    };

    utterance.onstart = () => {
      engineStarted = true;
    };
    utterance.onboundary = (e) => {
      engineStarted = true;
      if (e.name === "word" || e.name === undefined) report(e.charIndex + (e.charLength ?? 0));
    };
    utterance.onend = () => {
      if (!stalled) finish("ended");
    };
    utterance.onerror = (e) => {
      if (stalled) return;
      if (e.error === "canceled" || e.error === "interrupted") finish("cancelled");
      else finish("ended");
    };

    synth.speak(utterance);

    return {
      done,
      cancel: () => {
        if (settled) return;
        synth.cancel();
        finish("cancelled");
      },
    };
  }
}

export function createSpeaker(kind: SpeakerKind): Speaker {
  if (kind === "voice" && speechAvailable()) return new WebSpeechSpeaker();
  return new SilentSpeaker();
}
