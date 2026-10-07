import { defaultLessonId, getLesson, lessonList } from "@tma/content";
import { LessonApp } from "@/board/LessonApp";

export default async function Page({ searchParams }: { searchParams: Promise<{ lesson?: string }> }) {
  const { lesson: requested } = await searchParams;
  const lesson = (requested && getLesson(requested)) || getLesson(defaultLessonId)!;
  return <LessonApp localLesson={lesson} lessonList={lessonList} />;
}
