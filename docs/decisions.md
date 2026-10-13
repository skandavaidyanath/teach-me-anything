# Decisions

Design decisions made so far, with the reasoning. Dated 2026-10-02 unless noted. Newer decisions supersede older ones where they conflict, and the superseded ones are marked.

1. **The core object is a board, not a chat window.** The board is a structured document whose elements have ids and labels. The model drives it through ops, never through prose. This gives pacing, persistence, and cheap pointing for free.

2. **A lesson is a sequence of beats.** Each beat introduces one idea and ends in one check. The schema enforces it. The model cannot dump five ideas because a beat ends at a check.

3. **Checks have known expected answers and grade on the client.** Instant feedback at zero latency. The tutor's spoken reaction follows about a second later, which reads as a natural pause.

4. **Checkpoints are engagement-aware.** If the learner has interrupted, pointed, or answered a micro-check recently, skip the "does that make sense?" If they have been passive for two or three beats, ask, and offer a cheap exit such as redoing it with an example.

5. **The Planner writes the words ahead of time.** Supersedes an earlier design where a Tutor improvised narration just in time. The Planner streams a spine with the spoken text of the main path pre-written. Pre-synthesized audio means beat 1 starts about 100 ms after the calibration tap.

6. **Branches are per-beat parallel jobs, never part of the spine stream.** Predicted questions, misconceptions, and remediation nodes come from a Brancher that fans out as each beat lands, alongside the Animator and TTS. The spine never waits.

7. **Two kinds of visuals.** Declarative primitives are instant, op-driven, interactive, and hit-testable. Compiled compositions are slow and cinematic. The Animator builds only the second kind, and the Planner schedules them only where lead time exists. Beat 1 is primitives only.

8. **Code-rendered animation, not generated video.** Remotion compositions written by the model, played in the browser, deterministic and seekable. Markers in the composition align to words in the narration via TTS word timestamps so pause, seek, and resume stay in sync.

9. **Interruption is client-local and instant.** Starting to type is a soft interrupt that pauses at the next sentence boundary. Submitting is a hard interrupt. Navigation commands resolve from a local table in zero round trips. The server learns about the pause after it has happened.

10. **Resume is a decision, not a default.** Continue, rewind, revise, or skip, each with a model-written bridge sentence. Pre-authored branch nodes carry their resume instruction. The lesson resumes automatically after an aside, and the learner can interrupt again.

11. **A fast Dispatcher routes input over the lesson graph.** Its decision fields are fixed and its candidate list is dynamic. v0 uses a small Claude call with structured output. A calibrated classifier such as Jev is a candidate replacement behind the same interface.

12. **A generative Responder covers what the graph did not predict.** v0 uses an Opus-class model at low effort. A diffusion model such as Mercury is a candidate for the in-scope tier behind the same interface. Tiering is a measured change.

13. **Responder answers write back into the topic graph.** The graph for a topic gets richer with every learner and the fast-path hit rate rises. This is where content caching lives. Composition templates are deferred until logs show which shapes repeat.

14. **The harness is code, not a model.** The workflow is fixed: plan, branch, build, play, observe. An LLM orchestrator would add latency and nondeterminism and buy nothing.

15. **Text in, voice out for v0.** Voice output is cheap and changes how the product feels. Voice input with barge-in is its own project and lands in v1. The UI is designed for voice from day one: short on-screen text, the board carries the content.

16. **Memory covers knowledge state and style preferences.** Knowledge state is a concept map with status, confidence, and evidence. Preferences are keyed traits with confidence and evidence that decay when unused. v0's Observer runs at session end only.

17. **Scope is the single-concept lesson.** Three to ten minutes, four to eight beats. Courses, scheduling, and spaced review are a different product and are deferred.

18. **The calibration question is also a latency mask.** It is asked while the Planner streams. Beat 1 is calibration-agnostic by rule. If the answer contradicts later beats, the harness replans from the first affected beat off the critical path.

19. **Not building on praxis.** Its step-synchronous loop, per-call instantiation cost, and monorepo coupling do not fit a playhead-driven, latency-bound product. Ideas borrowed: per-role YAML config, the model gateway shape, replay logging, and the interrupt handshake lessons. See the praxis section of the v0 plan.

20. **One model family, effort varied per role.** The Planner thinks at high effort, the Responder talks at low effort. Keeping one model keeps one prompt cache namespace. Switching models is a measured optimization, not a default.

21. **References kept in mind, not adopted.** Context Language Models (arXiv 2609.37725) for the shared-workspace idea and model-kept notes. TypeSafe's Jev for calibrated structured decisions. Inception's Mercury for fast generation. None are v0 dependencies.

22. **TypeScript on the request path, Python offline.** The op schema is one Zod module shared by client, harness, and content. Remotion needs Node anyway. Hosted model APIs are HTTP with TypeScript SDKs at parity. Analysis, the grading pipeline, and any fine-tuning of a Dispatcher or Responder stay in Python, reading replay logs and the database, never in the latency path.

23. **Engine semantics, fixed in v0.0.** The board is always the replay of executed ops, so seek and rewind are recomputation, not undo. "Go back" pops history to the previous sentence boundary and requeues lesson ops; spliced reaction ops are dropped and the check is re-asked. Skip and forward jumps fast-forward the board silently: shows, updates, clears, and pins are applied, checks follow their correct path, highlights are dropped. Asides run on a swapped-in queue and remove what they put on the stage when they finish. Pins persist across everything except an explicit rewind past them.

24. **Build in increments the user can check.** Each v0.x step is small enough to evaluate by using it, not reading it, before the next step builds on it. The increments table in the v0 plan is the sequence.

