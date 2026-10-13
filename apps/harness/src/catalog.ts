import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The board vocabulary, written once for every model that produces ops.
 * Kept as plain text so it sits in a cached prompt prefix.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** How a lesson sounds and moves: the style guide in prompts/style.md, editable without touching code. */
export const STYLE_GUIDE = fs.readFileSync(path.join(here, "..", "prompts", "style.md"), "utf8").trim();

/** The voice rules alone, for the tutor's prompt. */
export const VOICE_GUIDE = (() => {
  const at = STYLE_GUIDE.indexOf("VOICE,");
  return at === -1 ? STYLE_GUIDE : STYLE_GUIDE.slice(at);
})();

export const LESSON_STYLES = ["demo", "write-along"] as const;
export type LessonStyle = (typeof LESSON_STYLES)[number];

export const COMPONENT_API_DOC = `A component's code is the body of an HTML page: markup (SVG or divs), a <style>, and one <script>. It runs in a frame of the given width and height with no network and no libraries, so draw with SVG and plain DOM. Keep it under about 120 lines. The script gets window.tma:
- tma.state: the current state object.
- tma.onState(function (state, prev) {...}): called once at start and after every update; redraw from the state here.
- tma.onFrame(function (t, dt) {...}): called every animation frame while the lesson is playing (t = seconds since start, dt = seconds since the last frame) and not while it is paused; animate here, never with your own timers.
- tma.onHighlight(function (ids, tone) {...}): optional. By default a highlighted part gets a glow through a data-tma-highlight attribute on the element with that id.
Give every element the lesson will point at an id and list those ids in "parts", in order; highlight and click checks then address them as ID[0], ID[1], ... in that order. CSS variables available: --ink, --ink-soft, --ink-mute, --surface, --board, --line, --marker (the highlighter), --correct (green: real forces, right answers), --incorrect (red: fictitious, wrong), --font.`;

