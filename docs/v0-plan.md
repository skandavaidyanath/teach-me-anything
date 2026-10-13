# v0 Plan

Date: 2026-10-02. Status: agreed. The language decision at the end is settled: TypeScript on the request path, Python offline.

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

Learning outcomes: measured by the protocol in [measurement.md](measurement.md), a within-subject comparison against a strong chatbot with pre, post, and delayed tests and a calibration measure. In v0 we run the protocol on five to ten people to build and debug the instrument. The claim itself is tested in v1 at thirty to forty people. v0 does not claim victory on preference alone.

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

### Two tiers (decided 2026-10-07)

The roles collapsed to two. The **Planner** is slow and runs twice per lesson: a fast opening call writes the header, calibration question, outline, and beat 1 so the learner can start within seconds; a high-effort call writes the remaining beats while beat 1 plays. It runs again only when the Tutor asks for a replan from a future beat. The **Tutor** is fast and owns the words from then on. It is triggered by a question, when it returns the pending script edited with the answer first, and at a check when the record changed since the next beat was written, when it reviews that beat. Board ops are anchors it must keep in order; the sentences around them are its own. Pre-authored branches remain a zero-latency fast path. There is no Dispatcher and no aside system; a question is an edit to one stream of narration.

### Model placement

One Opus-class model for Planner, Brancher, and Responder, with effort varied per role rather than switching models. The Planner thinks, the Responder talks. Dispatcher and Responder sit behind interfaces so a calibrated classifier or a diffusion model can replace them when measurement says so.

## Increments

The milestones below are the engineering shape. These are the finer steps we actually ship, each small enough to check the user experience before the next one builds on it. Reordered twice after reviews: first to bring the live tutor and real voice forward, then on 2026-10-07 to collapse the roles into two tiers before adding anything else.

| Increment | What lands | What to check as a user | Status |
|---|---|---|---|
| v0.0 | Board, playhead, hand-written merge sort lesson, browser voice, local interrupts, navigation, pre-authored branches | Rhythm. Does the interrupt feel smooth. Does the board carry the content without reading captions. | built 2026-10-02, reviewed 2026-10-06 |
| v0.0.1 | Layout from the review: caption on top, wider rail with stamped pins and spoken pin cues, primitives scaled up | Do pins register as moments. Is the script where the eye goes. | built 2026-10-06 |
| v0.0.2 | Motion: a `move` op so values travel between rows, FLIP animation for anything that changes position, pin spotlight that flies into the rail instead of a spoken cue | Do the moves read as the algorithm's steps. Does the pin moment land without words. | built 2026-10-06 |
| v0.1 | Harness skeleton: WebSocket, session actor, the canned lesson streamed as ops from the server. Real TTS with word timestamps behind the speaker interface. Live Responder for unpredicted questions, answers played as ops | Voice you can listen to for ten minutes. Ask anything and get a real answer in context, then a clean resume. | built 2026-10-06 |
| v0.1.1 | The tutor can draw in a layer over the board. Outline-aware answers with callbacks. Two new primitives, derivation and scene. Two new lessons, ELBO and centrifugal force. Lesson picker. | Do the three lessons read as one product. Does a drawn answer help. | built 2026-10-07, callbacks judged bolted-on |
| v0.2 | Two tiers. A slow Planner writes any lesson from a topic in two calls, a fast opening then the rest while beat 1 plays. A fast Tutor owns the words: on a question it returns the pending script edited with the answer first; at a check, if anything happened since the next beat was written, it reviews that beat. Board ops are anchors the Tutor must keep in order. Asides, bridges, and callbacks removed. `@replan` wired to the Planner. Landing page for any topic. | Ask for a lesson on anything and judge it. Ask a question and listen to how the lesson picks up afterwards. Get a check wrong and see whether the next part knows. | built 2026-10-07 |
| v0.3 | Figures as code. A `component` element: the body of an HTML page that runs in a sandboxed frame on the board, renders from a state object the script drives with `update` ops, animates on a clock the lesson pauses, and exposes named parts to highlight and click checks. The Planner writes one per lesson in a COMPONENT block and drives it from later beats; the Tutor can change its state mid-answer (undone afterwards) or write its own. Every non-navigation input goes to the Tutor, with the lesson's prepared answers as hints; a repeated question must change representation. Teaching rules in the Planner: show, don't ask to imagine; introduce symbols before use; checks are predictions. Tutor on Sonnet. The next beat waits up to 2.5 s for a review that is still out. | Does a lesson on something physical show the thing moving. Ask a question, then say you still don't get it, and see whether the second answer is a different picture. Is the answer fast enough now. | built 2026-10-13 |
| v0.3.1 | Blackboard writing primitive: handwriting in sync with speech, driven by the same word timestamps as the caption. Board styling toward the engraved-plate reference in docs/references.md: paper, ink, hatching, figure captions, camera focus, zoom-out recap | Does writing-as-you-speak beat cards and captions for explanation. | |
| v0.4 | Animator with Remotion compositions, fallback, compile metrics | Does animation earn its place over primitives and writing. | |
| v0.5 | Observer, synthetic learner, measurement instrument, latency work: stream audio chunks, faster tier where measurement says so | Latency table at p95. Instrument runs end to end. | |

