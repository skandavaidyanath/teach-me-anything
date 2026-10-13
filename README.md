# Teach Me Anything

An agentic tutor. You ask a question like "How does merge sort work?" and within a few seconds a short, interactive, interruptible lesson begins: a voice narrates, a visual appears on a persistent board, key facts accumulate in a pinned rail, and the lesson moves one idea at a time with a check at each step. You can interrupt at any moment, point at anything on the board, say "go back", or skip ahead.

**Status:** v0.3 is built. Ask for a lesson on anything: a slow Planner writes it in passes, a fast opening so you start within seconds and the rest while the first part plays. When the topic moves, the Planner writes a figure as code, a small simulation that runs on the board, and drives it from later parts. A fast Tutor owns the words from there: every question goes to it, it draws before it talks, it can switch the figure to another viewpoint or state for an answer, and if you say you still don't get it, it must change the picture. Get a check wrong and the next part is reviewed before it plays. Narration is real text-to-speech with word timestamps. Three hand-written lessons remain as references. The plan is in [docs/v0-plan.md](docs/v0-plan.md), the reasoning in [docs/decisions.md](docs/decisions.md), how we will measure it in [docs/measurement.md](docs/measurement.md), what each review said in [docs/feedback.md](docs/feedback.md), and the visual reference we are aiming at in [docs/references.md](docs/references.md).

## Run it

Needs Node 20 or newer and pnpm 10. Two keys go in a `.env` at the repo root (see `apps/harness/.env.example`): `ANTHROPIC_API_KEY` for the live tutor and `CARTESIA_API_KEY` for voice.

```
pnpm install
pnpm dev
```

That starts the web app on http://localhost:3000 and the harness on http://localhost:3210. Open the web app in Chrome, Edge, or Safari, type a topic or pick a ready-made lesson. The dot next to the title is green when the harness is connected. Without the harness, or without keys, the ready-made lessons still play locally with the browser's own speech engine.

`pnpm test` runs the schema, reducer, dispatcher, engine, parser, and session tests. `pnpm typecheck` and `pnpm build` do what they say.

## What to try

The point of v0.0 is to feel the rhythm and the interrupts, so push on those.

1. Answer the calibration chip and let the first beat run. Notice when the board moves relative to the words, and watch the rail when the tutor says it is pinning something.
2. When the check comes, click the wrong cell on purpose.
3. Mid-sentence, start typing anything. The lesson pauses at the end of the sentence. Clear the box and it resumes.
4. Ask a question the lesson predicted: "why go all the way to one?" during the splitting beat, "what if one list runs out?", "how does merge know which one to take?", "how does this compare to quicksort?"
5. Ask something it did not predict, like "is this how Python sorts?" The tutor answers in a sentence or two, may draw or highlight, and then the lesson continues from a script it has just reshaped to fit. The readout next to the controls shows how long it took.
6. Get a check wrong on purpose, then listen to how the next part opens.
6. Type "go back", "again", "skip", or "start over". Space pauses and resumes when the input is not focused.
7. Click a pin in the rail, then type "explain this".
8. Click an outline chip to jump forward or back.

## What is not in v0.3

No blackboard writing yet, and no art direction: figures are the model's own SVG. Beat 1 never carries a figure, so a lesson on something physical shows it moving from part 2. Nothing persists beyond a per-session replay log under `data/local/`. Desktop only. Voice input is typing only.

## Changing how it teaches

The lesson's voice and structure are in `apps/harness/prompts/style.md`, a plain text file both models read: how a lesson opens, when the learner predicts, how names and symbols arrive, the two modes (demo, write-along), and the voice. Edit it and restart the harness. To read what the Planner writes for a topic without the browser:

```
cd apps/harness && node scripts/dump-lesson.mjs "why is the sky blue"
```

## Layout

```
apps/web          Next.js client: board, playhead, speakers, dispatcher, harness connection
apps/harness      Node service: WebSocket sessions, Planner and Tutor (Claude), TTS (Cartesia), replay logs
packages/schema   the op schema and the wire protocol, shared by everything
packages/content  hand-written lessons until the Planner writes them
docs              plan, decisions, measurement protocol, review notes
```

## The idea in one paragraph

LLMs already explain things well. What they do badly is pacing, persistence, and steering. This product is a control loop around understanding: a structured board instead of a chat window, lessons made of short beats that each introduce one idea and end in a check, and an interrupt path that pauses in zero round trips and resumes smoothly. A planner writes the lesson ahead of time, fast components select and play it, and a generative model fills the gaps the planner did not predict.

## Three layers

```
BROWSER (client)            SERVER (harness)                 MODEL CALLS (roles)
board store, playhead,      session actor, state machine,    Planner     spine of the lesson, high effort
TTS + animation players,    task registry, cancellation,     Brancher    predicted questions and remediations, per beat
input layer, nav table,     prompt assembly, op relay,       Animator    compiled compositions, generate-compile-fix
op buffer, asset cache      lesson graph store, assets       Dispatcher  routes learner input over the graph, fast
                                                             Responder   generative fallback for unpredicted input
                                                             Observer    learner profile update at session end
```

The client is a deterministic runtime and makes no model calls. The harness is code, not a model. The roles are the only places a model runs.