25. **Things travel, they do not teleport.** Any value that moves between containers keeps its identity and animates along the way, through a `move` op and a FLIP pass over the board. The same pass carries a pin from its spotlight on the stage into the rail. Motion shows what changed; it is never decoration.

26. **The Responder speaks prose with directives, streamed.** It writes plain sentences, plus `@highlight`, `@pin`, and a final `@resume` line. The harness turns each completed sentence into a `say` op the moment it is complete, so the first sentence is on its way to TTS while the model is still writing. Structured JSON output would have forced the client to wait for the whole answer.

27. **Voice comes through the harness, with word timestamps.** The client speaks through a server speaker that fetches audio and per-word timing from the harness, decodes it with the Web Audio API, and drives the caption from the timestamps. The same timestamps will drive blackboard writing. The browser speech engine remains the offline fallback.

28. **A filler covers a slow answer.** If the Responder's first sentence has not arrived within 900 ms, a short pre-synthesized filler plays. It is a mask, not a fix, and the latency readout keeps the real number visible.

29. **The client falls back to local on any harness failure.** No connection, no header within 2.5 seconds, or an answer that errors all degrade to the bundled lesson, browser speech, or the canned apology. The lesson never stalls on the server.

30. **The tutor may draw, in a layer.** Anything the Responder shows renders over the lesson's board, which dims behind it, and is removed when the lesson resumes. It may highlight the lesson's own elements but never alter or clear them, so the lesson's later ops stay valid. Same rule for pre-authored branches.

31. **Callbacks are an interim mechanism, not the design.** A model-written sentence that plays when a later beat starts closes the "explained as if new" gap while beat narration is fixed text. Once narration is generated or revised at beat start with the session record in context, callbacks are unnecessary and should go.

32. **Two tiers, no Dispatcher, no asides.** Supersedes 11, 12, 30, and 31. A slow Planner writes the lesson; a fast Tutor owns the words from then on. A question is not an aside with a bridge back: the Tutor returns the pending script edited, answer first, and the lesson simply continues from the edited script. Callbacks are gone because the Tutor edits the next beat's opening directly.

33. **The script is a reference for words and anchors for visuals.** The Tutor may reword, drop, or add sentences and its own drawings; it must keep every board op of the pending script, in order. The harness validates the anchors and falls back to the authored script if they are missing. This one rule keeps a rewritten beat from desyncing the stage.

34. **Review only when something happened.** At a check, the Tutor reviews the next beat only if the record changed since that beat was written: a question, a wrong answer, a skip, a jump, or the calibration answer for beat 2. A quiet lesson costs no model calls and plays its authored words with audio already synthesized.

35. **The Planner opens fast and finishes slow.** Header, calibration, outline, and beat 1 at low effort so the learner starts within seconds; the rest at high effort while beat 1 plays. Replans run from a future beat only, requested by the Tutor, and the Tutor covers the gap by asking early and by keeping the current beat playing.

36. **Figures as code, as a primitive, not instead of primitives.** A `component` element carries the body of an HTML page that runs in a sandboxed frame (opaque origin, inline script and style only, no network). Its state is data: the script drives it with `update` ops, the Tutor with `@update`, and replay still works because the board is still the replay of ops. A prelude gives the code a clock the lesson pauses, highlight delivery, and click reporting through named parts, so a figure plays by the same rules as a row or a tree. The Planner writes figures in COMPONENT blocks so the code is not escaped inside JSON, and attaches them to beats by reference. Beat 1 stays on the instant primitives so a lesson still starts in seconds. Model-written code that fails shows a fallback card, never breaks the board.

37. **Every question goes to the Tutor.** Supersedes the pre-authored branch fast path for questions (decision 23's asides already went in 32). A regex cannot tell "tell me about the car" from "I don't get the car", and the v0.2 review showed the cost: the same canned answer twice, with nothing drawn. Prepared answers remain content: they reach the Tutor as hints it may use in its own words. Navigation commands stay local. Offline, a branch still plays, because then there is no Tutor.

38. **The Tutor is on Sonnet, and the next beat waits for a review.** Measured first-token time on Opus at low effort ranged from 1.3 to 6.9 s; Sonnet with the same prompt lands at about 0.8 s and the answer quality in the first live runs held. Reviews that arrived after the next beat had started were discarded; the playhead now holds the beat boundary up to 2.5 s for a review that is still out, with the caption showing "Thinking", and plays the authored opening if the review never comes.

39. **A repeat is a different picture, and the harness checks.** The record keeps each answer's opening sentence and what it drew, so when a learner says they still do not get it, the Tutor can see what was tried and must change representation: a different drawing, a concrete case, the lesson's figure switched to another viewpoint or state. The prompt makes the first line of any answer a drawing, with an explicit `@nodraw` escape for questions of fact, so the choice is a visible token rather than a mood. Live runs at low effort still produced word-only repeats about half the time, so the rule is enforced: when a repeat (asked again in the same part, or "still", "don't get", "lost") comes back without a show or update, the harness makes one more short call for the picture alone and plays it into the answer. The replay log records whether that happened, which makes the compliance rate measurable. A repeat also runs at medium effort, which cost nothing measurable in first-token time. What holds after seven live runs: every answer drew (7 of 7 first answers, 5 of 5 repeats). What does not yet hold: "differs in kind". Given a figure with a viewpoint switch in its state and a record saying a car scene was already drawn, the Tutor redrew the learner's car four times out of five rather than switching the figure, at low and at medium effort. It is a defensible choice (the rotating view is a later part) but not the one the rule asks for. The next lever is structural, forcing a figure-state change on a repeat when the figure has one, and whether that is wanted is an open question for the reviewer.
