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

## v0.1, reviewed 2026-10-07

Verdict: the new voice is good, and answering questions mid-lesson is good.

What was raised and what changed:

- **The tutor explained splitting with no visual.** It could only speak, highlight, and pin. Changed in v0.1.1: it can now show rows, trees, cards, and formulas and move cells among its own rows. Drawings appear in a layer over the lesson's board, which dims behind them, and clear when the lesson resumes. It cannot alter the lesson's own elements, only highlight them, so later steps stay consistent. In the first live test it chose to answer in words and highlight the two fronts rather than draw, which is a reasonable call for that question.
- **After the question, the lesson explained splitting as if for the first time.** Root cause: the lesson's narration is pre-written, so no model is in the loop when a beat starts. Interim change in v0.1.1: the tutor sees the outline with covered, current, and upcoming beats, says when a question jumps ahead, and leaves a model-written callback sentence that plays when that beat begins. In the live test it wrote "This is where those sorted lists come from, the thing you asked about earlier, now step by step." The reviewer's reaction: this feels bolted on and non-LLM; with the right context the Planner and Tutor would handle it naturally. Agreed. The callback is a patch over fixed text. The real fix is narration that is generated or revised at beat start with the session so far in context, and that is proposed as the next increment, ahead of blackboard writing.
- **More lessons to evaluate across.** Added the ELBO derivation and centrifugal force, which needed two new primitives: a derivation stack revealed line by line, and a declarative 2D diagram with movable items and arrows. All three lessons validate under the same rules.

Question raised, answered in the plan's architecture notes: what tools do the Tutor and Planner get, and how do they share what happened. The shared record is the session workspace, already written to the per-session replay log; the next increment reads it at beat start.

## Design review, 2026-10-07

Raised: callbacks feel bolted-on; with context the Planner and Tutor would handle it naturally. Then: do Responder and Tutor need to be different roles at all; what tools do they get and how do they share state; when does the Planner re-trigger; and finally, leave the Dispatcher out and try a simple two-tier model first.

Changed in v0.2: Responder and Tutor merged into one Tutor that edits the pending script, with the answer first and the board ops as fixed anchors. Asides, bridges, and callbacks deleted. The Planner went live for any topic, opening fast and finishing while beat 1 plays. Replan requests from the Tutor are wired through. The shared record is the session log the client and harness both keep: calibration, questions and answers, check results, skips, jumps.


## v0.2, reviewed 2026-10-12 (centrifugal force, the hand-written lesson)

Verdict: everything is dynamic and any question gets handled. Question latency still too high. The bigger issue: the board is underused and answers are mostly plain speech; a repeated "I don't get the car example" got the same words twice with no visual; the script feels like a chat converted to a tutorial, with generic checks; omega appeared in a formula without being introduced; "imagine you're sitting on the ball" needed a moving picture, not a sentence.

What the log (`c1135373`) shows:

- **The two "I don't get it" messages never reached the Tutor.** Both matched the pre-authored regex branch `br.car` (patterns include "car" and "turn(ing)?"), and the playhead routes branches before the Tutor. The same two canned sentences played twice, no model in the loop, nothing drawn. The zero-latency fast path cannot tell "tell me about the car" from "I don't understand the car", and nothing stops a branch from repeating. Design error, not a model error.
- **Ask latency was 4.8 s and 6.9 s to first token** (done at 6.4 s and 9.5 s), against 2.6 to 2.9 s measured on 2026-10-07. Reviews took 1.3 to 3.8 s to first token for 26 to 110 output tokens. The cost is first-token time on the big model at low effort, not output length; the answer sentences stream first. One review (beat 4) arrived 0.5 s after the beat had started and was discarded.
- **The Tutor has no scene directive.** It can draw rows, trees, cards, formulas, derivations, and highlight the lesson's scene items. It cannot draw a ball, a frame, or an arrow of its own, which in a physics lesson is the only primitive that matters. Its prompt also frames drawing as the exception ("when words alone will not do"). The two real questions got one formula card and one highlight.
- **The lesson was the hand-written one** (`centrifugal-v0`), not Planner output. The omega gap is a content bug: the formula card shows F = m v² / r = m ω² r and no say line introduces ω. The check "What is centrifugal force?" is recall of the sentence just spoken. The Planner's rules would produce the same shape: they constrain format, not teaching moves.
- **The scene primitive is static.** Beat 3 says "imagine you are a tiny rider sitting on the ball" and updates a still picture with a label. The explanation needs the ball to move and the view to lock onto it so the world turns instead.