export const PRIMITIVES_DOC = `ELEMENTS you can put on the board (each has an id you choose, short and unique):
- array_row: a row of values. {"kind":"array_row","id":"A","label":"A","values":[2,5,8]} Add "role":"output" for a row that collects results. Cells are addressed A[0], A[1], ...
- split_tree: a halving tree over numbers. {"kind":"split_tree","id":"T","values":[8,3,5,1,9,2,7,4],"revealDepth":0} revealDepth = how many levels of splitting are visible; sortedFromDepth = levels at or below which nodes show sorted (merge-up). Levels are addressed T[0], T[1], ...
- text_card: a short card. {"kind":"text_card","id":"C","title":"In practice","body":"Line one.\\nLine two."}
- latex: one formula. {"kind":"latex","id":"F","tex":"F = \\\\frac{m v^2}{r}","caption":"optional"}
- derivation: equations revealed one line at a time. {"kind":"derivation","id":"D","label":"the evidence","revealed":1,"focus":0,"steps":[{"tex":"\\\\log p(x) = \\\\log \\\\int p(x,z)\\\\,dz","note":"optional note"}, ...]} Lines are addressed D[0], D[1], ...
- scene: a small still 2D diagram, width/height in scene units, items keyed by id. {"kind":"scene","id":"S","width":420,"height":300,"items":[{"id":"orbit","type":"circle","cx":210,"cy":150,"r":100,"dashed":true,"label":"the circle"},{"id":"ball","type":"dot","cx":310,"cy":150,"r":10,"label":"the ball"},{"id":"v","type":"arrow","x1":310,"y1":150,"x2":310,"y2":75,"role":"velocity","label":"velocity"},{"id":"t","type":"arrow","x1":310,"y1":150,"x2":240,"y2":150,"role":"force","label":"pull"},{"id":"l","type":"line","x1":0,"y1":0,"x2":10,"y2":10,"dashed":true},{"id":"p","type":"path","d":"M 30 190 L 330 24"},{"id":"txt","type":"text","x":20,"y":285,"text":"a caption","size":13}]} Arrow roles: force (green), velocity (ink), fictitious (red), neutral. Items are addressed S[0], S[1], ... in item order.
- component: a figure written as code, for what the other elements cannot show: motion, a changing viewpoint, a simulation, a mechanism, a picture of something physical. {"kind":"component","id":"P","title":"A pendulum","width":600,"height":360,"state":{"length":1,"showForces":true},"stateDoc":"length: 0.5 to 2, relative string length; showForces: true | false","parts":["bob","string","gravity"],"code":"...the code..."} "stateDoc" says what each state field means and what it may be set to, so the tutor can change it mid-lesson. ${COMPONENT_API_DOC}

OPS (each has a unique "id"; use "<beatId>.<letter><n>" like "b2.s3"):
- say: one spoken sentence, what the learner hears as one caption line. {"op":"say","id":"b1.s1","text":"One sentence only."} Delivery is yours to shape: "key":true marks a sentence a listener needs to land, spoken slowly with a breath after and set apart in the caption; "pace":"slow" or "quick" changes the speed of any sentence; a pause op puts silence where it does work. Most sentences are ordinary.
- show: put an element on the board. {"op":"show","id":"b1.e1","element":{...}}
- update: patch an element's fields. {"op":"update","id":"b1.u1","target":"T","patch":{"revealDepth":2}} For a scene, patch "items" with the full new item list; items keep their ids so they animate between positions. For a component, patch "state": {"op":"update","id":"b3.u1","target":"P","patch":{"state":{"length":2}}} merges those fields into its state and the figure redraws.
- move: carry one cell from a row to another, animated. {"op":"move","id":"b1.m1","from":{"id":"B","index":0},"to":{"id":"OUT"}}
- highlight: mark cells, levels, lines, items, or parts. {"op":"highlight","id":"b1.h1","targets":[{"id":"A","index":0},{"id":"B","index":0}]} Optional "tone": "marker" | "correct" | "incorrect".
- clear_highlights: {"op":"clear_highlights","id":"b1.c1"}
- clear: remove elements. {"op":"clear","id":"b2.c0"} removes everything; add "targets":["A","B"] to remove some.
- pin: keep an idea for the whole lesson. {"op":"pin","id":"b1.p1","pin":{"pinId":"T1","kind":"takeaway","title":"Merging is one pass","text":"One sentence of body."}} kinds: takeaway | definition | equation (add "tex") | code (text is code).
- check: exactly one per beat, always the last op. Choice: {"op":"check","id":"b2.k1","kind":"choice","prompt":"How many rounds of splitting?","options":["2","3","4"],"expected":["3","three"],"onCorrect":[say...],"onIncorrect":[highlight..., say..., clear_highlights]} Click: {"op":"check","id":"b1.k1","kind":"click_cell","prompt":"Click the element that goes next.","targets":[{"id":"A","index":0},{"id":"B","index":0}],"expected":{"id":"B","index":0},"onCorrect":[...],"onIncorrect":[...]} Ungraded prompt: add "graded":false.`;

export const DRAWING_DIRECTIVES_DOC = `DRAWING DIRECTIVES (one per line, placed before the sentences that talk about them). Give your own things new ids. The lesson's own elements may be highlighted, and a component's state may be changed.
@row ID "Label": 8, 3, 5, 1
@row OUT2 "merged" (output):
@tree ID: 8 3 5 1 9 2 7 4 | levels=1
@reveal ID 2
@move ID[0] -> OUT2
@card ID "Title" :: one or two short lines
@formula ID: \\\\log p(x) \\\\ge \\\\mathbb{E}_q[\\\\log p(x,z) - \\\\log q(z)]
@scene ID "Label" 420x300: [{"id":"ball","type":"dot","cx":310,"cy":150,"r":10,"label":"the ball"},{"id":"pull","type":"arrow","x1":310,"y1":150,"x2":240,"y2":150,"role":"force","label":"pull"}]      (one line of JSON items: circle, dot, arrow with role force|velocity|fictitious|neutral, line, path, text)
@update P: {"length":2}      (set fields of a component's state; its state doc on the board says what you can set)
@highlight A[0] B[0]      (row cells A[0], tree levels T[2], derivation lines D[1], scene items S[3], component parts P[0])
@pin takeaway "Short title" :: one sentence of body
@component ID "Title" 600x360 parts=bob,string,gravity state={"length":1}
...the code, as many lines as needed...
@end`;
