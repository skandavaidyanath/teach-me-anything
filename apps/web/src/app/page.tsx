import { LessonApp } from "@/board/LessonApp";
import { mergeSortLesson } from "@tma/content";

export default function Page() {
  return <LessonApp localLesson={mergeSortLesson} />;
}
