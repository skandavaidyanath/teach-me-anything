import WebSocket from "ws";
const topic = process.argv[2];
const ws = new WebSocket("ws://localhost:3210/ws");
const t0 = Date.now();
const beats = [];
let header = null;
const s = () => `[${((Date.now() - t0) / 1000).toFixed(0).padStart(3)}s]`;
const el = (e) => `${e.kind} ${e.id}${e.title ? ` "${e.title}"` : e.label ? ` "${e.label}"` : ""}${e.kind === "derivation" ? ` (${e.steps.length} lines, ${e.revealed} shown)` : ""}${e.kind === "latex" ? ` ${e.tex}` : ""}${e.kind === "component" ? ` [${(e.code || "").split("\n").length} lines of code; state ${JSON.stringify(e.state)}; parts ${JSON.stringify(e.parts)}]` : ""}${e.kind === "text_card" ? ` :: ${e.body.replace(/\n/g, " / ")}` : ""}`;
const op = (o, ind = "    ") => {
  switch (o.op) {
    case "say": return `${ind}${o.text}`;
    case "show": return `${ind}[show ${el(o.element)}]`;
    case "update": return `${ind}[update ${o.target} ${JSON.stringify(o.patch)}]`;
    case "highlight": return `${ind}[highlight ${o.targets.map((t) => (t.index === undefined ? t.id : `${t.id}[${t.index}]`)).join(" ")}]`;
    case "pin": return `${ind}[pin "${o.pin.title ?? ""}" :: ${o.pin.text ?? o.pin.tex ?? ""}]`;
    case "check": return `${ind}[CHECK ${o.kind}: ${o.prompt}${o.options ? ` {${o.options.join(" | ")}}` : ""} expected ${JSON.stringify(o.expected)}]\n${(o.onCorrect ?? []).map((x) => op(x, ind + "  ✓ ")).join("\n")}\n${(o.onIncorrect ?? []).map((x) => op(x, ind + "  ✗ ")).join("\n")}`;
    default: return `${ind}[${o.op}${o.targets ? " " + o.targets.join(",") : ""}]`;
  }
};
ws.on("open", () => {});
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.type === "session.ready") ws.send(JSON.stringify({ type: "session.start", lessonId: null, topic, calibrationAnswer: null }));
  else if (m.type === "lesson.header") {
    header = m.header;
    console.log(`${s()} HEADER "${header.title}" style=${header.style} topic=${header.topic}`);
    console.log(`      calibration: ${header.calibration?.prompt} {${header.calibration?.options.join(" | ")}}`);
    for (const b of header.outline) console.log(`      - ${b.id} ${b.title}: ${b.summary ?? ""}`);
  } else if (m.type === "lesson.beat") {
    beats[m.index] = m.beat;
    console.log(`\n${s()} BEAT ${m.index + 1} "${m.beat.title}"`);
    for (const o of m.beat.ops) console.log(op(o));
  } else if (m.type === "lesson.complete" || m.type === "lesson.error") {
    console.log(`\n${s()} ${m.type} ${m.message ?? ""}`);
    ws.close();
    process.exit(0);
  }
});
setTimeout(() => { console.log("timeout"); process.exit(1); }, 300000);
