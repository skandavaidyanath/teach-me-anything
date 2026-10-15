"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Component, ElementRef } from "@tma/schema";
import type { ElementViewProps } from "../Stage";
import { buildComponentDocument } from "./component-doc";
import { playSound, type SoundRequest } from "../sound";

const MAX_WIDTH = 980;

type FrameMessage = { tma: true; type: "ready" | "click" | "error" | "custom" | "sound"; data?: { target?: string | null; message?: string } & Partial<SoundRequest> };

/**
 * A figure written as code, run in a sandboxed frame. The frame is created
 * once per code string; state, highlights, and the lesson's clock reach it by
 * message, and clicks inside it come back as element refs.
 */
export function ComponentView({ element, state, clickable, onCell }: ElementViewProps<Component>) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(element.state ?? {});
  stateRef.current = element.state ?? {};
  const onCellRef = useRef(onCell);
  onCellRef.current = onCell;
  const parts = element.parts ?? [];
  const partsKey = parts.join("|");

  // The document depends on the code alone; state changes travel by message so the frame never reloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doc = useMemo(() => (element.code ? buildComponentDocument(element.code, stateRef.current) : null), [element.code]);

  const highlights = state.board.highlights.filter((h) => h.ref.id === element.id);
  const whole = highlights.find((h) => h.ref.index === undefined) ?? null;
  const partIds = highlights.filter((h) => h.ref.index !== undefined).map((h) => parts[h.ref.index!]).filter((p): p is string => !!p);
  const tone = highlights[0]?.tone ?? "marker";
  const running = state.mode === "playing";
  const runningRef = useRef(running);
  runningRef.current = running;
  const pointed = !!state.pointed && state.pointed.id === element.id && state.pointed.index === undefined;
  const awaitingClick = clickable.some((c) => c.id === element.id);

  const post = (msg: Record<string, unknown>) => frameRef.current?.contentWindow?.postMessage({ tma: true, ...msg }, "*");

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (!frameRef.current || ev.source !== frameRef.current.contentWindow) return;
      const m = ev.data as FrameMessage | null;
      if (!m || m.tma !== true) return;
      if (m.type === "ready") setReady(true);
      else if (m.type === "click") {
        const target = m.data?.target ?? null;
        const index = target ? parts.indexOf(target) : -1;
        const ref: ElementRef = index >= 0 ? { id: element.id, index } : { id: element.id };
        onCellRef.current(ref);
      } else if (m.type === "error") {
        setError(m.data?.message ?? "error");
        console.warn(`[figure ${element.id}]`, m.data?.message);
      } else if (m.type === "sound" && m.data && "kind" in m.data) {
        if (runningRef.current) playSound(m.data as SoundRequest);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [element.id, partsKey]);

  useEffect(() => {
    setReady(false);
    setError(null);
  }, [doc]);

  const stateKey = JSON.stringify(element.state ?? {});
  useEffect(() => {
    if (ready) post({ type: "state", state: element.state ?? {} });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stateKey]);

  const highlightKey = `${partIds.join("|")}:${tone}`;
  useEffect(() => {
    if (ready) post({ type: "highlight", ids: partIds, tone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, highlightKey]);

  useEffect(() => {
    if (ready) post({ type: "clock", running });
  }, [ready, running]);

  const width = element.width ?? 960;
  const height = element.height ?? 540;
  const scale = Math.min(1, MAX_WIDTH / width);
  const ring = whole ? `var(--color-${whole.tone})` : pointed ? "var(--color-ink)" : awaitingClick ? "var(--color-line)" : null;

  if (!doc) {
    // The figure is still being written; its place on the board is held at its size.
    return (
      <figure className="settle-in flex flex-col items-center gap-2">
        <div className="ring-pulse grid place-items-center rounded-lg border border-dashed border-line text-[15px] text-ink-mute" style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}>
          drawing {element.title ? `"${element.title}"` : "the figure"}…
        </div>
      </figure>
    );
  }

  return (
    <figure className="settle-in flex flex-col items-center gap-2">
      <div
        className="relative overflow-hidden rounded-lg transition-shadow duration-300"
        style={{ width: Math.round(width * scale), height: Math.round(height * scale), boxShadow: ring ? `0 0 0 3px ${ring}` : undefined }}
      >
        <iframe
          ref={frameRef}
          title={element.title ?? element.label ?? element.id}
          sandbox="allow-scripts"
          srcDoc={doc}
          onLoad={() => setReady(true)}
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left", border: 0, display: "block", background: "transparent" }}
        />
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-surface/90 px-6 text-center text-[15px] text-ink-soft">
            <div>
              <div>This figure didn't load.</div>
              {element.title && <div className="mt-1 text-ink-mute">{element.title}</div>}
            </div>
          </div>
        )}
      </div>
      {(element.caption || element.title) && <figcaption className="text-[15px] text-ink-soft">{element.caption ?? element.title}</figcaption>}
    </figure>
  );
}
