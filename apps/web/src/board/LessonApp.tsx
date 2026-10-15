"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { validateLesson, type Lesson } from "@tma/schema";
import { Playhead } from "@/playhead/playhead";
import { HarnessConnection } from "@/playhead/connection";
import { ServerSpeaker } from "@/playhead/server-speaker";
import { OutlineStrip, type ConnectionState, type VoiceOption } from "./OutlineStrip";
import { Stage } from "./Stage";
import { PinnedRail } from "./PinnedRail";
import { CaptionBar } from "./CaptionBar";
import { InputBar } from "./InputBar";
import { useFlip } from "./useFlip";

const HARNESS_URL = process.env["NEXT_PUBLIC_HARNESS_URL"] ?? "http://localhost:3210";
const CONNECT_TIMEOUT_MS = 2500;

export type LessonListEntry = { id: string; title: string; topic: string };

/**
 * Hosts the playhead. For a bundled lesson it plays what the harness streams
 * and falls back to local playback if the harness is unreachable. For a topic
 * it needs the harness, which has the Planner write the lesson.
 */
export function LessonApp({ localLesson, topic, lessonList }: { localLesson: Lesson | null; topic: string | null; lessonList: LessonListEntry[] }) {
  const [playhead, setPlayhead] = useState<Playhead | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [failure, setFailure] = useState<string | null>(null);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const speakerRef = useRef<ServerSpeaker | null>(null);
  const playheadRef = useRef<Playhead | null>(null);
  const issues = useMemo(() => (localLesson ? validateLesson(localLesson).issues : []), [localLesson]);

  useEffect(() => {
    let settled = false;
    let pingTimer: ReturnType<typeof setInterval> | null = null;

    const adopt = (ph: Playhead, mode: ConnectionState) => {
      playheadRef.current = ph;
      setPlayhead(ph);
      setConnection(mode);
    };

    const goLocal = (why: string) => {
      if (settled) return;
      settled = true;
      if (!localLesson) {
        setFailure(`The tutor is offline (${why}). Pick a ready-made lesson, or start the harness and reload.`);
        setConnection("local");
        return;
      }
      const ph = Playhead.fromLesson(localLesson);
      ph.detectSpeech();
      adopt(ph, "local");
    };

    const startMessage = (calibration: string | null) =>
      ({ type: "session.start", lessonId: localLesson?.id ?? null, topic: localLesson ? null : topic, calibrationAnswer: calibration }) as const;

    const wsUrl = HARNESS_URL.replace(/^http/, "ws") + "/ws";
    const conn = new HarnessConnection(wsUrl, {
      onStatus: (s) => {
        if (s === "failed") goLocal("no connection");
        if (s === "open" && settled && playheadRef.current) {
          conn.send(startMessage(playheadRef.current.getState().calibrationAnswer));
          setConnection("server");
        }
        if (s === "closed" && settled) setConnection("connecting");
      },
      onMessage: (msg) => {
        const ph = playheadRef.current;
        switch (msg.type) {
          case "session.ready": {
            if (!settled) conn.send(startMessage(null));
            if (msg.tts.available && msg.tts.voiceId && !speakerRef.current) {
              speakerRef.current = new ServerSpeaker(HARNESS_URL, msg.tts.voiceId, (stats) => playheadRef.current?.recordTts(stats));
              setVoiceId(msg.tts.voiceId);
              void fetch(`${HARNESS_URL}/voices`)
                .then((r) => r.json())
                .then((d: { voices?: VoiceOption[] }) => setVoices(d.voices ?? []))
                .catch(() => {});
            }
            return;
          }
          case "lesson.header": {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            const fresh = new Playhead(msg.header, speakerRef.current ? { speaker: speakerRef.current } : {});
            if (!speakerRef.current) fresh.detectSpeech();
            fresh.onAsk = (req) => conn.send({ type: "tutor.ask", ...req });
            fresh.onReview = (req) => conn.send({ type: "tutor.review", ...req });
            fresh.onEvent = (event) => conn.send({ type: "event", at: Date.now(), event });
            adopt(fresh, "server");
            pingTimer = setInterval(() => conn.send({ type: "ping", t: performance.now() }), 5000);
            return;
          }
          case "lesson.beat":
            ph?.appendBeat(msg.beat, msg.index, { calibrationSeen: msg.calibrationSeen });
            return;
          case "lesson.replace":
            ph?.replaceFrom(msg.fromIndex, msg.outline);
            return;
          case "lesson.component":
            ph?.attachComponent(msg.element);
            return;
          case "lesson.complete":
            return;
          case "lesson.error":
            if (!settled) {
              settled = true;
              clearTimeout(timeout);
              setFailure(msg.message);
            }
            return;
          case "tutor.answer":
            ph?.appendAnswerOps(msg.requestId, msg.ops);
            return;
          case "tutor.done":
            ph?.applyWindow(msg.requestId, msg.current, msg.nextPrefix, msg.timing);
            return;
          case "tutor.error":
            ph?.failTutor(msg.requestId, msg.message);
            return;
          case "pong":
            ph?.recordRtt(Math.round(performance.now() - msg.t));
            return;
          case "error":
            console.warn("[harness]", msg.message);
            return;
        }
      },
    });
    // A planned lesson takes a few seconds to open; a bundled one should arrive at once.
    const timeout = setTimeout(() => goLocal("no answer from the harness"), localLesson ? CONNECT_TIMEOUT_MS : 20000);
    conn.connect();
    return () => {
      clearTimeout(timeout);
      if (pingTimer) clearInterval(pingTimer);
      conn.close();
    };
  }, [localLesson, topic]);

  const onVoice = (id: string) => {
    speakerRef.current?.setVoice(id);
    setVoiceId(id);
  };

  if (failure) {
    return (
      <div className="grid h-dvh place-items-center px-6 text-center">
        <div className="max-w-md">
          <p className="text-[20px] text-ink">{failure}</p>
          <a href="/" className="mt-4 inline-block rounded-full border border-ink px-5 py-2 text-[15px] hover:bg-ink hover:text-surface">
            Back
          </a>
        </div>
      </div>
    );
  }
  if (!playhead) {
    return (
      <div className="grid h-dvh place-items-center text-ink-mute">
        <div>{topic ? `Writing a lesson on ${topic}…` : "Connecting to the tutor…"}</div>
      </div>
    );
  }
  return <Board playhead={playhead} connection={connection} voices={voices} voiceId={voiceId} onVoice={onVoice} issues={issues} lessonList={lessonList} lessonId={localLesson?.id ?? null} />;
}

function Board({
  playhead,
  connection,
  voices,
  voiceId,
  onVoice,
  issues,
  lessonList,
  lessonId,
}: {
  playhead: Playhead;
  connection: ConnectionState;
  voices: VoiceOption[];
  voiceId: string | null;
  onVoice: (id: string) => void;
  issues: ReturnType<typeof validateLesson>["issues"];
  lessonList: LessonListEntry[];
  lessonId: string | null;
}) {
  const state = useSyncExternalStore(playhead.subscribe, playhead.getState, playhead.getState);
  const rootRef = useRef<HTMLDivElement>(null);
  useFlip(rootRef, [state.board, state.pinSpotlight]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
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
    <div ref={rootRef} className="grid h-dvh grid-rows-[auto_auto_minmax(0,1fr)_auto]">
      <OutlineStrip state={state} playhead={playhead} connection={connection} voices={voices} voiceId={voiceId} onVoice={onVoice} lessonList={lessonList} lessonId={lessonId} />
      <CaptionBar state={state} playhead={playhead} />
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_400px] gap-3 px-4 pb-3">
        <Stage state={state} playhead={playhead} />
        <PinnedRail state={state} playhead={playhead} />
      </div>
      <div className="border-t border-line bg-surface">
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
