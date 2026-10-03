# Teach Me Anything

An agentic tutor. You ask a question like "How does merge sort work?" and within a few seconds a short, interactive, interruptible lesson begins: a voice narrates, a visual appears on a persistent board, key facts accumulate in a pinned rail, and the lesson moves one idea at a time with a check at each step. You can interrupt at any moment, point at anything on the board, say "go back", or skip ahead.

**Status:** v0 planning. Start with [docs/v0-plan.md](docs/v0-plan.md), then [docs/decisions.md](docs/decisions.md) for the reasoning behind the design.

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
