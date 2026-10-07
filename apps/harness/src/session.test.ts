import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultLessonId } from "@tma/content";
import { ServerMessageSchema, type ServerMessage } from "@tma/schema";
import { Session } from "./session";
import type { TextStreamer } from "./responder";

class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  sent: ServerMessage[] = [];
  send(data: string): void {
    this.sent.push(ServerMessageSchema.parse(JSON.parse(data)));
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tma-session-"));
afterEach(() => {
  for (const f of fs.readdirSync(tmp)) fs.rmSync(path.join(tmp, f));
});

const scriptedStreamer =
  (script: string[]): TextStreamer =>
  async function* () {
    for (const piece of script) yield { kind: "text", text: piece };
    yield { kind: "final", model: "fake", inputTokens: 100, outputTokens: 40, refusal: false };
  };

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Session", () => {
  it("announces itself, then streams header, beats in order, and completion", async () => {
    const sock = new FakeSocket();
    const s = new Session(sock, { streamer: null, tts: { available: false, voiceId: null }, logDir: tmp, beatStaggerMs: 1 });
    expect(sock.sent[0]?.type).toBe("session.ready");
    await s.handle({ type: "session.start", lessonId: defaultLessonId, calibrationAnswer: "Sort of" });
    expect(sock.sent[1]?.type).toBe("lesson.header");
    await new Promise((r) => setTimeout(r, 30));
    const beats = sock.sent.filter((m) => m.type === "lesson.beat");
    expect(beats.map((m) => (m.type === "lesson.beat" ? m.index : -1))).toEqual([0, 1, 2, 3, 4]);
    expect(sock.sent[sock.sent.length - 1]?.type).toBe("lesson.complete");
    s.close();
    expect(fs.readdirSync(tmp).some((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("rejects an unknown lesson and a malformed message", async () => {
    const sock = new FakeSocket();
    const s = new Session(sock, { streamer: null, tts: { available: false, voiceId: null }, logDir: tmp });
    await s.handle({ type: "session.start", lessonId: "nope", calibrationAnswer: null });
    expect(sock.sent[1]).toMatchObject({ type: "error" });
    await s.handleRaw("{not json");
    expect(sock.sent[2]).toMatchObject({ type: "error", message: "unrecognized message" });
    s.close();
  });

  it("streams an ask as partial ops then done, with timing", async () => {
    const sock = new FakeSocket();
    const streamer = scriptedStreamer(["Good question. You could stop at", " pairs, but one is simpler.\n@highlight T[3]\n@resume continue Back to the tree.\n"]);
    const s = new Session(sock, { streamer, tts: { available: false, voiceId: null }, logDir: tmp, beatStaggerMs: 1 });
    await s.handle({ type: "session.start", lessonId: defaultLessonId, calibrationAnswer: null });
    await s.handle({
      type: "ask",
      requestId: "q1",
      text: "why go all the way to one?",
      pointed: null,
      context: {
        beatId: "b2",
        beatTitle: "Split it down",
        currentSentence: "Cut each half in half again.",
        recentSentences: ["Take an unsorted list of eight numbers and cut it in half."],
        boardSummary: ["T: split tree over 8 3 5 1 9 2 7 4, 2 levels revealed"],
        pins: ["Merging is one pass"],
        activeCheck: null,
        calibrationAnswer: "Sort of",
      },
    });
    await tick();
    const partials = sock.sent.filter((m) => m.type === "aside.partial");
    const ops = partials.flatMap((m) => (m.type === "aside.partial" ? m.ops : []));
    expect(ops.map((o) => o.op)).toEqual(["say", "say", "highlight"]);
    expect(ops[0]).toMatchObject({ op: "say", text: "Good question." });
    const done = sock.sent.find((m) => m.type === "aside.done");
    expect(done).toMatchObject({ type: "aside.done", requestId: "q1", resume: { mode: "continue", bridge: "Back to the tree." } });
    if (done?.type === "aside.done") {
      expect(done.timing.model).toBe("fake");
      expect(done.timing.firstOpMs).not.toBeNull();
    }
    s.close();
  });

  it("falls back to a spoken apology when the model returns nothing", async () => {
    const sock = new FakeSocket();
    const streamer: TextStreamer = async function* () {
      yield { kind: "final", model: "fake", inputTokens: 1, outputTokens: 0, refusal: true };
    };
    const s = new Session(sock, { streamer, tts: { available: false, voiceId: null }, logDir: tmp, beatStaggerMs: 1 });
    await s.handle({ type: "session.start", lessonId: defaultLessonId, calibrationAnswer: null });
    await s.handle({
      type: "ask",
      requestId: "q2",
      text: "hm",
      pointed: null,
      context: { beatId: "b1", beatTitle: "x", currentSentence: null, recentSentences: [], boardSummary: [], pins: [], activeCheck: null, calibrationAnswer: null },
    });
    const partial = sock.sent.find((m) => m.type === "aside.partial");
    expect(partial && partial.type === "aside.partial" ? partial.ops[0] : null).toMatchObject({ op: "say" });
    expect(sock.sent.some((m) => m.type === "aside.done")).toBe(true);
    s.close();
  });
});
