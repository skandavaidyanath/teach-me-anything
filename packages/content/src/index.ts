import type { Lesson } from "@tma/schema";
import { mergeSortLesson } from "./merge-sort";

export { mergeSortLesson };

/** Hand-written lessons available until the Planner writes them live. */
export const lessons: Record<string, Lesson> = {
  [mergeSortLesson.id]: mergeSortLesson,
};

export const defaultLessonId = mergeSortLesson.id;

export function getLesson(id: string): Lesson | null {
  return lessons[id] ?? null;
}
