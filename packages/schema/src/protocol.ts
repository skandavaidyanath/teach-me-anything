import { z } from "zod";
import { BeatSchema, BranchSchema, CalibrationSchema, OpSchema, ResumeSchema, type Lesson } from "./core";

/**
 * The wire protocol between the client runtime and the harness. The header
 * arrives first and carries everything the client needs to lay out the lesson
 * and route interrupts locally; beats stream in afterwards, one message each,
 * which is the shape a live Planner will produce.
 */

export const OutlineEntrySchema = z.object({ id: z.string(), title: z.string() });

export const LessonHeaderSchema = z.object({
  id: z.string(),
  topic: z.string(),
  title: z.string(),
  calibration: CalibrationSchema.optional(),
  outline: z.array(OutlineEntrySchema).min(1),
  branches: z.array(BranchSchema),
  fallback: z.object({ ops: z.array(OpSchema).min(1), resume: ResumeSchema }),
});
export type LessonHeader = z.infer<typeof LessonHeaderSchema>;

export function headerFromLesson(lesson: Lesson): LessonHeader {
  return {
    id: lesson.id,
    topic: lesson.topic,
    title: lesson.title,
    ...(lesson.calibration ? { calibration: lesson.calibration } : {}),
    outline: lesson.beats.map((b) => ({ id: b.id, title: b.title })),
    branches: lesson.branches,
    fallback: lesson.fallback,
  };
}

/** What the client knows at the moment of a question; the Responder grounds its answer in it. */
export const AskContextSchema = z.object({
  beatId: z.string(),
  beatTitle: z.string(),
  currentSentence: z.string().nullable(),
  recentSentences: z.array(z.string()),
  boardSummary: z.array(z.string()),
  pins: z.array(z.string()),
  activeCheck: z.string().nullable(),
  calibrationAnswer: z.string().nullable(),
});
export type AskContext = z.infer<typeof AskContextSchema>;

export const PlayheadEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lesson_started"), calibrationAnswer: z.string().nullable() }),
  z.object({ kind: z.literal("beat_started"), beatId: z.string(), index: z.number() }),
  z.object({ kind: z.literal("check_answered"), checkId: z.string(), answer: z.string(), correct: z.boolean() }),
  z.object({ kind: z.literal("interrupt"), mode: z.enum(["soft", "hard"]), beatId: z.string(), opId: z.string().nullable() }),
  z.object({ kind: z.literal("nav"), command: z.string() }),
  z.object({ kind: z.literal("aside_started"), source: z.enum(["branch", "fallback", "remote"]), title: z.string(), text: z.string() }),
  z.object({ kind: z.literal("aside_finished"), resume: z.string() }),
  z.object({ kind: z.literal("lesson_finished") }),
]);
export type PlayheadEvent = z.infer<typeof PlayheadEventSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.start"),
    lessonId: z.string(),
    calibrationAnswer: z.string().nullable(),
  }),
  z.object({ type: z.literal("event"), at: z.number(), event: PlayheadEventSchema }),
  z.object({
    type: z.literal("ask"),
    requestId: z.string(),
    text: z.string().min(1),
    pointed: z.string().nullable(),
    context: AskContextSchema,
  }),
  z.object({ type: z.literal("ping"), t: z.number() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const AsideTimingSchema = z.object({
  requestReceivedAt: z.number(),
  firstTokenMs: z.number().nullable(),
  firstOpMs: z.number().nullable(),
  doneMs: z.number(),
  model: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
});
export type AsideTiming = z.infer<typeof AsideTimingSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.ready"), sessionId: z.string(), tts: z.object({ available: z.boolean(), voiceId: z.string().nullable() }) }),
  z.object({ type: z.literal("lesson.header"), header: LessonHeaderSchema }),
  z.object({ type: z.literal("lesson.beat"), index: z.number(), beat: BeatSchema }),
  z.object({ type: z.literal("lesson.complete") }),
  z.object({ type: z.literal("aside.partial"), requestId: z.string(), ops: z.array(OpSchema) }),
  z.object({ type: z.literal("aside.done"), requestId: z.string(), resume: ResumeSchema, timing: AsideTimingSchema }),
  z.object({ type: z.literal("aside.error"), requestId: z.string(), message: z.string() }),
  z.object({ type: z.literal("pong"), t: z.number(), serverTime: z.number() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export const TtsRequestSchema = z.object({ text: z.string().min(1), voiceId: z.string().optional() });
export const TtsWordSchema = z.object({ text: z.string(), start: z.number(), end: z.number() });
export const TtsResponseSchema = z.object({
  mime: z.string(),
  audioBase64: z.string(),
  words: z.array(TtsWordSchema),
  durationMs: z.number(),
  cached: z.boolean(),
  synthMs: z.number(),
});
export type TtsResponse = z.infer<typeof TtsResponseSchema>;
export type TtsWord = z.infer<typeof TtsWordSchema>;
