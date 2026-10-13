import { z } from "zod";

/**
 * The op schema is the center of the design. Every layer speaks it: the lesson
 * content, the playhead that executes it, and later the Planner, Brancher,
 * Responder, harness relay, and lesson graph store.
 *
 * Zod schemas validate content at runtime; the hand-written TS types next to
 * them exist because the op type is recursive (checks carry reaction ops).
 */

// ---------------------------------------------------------------------------
// Element references
// ---------------------------------------------------------------------------

export const ElementRefSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().nonnegative().optional(),
});
export type ElementRef = z.infer<typeof ElementRefSchema>;

export function sameRef(a: ElementRef, b: ElementRef): boolean {
  return a.id === b.id && (a.index ?? null) === (b.index ?? null);
}

// ---------------------------------------------------------------------------
// Elements: the declarative primitives that live on the stage
// ---------------------------------------------------------------------------

const ElementBase = {
  id: z.string().min(1),
  label: z.string().optional(),
};

export const TextCardSchema = z.object({
  kind: z.literal("text_card"),
  ...ElementBase,
  title: z.string().optional(),
  body: z.string(),
});

export const LatexCardSchema = z.object({
  kind: z.literal("latex"),
  ...ElementBase,
  tex: z.string().min(1),
  caption: z.string().optional(),
});

export const ArrayRowSchema = z.object({
  kind: z.literal("array_row"),
  ...ElementBase,
  values: z.array(z.union([z.number(), z.string()])),
  role: z.enum(["input", "output"]).optional(),
  /** Runtime identity per cell so a value keeps its identity when it moves between rows. Authors omit this. */
  cellIds: z.array(z.string()).optional(),
});

/**
 * A recursive halving tree over `values`. The component derives the tree.
 * `revealDepth` is how many levels of splitting are visible (0 = root only).
 * `sortedFromDepth` marks levels at or below which nodes display sorted,
 * which is how merge-up is shown. `showWork` annotates each level with the
 * number of elements touched.
 */
export const SplitTreeSchema = z.object({
  kind: z.literal("split_tree"),
  ...ElementBase,
  values: z.array(z.number()).min(1),
  revealDepth: z.number().int().nonnegative(),
  sortedFromDepth: z.number().int().nonnegative().optional(),
  showWork: z.boolean().optional(),
});

/**
 * A small declarative 2D diagram. Items are positioned in scene coordinates
 * and keyed by id so they can move smoothly between updates. Highlight and
 * click targets address items by index.
 */
const SceneItemBase = { id: z.string().min(1), label: z.string().optional() };
export const SceneItemSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("circle"), ...SceneItemBase, cx: z.number(), cy: z.number(), r: z.number().positive(), dashed: z.boolean().optional() }),
  z.object({ type: z.literal("dot"), ...SceneItemBase, cx: z.number(), cy: z.number(), r: z.number().positive().optional() }),
  z.object({
    type: z.literal("arrow"),
    ...SceneItemBase,
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    role: z.enum(["force", "velocity", "fictitious", "neutral"]).optional(),
  }),
  z.object({ type: z.literal("line"), ...SceneItemBase, x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), dashed: z.boolean().optional() }),
  z.object({ type: z.literal("path"), ...SceneItemBase, d: z.string().min(1), dashed: z.boolean().optional() }),
  z.object({ type: z.literal("text"), ...SceneItemBase, x: z.number(), y: z.number(), text: z.string(), size: z.number().optional() }),
]);
export type SceneItem = z.infer<typeof SceneItemSchema>;

export const SceneSchema = z.object({
  kind: z.literal("scene"),
  ...ElementBase,
  width: z.number().positive(),
  height: z.number().positive(),
  items: z.array(SceneItemSchema),
  caption: z.string().optional(),
});

/** A stack of equations revealed one line at a time. Highlight targets address lines by index. */
export const DerivationSchema = z.object({
  kind: z.literal("derivation"),
  ...ElementBase,
  steps: z.array(z.object({ tex: z.string().min(1), note: z.string().optional() })).min(1),
  revealed: z.number().int().nonnegative(),
  focus: z.number().int().nonnegative().optional(),
});

/**
 * A figure written as code: the body of an HTML page (markup, a <style>, a
 * <script>) that runs in a sandboxed frame on the board. It renders from
 * `state`, which `update` ops patch with {"state": {...}}; the frame learns
 * of every change through window.tma. `parts` names the elements inside it
 * that highlight and click checks address, as ID[index] in that order.
 */
