/**
 * Sound effects a figure asks for, played here rather than inside its sandboxed
 * frame, which has no user activation of its own. A small synth is enough:
 * tones and chords with an envelope, a click, a burst of noise.
 */

export type SoundRequest =
  | { kind: "tone" | "chord"; freqs: number[]; ms?: number; wave?: OscillatorType; gain?: number }
  | { kind: "click" | "noise"; ms?: number; gain?: number };

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function playSound(req: SoundRequest): void {
  const ac = context();
  if (!ac) return;
  const now = ac.currentTime;
  const ms = Math.min(8000, Math.max(30, req.ms ?? (req.kind === "click" ? 40 : req.kind === "noise" ? 300 : 500)));
  const gainValue = Math.min(1, Math.max(0, req.gain ?? 0.25));
  const out = ac.createGain();
  out.gain.value = 0;
  out.connect(ac.destination);
  const dur = ms / 1000;
  // A short envelope so nothing clicks on the way in or out.
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(gainValue, now + Math.min(0.02, dur / 4));
  out.gain.setValueAtTime(gainValue, now + dur * 0.7);
  out.gain.linearRampToValueAtTime(0, now + dur);

  if (req.kind === "tone" || req.kind === "chord") {
    const freqs = req.freqs.filter((f) => Number.isFinite(f) && f > 20 && f < 12000).slice(0, 8);
    if (freqs.length === 0) return;
    for (const f of freqs) {
      const osc = ac.createOscillator();
      osc.type = req.wave ?? "sine";
      osc.frequency.value = f;
      const share = ac.createGain();
      share.gain.value = 1 / Math.sqrt(freqs.length);
      osc.connect(share);
      share.connect(out);
      osc.start(now);
      osc.stop(now + dur + 0.05);
    }
    return;
  }
  // click and noise: a burst of white noise, short or shaped.
  const buffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (req.kind === "click" ? 1 - i / data.length : 1);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  if (req.kind === "noise") {
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    src.connect(filter);
    filter.connect(out);
  } else src.connect(out);
  src.start(now);
}
