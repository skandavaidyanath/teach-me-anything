import type { Lesson } from "@tma/schema";

/**
 * Hand-written v0.1 lesson. A derivation revealed one line at a time, with a
 * small diagram for Jensen's inequality. One sentence per `say`; every beat
 * ends in one check.
 */
export const elboLesson: Lesson = {
  id: "elbo-v0",
  topic: "the evidence lower bound (ELBO)",
  title: "Deriving the ELBO",
  calibration: {
    prompt: "Quick check before we start: how comfortable are you with expectations and KL divergence?",
    options: ["Comfortable", "Rusty", "New to them"],
  },
  beats: [
    {
      id: "e1",
      title: "The thing we can't compute",
      summary: "The evidence log p(x) needs an integral over every hidden z, which is intractable.",
      ops: [
        { op: "say", id: "e1.s1", text: "We have data x and a hidden variable z, tied together by a model p of x and z." },
        {
          op: "show",
          id: "e1.e1",
          element: {
            kind: "derivation",
            id: "D",
            label: "the evidence",
            revealed: 1,
            focus: 0,
            steps: [
              { tex: "\\log p(x) = \\log \\int p(x, z)\\, dz", note: "sum over every hidden z" },
              { tex: "= \\log \\int q(z)\\, \\frac{p(x, z)}{q(z)}\\, dz", note: "multiply and divide by q(z)" },
              { tex: "= \\log\\, \\mathbb{E}_{q(z)}\\!\\left[ \\frac{p(x, z)}{q(z)} \\right]", note: "an expectation under q" },
              { tex: "\\ge \\mathbb{E}_{q(z)}\\!\\left[ \\log \\frac{p(x, z)}{q(z)} \\right] =: \\mathrm{ELBO}(q)", note: "Jensen: log is concave" },
              { tex: "\\mathrm{ELBO}(q) = \\mathbb{E}_{q}[\\log p(x \\mid z)] - \\mathrm{KL}\\big(q(z)\\,\\|\\,p(z)\\big)", note: "two terms, two jobs" },
              { tex: "\\log p(x) - \\mathrm{ELBO}(q) = \\mathrm{KL}\\big(q(z)\\,\\|\\,p(z \\mid x)\\big) \\ge 0", note: "the gap" },
            ],
          },
        },
        { op: "say", id: "e1.s2", text: "The evidence, log p of x, is how well the model explains the data we actually saw." },
        { op: "say", id: "e1.s3", text: "To get it we have to integrate over every possible z, and for any interesting model that integral has no closed form." },
        {
          op: "pin",
          id: "e1.p1",
          pin: {
            pinId: "E-goal",
            kind: "definition",
            title: "The goal",
            tex: "\\log p(x) = \\log \\int p(x,z)\\,dz",
            text: "What we want but cannot compute directly.",
          },
        },
        {
          op: "check",
          id: "e1.k1",
          kind: "choice",
          prompt: "Why can't we just compute log p(x) directly?",
          options: ["The integral over z is intractable", "The log of a probability is undefined", "We don't know p(x, z)"],
          expected: ["The integral over z is intractable", "intractable", "the integral"],
          onCorrect: [{ op: "say", id: "e1.k1.y1", text: "Right, the model gives us p of x and z, but summing it over all z is the part we cannot do." }],
          onIncorrect: [
            { op: "highlight", id: "e1.k1.h1", targets: [{ id: "D", index: 0 }] },
            { op: "say", id: "e1.k1.n1", text: "The model defines p of x and z, and logs of probabilities are fine; the trouble is that integral over every z." },
            { op: "clear_highlights", id: "e1.k1.c1" },
          ],
        },
      ],
    },
    {
      id: "e2",
      title: "Bring in a helper",
      summary: "Multiply and divide by a chosen distribution q(z) to turn the integral into an expectation under q.",
      ops: [
        { op: "say", id: "e2.s1", text: "The trick is to bring in a helper distribution over z that we get to choose, called q." },
        { op: "update", id: "e2.u1", target: "D", patch: { revealed: 2, focus: 1 } },
        { op: "say", id: "e2.s2", text: "Multiplying and dividing by q of z changes nothing, as long as q is positive wherever p is." },
        { op: "update", id: "e2.u2", target: "D", patch: { revealed: 3, focus: 2 } },
        { op: "say", id: "e2.s3", text: "Now the integral of q times something is just an expectation of that something under q." },
        { op: "say", id: "e2.s4", text: "That matters because we can sample from q, so expectations under q are things we can estimate." },
        {
          op: "pin",
          id: "e2.p1",
          pin: {
            pinId: "E-q",
            kind: "definition",
            title: "The helper q(z)",
            text: "A distribution over z that we choose and can sample from. It must be positive wherever p(x, z) is.",
          },
        },
        {
          op: "check",
          id: "e2.k1",
          kind: "choice",
          prompt: "What must be true of q for the multiply-and-divide step to be legal?",
          options: ["q(z) > 0 wherever p(x, z) > 0", "q equals the true posterior", "q is Gaussian"],
          expected: ["q(z) > 0 wherever p(x, z) > 0", "positive", "q(z) > 0"],
          onCorrect: [{ op: "say", id: "e2.k1.y1", text: "Exactly, otherwise we would be dividing by zero somewhere the model puts mass." }],
          onIncorrect: [
            { op: "highlight", id: "e2.k1.h1", targets: [{ id: "D", index: 1 }] },
            { op: "say", id: "e2.k1.n1", text: "q can be any shape and it does not need to be the posterior; it only has to be positive wherever p of x and z is, so the division is safe." },
            { op: "clear_highlights", id: "e2.k1.c1" },
          ],
        },
      ],
    },
    {
      id: "e3",
      title: "Jensen turns it into a bound",
      summary: "Because log is concave, log of an expectation is at least the expectation of the log, which gives the lower bound.",
      ops: [
        { op: "say", id: "e3.s1", text: "Here is the one inequality in the whole derivation." },
        {
          op: "show",
          id: "e3.e1",
          element: {
            kind: "scene",
            id: "J",
            label: "log is concave",
            width: 360,
            height: 220,
            caption: "The curve stays above any chord between two of its points.",
            items: [
              { id: "axis-x", type: "line", x1: 20, y1: 205, x2: 345, y2: 205 },
              { id: "axis-y", type: "line", x1: 25, y1: 10, x2: 25, y2: 210 },
              { id: "curve", type: "path", d: "M 30 190.0 L 45 156.4 L 60 135.0 L 75 119.3 L 90 106.8 L 105 96.5 L 120 87.7 L 135 80.0 L 150 73.2 L 165 67.1 L 180 61.6 L 195 56.5 L 210 51.8 L 225 47.5 L 240 43.5 L 255 39.7 L 270 36.1 L 285 32.7 L 300 29.6 L 315 26.5 L 330 23.6", label: "log" },
              { id: "chord", type: "line", x1: 70, y1: 124.1, x2: 290, y2: 31.7, dashed: true, label: "chord" },
              { id: "p1", type: "dot", cx: 70, cy: 124.1, r: 6, label: "log y₁" },
              { id: "p2", type: "dot", cx: 290, cy: 31.7, r: 6, label: "log y₂" },
              { id: "mid-chord", type: "dot", cx: 180, cy: 77.9, r: 6, label: "average of the logs" },
              { id: "mid-curve", type: "dot", cx: 180, cy: 61.6, r: 6, label: "log of the average" },
            ],
          },
        },
        { op: "say", id: "e3.s2", text: "Log is concave: the curve bows upward, so the curve sits above the straight line between any two of its points." },
        { op: "highlight", id: "e3.h1", targets: [{ id: "J", index: 7 }, { id: "J", index: 6 }] },
        { op: "say", id: "e3.s3", text: "So the log of an average is at least the average of the logs." },
        { op: "clear_highlights", id: "e3.c1" },
        { op: "update", id: "e3.u1", target: "D", patch: { revealed: 4, focus: 3 } },
        { op: "say", id: "e3.s4", text: "Pushing the log inside the expectation can only make the value smaller, and that smaller thing is the evidence lower bound." },
        {
          op: "pin",
          id: "e3.p1",
          pin: {
            pinId: "E-elbo",
            kind: "equation",
            title: "The ELBO",
            tex: "\\log p(x) \\ge \\mathbb{E}_{q}\\!\\left[\\log \\frac{p(x,z)}{q(z)}\\right]",
            text: "A lower bound on the evidence, for any q.",
          },
        },
        {
          op: "check",
          id: "e3.k1",
          kind: "choice",
          prompt: "For a concave function f, how does f of the average compare to the average of f?",
          options: ["f(E[Y]) ≥ E[f(Y)]", "f(E[Y]) ≤ E[f(Y)]", "They are always equal"],
          expected: ["f(E[Y]) ≥ E[f(Y)]", "greater", "≥", "at least"],
          onCorrect: [{ op: "say", id: "e3.k1.y1", text: "Yes, and for log that is exactly the step that produces a lower bound rather than an upper one." }],
          onIncorrect: [
            { op: "highlight", id: "e3.k1.h1", targets: [{ id: "J", index: 7 }] },
            { op: "say", id: "e3.k1.n1", text: "Look at the diagram: the point on the curve sits above the point on the chord, so f of the average is the larger one." },
            { op: "clear_highlights", id: "e3.k1.c1" },
          ],
        },
      ],
    },
    {
      id: "e4",
      title: "Two terms, two jobs",
      summary: "Splitting log p(x,z) into log p(x|z) + log p(z) rewrites the ELBO as expected log-likelihood minus KL(q || p(z)).",
      ops: [
        { op: "say", id: "e4.s1", text: "The bound becomes useful once we split it into two pieces." },
        { op: "update", id: "e4.u1", target: "D", patch: { revealed: 5, focus: 4 } },
        { op: "say", id: "e4.s2", text: "Write log p of x and z as log p of x given z plus log p of z." },
        { op: "say", id: "e4.s3", text: "The log p of z and the minus log q of z combine into a KL divergence between q and the prior." },
        { op: "say", id: "e4.s4", text: "The first term rewards q for picking z values that explain the data; the second penalizes q for straying from the prior." },
        {
          op: "pin",
          id: "e4.p1",
          pin: {
            pinId: "E-split",
            kind: "equation",
            title: "Reconstruction minus regularization",
            tex: "\\mathrm{ELBO} = \\mathbb{E}_{q}[\\log p(x \\mid z)] - \\mathrm{KL}(q(z)\\,\\|\\,p(z))",
          },
        },
        {
          op: "check",
          id: "e4.k1",
          kind: "choice",
          prompt: "Which term rewards explaining the data well?",
          options: ["The expected log-likelihood E_q[log p(x | z)]", "The KL term", "Neither; both are penalties"],
          expected: ["The expected log-likelihood E_q[log p(x | z)]", "log-likelihood", "expected log", "the first"],
          onCorrect: [{ op: "say", id: "e4.k1.y1", text: "Right, that is the reconstruction term, and the KL term is the regularizer pulling q toward the prior." }],
          onIncorrect: [
            { op: "highlight", id: "e4.k1.h1", targets: [{ id: "D", index: 4 }] },
            { op: "say", id: "e4.k1.n1", text: "The KL term only measures how far q is from the prior; it is the log-likelihood term that cares about the data." },
            { op: "clear_highlights", id: "e4.k1.c1" },
          ],
        },
      ],
    },
    {
      id: "e5",
      title: "How loose is the bound?",
      summary: "The gap between log p(x) and the ELBO is exactly KL(q || p(z|x)), so maximizing the ELBO fits q to the posterior.",
      ops: [
        { op: "say", id: "e5.s1", text: "Last question: how much do we lose by maximizing the bound instead of the evidence?" },
        { op: "update", id: "e5.u1", target: "D", patch: { revealed: 6, focus: 5 } },
        { op: "say", id: "e5.s2", text: "The gap is exactly the KL divergence between q and the true posterior over z." },
        { op: "say", id: "e5.s3", text: "So pushing the ELBO up does two things at once: it raises a bound on the evidence and pulls q toward the posterior." },
        { op: "say", id: "e5.s4", text: "The bound is tight exactly when q equals the posterior, which is the thing we could not compute in the first place." },
        {
          op: "pin",
          id: "e5.p1",
          pin: {
            pinId: "E-gap",
            kind: "takeaway",
            title: "Why the ELBO is worth maximizing",
            text: "Its gap to the evidence is KL(q || p(z|x)). Raising the ELBO tightens the bound and fits q to the posterior.",
          },
        },
        {
          op: "check",
          id: "e5.k1",
          kind: "choice",
          prompt: "When is the bound tight?",
          options: ["When q(z) equals the posterior p(z | x)", "When q(z) equals the prior p(z)", "Never"],
          expected: ["When q(z) equals the posterior p(z | x)", "posterior", "p(z | x)", "p(z|x)"],
          onCorrect: [{ op: "say", id: "e5.k1.y1", text: "Exactly, then the KL gap is zero and the ELBO equals the evidence." }],
          onIncorrect: [
            { op: "highlight", id: "e5.k1.h1", targets: [{ id: "D", index: 5 }] },
            { op: "say", id: "e5.k1.n1", text: "The gap is a KL between q and the posterior, and a KL is zero only when the two distributions match." },
            { op: "clear_highlights", id: "e5.k1.c1" },
          ],
        },
      ],
    },
  ],
  branches: [
    {
      id: "br.why-lower",
      title: "Why a lower bound?",
      match: { patterns: ["why (a )?lower", "upper bound", "why not (an )?upper", "why is it (called )?(a )?bound"] },
      ops: [
        { op: "say", id: "ebr1.s1", text: "Because the only inequality we used was Jensen's, and for a concave function like log it points one way: log of an average is at least the average of the logs." },
        { op: "say", id: "ebr1.s2", text: "A lower bound is still useful, because raising it can only push the true evidence up with it." },
      ],
      resume: { mode: "continue", bridge: "Back to the derivation." },
    },
    {
      id: "br.what-is-q",
      title: "Where does q come from?",
      match: { patterns: ["what is q", "where does q", "choose q", "pick q", "what.*q\\b.*(mean|is)"] },
      ops: [
        { op: "say", id: "ebr2.s1", text: "q is ours to choose: any family of distributions over z that we can sample from and evaluate, like a Gaussian whose mean and variance we fit." },
        { op: "say", id: "ebr2.s2", text: "In a variational autoencoder, q is the encoder network, which outputs those Gaussian parameters for each x." },
      ],
      resume: { mode: "continue", bridge: "Okay, back to it." },
    },
    {
      id: "br.what-is-kl",
      title: "What is KL divergence?",
      match: { patterns: ["what is kl", "kl divergence", "kullback", "what does kl"] },
      ops: [
        { op: "show", id: "ebr3.e1", element: { kind: "latex", id: "KL", tex: "\\mathrm{KL}(q\\,\\|\\,p) = \\mathbb{E}_q\\!\\left[\\log \\frac{q(z)}{p(z)}\\right] \\ge 0", caption: "zero exactly when q and p agree" } },
        { op: "say", id: "ebr3.s1", text: "KL divergence measures how far one distribution is from another: the expected log ratio of their densities under the first one." },
        { op: "say", id: "ebr3.s2", text: "It is never negative, and it is zero only when the two distributions are the same, which is why it works as a gap." },
      ],
      resume: { mode: "continue", bridge: "Back to the bound." },
    },
    {
      id: "br.vae",
      title: "The VAE connection",
      match: { patterns: ["vae", "autoencoder", "encoder", "decoder", "neural"] },
      ops: [
        { op: "say", id: "ebr4.s1", text: "A variational autoencoder is this derivation turned into a training objective: the encoder is q of z given x, the decoder is p of x given z, and the loss is the negative ELBO." },
        { op: "say", id: "ebr4.s2", text: "The reconstruction term trains the decoder to rebuild x from z, and the KL term keeps the encoder's codes close to the prior." },
      ],
      resume: { mode: "continue", bridge: "Back to where we were." },
    },
  ],
  fallback: {
    ops: [{ op: "say", id: "efb.s1", text: "I can't answer that while I'm offline. Try again when the tutor is connected." }],
    resume: { mode: "continue", bridge: "Let's pick up where we left off." },
  },
};
