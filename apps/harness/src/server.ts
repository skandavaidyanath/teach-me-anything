import http from "node:http";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { WebSocketServer } from "ws";
import { TtsRequestSchema } from "@tma/schema";
import { config } from "./env";
import { makeClaudePlannerStreamer } from "./planner";
import { makeClaudeStreamer } from "./tutor";
import { attachSession } from "./session";
import { TtsService } from "./tts";

const tts = new TtsService();
const anthropic = config.anthropicApiKey ? new Anthropic({ apiKey: config.anthropicApiKey }) : null;
const tutorStreamer = anthropic ? makeClaudeStreamer(anthropic) : null;
const plannerStreamer = anthropic ? makeClaudePlannerStreamer(anthropic) : null;

type VoiceEntry = { id: string; name: string; description: string };
let voicesCache: { at: number; voices: VoiceEntry[] } | null = null;

async function listVoices(): Promise<VoiceEntry[]> {
  if (voicesCache && Date.now() - voicesCache.at < 10 * 60_000) return voicesCache.voices;
  const res = await fetch("https://api.cartesia.ai/voices/?limit=100", {
    headers: { "X-API-Key": config.cartesiaApiKey, "Cartesia-Version": config.cartesiaVersion },
  });
  if (!res.ok) throw new Error(`voices: http ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id: string; name: string; description?: string; language?: string }> };
  const english = (body.data ?? []).filter((v) => !v.language || v.language.startsWith("en"));
  const voices = english.slice(0, 14).map((v) => ({ id: v.id, name: v.name, description: v.description ?? "" }));
  // The default voice leads the list even if the catalog order changes.
  voices.sort((a, b) => (a.id === config.cartesiaVoiceId ? -1 : b.id === config.cartesiaVoiceId ? 1 : 0));
  voicesCache = { at: Date.now(), voices };
  return voices;
}

function cors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin ?? "";
  if (config.allowedOrigins.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    if (url.pathname === "/health") {
      json(res, 200, { ok: true, tts: tts.available, tutor: tutorStreamer !== null, planner: plannerStreamer !== null, tutorModel: config.tutorModel, plannerModel: config.plannerModel });
      return;
    }
    if (url.pathname === "/voices" && req.method === "GET") {
      if (!tts.available) {
        json(res, 200, { voices: [] });
        return;
      }
      json(res, 200, { voices: await listVoices(), defaultVoiceId: config.cartesiaVoiceId });
      return;
    }
    if (url.pathname === "/tts" && req.method === "POST") {
      if (!tts.available) {
        json(res, 503, { error: "tts not configured" });
        return;
      }
      const parsed = TtsRequestSchema.safeParse(JSON.parse(await readBody(req)));
      if (!parsed.success) {
        json(res, 400, { error: "bad request" });
        return;
      }
      const started = performance.now();
      const clip = await tts.speak(parsed.data.text, parsed.data.voiceId, parsed.data.speed);
      res.setHeader("x-tts-ms", String(Math.round(performance.now() - started)));
      json(res, 200, clip);
      return;
    }
    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error(`[harness] ${req.method} ${url.pathname} failed: ${err instanceof Error ? err.message : String(err)}`);
    json(res, 500, { error: err instanceof Error ? err.message : "internal error" });
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  const session = attachSession(ws, {
    tutorStreamer,
    plannerStreamer,
    tts: { available: tts.available, voiceId: tts.available ? config.cartesiaVoiceId : null },
    logDir: path.join(config.dataDir, "sessions"),
  });
  console.log(`[harness] session ${session.id} opened`);
  ws.on("close", () => console.log(`[harness] session ${session.id} closed`));
});

server.listen(config.port, () => {
  console.log(`[harness] listening on http://localhost:${config.port}  ws: /ws  tts: ${tts.available ? "cartesia" : "off"}  tutor: ${tutorStreamer ? config.tutorModel : "off"}  planner: ${plannerStreamer ? config.plannerModel : "off"}`);
});
