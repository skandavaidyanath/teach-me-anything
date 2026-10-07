import type { Lesson } from "@tma/schema";
import { mergeSortLesson } from "./merge-sort";
import { elboLesson } from "./elbo";
import { centrifugalLesson } from "./centrifugal";

export { mergeSortLesson, elboLesson, centrifugalLesson };

/** Hand-written lessons available until the Planner writes them live. */
export const lessons: Record<string, Lesson> = {
  [mergeSortLesson.id]: mergeSortLesson,
  [elboLesson.id]: elboLesson,
  [centrifugalLesson.id]: centrifugalLesson,
};

export const defaultLessonId = mergeSortLesson.id;

export const lessonList: Array<{ id: string; title: string; topic: string }> = Object.values(lessons).map((l) => ({
  id: l.id,
  title: l.title,
  topic: l.topic,
}));

export function getLesson(id: string): Lesson | null {
  return lessons[id] ?? null;
}
