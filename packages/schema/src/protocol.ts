import { z } from "zod";
import { BeatSchema, BranchSchema, CalibrationSchema, OpSchema, ResumeSchema, type Lesson } from "./core";

/**
 * The wire protocol between the client runtime and the harness. The header
 * arrives first and carries everything the client needs to lay out the lesson
 * and route interrupts locally; beats stream in afterwards, one message each,
 * which is the shape a live Planner will produce.
 */

export const OutlineEntrySchema = z.object({ id: z.string(), title: z.string(), summary: z.string().optional() });
export type OutlineEntry = z.infer<typeof OutlineEntrySchema>;

export const LessonStyleSchema = z.enum(["demo", "write-along"]);
export type LessonStyle = z.infer<typeof LessonStyleSchema>;

export const LessonHeaderSchema = z.object({
  id: z.string(),
  topic: z.string(),
  title: z.string(),
  /** Which of the two teaching modes the planner chose; see apps/harness/prompts/style.md. */
  style: LessonStyleSchema.optional(),
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
    outline: lesson.beats.map((b) => ({ id: b.id, title: b.title, ...(b.summary ? { summary: b.summary } : {}) })),
    branches: lesson.branches,
    fallback: lesson.fallback,
  };
}

/** The lesson's shape and the record of what happened, rendered for the Tutor. */
export const OutlineStatusSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  status: z.enum(["done", "current", "upcoming"]),
});

export const RecordEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("calibration"), answer: z.string() }),
  z.object({ kind: z.literal("asked"), beatId: z.string(), text: z.string(), answered: z.string().nullable() }),
  z.object({ kind: z.literal("check"), beatId: z.string(), prompt: z.string(), answer: z.string(), correct: z.boolean() }),
  z.object({ kind: z.literal("skipped"), beatId: z.string() }),
  z.object({ kind: z.literal("jumped"), toBeatId: z.string() }),
]);
export type RecordEntry = z.infer<typeof RecordEntrySchema>;

export const TutorContextSchema = z.object({
  beatId: z.string(),
  beatTitle: z.string(),
  outline: z.array(OutlineStatusSchema),
  record: z.array(RecordEntrySchema),
  recentSentences: z.array(z.string()),
  currentSentence: z.string().nullable(),
  boardSummary: z.array(z.string()),
  pins: z.array(z.string()),
  activeCheck: z.string().nullable(),
});
export type TutorContext = z.infer<typeof TutorContextSchema>;

/**
 * The pending script the Tutor may edit: the rest of the current beat and
 * the opening of the next. Board ops in it are anchors and must be kept in
 * order; say ops are reference wording.
 */
export const TutorWindowSchema = z.object({
  currentBeatId: z.string(),
  current: z.array(OpSchema),
  nextBeatId: z.string().nullable(),
  nextPrefix: z.array(OpSchema),
});
export type TutorWindow = z.infer<typeof TutorWindowSchema>;

export const PlayheadEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("lesson_started"), calibrationAnswer: z.string().nullable() }),
  z.object({ kind: z.literal("beat_started"), beatId: z.string(), index: z.number() }),
  z.object({ kind: z.literal("check_answered"), checkId: z.string(), answer: z.string(), correct: z.boolean() }),
  z.object({ kind: z.literal("interrupt"), mode: z.enum(["soft", "hard"]), beatId: z.string(), opId: z.string().nullable() }),
  z.object({ kind: z.literal("nav"), command: z.string() }),
  z.object({ kind: z.literal("branch_played"), branchId: z.string(), text: z.string() }),
  z.object({ kind: z.literal("lesson_finished") }),
]);
export type PlayheadEvent = z.infer<typeof PlayheadEventSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("session.start"),
    /** A bundled lesson id, or null to have the Planner write one for `topic`. */
    lessonId: z.string().nullable(),
    topic: z.string().nullable(),
    calibrationAnswer: z.string().nullable(),
  }),
  z.object({ type: z.literal("event"), at: z.number(), event: PlayheadEventSchema }),
  z.object({
    type: z.literal("tutor.ask"),
    requestId: z.string(),
    text: z.string().min(1),
    pointed: z.string().nullable(),
    context: TutorContextSchema,
    window: TutorWindowSchema,
  }),
  z.object({
    type: z.literal("tutor.review"),
    requestId: z.string(),
    context: TutorContextSchema,
    window: TutorWindowSchema,
  }),
  z.object({ type: z.literal("ping"), t: z.number() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const TutorTimingSchema = z.object({
  requestReceivedAt: z.number(),
  firstTokenMs: z.number().nullable(),
  firstOpMs: z.number().nullable(),
  doneMs: z.number(),
  model: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  /** The edit was rejected and the original script kept. */
  fellBack: z.boolean(),
});
export type TutorTiming = z.infer<typeof TutorTimingSchema>;

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("session.ready"), sessionId: z.string(), tts: z.object({ available: z.boolean(), voiceId: z.string().nullable() }) }),
  z.object({ type: z.literal("lesson.header"), header: LessonHeaderSchema, source: z.enum(["bundled", "planner"]) }),
  z.object({ type: z.literal("lesson.beat"), index: z.number(), beat: BeatSchema }),
  /** Replan: beats from `fromIndex` on are replaced; the outline is replaced from that index too. */
  z.object({ type: z.literal("lesson.replace"), fromIndex: z.number(), outline: z.array(OutlineEntrySchema), reason: z.string() }),
  z.object({ type: z.literal("lesson.complete") }),
  z.object({ type: z.literal("lesson.error"), message: z.string() }),
  /** Answer sentences and drawings, streamed as they complete. Played ahead of the pending script. */
  z.object({ type: z.literal("tutor.answer"), requestId: z.string(), ops: z.array(OpSchema) }),
  /** The edited window. `current` replaces the pending ops of the current beat; `nextPrefix` replaces the opening of the next beat. */
  z.object({
    type: z.literal("tutor.done"),
    requestId: z.string(),
    current: z.array(OpSchema),
    nextPrefix: z.array(OpSchema).nullable(),
    timing: TutorTimingSchema,
    replan: z.object({ fromBeatId: z.string(), reason: z.string() }).nullable(),
  }),
  z.object({ type: z.literal("tutor.error"), requestId: z.string(), message: z.string() }),
  z.object({ type: z.literal("pong"), t: z.number(), serverTime: z.number() }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

/** `speed` is Cartesia's generation_config.speed: 0.6 to 1.5, 1 is normal; the model treats it as guidance. */
export const TtsRequestSchema = z.object({ text: z.string().min(1), voiceId: z.string().optional(), speed: z.number().min(0.6).max(1.5).optional() });
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