What changed in v0.3 (built 2026-10-13), in the order proposed:

1. Every non-navigation input goes to the Tutor. Planner-authored branch answers become reference text in the Tutor's prompt, so their wording stays free but the decision is the model's. A question asked twice means "a different way", and the different way must draw.
2. The Tutor gets `@scene` and arrow, dot, label, and path items, can draw over the lesson's scene at its coordinates, and its prompt is flipped to draw by default for anything spatial or quantitative.
3. Scene motion: items that orbit or follow a path, and a frame that attaches to an item so the viewport rotates with it. Planner rules gain teaching moves: never say "imagine" without showing it; no symbol appears on the board before it is introduced; a check asks for a prediction before the reveal, not a definition after it. Regenerate the centrifugal lesson with the Planner and compare it with the hand-written one.
4. Tutor on a smaller model (Sonnet 5.5) with the same prompt, measured against Opus on first-token time and answer quality. Apply a late review if the reviewed lines have not played yet.
5. Blackboard writing moves after these; the visuals problem is upstream of handwriting.

Decided with the reviewer on 2026-10-12: give the Tutor and the Planner full coding flexibility rather than more fixed primitives. Built as a `component` element (decision 36). First live run on a Planner-written centrifugal force lesson: beat 2 arrived with a figure of a ball on a string, orbiting, with velocity and tension arrows that follow it and a state the later beats drive (speed, string snapped, viewpoint). The highlight glow lands on the arrow the narration names. The car question was answered in 1.2 s to the first sentence with a drawn car scene; the follow-up "I still don't get it" redrew a car scene in the first run because the record did not say what the first answer had drawn. Fixed in three steps across four live runs: the record now carries each answer's opening sentence and drawings (and the filler and no-op state updates are kept out of it); the first line of an answer is a drawing or an explicit @nodraw; and because Sonnet at low effort still answered a repeat in words about half the time, the harness now enforces the rule with one extra call for the picture when a repeat drew nothing (decision 39). Question latency on Sonnet: first token 0.66 to 0.96 s (one 4.8 s outlier), first sentence 1.0 to 2.5 s, done 2.9 to 4.5 s. Across seven live runs every answer drew; on a repeat the Tutor drew the learner's car again four times out of five rather than switching the lesson's figure to the rotating view, so "a different kind of picture" is the open item (decision 39). Writing beats 1 and 2 concurrently moved beat 2's arrival from about 70 s to 43 to 51 s after the topic, ahead of beat 1's check.

## Style pass, 2026-10-13

Asked for: lessons that follow Veritasium and 3Blue1Brown (visual demonstrations) and Khan Academy and Numberphile (explaining while writing), as references for both style and script structure, and to compare against the real videos before claiming it works.

