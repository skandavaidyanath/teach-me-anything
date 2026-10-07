import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");

// Repo-root .env first (where keys live), then the app's own .env for overrides.
dotenv.config({ path: path.join(repoRoot, ".env") });
dotenv.config({ path: path.join(here, "..", ".env"), override: true });

export const config = {
  port: Number(process.env["HARNESS_PORT"] ?? 3210),
  anthropicApiKey: process.env["ANTHROPIC_API_KEY"] ?? "",
  cartesiaApiKey: process.env["CARTESIA_API_KEY"] ?? "",
  cartesiaVersion: "2026-08-14",
  cartesiaModel: process.env["CARTESIA_MODEL_ID"] ?? "sonic-3.6",
  // Cartesia's starter plans allow two concurrent syntheses; excess requests queue rather than fail.
  cartesiaConcurrency: Number(process.env["CARTESIA_CONCURRENCY"] ?? 2),
  // Clive: "composed and articulate, perfect for delivering education".
  cartesiaVoiceId: process.env["CARTESIA_VOICE_ID"] ?? "b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1",
  tutorModel: process.env["TUTOR_MODEL"] ?? "claude-opus-5-5",
  plannerModel: process.env["PLANNER_MODEL"] ?? "claude-opus-5-5",
  dataDir: path.join(repoRoot, "data", "local"),
  allowedOrigins: (process.env["HARNESS_ALLOWED_ORIGINS"] ?? "http://localhost:3000,http://127.0.0.1:3000").split(","),
};
