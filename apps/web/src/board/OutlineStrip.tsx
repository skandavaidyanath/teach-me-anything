"use client";

import type { Playhead, PlayheadState } from "@/playhead/playhead";

export type ConnectionState = "connecting" | "server" | "local";
export type VoiceOption = { id: string; name: string; description: string };
export type LessonListEntry = { id: string; title: string; topic: string };

export function OutlineStrip({
  state,
  playhead,
  connection,
  voices,
  voiceId,
  onVoice,
  lessonList,
  lessonId,
}: {
  state: PlayheadState;
  playhead: Playhead;
  connection: ConnectionState;
  voices: VoiceOption[];
  voiceId: string | null;
  onVoice: (id: string) => void;
  lessonList: LessonListEntry[];
  lessonId: string | null;
}) {
  const started = state.mode !== "calibrating" && state.mode !== "idle";
  const dot = connection === "server" ? "bg-correct" : connection === "local" ? "bg-ink-mute" : "bg-marker";
  const dotTitle = connection === "server" ? "Connected to the tutor" : connection === "local" ? "Offline: playing the built-in lesson with browser speech" : "Connecting";
  return (
    <header className="flex items-center gap-6 px-5 py-3">
      <h1 className="flex items-center gap-2 text-[15px] font-bold leading-none tracking-tight">
        <span className={`inline-block h-2 w-2 rounded-full ${dot}`} title={dotTitle} aria-label={dotTitle} />
        <select
          aria-label="Lesson"
          value={lessonId ?? "__topic__"}
          onChange={(e) => {
            const url = new URL(window.location.href);
            url.search = e.target.value === "__new__" ? "" : `?lesson=${encodeURIComponent(e.target.value)}`;
            window.location.assign(url.toString());
          }}
          className="-ml-1 cursor-pointer appearance-none bg-transparent pr-5 text-[15px] font-bold text-ink"
          style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M1 1l4 4 4-4' fill='none' stroke='%234b5a73' stroke-width='1.5'/></svg>\")", backgroundRepeat: "no-repeat", backgroundPosition: "right 4px center" }}
        >
          {lessonId === null && <option value="__topic__">{state.title}</option>}
          {lessonList.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
          <option value="__new__">New topic…</option>
        </select>
      </h1>
      <ol className="flex flex-1 items-center" aria-label="Lesson outline">
        {state.outline.map((entry, i) => {
          const isCurrent = started && i === state.beatIndex;
          const isDone = state.completedBeats.includes(entry.id);
          const loaded = i < state.loadedBeats;
          return (
            <li key={entry.id} className="flex items-center">
              {i > 0 && <span className={`h-px w-6 ${isDone || isCurrent ? "bg-ink-soft" : "bg-line"}`} aria-hidden />}
              <button
                type="button"
                onClick={() => playhead.jumpToBeat(i)}
                disabled={!started}
                aria-current={isCurrent ? "step" : undefined}
                title={loaded ? undefined : "Still arriving"}
                className={[
                  "flex items-center gap-2 rounded-full px-3 py-1 text-[13px] transition-colors",
                  isCurrent ? "bg-ink text-surface" : isDone ? "text-ink-soft hover:bg-rail" : "text-ink-mute hover:bg-rail",
                  !started ? "cursor-default" : "",
                  !loaded && !isCurrent ? "opacity-60" : "",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-block h-2 w-2 rounded-full",
                    isCurrent ? "bg-marker" : isDone ? "bg-ink-soft" : "border border-ink-mute",
                  ].join(" ")}
                  aria-hidden
                />
                {entry.title}
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-3 text-[13px] text-ink-soft">
        {started && (
          <span>
            beat {state.beatIndex + 1} of {state.outline.length}
          </span>
        )}
        {voices.length > 0 && state.speakerKind === "voice" && (
          <select
            aria-label="Voice"
            value={voiceId ?? ""}
            onChange={(e) => onVoice(e.target.value)}
            className="rounded-full border border-line bg-surface px-2 py-1 text-[13px] text-ink"
          >
            {voices.map((v) => (
              <option key={v.id} value={v.id} title={v.description}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex overflow-hidden rounded-full border border-line" role="radiogroup" aria-label="Narration">
          <button
            type="button"
            role="radio"
            aria-checked={state.speakerKind === "voice"}
            disabled={!state.speechAvailable}
            onClick={() => playhead.setSpeaker("voice")}
            title={state.speechAvailable ? "Spoken narration" : "No voice available"}
            className={`px-3 py-1 ${state.speakerKind === "voice" ? "bg-ink text-surface" : "text-ink-soft hover:bg-rail"} disabled:opacity-40`}
          >
            Voice
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={state.speakerKind === "silent"}
            onClick={() => playhead.setSpeaker("silent")}
            className={`px-3 py-1 ${state.speakerKind === "silent" ? "bg-ink text-surface" : "text-ink-soft hover:bg-rail"}`}
          >
            Captions
          </button>
        </div>
      </div>
    </header>
  );
}
