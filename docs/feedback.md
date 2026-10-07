# Review notes

What each increment's review said, and what changed because of it. This is the "why" layer of the measurement plan while there is one reviewer.

## v0.0, reviewed 2026-10-06

Verdict: "pretty good". The word-by-word caption highlight landed.

What was wrong and what changed:

- **Pins were not pin-worthy and not prominent.** The rail sat in the corner, nothing marked the moment of pinning, and the text was thin. Changed in v0.0.1: rail widened to 400px with larger cards, each pin stamps in with the highlighter color and a "Pinned" notice at the top, the tutor says it is pinning before each pin, and pins now carry a bold title and a one-line reason.
- **The script was missed at the bottom.** Changed in v0.0.1: the caption sits above the stage. The input stays at the bottom.
- **Too much blank canvas for a simple example.** Changed in v0.0.1: primitives scaled up about a third and the rail takes more width. The stage keeps its size for complex examples.
- **Could not ask real questions.** Expected in v0.0, which has no model calls, but it was the most felt gap. Changed in the plan: v0.1 now includes a live Responder alongside the harness and real voice.
- **Voice was monotone and hard to follow.** Browser speech engine. Real TTS moves to v0.1.
- **Idea: Khan Academy style blackboard with writing in real time.** Added as v0.2, before the Planner goes live, so the Planner can write with it.

Open UX question from the build, not yet answered: "go back" during a check's reaction rewinds to before the check and re-asks it.

## v0.0.1, reviewed 2026-10-06

Verdict: "I like this." Two refinements, both about motion.

- **Numbers should float into the merged slot, not disappear and reappear.** Changed in v0.0.2: a `move` op carries a cell, with its identity, from one row to another, and a FLIP pass animates anything whose position changed between renders. Rows also slide to make room when a new row appears.
- **Don't say "I'm going to pin it". Show it.** Changed in v0.0.2: the spoken pin cues are gone. When a pin lands, the idea appears large over the stage for about a second, then flies into its slot in the rail and glows briefly.

## v0.1, built 2026-10-06, awaiting review

What to look at: voice quality and pacing over a full lesson, whether the word highlight tracks the audio, how a live answer feels, including the filler before it, and whether the resume after a live answer reads naturally. The Cartesia voice is Clive by default and can be changed from the header.

Known before review: the generative path lands its first real sentence around 3 s after the question, with a filler at 1.5 s. The plan's "Measured so far" table has the breakdown and the order of fixes.