export const ComponentSchema = z.object({
  kind: z.literal("component"),
  ...ElementBase,
  title: z.string().optional(),
  width: z.number().positive(),
  height: z.number().positive(),
  code: z.string().min(1),
  state: z.record(z.string(), z.unknown()).optional(),
  /** What each state field means and what it may be set to, for the Tutor. */
  stateDoc: z.string().optional(),
  parts: z.array(z.string()).optional(),
  caption: z.string().optional(),
});

export const ElementSchema = z.discriminatedUnion("kind", [
  TextCardSchema,
  LatexCardSchema,
  ArrayRowSchema,
  SplitTreeSchema,
  SceneSchema,
  DerivationSchema,
  ComponentSchema,
]);
export type Element = z.infer<typeof ElementSchema>;
export type TextCard = z.infer<typeof TextCardSchema>;
export type LatexCard = z.infer<typeof LatexCardSchema>;
export type ArrayRow = z.infer<typeof ArrayRowSchema>;
export type SplitTree = z.infer<typeof SplitTreeSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Derivation = z.infer<typeof DerivationSchema>;
export type Component = z.infer<typeof ComponentSchema>;

// ---------------------------------------------------------------------------
// Pins: what accumulates in the rail
// ---------------------------------------------------------------------------

export const PinKindSchema = z.enum(["takeaway", "definition", "equation", "code"]);
export type PinKind = z.infer<typeof PinKindSchema>;

export const PinSchema = z.object({
  pinId: z.string().min(1),
  kind: PinKindSchema,
  title: z.string().optional(),
  text: z.string().optional(),
  tex: z.string().optional(),
});
export type Pin = z.infer<typeof PinSchema>;

// ---------------------------------------------------------------------------
// Ops
// ---------------------------------------------------------------------------

export const HighlightToneSchema = z.enum(["marker", "correct", "incorrect"]);
export type HighlightTone = z.infer<typeof HighlightToneSchema>;

export const CheckKindSchema = z.enum(["choice", "click_cell", "free_text"]);
export type CheckKind = z.infer<typeof CheckKindSchema>;

/** How a sentence is spoken. `key` marks the one sentence in a beat that carries the idea: spoken slowly, followed by a short silence, set apart in the caption. */
export type Pace = "slow" | "quick";
export type SayOp = { op: "say"; id: string; text: string; pace?: Pace; key?: boolean };
export type ShowOp = { op: "show"; id: string; element: Element };
export type UpdateOp = { op: "update"; id: string; target: string; patch: Record<string, unknown> };
/** Move one cell of an array row into another row (or another position). The cell keeps its identity, so it animates. */
export type MoveOp = { op: "move"; id: string; from: ElementRef; to: { id: string; index?: number } };
export type HighlightOp = { op: "highlight"; id: string; targets: ElementRef[]; tone?: HighlightTone };
export type ClearHighlightsOp = { op: "clear_highlights"; id: string };
export type ClearOp = { op: "clear"; id: string; targets?: string[] };
export type PinOp = { op: "pin"; id: string; pin: Pin };
export type PauseOp = { op: "pause"; id: string; ms: number };
export type CheckOp = {
  op: "check";
  id: string;
  kind: CheckKind;
  prompt: string;
  /** choice: the chips to show */
  options?: string[];
  /** click_cell: the cells that are clickable */
  targets?: ElementRef[];
  /** choice / free_text: accepted answers (normalized). click_cell: the expected cell. */
  expected?: string[] | ElementRef;
  /** false for prompts with no right answer, like "want to go deeper?" */
  graded?: boolean;
  onCorrect?: Op[];
  onIncorrect?: Op[];
};

export type Op =
  | SayOp
  | ShowOp
  | UpdateOp
  | MoveOp
  | HighlightOp
  | ClearHighlightsOp
  | ClearOp
  | PinOp
  | PauseOp
  | CheckOp;

const OpBase = { id: z.string().min(1) };

export const PaceSchema = z.enum(["slow", "quick"]);
const SayOpSchema = z.object({ op: z.literal("say"), ...OpBase, text: z.string().min(1), pace: PaceSchema.optional(), key: z.boolean().optional() });
const ShowOpSchema = z.object({ op: z.literal("show"), ...OpBase, element: ElementSchema });
const UpdateOpSchema = z.object({
  op: z.literal("update"),
  ...OpBase,
  target: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});
