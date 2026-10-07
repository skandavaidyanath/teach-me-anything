import { getLesson, lessonList } from "@tma/content";
import { Landing } from "@/board/Landing";
import { LessonApp } from "@/board/LessonApp";

export default async function Page({ searchParams }: { searchParams: Promise<{ lesson?: string; topic?: string }> }) {
  const { lesson: lessonId, topic } = await searchParams;
  const lesson = lessonId ? getLesson(lessonId) : null;
  if (lesson) return <LessonApp localLesson={lesson} topic={null} lessonList={lessonList} />;
  if (topic && topic.trim()) return <LessonApp localLesson={null} topic={topic.trim()} lessonList={lessonList} />;
  return <Landing lessonList={lessonList} />;
}
