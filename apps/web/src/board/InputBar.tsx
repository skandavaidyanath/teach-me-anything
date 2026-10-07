"use client";

import { useEffect, useRef, useState } from "react";
import type { Playhead, PlayheadState } from "@/playhead/playhead";

export function InputBar({ state, playhead }: { state: PlayheadState; playhead: Playhead }) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const live = state.mode !== "calibrating" && state.mode !== "idle";

  useEffect(() => {
    playhead.setTyping(text.trim().length > 0);
  }, [text, playhead]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    playhead.submitInput(t);
    setText("");
  };

  const pointedLabel = state.pointed
    ? state.pointed.index !== undefined
      ? `${state.pointed.id}[${state.pointed.index}]`
      : state.pointed.id
    : null;

  const awaitingFree = state.mode === "awaiting_check" && state.check?.op.kind === "free_text" && state.check.result === null;
  const placeholder = !live
    ? "Answer above to begin"
    : awaitingFree
      ? "Type your answer"
      : state.mode === "paused"
        ? "Ask anything, or type “ok” to continue"
        : "Type to interrupt. Try “why?”, “go back”, or “skip”";

  return (
    <div className="flex items-center gap-3 px-5 pb-4 pt-3">
      <form
        className="flex flex-1 items-center gap-2 rounded-full border border-line bg-board px-4 py-2 focus-within:border-ink"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {pointedLabel && (
          <button
            type="button"
            onClick={() => playhead.setPointed(null)}
            className="flex items-center gap-1 rounded-full bg-marker-soft px-2 py-0.5 text-[12.5px] text-ink"
            title="Stop pointing"
          >
            pointing at {pointedLabel}
            <span aria-hidden>×</span>
          </button>
        )}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!live}
          placeholder={placeholder}
          aria-label="Talk to the tutor"
          className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-mute disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!live || text.trim().length === 0}
          className="rounded-full bg-ink px-3 py-1 text-[13px] text-surface disabled:opacity-30"
        >
          Send
        </button>
      </form>

      <LatencyReadout state={state} />

      <div className="flex items-center gap-1" role="group" aria-label="Playback">
        <Ctl label="Go back a sentence" onClick={() => playhead.rewind()} disabled={!live}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 19l-7-7 7-7M20 19l-7-7 7-7" />
          </svg>
        </Ctl>
        <Ctl label={state.mode === "playing" ? "Pause" : "Continue"} onClick={() => playhead.togglePause()} disabled={!live || state.mode === "awaiting_check" || state.mode === "finished"} primary>
          {state.mode === "playing" ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 5v14l12-7z" />
            </svg>
          )}
        </Ctl>
        <Ctl label="Skip to the next beat" onClick={() => playhead.skipBeat()} disabled={!live || state.mode === "finished"}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M13 5l7 7-7 7M4 5l7 7-7 7" />
          </svg>
        </Ctl>
      </div>
    </div>
  );
}

function LatencyReadout({ state }: { state: PlayheadState }) {
  const t = state.telemetry;
  const parts: string[] = [];
  if (t.rttMs !== null) parts.push(`rtt ${t.rttMs} ms`);
  if (t.tts) parts.push(`tts ${t.tts.fetchMs} ms${t.tts.cached ? " cached" : ""}`);
  if (t.ask) {
    const a = t.ask;
    const first = a.firstOpMs !== null ? `${(a.firstOpMs / 1000).toFixed(1)} s` : "…";
    const audio = a.firstAudioMs !== null ? `${(a.firstAudioMs / 1000).toFixed(1)} s` : "…";
    parts.push(`ask first ${first}, audio ${audio}`);
  }
  if (parts.length === 0) return null;
  return (
    <div className="hidden whitespace-nowrap font-mono text-[11px] text-ink-mute lg:block" title="Latency readout: round trip, last TTS fetch, last question">
      {parts.join("   ")}
    </div>
  );
}

function Ctl({
  label,
  onClick,
  disabled,
  primary,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={[
        "flex h-10 w-10 items-center justify-center rounded-full border transition-colors disabled:opacity-30",
        primary ? "border-ink bg-ink text-surface hover:bg-ink-soft" : "border-line text-ink hover:bg-rail",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
