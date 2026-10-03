# Measurement

How we will know whether the product works, as opposed to feeling like it works.

## The claim

A board-based, beat-paced, interruptible lesson produces better understanding of a concept than asking a strong chatbot the same question in the same amount of time, and learners' sense of how well they understand is better calibrated to what they can actually do.

The second half matters. Fluent explanations are known to produce an illusion of understanding: people feel they got it and then cannot apply it. The checks in every beat exist to close that gap, so calibration is a primary outcome, not a nice-to-have.

## Three layers

**1. System metrics.** Automated, every run, from the synthetic learner and from production logs. The latency table, completion rate, composition compile rate, fast-path hit rate, replan rate, per-beat check pass rate, interrupt rate by type per beat, drop-off per beat, and Responder answer quality scored by a rubric with an LLM judge and a human sample. These tell us the system works and which beats are weak. They say nothing about learning.

**2. Learning outcomes.** Humans, under the protocol below. This is the only layer that can support the claim.

**3. Why.** Short interviews after each session and think-aloud recordings for a handful of sessions. This is where v1 scope comes from.

## Protocol

**Design.** Within-subject, counterbalanced. Each participant learns two topics they do not already know, one through a lesson and one by asking a chatbot. Topic-to-condition assignment is randomized and balanced so every topic appears in both conditions equally often across participants. Within-subject halves the sample needed and controls for individual differences.

**Control condition.** A strong frontier chatbot, the same opening question, free follow-ups, same time cap. The comparison has to be against the best chatbot experience, not a weak one.

**Time cap.** Ten minutes per topic in both conditions. Equal time makes the gain comparison fair and keeps sessions short.

**Pre-test.** Four to six items per topic. A topic is excluded for a participant who scores above half, because there is nothing left to learn.

**Immediate post-test.** Eight to ten items per topic: two recall, four application to a new instance, two or three transfer or edge-case items, and one "explain it to someone who has never heard of it" free response graded against a rubric. Items never reuse the lesson's own examples.

**Delayed post-test.** A parallel form of the post-test three to seven days later, delivered by link. Retention is where pacing and checks should show up most.

**Confidence.** Before each post-test, one overall rating of understanding on a seven-point scale, and a confidence rating on every item.

**Grading.** Free responses graded by someone who does not know which condition produced them.

## Metrics

| Metric | Definition |
|---|---|
| Normalized learning gain | (post minus pre) divided by (maximum minus pre), the standard measure in education research |
| Retention | delayed score divided by immediate post score |
| Calibration gap | absolute difference between rated confidence and actual score, per item and overall |
| Efficiency | normalized gain per minute of time on task |
| Primary metric | normalized gain on the application and transfer items only, pre-registered before the study runs |

Analysis is paired per participant: the gain on their lesson topic against the gain on their chatbot topic. Report the effect size with a confidence interval, not only a p-value.

## Sample size and phasing

- **v0, five to ten people.** The purpose is to build and debug the instrument: the quizzes, the timing, the grading rubric, the delayed-test delivery. We do not make the claim at this size. We do collect preference and interview notes for v1 scope.
- **v1, thirty to forty people.** Enough for a medium effect in a paired design at conventional power. This is where the claim is tested.

## Item quality

Quizzes are written per topic and reviewed by a second person. The same quiz is used in both conditions. Items are piloted on two or three people first, and any item everyone gets right or everyone gets wrong is dropped.

## Simulated learners

LLM-simulated learners with personas and seeded misconceptions run the same pre/post protocol at scale. They are useful for regression testing lesson quality, the Dispatcher's routing, and the Responder's answers between human studies. They are not evidence about human learning, and reports keep the two clearly separated.

## What counts as success

- **v0.** The instrument runs end to end on the dogfood participants. The interviews tell us what v1 is.
- **v1.** Lesson gain exceeds chatbot gain with a confidence interval that excludes zero, or equals it in less time, and the calibration gap is smaller for lessons.

## After launch

Per-beat pass rate, interrupt type distribution, "I don't get it" rate, drop-off per beat, repeat usage, and the rate at which learners choose to go deeper at the end of a lesson. Plus periodic opt-in post-tests as an in-product learning signal, so the learning measurement does not stop when the study does.
