import type { Lesson } from "@tma/schema";

/**
 * Hand-written v0.1 lesson built on a diagram: a ball on a string, seen from
 * outside and then from a spinning seat. One sentence per `say`; every beat
 * ends in one check.
 */

const C = { x: 210, y: 150, r: 100 };
const BALL = { x: C.x + C.r, y: C.y };

export const centrifugalLesson: Lesson = {
  id: "centrifugal-v0",
  topic: "centrifugal force",
  title: "Centrifugal force",
  calibration: {
    prompt: "Quick check before we start: have you met Newton's laws of motion before?",
    options: ["Yes, comfortable", "A long time ago", "Not really"],
  },
  beats: [
    {
      id: "c1",
      title: "A ball on a string",
      summary: "A ball moving in a circle has a tangent velocity; the only real force is the string's inward pull, the centripetal force.",
      ops: [
        { op: "say", id: "c1.s1", text: "Picture a ball on a string, with you holding the other end and standing at the center." },
        {
          op: "show",
          id: "c1.e1",
          element: {
            kind: "scene",
            id: "S",
            label: "a ball on a string, seen from above",
            width: 420,
            height: 300,
            items: [
              { id: "orbit", type: "circle", cx: C.x, cy: C.y, r: C.r, dashed: true, label: "the circle it travels" },
              { id: "center", type: "dot", cx: C.x, cy: C.y, r: 4, label: "you" },
              { id: "string", type: "line", x1: C.x, y1: C.y, x2: BALL.x, y2: BALL.y, label: "the string" },
              { id: "ball", type: "dot", cx: BALL.x, cy: BALL.y, r: 10, label: "the ball" },
              { id: "v", type: "arrow", x1: BALL.x, y1: BALL.y, x2: BALL.x, y2: BALL.y - 75, role: "velocity", label: "velocity" },
              { id: "tension", type: "arrow", x1: BALL.x, y1: BALL.y, x2: BALL.x - 70, y2: BALL.y, role: "force", label: "pull of the string" },
            ],
          },
        },
        { op: "say", id: "c1.s2", text: "The ball moves around the circle, and at every instant its velocity points along the tangent, straight ahead." },
        { op: "highlight", id: "c1.h1", targets: [{ id: "S", index: 4 }] },
        { op: "say", id: "c1.s3", text: "Left alone, the ball would keep going straight, because that is what moving things do." },
        { op: "highlight", id: "c1.h2", targets: [{ id: "S", index: 5 }] },
        { op: "say", id: "c1.s4", text: "The only thing bending it into a circle is the string pulling it inward, toward you." },
        { op: "clear_highlights", id: "c1.c1" },
        {
          op: "pin",
          id: "c1.p1",
          pin: {
            pinId: "F-centripetal",
            kind: "definition",
            title: "Centripetal force",
            text: "The real inward pull that bends a moving object into a circle. Here, the string.",
          },
        },
        {
          op: "check",
          id: "c1.k1",
          kind: "click_cell",
          prompt: "Click the arrow that is an actual force on the ball.",
          targets: [{ id: "S", index: 4 }, { id: "S", index: 5 }],
          expected: { id: "S", index: 5 },
          onCorrect: [{ op: "say", id: "c1.k1.y1", text: "Right, the string's pull is the only force here; the velocity arrow just shows where the ball is heading." }],
          onIncorrect: [
            { op: "say", id: "c1.k1.n1", text: "That arrow is the velocity, where the ball is heading, not a push or a pull on it." },
            { op: "highlight", id: "c1.k1.h1", targets: [{ id: "S", index: 5 }], tone: "correct" },
            { op: "say", id: "c1.k1.n2", text: "The only force is the string, pulling inward." },
            { op: "clear_highlights", id: "c1.k1.c1" },
          ],
        },
      ],
    },
    {
      id: "c2",
      title: "Cut the string",
      summary: "With no inward pull, the ball flies off along the tangent, not outward.",
      ops: [
        { op: "say", id: "c2.s1", text: "Now cut the string." },
        {
          op: "update",
          id: "c2.u1",
          target: "S",
          patch: {
            items: [
              { id: "orbit", type: "circle", cx: C.x, cy: C.y, r: C.r, dashed: true, label: "the circle it was on" },
              { id: "center", type: "dot", cx: C.x, cy: C.y, r: 4, label: "you" },
              { id: "tangent", type: "line", x1: BALL.x, y1: BALL.y, x2: BALL.x, y2: 20, dashed: true, label: "the tangent" },
              { id: "ball", type: "dot", cx: BALL.x, cy: 70, r: 10, label: "the ball" },
              { id: "v", type: "arrow", x1: BALL.x, y1: 70, x2: BALL.x, y2: 20, role: "velocity", label: "velocity" },
              { id: "ghost", type: "circle", cx: BALL.x, cy: BALL.y, r: 10, dashed: true, label: "where it was" },
            ],
          },
        },
        { op: "say", id: "c2.s2", text: "The ball does not shoot outward; it keeps going straight along the line it was already moving on." },
        { op: "highlight", id: "c2.h1", targets: [{ id: "S", index: 2 }] },
        { op: "say", id: "c2.s3", text: "There was never anything pushing it outward; there was only something pulling it in, and we just removed that." },
        { op: "clear_highlights", id: "c2.c1" },
        {
          op: "pin",
          id: "c2.p1",
          pin: {
            pinId: "F-tangent",
            kind: "takeaway",
            title: "No inward pull, no circle",
            text: "Remove the force toward the center and the object goes straight along the tangent.",
          },
        },
        {
          op: "check",
          id: "c2.k1",
          kind: "choice",
          prompt: "If the string snaps, which way does the ball fly?",
          options: ["Straight along the tangent", "Straight outward from the center", "It spirals outward"],
          expected: ["Straight along the tangent", "tangent", "straight"],
          onCorrect: [{ op: "say", id: "c2.k1.y1", text: "Exactly, it just continues the way it was going." }],
          onIncorrect: [
            { op: "highlight", id: "c2.k1.h1", targets: [{ id: "S", index: 2 }] },
            { op: "say", id: "c2.k1.n1", text: "Outward would need an outward force, and there is none; the ball simply carries on along the tangent." },
            { op: "clear_highlights", id: "c2.k1.c1" },
          ],
        },
      ],
    },
    {
      id: "c3",
      title: "Ride along with the ball",
      summary: "In a spinning frame the ball seems pushed outward; centrifugal force is the made-up outward force that makes Newton's laws work in that frame.",
      ops: [
        { op: "say", id: "c3.s1", text: "Now imagine you are a tiny rider sitting on the ball, spinning around with it." },
        {
          op: "update",
          id: "c3.u1",
          target: "S",
          patch: {
            items: [
              { id: "orbit", type: "circle", cx: C.x, cy: C.y, r: C.r, dashed: true, label: "the circle" },
              { id: "center", type: "dot", cx: C.x, cy: C.y, r: 4, label: "the center" },
              { id: "string", type: "line", x1: C.x, y1: C.y, x2: BALL.x, y2: BALL.y, label: "the string" },
              { id: "ball", type: "dot", cx: BALL.x, cy: BALL.y, r: 10, label: "you, on the ball" },
              { id: "tension", type: "arrow", x1: BALL.x, y1: BALL.y, x2: BALL.x - 70, y2: BALL.y, role: "force", label: "pull of the string" },
              { id: "centrifugal", type: "arrow", x1: BALL.x, y1: BALL.y, x2: BALL.x + 70, y2: BALL.y, role: "fictitious", label: "what you feel" },
              { id: "frame", type: "text", x: 20, y: 285, text: "seen from the spinning seat", size: 13 },
            ],
          },
        },
        { op: "say", id: "c3.s2", text: "From your seat the ball is not moving, yet you feel pressed outward, and the string is clearly pulling inward." },
        { op: "highlight", id: "c3.h1", targets: [{ id: "S", index: 5 }] },
        { op: "say", id: "c3.s3", text: "Your spinning viewpoint is accelerating, so Newton's laws only work there if you add a made-up outward force that balances the string's pull." },
        { op: "say", id: "c3.s4", text: "That added force is the centrifugal force: real as a feeling, fictitious as an interaction, and present only in the spinning frame." },
        { op: "clear_highlights", id: "c3.c1" },
        {
          op: "pin",
          id: "c3.p1",
          pin: {
            pinId: "F-centrifugal",
            kind: "definition",
            title: "Centrifugal force",
            text: "The outward force you must add in a rotating frame to make Newton's laws work there. Nothing is pushing; the frame is turning.",
          },
        },
        {
          op: "check",
          id: "c3.k1",
          kind: "choice",
          prompt: "What is centrifugal force?",
          options: [
            "An effect of describing motion from a spinning frame",
            "A real force from the center pushing things out",
            "Another name for the string's pull",
          ],
          expected: ["An effect of describing motion from a spinning frame", "spinning frame", "frame", "fictitious"],
          onCorrect: [{ op: "say", id: "c3.k1.y1", text: "Yes, it belongs to the viewpoint, not to the ball." }],
          onIncorrect: [
            { op: "highlight", id: "c3.k1.h1", targets: [{ id: "S", index: 4 }], tone: "correct" },
            { op: "say", id: "c3.k1.n1", text: "The only real force is the string's inward pull; the outward one appears because your seat is turning." },
            { op: "clear_highlights", id: "c3.k1.c1" },
          ],
        },
      ],
    },
    {
      id: "c4",
      title: "How big is it?",
      summary: "The inward force needed is m v squared over r; the centrifugal term in the rotating frame has the same size.",
      ops: [
        { op: "say", id: "c4.s1", text: "Both arrows, the real inward pull and the fictitious outward one, have the same size." },
        {
          op: "show",
          id: "c4.e1",
          element: { kind: "latex", id: "FORMULA", tex: "F = \\frac{m v^2}{r}", caption: "the pull a circle of radius r demands at speed v" },
        },
        { op: "say", id: "c4.s2", text: "Double the speed and you need four times the pull, because the ball changes direction twice as often and by twice as much each time." },
        { op: "say", id: "c4.s3", text: "Make the circle bigger at the same speed and the pull gets smaller, because the turn is gentler." },
        {
          op: "pin",
          id: "c4.p1",
          pin: {
            pinId: "F-formula",
            kind: "equation",
            title: "How much pull a circle needs",
            tex: "F = \\frac{m v^2}{r}",
          },
        },
        {
          op: "check",
          id: "c4.k1",
          kind: "choice",
          prompt: "Double the speed on the same circle. The inward force needed…",
          options: ["Quadruples", "Doubles", "Stays the same"],
          expected: ["Quadruples", "four times", "4", "x4", "4x"],
          onCorrect: [{ op: "say", id: "c4.k1.y1", text: "Right, speed enters squared." }],
          onIncorrect: [
            { op: "highlight", id: "c4.k1.h1", targets: [{ id: "FORMULA" }] },
            { op: "say", id: "c4.k1.n1", text: "Look at the formula: v is squared, so doubling it multiplies the force by four." },
            { op: "clear_highlights", id: "c4.k1.c1" },
          ],
        },
      ],
    },
    {
      id: "c5",
      title: "Where you meet it",
      summary: "Car turns, spin dryers, and orbits: the real force points inward, and the outward feeling is the frame turning.",
      ops: [
        { op: "say", id: "c5.s1", text: "You meet this every time something turns." },
        { op: "clear", id: "c5.c0" },
        {
          op: "show",
          id: "c5.e1",
          element: {
            kind: "text_card",
            id: "WHERE",
            title: "The same pattern, three places",
            body: "A car turning: the seat and door push you inward; you feel thrown outward.\nA spin dryer: the drum pushes the clothes inward; the water escapes through the holes.\nAn orbit: gravity is the inward pull; nothing holds the satellite out.",
          },
        },
        { op: "say", id: "c5.s2", text: "In a turning car the door pushes you inward, and your body reads that as being thrown outward." },
        { op: "say", id: "c5.s3", text: "In every case the real force points toward the center, and the outward feeling is your frame of reference turning underneath you." },
        {
          op: "pin",
          id: "c5.p1",
          pin: {
            pinId: "F-pattern",
            kind: "takeaway",
            title: "The pattern",
            text: "Real force inward: centripetal. Outward feeling from a turning frame: centrifugal. Same size, opposite direction, different kind of thing.",
          },
        },
        {
          op: "check",
          id: "c5.k1",
          kind: "choice",
          prompt: "Want to go deeper?",
          options: ["Why orbits don't fall", "The Coriolis effect", "I'm done"],
          graded: false,
          onCorrect: [{ op: "say", id: "c5.k1.y1", text: "In this version the lesson ends here; in the real product the tutor would continue from your choice." }],
        },
      ],
    },
  ],
  branches: [
    {
      id: "br.fake",
      title: "Is it fake?",
      match: { patterns: ["fake", "not real", "real force", "does it exist", "fictitious", "made up"] },
      ops: [
        { op: "say", id: "cbr1.s1", text: "As an interaction between objects, no: nothing is pushing the ball outward." },
        { op: "say", id: "cbr1.s2", text: "As a term in the equations of a spinning frame, it is exactly as real as any other term, and the feeling in your body is certainly real." },
      ],
      resume: { mode: "continue", bridge: "Back to the ball." },
    },
    {
      id: "br.car",
      title: "Why do I feel thrown outward in a car?",
      match: { patterns: ["car", "thrown", "turn(ing)?", "door", "seat", "roller ?coaster"] },
      ops: [
        { op: "say", id: "cbr2.s1", text: "Your body wants to keep going straight, and the car turns underneath you, so the door or seat has to push you inward to bring you around." },
        { op: "say", id: "cbr2.s2", text: "You feel that inward push as being thrown outward, because from inside the car it looks like you moved toward the door." },
      ],
      resume: { mode: "continue", bridge: "Okay, back to it." },
    },
    {
      id: "br.difference",
      title: "Centripetal versus centrifugal",
      match: { patterns: ["difference", "centripetal", "versus", "vs\\b", "opposite"] },
      ops: [
        { op: "say", id: "cbr3.s1", text: "Centripetal is the real inward force that makes something turn, like the string or a car's tires." },
        { op: "say", id: "cbr3.s2", text: "Centrifugal is the outward force you add when you describe things from inside the turning frame; same size, opposite direction, different kind of thing." },
      ],
      resume: { mode: "continue", bridge: "Back to the lesson." },
    },
    {
      id: "br.orbit",
      title: "What about orbits?",
      match: { patterns: ["orbit", "satellite", "moon", "planet", "gravity", "space"] },
      ops: [
        { op: "say", id: "cbr4.s1", text: "An orbit is the same picture with gravity as the string: the inward pull of gravity is exactly what bends the satellite's straight-line motion into a circle." },
        { op: "say", id: "cbr4.s2", text: "Nothing holds the satellite out; it is always falling toward the planet and always moving sideways fast enough to miss." },
      ],
      resume: { mode: "continue", bridge: "Back to our ball on a string." },
    },
    {
      id: "br.radius",
      title: "What if the circle changes?",
      match: { patterns: ["longer string", "shorter string", "radius", "bigger circle", "smaller circle", "tighter"] },
      ops: [
        { op: "say", id: "cbr5.s1", text: "At the same speed, a bigger circle is a gentler turn, so it needs less inward pull; a tighter circle needs more." },
        { op: "say", id: "cbr5.s2", text: "That is the r in the denominator of m v squared over r." },
      ],
      resume: { mode: "continue", bridge: "Back to where we were." },
    },
  ],
  fallback: {
    ops: [{ op: "say", id: "cfb.s1", text: "I can't answer that while I'm offline. Try again when the tutor is connected." }],
    resume: { mode: "continue", bridge: "Let's pick up where we left off." },
  },
};