const MoveOpSchema = z.object({
  op: z.literal("move"),
  ...OpBase,
  from: ElementRefSchema,
  to: z.object({ id: z.string().min(1), index: z.number().int().nonnegative().optional() }),
});
const HighlightOpSchema = z.object({
  op: z.literal("highlight"),
  ...OpBase,
  targets: z.array(ElementRefSchema).min(1),
  tone: HighlightToneSchema.optional(),
});
const ClearHighlightsOpSchema = z.object({ op: z.literal("clear_highlights"), ...OpBase });
const ClearOpSchema = z.object({ op: z.literal("clear"), ...OpBase, targets: z.array(z.string()).optional() });
const PinOpSchema = z.object({ op: z.literal("pin"), ...OpBase, pin: PinSchema });
const PauseOpSchema = z.object({ op: z.literal("pause"), ...OpBase, ms: z.number().int().positive() });

// Declared before CheckOpSchema so the recursive reference resolves lazily.
export const OpSchema: z.ZodType<Op> = z.lazy(() =>
  z.discriminatedUnion("op", [
    SayOpSchema,
    ShowOpSchema,
    UpdateOpSchema,
    MoveOpSchema,
    HighlightOpSchema,
    ClearHighlightsOpSchema,
    ClearOpSchema,
    PinOpSchema,
    PauseOpSchema,
    CheckOpSchema,
  ]),
);

const CheckOpSchema = z.object({
  op: z.literal("check"),
  ...OpBase,
  kind: CheckKindSchema,
  prompt: z.string().min(1),
  options: z.array(z.string()).optional(),
  targets: z.array(ElementRefSchema).optional(),
  expected: z.union([z.array(z.string()), ElementRefSchema]).optional(),
  graded: z.boolean().optional(),
  onCorrect: z.array(OpSchema).optional(),
  onIncorrect: z.array(OpSchema).optional(),
});

// ---------------------------------------------------------------------------
// Lesson structure
// ---------------------------------------------------------------------------

export const ResumeModeSchema = z.enum(["continue", "rewind", "skip"]);
export type ResumeMode = z.infer<typeof ResumeModeSchema>;

export const ResumeSchema = z.object({
  mode: ResumeModeSchema,
  /** One short spoken sentence that bridges back into the lesson. */
  bridge: z.string().optional(),
});
export type Resume = z.infer<typeof ResumeSchema>;

export const BeatSchema = z.object({
  id: z.string().min(1),
  /** Short title for the outline strip. */
  title: z.string().min(1),
  /** One sentence of what this beat teaches, so the Responder can place a question in the lesson. */
  summary: z.string().optional(),
  ops: z.array(OpSchema).min(1),
});
export type Beat = z.infer<typeof BeatSchema>;

/**
 * A branch is a pre-authored response to something the learner might say.
 * In v0.0 matching is local: regex patterns over the input text, optional
 * pointed element or pin ids, optional restriction to certain beats.
 */
export const BranchSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  match: z.object({
    patterns: z.array(z.string()).min(1),
    pointed: z.array(z.string()).optional(),
    beats: z.array(z.string()).optional(),
  }),
  ops: z.array(OpSchema).min(1),
  resume: ResumeSchema,
  /** Keep elements the branch showed on stage after resuming. Default false. */
  keepStage: z.boolean().optional(),
});
export type Branch = z.infer<typeof BranchSchema>;

export const CalibrationSchema = z.object({
  prompt: z.string().min(1),
  options: z.array(z.string().min(1)).min(2),
});
export type Calibration = z.infer<typeof CalibrationSchema>;

export const LessonSchema = z.object({
  id: z.string().min(1),
  topic: z.string().min(1),
  title: z.string().min(1),
  calibration: CalibrationSchema.optional(),
  beats: z.array(BeatSchema).min(1),
  branches: z.array(BranchSchema),
  /** Played when no branch matches. In v0.0 this is a placeholder for the Responder. */
  fallback: z.object({ ops: z.array(OpSchema).min(1), resume: ResumeSchema }),
});
export type Lesson = z.infer<typeof LessonSchema>;

// ---------------------------------------------------------------------------
// Navigation commands: resolved on the client, never sent to a model
// ---------------------------------------------------------------------------

export const NavCommandSchema = z.enum(["pause", "resume", "back", "repeat", "skip", "restart"]);
export type NavCommand = z.infer<typeof NavCommandSchema>;

// ---------------------------------------------------------------------------
// Validation beyond the schema
// ---------------------------------------------------------------------------

export type LessonIssue = { path: string; message: string };

export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/[.,!?;:]+$/g, "").replace(/\s+/g, " ");
}

