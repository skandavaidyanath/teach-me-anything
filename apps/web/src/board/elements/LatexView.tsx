"use client";

import { useMemo } from "react";
import katex from "katex";
import type { LatexCard } from "@tma/schema";
import type { ElementViewProps } from "../Stage";

export function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
    } catch {
      return tex;
    }
  }, [tex, display]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function LatexView({ element, state, onCell }: ElementViewProps<LatexCard>) {
  const pointed = state.pointed?.id === element.id;
  return (
    <button
      type="button"
      onClick={() => onCell({ id: element.id })}
      className={[
        "settle-in rounded-lg border border-line bg-surface px-10 py-6 text-[28px]",
        pointed ? "outline outline-2 outline-ink" : "hover:bg-board",
      ].join(" ")}
    >
      <Tex tex={element.tex} display />
      {element.caption && <div className="mt-2 text-[16px] text-ink-soft">{element.caption}</div>}
    </button>
  );
}
