import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultLessonId } from "@tma/content";
import { ServerMessageSchema, type ServerMessage, type TutorContext, type TutorWindow } from "@tma/schema";
import { Session } from "./session";
import type { TextStreamer } from "./tutor";
import type { PlannerStreamer } from "./planner";

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

const tutorScript =
  (script: string): TextStreamer =>
  async function* () {
    for (const piece of script.match(/.{1,30}/gs) ?? []) yield { kind: "text", text: piece };
    yield { kind: "final", model: "fake", inputTokens: 100, outputTokens: 40, refusal: false };
  };

const context: TutorContext = {
  beatId: "b1",
  beatTitle: "The merge trick",
  outline: [{ id: "b1", title: "The merge trick", status: "current" }, { id: "b2", title: "Split it down", status: "upcoming" }],
  record: [],
  recentSentences: [],
  currentSentence: null,
  boardSummary: [],
  pins: [],
  activeCheck: null,
};
const window: TutorWindow = {
  currentBeatId: "b1",
  current: [{ op: "say", id: "b1.s6", text: "Every step looks at two elements." }, { op: "check", id: "b1.k1", kind: "choice", prompt: "?", options: ["a", "b"], expected: ["a"] }],
  nextBeatId: "b2",
  nextPrefix: [{ op: "say", id: "b2.s1", text: "So where do sorted lists come from?" }],
};

const noDeps = { tutorStreamer: null, plannerStreamer: null, tts: { available: false, voiceId: null }, logDir: tmp, beatStaggerMs: 1 };

describe("Session with a bundled lesson", () => {
  it("streams header, beats in order, and completion", async () => {
    const sock = new FakeSocket();
    const s = new Session(sock, noDeps);
    expect(sock.sent[0]?.type).toBe("session.ready");
    await s.handle({ type: "session.start", lessonId: defaultLessonId, topic: null, calibrationAnswer: null });
    expect(sock.sent[1]).toMatchObject({ type: "lesson.header", source: "bundled" });
    await new Promise((r) => setTimeout(r, 30));
    const beats = sock.sent.filter((m) => m.type === "lesson.beat");
    expect(beats.map((m) => (m.type === "lesson.beat" ? m.index : -1))).toEqual([0, 1, 2, 3, 4]);
    expect(sock.sent[sock.sent.length - 1]?.type).toBe("lesson.complete");
    s.close();
    expect(fs.readdirSync(tmp).some((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("rejects an unknown lesson and a malformed message", async () => {
    const sock = new FakeSocket();
    const s = new Session(sock, noDeps);
    await s.handle({ type: "session.start", lessonId: "nope", topic: null, calibrationAnswer: null });
    expect(sock.sent[1]).toMatchObject({ type: "error" });
    await s.handleRaw("{not json");
    expect(sock.sent[2]).toMatchObject({ type: "error", message: "unrecognized message" });
    s.close();
  });

  it("answers a question: streamed answer ops, then the edited window, and records it", async () => {
    const sock = new FakeSocket();
    const tutorStreamer = tutorScript("That is coming up. Short version: we split in half.\nkeep 1\nkeep 2\nHere is the splitting you asked about.\n");
    const s = new Session(sock, { ...noDeps, tutorStreamer });
    await s.handle({ type: "session.start", lessonId: defaultLessonId, topic: null, calibrationAnswer: null });
    await s.handle({ type: "tutor.ask", requestId: "q1", text: "how do we get two sorted lists?", pointed: null, context, window });
    const answers = sock.sent.filter((m) => m.type === "tutor.answer").flatMap((m) => (m.type === "tutor.answer" ? m.ops : []));
    expect(answers.map((o) => (o.op === "say" ? o.text : o.op))).toEqual(["That is coming up.", "Short version: we split in half."]);
    const done = sock.sent.find((m) => m.type === "tutor.done");
    expect(done).toMatchObject({ type: "tutor.done", requestId: "q1", replan: null });
    if (done?.type === "tutor.done") {
      expect(done.current.map((o) => o.id)).toEqual(["b1.s6", "b1.k1"]);
      expect(done.nextPrefix?.map((o) => (o.op === "say" ? o.text : o.op))).toEqual(["Here is the splitting you asked about."]);
      expect(done.timing.fellBack).toBe(false);
    }
    s.close();
  });

  it("surfaces tutor failures as tutor.error", async () => {
    const sock = new FakeSocket();
    const failing: TextStreamer = async function* () {
      throw new Error("boom");
    };
    const s = new Session(sock, { ...noDeps, tutorStreamer: failing });
    await s.handle({ type: "session.start", lessonId: defaultLessonId, topic: null, calibrationAnswer: null });
    await s.handle({ type: "tutor.review", requestId: "r1", context, window });
    expect(sock.sent.some((m) => m.type === "tutor.error" && m.message === "boom")).toBe(true);
    s.close();
  });
});

describe("Session with the Planner", () => {
  const block = (type: string, body: unknown) => `===${type}===\n${JSON.stringify(body)}\n===END===\n`;
  const header = { topic: "x", title: "X", calibration: { prompt: "?", options: ["a", "b"] }, outline: [{ id: "b1", title: "One", summary: "s1" }, { id: "b2", title: "Two", summary: "s2" }] };
  const beat = (id: string) => ({ id, title: id, summary: "s", ops: [{ op: "say", id: `${id}.s1`, text: "Hi." }, { op: "check", id: `${id}.k1`, kind: "choice", prompt: "?", options: ["a", "b"], graded: false }] });
  const planner: PlannerStreamer = async function* (_s, _u, effort) {
    const text = effort === "low" ? block("HEADER", header) + block("BEAT", beat("b1")) : block("BEAT", beat("b2"));
    for (const piece of text.match(/.{1,50}/gs) ?? []) yield { kind: "text", text: piece };
    yield { kind: "final", model: "fake", inputTokens: 1, outputTokens: 1, refusal: false };
  };

  it("writes a lesson for a topic and streams it", async () => {
    const sock = new FakeSocket();
    const s = new Session(sock, { ...noDeps, plannerStreamer: planner });
    await s.handle({ type: "session.start", lessonId: null, topic: "x", calibrationAnswer: null });
    expect(sock.sent.map((m) => m.type)).toEqual(["session.ready", "lesson.header", "lesson.beat", "lesson.beat", "lesson.complete"]);
    expect(sock.sent[1]).toMatchObject({ type: "lesson.header", source: "planner" });
    s.close();
  });

  it("reports a missing planner", async () => {
    const sock = new FakeSocket();
    const s = new Session(sock, noDeps);
    await s.handle({ type: "session.start", lessonId: null, topic: "x", calibrationAnswer: null });
    expect(sock.sent[1]).toMatchObject({ type: "lesson.error" });
    s.close();
  });
});