function walkOps(ops: Op[], visit: (op: Op, path: string) => void, path: string): void {
  ops.forEach((op, i) => {
    const here = `${path}[${i}]`;
    visit(op, here);
    if (op.op === "check") {
      walkOps(op.onCorrect ?? [], visit, `${here}.onCorrect`);
      walkOps(op.onIncorrect ?? [], visit, `${here}.onIncorrect`);
    }
  });
}

/**
 * Parse and then enforce the structural rules the schema alone cannot:
 * unique ids, every beat ends in a check, update and highlight targets refer
 * to elements the lesson shows somewhere, branch patterns compile.
 */
export function validateLesson(input: unknown): { lesson: Lesson | null; issues: LessonIssue[] } {
  const parsed = LessonSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((iss) => ({
      path: iss.path.map(String).join("."),
      message: iss.message,
    }));
    return { lesson: null, issues };
  }
  const lesson = parsed.data;
  const issues: LessonIssue[] = [];

  const shownElementIds = new Set<string>();
  const pinIds = new Set<string>();
  const allOpGroups: Array<{ ops: Op[]; path: string }> = [
    ...lesson.beats.map((b, i) => ({ ops: b.ops, path: `beats[${i}].ops` })),
    ...lesson.branches.map((b, i) => ({ ops: b.ops, path: `branches[${i}].ops` })),
    { ops: lesson.fallback.ops, path: "fallback.ops" },
  ];

  for (const group of allOpGroups) {
    walkOps(
      group.ops,
      (op) => {
        if (op.op === "show") shownElementIds.add(op.element.id);
        if (op.op === "pin") pinIds.add(op.pin.pinId);
      },
      group.path,
    );
  }

  const seenOpIds = new Map<string, string>();
  for (const group of allOpGroups) {
    walkOps(
      group.ops,
      (op, path) => {
        const prior = seenOpIds.get(op.id);
        if (prior) issues.push({ path, message: `duplicate op id "${op.id}" (also at ${prior})` });
        seenOpIds.set(op.id, path);

        if (op.op === "update" && !shownElementIds.has(op.target)) {
          issues.push({ path, message: `update targets unknown element "${op.target}"` });
        }
        if (op.op === "move") {
          if (!shownElementIds.has(op.from.id)) issues.push({ path, message: `move from unknown element "${op.from.id}"` });
          if (!shownElementIds.has(op.to.id)) issues.push({ path, message: `move to unknown element "${op.to.id}"` });
          if (op.from.index === undefined) issues.push({ path, message: "move needs from.index" });
        }
        if (op.op === "highlight") {
          for (const t of op.targets) {
            if (!shownElementIds.has(t.id) && !pinIds.has(t.id)) {
              issues.push({ path, message: `highlight targets unknown element or pin "${t.id}"` });
            }
          }
        }
        if (op.op === "check") {
          const graded = op.graded ?? true;
          if (graded && op.expected === undefined) {
            issues.push({ path, message: "graded check has no expected answer" });
          }
          if (op.kind === "choice" && (!op.options || op.options.length < 2)) {
            issues.push({ path, message: "choice check needs at least two options" });
          }
          if (op.kind === "click_cell" && (!op.targets || op.targets.length === 0)) {
            issues.push({ path, message: "click_cell check needs targets" });
          }
        }
      },
      group.path,
    );
  }

  lesson.beats.forEach((beat, i) => {
    const last = beat.ops[beat.ops.length - 1];
    if (!last || last.op !== "check") {
      issues.push({ path: `beats[${i}]`, message: `beat "${beat.id}" must end in a check` });
    }
    const checksAtTop = beat.ops.filter((op) => op.op === "check").length;
    if (checksAtTop > 1) {
      issues.push({ path: `beats[${i}]`, message: `beat "${beat.id}" has ${checksAtTop} checks; one idea, one check` });
    }
  });

  const beatIds = new Set(lesson.beats.map((b) => b.id));
  if (beatIds.size !== lesson.beats.length) issues.push({ path: "beats", message: "beat ids must be unique" });

  lesson.branches.forEach((branch, i) => {
    for (const p of branch.match.patterns) {
      try {
        new RegExp(p, "i");
      } catch {
        issues.push({ path: `branches[${i}].match.patterns`, message: `invalid regex: ${p}` });
      }
    }
    for (const b of branch.match.beats ?? []) {
      if (!beatIds.has(b)) issues.push({ path: `branches[${i}].match.beats`, message: `unknown beat "${b}"` });
    }
  });

  return { lesson, issues };
}