Done: captions pulled for one video from each channel (two from Veritasium: entropy, and gravity as curved spacetime; 3Blue1Brown's derivative paradox; Khan Academy's derivative as a concept; Numberphile's Josephus problem), read in full, and distilled into `apps/harness/prompts/style.md` with each move attributed. Three lessons were planned before and after, read against the transcripts, and counted.

What the transcripts corrected in the first draft of the guide, which had been written from memory: the voice is "I" (the teacher's own thinking) and "you" (the learner) far more than "we"; the teachers voice the learner's objection out loud and answer it ("whoa, but he is obviously accelerating"); after a subtle reveal they say what they are not claiming; they tell you when confusion is the right reaction; Numberphile gathers small cases by hand and states a conjecture before proving it; Khan narrates every stroke ("this point right here"); notation arrives with the reason it is good. "Imagine" is fine when the thing is on screen at that moment.

Voice counts, whole transcript versus all say lines of a lesson (sentences, average words per sentence, "I", "you", questions, voiced objections):

| Source | Sentences | Words/sentence | I | you | Questions | Objections |
|---|---|---|---|---|---|---|
| 3Blue1Brown, derivative | 135 | 21.6 | 30 | 56 | 9 | 3 |
| Numberphile, Josephus | 222 | 12.3 | 62 | 51 | 17 | 1 |
| Veritasium, entropy | 281 | 15.1 | 25 | 39 | 26 | 4 |
| Veritasium, gravity | 130 | 19.6 | 22 | 71 | 12 | 6 |
| Ours, centrifugal, first draft of the guide | 38 | 20.1 | 1 | 16 | 0 | 0 |
| Ours, centrifugal, guide from transcripts | 43 | 22.5 | 9 | 25 | 2 | 2 |
| Ours, derivative of x², first draft | 36 | 20.2 | 2 | 1 | 0 | 0 |
| Ours, derivative of x², from transcripts | 56 | 20.8 | 5 | 10 | 4 | 1 |
| Ours, Josephus, from transcripts | 62 | 20.9 | 5 | 11 | 2 | 0 |

What now reads like the references, in the lessons under docs/examples: the hook as a claim ("the force that throws you against the car door does not exist, and by the end you will see what is really going on"), "pause here and decide where the ball goes", "notice what I am not saying: I am not saying the pull drags the ball in", "whoa, but if the only real force points in, why does the outward shove feel so real", "if that feels like cheating, good", "I like this formula because the v squared is the quadrupling you just watched", the formula last with each symbol pointed at a part, and the return to the opening claim. The Josephus lesson in write-along mode follows the Numberphile video's own structure: start with seven, work every kill by hand, gather one through eight, "that surprised me, seat one is back", spot the climb by two, state the rule, check it against the table, swap numbers for symbols in the same places, then explain why powers of two reset.

What still differs: our sentences run about 21 words against 12 to 15 in the spoken sources, and we ask the learner a question every 15 to 30 sentences where the sources ask every 5 to 10. Added to the guide as numeric rules (most sentences under fifteen words; a question to the learner every few sentences), then checked on a topic not used while writing the guide, "why is the sky blue": 48 sentences at 17.6 words, 9 questions, 1 voiced objection, 16 "you". That is inside the sources' range on both counts. The four example lessons are in docs/examples.

## Pacing and sentence length, 2026-10-13

Raised after the style pass: our sentences were still longer than spoken video and hard to follow, and key ideas need to be said slowly instead of everything at one pace and tone.

What changed (decision 41): a say op is one sentence of at most eighteen words, the harness splits any op holding several sentences, logs words per sentence for every beat, and makes one short call to split anything past twenty-six words. One sentence per beat is marked `key`: spoken slowly through Cartesia's speed control, followed by 700 ms of silence, set apart in the caption. The Tutor marks its own with `@key`.

Measured on three fresh topics after the change (bicycle balance, the moon's far side, a refrigerator): 11.5 to 13 words per sentence in every beat, longest 13 to 17, one key line per beat, zero sentences needing the repair call. Key lines as written: "The bike steers itself into its own lean." "One turn per lap keeps the same face on Earth." "Tides brake the spin until it matches the orbit."

Not verified: how the slowed key line sounds. Cartesia returned HTTP 402 (credits used up) during the evening's runs, so the speed field is built to the documented API and present in the request, but no audio came back to listen to. The account needs topping up before the next review.

Side effect found and fixed: the style guide roughly doubled the Planner's output at high effort, which pushed beat 3 to 228 s in one run. The slow tier now writes beat 3 alone at medium effort the moment beat 2 is done, with the rest streamed in parallel; beat 3 landed at 62 s on the next run.

Reviewer, same day: "one sentence per beat", "at most 18 words": these are heuristics that will come back to bite us; the model should use its intelligence to decide when to speak slowly and how long sentences should be. Removed: the word caps in the prompts, the one-key-per-beat rule and its enforcement, and the second call that split long sentences. Kept: the pace, key, and pause controls as capabilities the model uses at its discretion, the explanation in the style guide of why spoken sentences are short, and the per-beat word counts in the log as a measurement.

Measured after the removal, on a fresh topic ("why does ice float"), with the reason explained and no cap: 46 sentences at 21.3 words on average, longest 35; one or two key lines per beat, several of them over twenty words; one pause op placed by the model on its own. So with reasons alone the model writes at the length of the first guide, not of the spoken sources. That is now the known cost of leaving the choice to the model, and the levers that stay within that choice are better reasons and examples in the guide, or showing the model its own numbers next to the sources' as information. Whether to pull either is the reviewer's call.

Cartesia credits restored the same evening; the speed path verified: one fresh 12-word sentence ran 8.24 s at speed 1, 9.12 s at 0.85 (the key-line setting), 9.84 s at 0.7. Cartesia treats speed as guidance, so 0.85 is a gentle slowdown; the mapping from "slow" to a number lives in one place in the client (PACE_SPEED) if it should be stronger.

