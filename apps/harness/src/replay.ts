import fs from "node:fs";
import path from "node:path";

/**
 * One JSONL file per session: every message in and out, every model and TTS
 * call with its timing. This is the event log the Observer and the
 * measurement work will read later.
 */
export class ReplayLog {
  private readonly file: string;
  private stream: fs.WriteStream | null = null;

  constructor(dir: string, sessionId: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${sessionId}.jsonl`);
  }

  get path(): string {
    return this.file;
  }

  write(kind: string, data: unknown): void {
    if (!this.stream) this.stream = fs.createWriteStream(this.file, { flags: "a" });
    this.stream.write(JSON.stringify({ t: Date.now(), kind, data }) + "\n");
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}
