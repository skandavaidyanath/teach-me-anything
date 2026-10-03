# Teach Me Anything

An agentic tutor. You ask a question like "How does merge sort work?" and within a few seconds a short, interactive, interruptible lesson begins: a voice narrates, a visual appears on a persistent board, key facts accumulate in a pinned rail, and the lesson moves one idea at a time with a check at each step. You can interrupt at any moment, point at anything on the board, say "go back", or skip ahead.

**Status:** v0.0 is built and ready to try. It is the board and the playhead running a hand-written merge sort lesson, with voice, interrupts, and navigation, and no model calls yet. The plan is in [docs/v0-plan.md](docs/v0-plan.md), the reasoning in [docs/decisions.md](docs/decisions.md), and how we will measure it in [docs/measurement.md](docs/measurement.md).

## Run v0.0

Needs Node 20 or newer and pnpm 10.

```
pnpm install
pnpm dev
```

Then open http://localhost:3000 in Chrome, Edge, or Safari. Voice uses the browser's own speech engine in v0.0, so quality varies by browser and machine. Chrome on a Mac with the Samantha voice is the best case. The "Captions" toggle at the top right pauses the lesson at reading speed instead.

`pnpm test` runs the schema, reducer, dispatcher, and engine tests. `pnpm typecheck` and `pnpm build` do what they say.

## What to try

The point of v0.0 is to feel the rhythm and the interrupts, so push on those.

1. Answer the calibration chip and let the first beat run. Notice when the board moves relative to the words.
2. When the check comes, click the wrong cell on purpose.
3. Mid-sentence, start typing anything. The lesson pauses at the end of the sentence. Clear the box and it resumes.
4. Ask a question the lesson predicted: "why go all the way to one?" during the splitting beat, "what if one list runs out?", "how does merge know which one to take?", "how does this compare to quicksort?"
5. Ask something it did not predict. A placeholder stands in for the generative tutor.
6. Type "go back", "again", "skip", or "start over". Space pauses and resumes when the input is not focused.
7. Click a pin in the rail, then type "explain this".
8. Click an outline chip to jump forward or back.

## What is not in v0.0

No model calls. Every sentence, branch, and check is hand-written in `apps/web/src/content/merge-sort.ts`. Voice is the browser's speech engine. Caption timing is estimated when the engine gives no word boundaries. Nothing is saved. Desktop only.

## Layout

```
apps/web          Next.js client: board, playhead, speaker, dispatcher, lesson content
packages/schema   the op schema, shared by everything that produces or plays a lesson
docs              plan, decisions, measurement protocol
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