## Milestones

Each milestone has an exit criterion you can check in five minutes.

**M0, canned lesson.** Repo scaffold. Op schema and protocol. Board, playhead, TTS playback, local nav table, interrupt and resume. The merge sort lesson is a hand-written JSON file, no model calls. Exit: you can take the merge sort lesson, interrupt it mid-beat, go back, skip, and it feels right. This is the cheapest possible test of the UX thesis.

**M1, live lessons on primitives.** Planner spine streaming. Harness state machine and task registry. Responder for interrupts. Dispatcher as regex plus a small model call. Latency instrumentation on every hop. Exit: type any of the seed topics and get a live lesson with primitives only, interrupts answered within budget.

**M2, animations and the graph.** Animator pipeline with compile, validate, retry, fallback. Brancher fan-out. Lesson graph persistence. Responder write-back. Exit: the split-tree animation plays in a live merge sort lesson, a predicted question hits the fast path, and an unpredicted one becomes a node for the next run.

**M3, measure and dogfood.** Observer and learner profile. Synthetic learner across all 10 topics. Latency budget report. The measurement instrument from measurement.md: quizzes for the seed topics, timing, delayed-test delivery, grading rubric. Five to ten dogfood sessions run under the protocol. Exit: the latency table is met at p95, the instrument runs end to end, and the interview notes tell us what v1 is.

## Measured so far

Live runs on a laptop against the APIs, single sessions, not yet the synthetic learner.

| Moment | Measured | Budget |
|---|---|---|
| Round trip to the harness | 1 to 4 ms | |
| One sentence of TTS, uncached | 600 to 1500 ms | |
| One sentence of TTS, cached | 0 ms server side | |
| Planner: topic to calibration question on screen | 5 to 8 s | |
| Planner: beat 1 ready | about 17 s after the topic, written while the learner reads the calibration question | 2 s after the calibration answer |
| Planner: beats 3 to 5 | 78 to 107 s after the topic, written at high effort while the first beats play | before each is needed |
| Tutor: question to filler audio | 1.2 s | |
| Tutor: question to first answer sentence, Opus | 2.6 to 6.9 s | 1.5 s |
| Tutor: question to first answer sentence, Sonnet (v0.3) | 1.2 to 2.1 s, first token 0.75 to 0.8 s | 1.5 s |
| Tutor: question fully answered and window edited | 3.6 to 3.9 s | |
| Tutor: review of the next beat at a check | 1.3 to 4.3 s | hidden behind the reaction; the beat now waits up to 2.5 s |
| Planner: beat 2 with a component, v0.3 | 43 to 51 s after the topic once beats 1 and 2 are written concurrently (69 to 76 s when written in sequence) | before beat 1's check is answered |
| Tutor: a repeat or "I don't get it", at medium effort | first token 0.75 to 0.93 s, done 4.0 to 4.5 s | no visible cost over low effort |

Two of the first three Planner runs produced beats that were not valid JSON; the harness now repairs the usual slips and asks the model to fix the rest, and the fast tier writes beats 1 and 2 so the slow tier has two beats of runway. Moving the Tutor to Sonnet took the first answer sentence from a 2.6 to 6.9 s spread down to 1.0 to 2.5 s, inside the filler's reach, with one 4.8 s first-token outlier in seven runs. Beat 2 is slower when it carries a figure's code, about 40 s of writing; written in sequence after beat 1 it arrived after beat 1's check in one run (a 15 s wait), so the fast tier now writes beats 1 and 2 concurrently and beat 2 lands at 43 to 51 s, before the check in every run since.

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

## Implementation language

Decided 2026-10-02: TypeScript on the request path, Python for the offline path (analysis, grading pipeline, any future fine-tuning).

**TypeScript end to end.** One pnpm monorepo with the Next.js client, the harness as a Node service with WebSockets, and the Animator's compile and render step. The op schema is one Zod module shared by every layer, which matters because that schema is the center of the design. Remotion is native. The agent logic is prompt assembly, streaming, and state machines, none of which needs Python.

**Alternative: Python harness.** FastAPI with WebSockets for the harness, Pydantic for the op schema with JSON Schema exported and TypeScript types generated at build time, and a small Node sidecar that exposes one endpoint for compile and render. Viable, and closer to the praxis idiom, at the cost of a second language and a generated schema boundary.

Hosted model APIs are HTTP and have TypeScript SDKs with parity. Research tooling is Python-first, which is why training and analysis stay in Python, off the latency path.
