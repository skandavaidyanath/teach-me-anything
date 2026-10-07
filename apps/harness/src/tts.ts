import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import type { TtsResponse, TtsWord } from "@tma/schema";
import { config } from "./env";
import { pcmDurationMs, pcmToWav } from "./wav";

const SAMPLE_RATE = 24000;

type CartesiaMessage =
  | { type: "chunk"; data: string; done?: boolean }
  | { type: "timestamps"; word_timestamps: { words: string[]; start: number[]; end: number[] } }
  | { type: "done" }
  | { type: "error"; message?: string; title?: string; status_code?: number };

/**
 * Cartesia over WebSocket, which is the path that returns word timestamps.
 * One connection per sentence is fine at this stage; a persistent connection
 * with contexts is an optimization for later.
 */
export async function synthesizeCartesia(text: string, voiceId: string): Promise<{ pcm: Buffer; words: TtsWord[] }> {
  const url = `wss://api.cartesia.ai/tts/websocket?cartesia_version=${config.cartesiaVersion}`;
  const ws = new WebSocket(url, { headers: { "X-API-Key": config.cartesiaApiKey } });
  const chunks: Buffer[] = [];
  const words: TtsWord[] = [];

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error("cartesia: timed out after 20s"));
    }, 20_000);
    const finish = (err?: Error) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          model_id: config.cartesiaModel,
          transcript: text,
          voice: { mode: "id", id: voiceId },
          context_id: crypto.randomUUID(),
          output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: SAMPLE_RATE },
          language: "en",
          add_timestamps: true,
        }),
      );
    });
    ws.on("message", (raw) => {
      let msg: CartesiaMessage;
      try {
        msg = JSON.parse(raw.toString()) as CartesiaMessage;
      } catch {
        return;
      }
      if (msg.type === "chunk") {
        if (msg.data) chunks.push(Buffer.from(msg.data, "base64"));
        if (msg.done) {
          ws.close();
          finish();
        }
      } else if (msg.type === "timestamps") {
        const { words: w, start, end } = msg.word_timestamps;
        for (let i = 0; i < w.length; i++) words.push({ text: w[i]!, start: start[i] ?? 0, end: end[i] ?? 0 });
      } else if (msg.type === "done") {
        ws.close();
        finish();
      } else if (msg.type === "error") {
        ws.close();
        finish(new Error(`cartesia: ${msg.title ?? ""} ${msg.message ?? "error"} (${msg.status_code ?? "?"})`));
      }
    });
    ws.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
    ws.on("unexpected-response", (_req, res) => finish(new Error(`cartesia: http ${res.statusCode}`)));
  });

  return { pcm: Buffer.concat(chunks), words };
}

/** A small semaphore: Cartesia plans cap concurrent syntheses, so excess requests wait instead of failing. */
class Gate {
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

const isRateLimit = (err: unknown) => err instanceof Error && /429|rate limit|concurrency/i.test(err.message);

export class TtsService {
  private memory = new Map<string, TtsResponse>();
  private inflight = new Map<string, Promise<TtsResponse>>();
  private readonly diskDir: string;
  private readonly gate: Gate;

  constructor(
    private readonly synth: (text: string, voiceId: string) => Promise<{ pcm: Buffer; words: TtsWord[] }> = synthesizeCartesia,
    diskDir = path.join(config.dataDir, "tts"),
    maxConcurrent = config.cartesiaConcurrency,
  ) {
    this.diskDir = diskDir;
    this.gate = new Gate(maxConcurrent);
    fs.mkdirSync(this.diskDir, { recursive: true });
  }

  private async synthWithRetry(text: string, voiceId: string): Promise<{ pcm: Buffer; words: TtsWord[] }> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.gate.run(() => this.synth(text, voiceId));
      } catch (err) {
        if (!isRateLimit(err) || attempt >= 3) throw err;
        attempt++;
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      }
    }
  }

  get available(): boolean {
    return config.cartesiaApiKey.length > 0;
  }

  private key(text: string, voiceId: string): string {
    return crypto.createHash("sha1").update(`${config.cartesiaModel}|${voiceId}|${text}`).digest("hex");
  }

  async speak(text: string, voiceId = config.cartesiaVoiceId): Promise<TtsResponse> {
    const key = this.key(text, voiceId);
    const hit = this.memory.get(key);
    if (hit) return { ...hit, cached: true, synthMs: 0 };
    const diskPath = path.join(this.diskDir, `${key}.json`);
    if (fs.existsSync(diskPath)) {
      const fromDisk = JSON.parse(fs.readFileSync(diskPath, "utf8")) as TtsResponse;
      this.memory.set(key, fromDisk);
      return { ...fromDisk, cached: true, synthMs: 0 };
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const job = (async () => {
      const started = performance.now();
      const { pcm, words } = await this.synthWithRetry(text, voiceId);
      const response: TtsResponse = {
        mime: "audio/wav",
        audioBase64: pcmToWav(pcm, SAMPLE_RATE).toString("base64"),
        words,
        durationMs: pcmDurationMs(pcm.length, SAMPLE_RATE),
        cached: false,
        synthMs: Math.round(performance.now() - started),
      };
      this.memory.set(key, response);
      fs.writeFile(diskPath, JSON.stringify(response), () => {});
      return response;
    })();
    this.inflight.set(key, job);
    try {
      return await job;
    } finally {
      this.inflight.delete(key);
    }
  }
}
