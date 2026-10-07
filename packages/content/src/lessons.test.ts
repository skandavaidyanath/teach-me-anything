import { describe, expect, it } from "vitest";
import { validateLesson } from "@tma/schema";
import { lessons } from "./index";

describe("every bundled lesson", () => {
  for (const [id, lesson] of Object.entries(lessons)) {
    it(`${id} validates with no issues`, () => {
      const { lesson: parsed, issues } = validateLesson(lesson);
      expect(issues).toEqual([]);
      expect(parsed).not.toBeNull();
    });

    it(`${id} has a summary on every beat and one check per beat`, () => {
      for (const beat of lesson.beats) {
        expect(beat.summary, `${beat.id} summary`).toBeTruthy();
        expect(beat.ops.filter((op) => op.op === "check")).toHaveLength(1);
      }
    });
  }
});
