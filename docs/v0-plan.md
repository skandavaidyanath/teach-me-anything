# v0 Plan

Date: 2026-10-02. Status: proposed, pending one open decision (see the end).

## Goal

Prove that a board-based, beat-paced, interruptible lesson with voice narration is a meaningfully better way to learn a single concept than asking a chatbot.

Everything in v0 serves that one test. Anything that does not is out of scope.

## What v0 is

A web app. The learner types a question. A calibration question appears within a second. When they answer it, the lesson begins: the tutor speaks, a visual appears on the stage, key facts accumulate in a pinned rail, and the lesson advances one idea at a time with a check at each step. The learner can interrupt at any moment by typing, click any element on the board to ask about it, type "go back" or "skip", and answer checks by clicking or typing. Lessons cover one concept in 3 to 10 minutes.

Input is text. Output is voice plus the board. Voice input is v1.

## Success criteria

Latency, measured by the synthetic-learner harness on the seed topics, 95th percentile:

| Moment | Target |
|---|---|
| Question submitted to calibration chips | 1.0 s |
| Calibration answer to first audio of beat 1 | 2.0 s |
| Check answered to tutor reaction audible | 1.5 s |
| Interrupt to playhead paused | 0 round trips, under 50 ms locally |
| Interrupt to aside first audio, fast path | 0.5 s |
| Interrupt to aside first audio, generative path | 1.5 s |
| Navigation command to effect | 0 round trips |

Reliability on the 10 seed topics:

- 95% of lessons run start to finish with no harness error.
- Composition compile success at least 80% on first attempt and 95% after retries. Static fallback otherwise, never a blank stage.
- Every beat has exactly one idea and ends in exactly one check. Enforced by schema validation on the Planner output.

Qualitative: five people each take two lessons and compare against asking a chatbot the same question. We want a clear majority to prefer the lesson and to be able to say why.

## In scope

Client:
- Board with four regions: stage, pinned rail, outline strip, caption and input bar. Nothing scrolls.
- Board store with element ids, labels, and bounding boxes. Click an element to reference it in a question.
- Playhead: executes ops in order, plays TTS with word timestamps, seeks animations to markers, manages focus and highlights. Pause, seek, and resume are local.
- Local navigation table: stop, go back, repeat, skip, continue.
- Soft interrupt on typing, hard interrupt on submit.
- Local grading of checks whose expected answer is known, with instant visual feedback.
- Primitives library: text card, LaTeX card, array row, number line, 2D function plot, node tree, two-column compare, slider widget.
- Remotion Player for compiled compositions, in a sandboxed iframe.
- Op buffer and WebSocket transport with sequence numbers, acks, and reconnect replay.

Harness:
- Session actor per lesson with the state machine and a task registry with cancellation.
- WebSocket protocol, typed, shared with the client.
- Planner: streams the spine beat by beat.
- Brancher: per-beat parallel job producing predicted questions, misconceptions, and remediation nodes.
- Animator: per-composition job with transpile, static checks, three-frame server render, two retries, static fallback.
- Dispatcher: classifies input and selects from the graph's candidate menu. v0 implementation is a small Claude call with structured output behind an interface.
- Responder: generative fallback. v0 implementation is an Opus-class model at low effort behind the same interface as the Dispatcher's candidates.
- TTS service wrapper returning word timestamps, with per-sentence caching.
- Lesson graph store in Postgres as JSONB. Responder answers write back as new nodes.
- Observer: session-end reflection writing a learner profile with knowledge state and style preferences.
- Replay log of every model call and every client event per session.

Eval:
- Synthetic learner: a script that runs a lesson headlessly, answers checks correctly or incorrectly on a schedule, interrupts at scripted points with scripted questions, and records every latency and failure.
- Latency budget report per run, diffed against the table above.

Content:
- 10 seed topics spanning domains: merge sort, Gale-Shapley stable matching, time dilation, the Maillard reaction, Bayes' theorem, the TCP three-way handshake, eigenvectors, the light reactions of photosynthesis, binary search, the Doppler effect.

