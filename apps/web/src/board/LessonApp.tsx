"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { validateLesson, type Lesson } from "@tma/schema";
import { Playhead } from "@/playhead/playhead";
import { OutlineStrip } from "./OutlineStrip";
import { Stage } from "./Stage";
import { PinnedRail } from "./PinnedRail";
import { CaptionBar } from "./CaptionBar";
import { InputBar } from "./InputBar";

export function LessonApp({ lesson }: { lesson: Lesson }) {
  const [playhead] = useState(() => new Playhead(lesson));
  const state = useSyncExternalStore(playhead.subscribe, playhead.getState, playhead.getState);
  const issues = useMemo(() => validateLesson(lesson).issues, [lesson]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (typing) return;
      if (e.code === "Space") {
        e.preventDefault();
        playhead.togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playhead]);

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto]">
      <OutlineStrip lesson={lesson} state={state} playhead={playhead} />
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_320px] gap-3 px-4 pb-2">
        <Stage lesson={lesson} state={state} playhead={playhead} />
        <PinnedRail state={state} playhead={playhead} />
      </div>
      <div className="border-t border-line bg-surface">
        <CaptionBar state={state} playhead={playhead} />
        <InputBar state={state} playhead={playhead} />
      </div>
      {issues.length > 0 && (
        <div className="fixed bottom-24 left-4 right-4 z-50 rounded-md border border-incorrect bg-incorrect-soft p-3 text-sm text-ink">
          <div className="font-bold">This lesson has {issues.length} content issue{issues.length > 1 ? "s" : ""}</div>
          <ul className="mt-1 list-disc pl-5">
            {issues.slice(0, 8).map((i, idx) => (
              <li key={idx}>
                <span className="font-mono text-xs">{i.path}</span> {i.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
