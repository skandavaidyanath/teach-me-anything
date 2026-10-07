# Teach Me Anything

An agentic tutor. You ask a question like "How does merge sort work?" and within a few seconds a short, interactive, interruptible lesson begins: a voice narrates, a visual appears on a persistent board, key facts accumulate in a pinned rail, and the lesson moves one idea at a time with a check at each step. You can interrupt at any moment, point at anything on the board, say "go back", or skip ahead.

**Status:** v0.1 is built. The board and playhead from v0.0, now fed by a server: the lesson streams in beat by beat over a WebSocket, narration is real text-to-speech with word timestamps, and any question the lesson did not predict goes to a live tutor whose answer streams back and plays in context. The plan is in [docs/v0-plan.md](docs/v0-plan.md), the reasoning in [docs/decisions.md](docs/decisions.md), how we will measure it in [docs/measurement.md](docs/measurement.md), and what each review said in [docs/feedback.md](docs/feedback.md).

## Run it

Needs Node 20 or newer and pnpm 10. Two keys go in a `.env` at the repo root (see `apps/harness/.env.example`): `ANTHROPIC_API_KEY` for the live tutor and `CARTESIA_API_KEY` for voice.

```
pnpm install
pnpm dev
```

That starts the web app on http://localhost:3000 and the harness on http://localhost:3210. Open the web app in Chrome, Edge, or Safari. The dot next to the title is green when the harness is connected. Without the harness, or without keys, the app still runs: it plays the built-in lesson locally with the browser's own speech engine, which is what v0.0 did.

`pnpm test` runs the schema, reducer, dispatcher, engine, parser, and session tests. `pnpm typecheck` and `pnpm build` do what they say.

## What to try

The point of v0.0 is to feel the rhythm and the interrupts, so push on those.

1. Answer the calibration chip and let the first beat run. Notice when the board moves relative to the words, and watch the rail when the tutor says it is pinning something.
2. When the check comes, click the wrong cell on purpose.
3. Mid-sentence, start typing anything. The lesson pauses at the end of the sentence. Clear the box and it resumes.
4. Ask a question the lesson predicted: "why go all the way to one?" during the splitting beat, "what if one list runs out?", "how does merge know which one to take?", "how does this compare to quicksort?"
5. Ask something it did not predict, like "is this how Python sorts?" The live tutor answers in a sentence or two, may highlight or pin something, and bridges back to where you were. The readout next to the controls shows how long it took.
6. Type "go back", "again", "skip", or "start over". Space pauses and resumes when the input is not focused.
7. Click a pin in the rail, then type "explain this".
8. Click an outline chip to jump forward or back.

## What is not in v0.1

The lesson itself is still hand-written, in `packages/content`. The tutor only answers interrupts; it does not plan or narrate the lesson yet. Pre-authored branches are matched by regex on the client. Nothing persists beyond a per-session replay log under `data/local/`. Desktop only.

## Layout

```
apps/web          Next.js client: board, playhead, speakers, dispatcher, harness connection
apps/harness      Node service: WebSocket sessions, Responder (Claude), TTS (Cartesia), replay logs
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