## Out of scope

- Voice input, barge-in detection, backchannel classification.
- Freehand circling or annotation. Click-to-reference only.
- Multi-session courses, scheduling, spaced review.
- Learning style preferences beyond the Observer's first pass.
- Jev or Mercury integration. Interfaces only, with Claude behind them.
- Composition templates. We log every visual spec and composition so templates can be derived later.
- Auth, billing, multi-tenant concerns. A single dev login is fine.
- Mobile layout. Desktop web only.
- Generated or retrieved images.

## Architecture summary

Three layers: a deterministic client runtime, a server harness that is code and not a model, and the model roles the harness calls. See the README for the layer diagram.

### Flow of a lesson

1. Learner submits a question. The client shows the topic shell. The harness fires the Planner at high effort and a small fast call for the calibration question in parallel.
2. The Planner streams the spine: for each beat, the spoken text, the visual spec, pins, and the check with its expected answer. Beat 1 uses only instant primitives by rule.
3. As each beat lands, the harness fans out three jobs that never block the spine: Brancher, Animator for any composition, TTS for the main path.
4. The learner answers the calibration question. Beat 1 starts immediately from pre-synthesized audio. If the answer contradicts a spine assumption for later beats, the harness replans from the first affected beat off the critical path.
5. Beats play. Checks grade locally. The playhead reports progress. Audio for the next beat is already cached.
6. On an interrupt, the client pauses locally and sends a snapshot. The Dispatcher classifies the input against the current candidate menu. High-confidence match plays the pre-authored node. Otherwise the Responder generates, and its answer is written back into the topic graph.
7. Every branch node carries a resume instruction: where to rejoin and the bridge sentence.
8. At session end the Observer updates the learner profile.

### Dispatcher routing

| Dispatcher result | Path | Who wrote the words |
|---|---|---|
| Navigation command | handled on the client before anything is sent | nobody |
| Check answer | graded locally, pre-authored reaction node | Planner |
| Matches a graph node with high confidence | fast path | Planner or Brancher |
| In-scope question with no node | Responder | generative model |
| Off topic, deep, or low confidence | Responder with a pre-authored filler line | generative model |
| Foundational gap | Responder now, replan from beat k in parallel | both |

### Protocol sketch

Ops from server to client, each with an id and sequence number: say, show, animate, pin, unpin, highlight, dim, clear, check, widget, note, resume.

Events from client to server: playhead progress, interrupt with soft or hard flag and snapshot, input text with pointed element ids, nav command, check answer, ack.

The op schema is the center of the design. It is defined once and shared by the Planner's output format, the Brancher's output format, the Responder's output format, the lesson graph store, the harness relay, and the client playhead.

### Model placement

One Opus-class model for Planner, Brancher, and Responder, with effort varied per role rather than switching models. The Planner thinks, the Responder talks. Dispatcher and Responder sit behind interfaces so a calibrated classifier or a diffusion model can replace them when measurement says so.

## Milestones

Each milestone has an exit criterion you can check in five minutes.

**M0, canned lesson.** Repo scaffold. Op schema and protocol. Board, playhead, TTS playback, local nav table, interrupt and resume. The merge sort lesson is a hand-written JSON file, no model calls. Exit: you can take the merge sort lesson, interrupt it mid-beat, go back, skip, and it feels right. This is the cheapest possible test of the UX thesis.

**M1, live lessons on primitives.** Planner spine streaming. Harness state machine and task registry. Responder for interrupts. Dispatcher as regex plus a small model call. Latency instrumentation on every hop. Exit: type any of the seed topics and get a live lesson with primitives only, interrupts answered within budget.

**M2, animations and the graph.** Animator pipeline with compile, validate, retry, fallback. Brancher fan-out. Lesson graph persistence. Responder write-back. Exit: the split-tree animation plays in a live merge sort lesson, a predicted question hits the fast path, and an unpredicted one becomes a node for the next run.

