import { LessonApp } from "@/board/LessonApp";
import { mergeSortLesson } from "@/content/merge-sort";

export default function Page() {
  return <LessonApp lesson={mergeSortLesson} />;
}
