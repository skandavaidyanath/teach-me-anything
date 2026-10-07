"use client";

import { useState } from "react";

export type LessonListEntry = { id: string; title: string; topic: string };

/** The front door: ask for anything, or pick a ready-made lesson. */
export function Landing({ lessonList }: { lessonList: LessonListEntry[] }) {
  const [topic, setTopic] = useState("");
  const go = (params: Record<string, string>) => {
    const url = new URL(window.location.href);
    url.search = new URLSearchParams(params).toString();
    window.location.assign(url.toString());
  };
  return (
    <main className="grid h-dvh place-items-center px-6">
      <div className="w-full max-w-xl">
        <h1 className="text-[34px] font-bold leading-tight tracking-tight">What do you want to learn?</h1>
        <p className="mt-2 text-[17px] text-ink-soft">One concept, a few minutes, a board you can interrupt.</p>
        <form
          className="mt-6 flex items-center gap-2 rounded-full border border-line bg-surface px-5 py-3 focus-within:border-ink"
          onSubmit={(e) => {
            e.preventDefault();
            const t = topic.trim();
            if (t) go({ topic: t });
          }}
        >
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="How does the TCP handshake work?"
            aria-label="Topic"
            autoFocus
            className="flex-1 bg-transparent text-[18px] outline-none placeholder:text-ink-mute"
          />
          <button type="submit" disabled={!topic.trim()} className="rounded-full bg-ink px-4 py-1.5 text-[15px] text-surface disabled:opacity-30">
            Teach me
          </button>
        </form>
        <div className="mt-8">
          <div className="text-[13px] text-ink-soft">Or start with a ready-made lesson</div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {lessonList.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  onClick={() => go({ lesson: l.id })}
                  className="rounded-full border border-line bg-surface px-4 py-2 text-[15px] hover:border-ink"
                >
                  {l.title}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}