**M3, measure and dogfood.** Observer and learner profile. Synthetic learner across all 10 topics. Latency budget report. Five dogfood sessions. Exit: the latency table is met at p95, and the dogfood notes tell us what v1 is.

## Risks and how v0 handles them

- **Composition generation is unreliable.** Beat 1 is primitives only. Every composition has a static fallback. Compile rate is a tracked metric from M2 on.
- **Planner predictions miss what learners ask.** The fast-path hit rate is a tracked metric. The Responder covers misses, and write-back raises the rate over time.
- **Latency drifts as features land.** The synthetic learner runs the budget table on every change from M1 on.
- **Small fast models answer badly.** v0 uses an Opus-class model at low effort for the Responder. Tiering to a faster model is a measured change, not a default.
- **Model-written code runs in the browser.** Compositions are transpiled server-side, rendered for three frames server-side, and played in a sandboxed iframe with no network.
- **The calibration answer arrives after the spine starts.** Beat 1 is calibration-agnostic by rule. A contradiction triggers a replan from beat 3 that finishes long before beat 3 plays.

## Praxis assessment

Praxis is Yutori's orchestration framework for Scout: about 142K lines, built around a Tool to Agent to sub-agent hierarchy, asyncio pipe messaging between parent and child, Hydra-style `_target_` instantiation from YAML, model failover, replay logging, and DBOS spans.

Verdict: do not build on it. Three structural reasons.

1. **Its agent loop is step-synchronous.** A step is predict, dispatch tools, wait for every child to finish, repeat. Interrupts are checked only before a step and after predict, with a must-complete zone around tool execution. Our ops are not executed by the server. They stream to a client playhead, their results arrive seconds later and asynchronously, and interrupts must cancel in-flight generation. The loop shape is the opposite of what we need.
2. **Instantiation cost lands on the hot path.** Every sub-agent call constructs a new Agent, which constructs a new Model with new API clients, a new prompt builder, a replay logger, a pipe, and a report manager. For Scout that is fine. For a Dispatcher that runs on every utterance and a Responder that must speak in 400 ms, it is not. The concern about on-the-fly class instantiation is accurate.
3. **It is not standalone.** It imports from `yutori.core`, `yutori.utils`, `yutori.config`, and `yutori.env`, assumes an S3 bucket, a task and run id, and Scout-specific run context fields. Pulling it in means depending on the monorepo and its 129 top-level packages. It is also Yutori production code, which is a question to settle with them before any of it lands in a personal repo.

Praxis also streams only text deltas from the model, not tool inputs, and our ops are tool calls or structured output that need op-level streaming.

Worth borrowing as ideas, not code:
- A YAML config per role naming the model, effort, and prompt file, so roles are swappable without touching code. We do not need runtime class instantiation for this.
- The model gateway shape: client failover, per-call usage metering, time-to-first-token recorded on every call.
- Replay logging of every model call and tool result for debugging.
- The interrupt handshake notes in the chat agent design doc, especially the warning that a process-local interrupt registry breaks under multiple workers. v0 is single-process. v1 needs sticky sessions or a shared signal store.

The purpose-built harness is small. Session actor, state machine, task registry, prompt assembly, relay, and gateway should come in around two thousand lines.

## Open decision: implementation language

**Recommended: TypeScript end to end.** One pnpm monorepo with the Next.js client, the harness as a Node service with WebSockets, and the Animator's compile and render step. The op schema is one Zod module shared by every layer, which matters because that schema is the center of the design. Remotion is native. The agent logic is prompt assembly, streaming, and state machines, none of which needs Python.

**Alternative: Python harness.** FastAPI with WebSockets for the harness, Pydantic for the op schema with JSON Schema exported and TypeScript types generated at build time, and a small Node sidecar that exposes one endpoint for compile and render. Viable, and closer to the praxis idiom, at the cost of a second language and a generated schema boundary.

This is the one decision that changes the M0 scaffold. Everything above holds either way.
