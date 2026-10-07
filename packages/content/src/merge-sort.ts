import type { Lesson } from "@tma/schema";

/**
 * Hand-written v0.0 lesson. One sentence per `say` so soft interrupts land at
 * sentence boundaries. Every beat ends in exactly one check. Branches are the
 * pre-authored answers a Planner and Brancher will later write; the fallback
 * stands in for the Responder.
 */
export const mergeSortLesson: Lesson = {
  id: "merge-sort-v0",
  topic: "merge sort",
  title: "How merge sort works",
  calibration: {
    prompt: "Quick check before we start: have you written a recursive function before?",
    options: ["Yes", "Sort of", "No"],
  },
  beats: [
    {
      id: "b1",
      title: "The merge trick",
      summary: "Merging two already-sorted lists takes one pass: compare the fronts and take the smaller.",
      ops: [
        { op: "say", id: "b1.s1", text: "Let's start with the one trick that makes merge sort work." },
        { op: "show", id: "b1.e1", element: { kind: "array_row", id: "A", label: "A", values: [2, 5, 8] } },
        { op: "show", id: "b1.e2", element: { kind: "array_row", id: "B", label: "B", values: [1, 4, 9] } },
        { op: "show", id: "b1.e3", element: { kind: "array_row", id: "OUT", label: "merged", values: [], role: "output" } },
        { op: "say", id: "b1.s2", text: "Here are two lists that are already sorted." },
        { op: "say", id: "b1.s3", text: "To merge them, you only ever compare the two front elements." },
        { op: "highlight", id: "b1.h1", targets: [{ id: "A", index: 0 }, { id: "B", index: 0 }] },
        { op: "say", id: "b1.s4", text: "One is smaller than two, so one goes to the output." },
        { op: "move", id: "b1.m1", from: { id: "B", index: 0 }, to: { id: "OUT" } },
        { op: "highlight", id: "b1.h2", targets: [{ id: "A", index: 0 }, { id: "B", index: 0 }] },
        { op: "say", id: "b1.s5", text: "Now the fronts are two and four, so two goes next." },
        { op: "move", id: "b1.m2", from: { id: "A", index: 0 }, to: { id: "OUT" } },
        { op: "clear_highlights", id: "b1.c1" },
        { op: "say", id: "b1.s6", text: "Every step looks at just two elements, so merging two sorted lists is a single pass through the data." },
        {
          op: "pin",
          id: "b1.p1",
          pin: {
            pinId: "T1",
            kind: "takeaway",
            title: "Merging is one pass",
            text: "Two sorted lists merge by comparing the fronts and taking the smaller. Each element is touched once.",
          },
        },
        { op: "highlight", id: "b1.h3", targets: [{ id: "A", index: 0 }, { id: "B", index: 0 }] },
        {
          op: "check",
          id: "b1.k1",
          kind: "click_cell",
          prompt: "Your turn. Click the element that goes to the output next.",
          targets: [{ id: "A", index: 0 }, { id: "B", index: 0 }],
          expected: { id: "B", index: 0 },
          onCorrect: [
            { op: "say", id: "b1.k1.y1", text: "Exactly, four is smaller than five." },
            { op: "move", id: "b1.k1.m1", from: { id: "B", index: 0 }, to: { id: "OUT" } },
            { op: "clear_highlights", id: "b1.k1.c1" },
            { op: "say", id: "b1.k1.y2", text: "The rest follows the same rule, smaller front first, until both lists are empty." },
            { op: "move", id: "b1.k1.m2", from: { id: "A", index: 0 }, to: { id: "OUT" } },
            { op: "move", id: "b1.k1.m3", from: { id: "A", index: 0 }, to: { id: "OUT" } },
            { op: "move", id: "b1.k1.m4", from: { id: "B", index: 0 }, to: { id: "OUT" } },
          ],
          onIncorrect: [
            { op: "say", id: "b1.k1.n1", text: "Not quite. Compare the fronts: five against four." },
            { op: "highlight", id: "b1.k1.h1", targets: [{ id: "B", index: 0 }], tone: "correct" },
            { op: "say", id: "b1.k1.n2", text: "Four is smaller, so four goes next." },
            { op: "move", id: "b1.k1.m5", from: { id: "B", index: 0 }, to: { id: "OUT" } },
            { op: "clear_highlights", id: "b1.k1.c2" },
            { op: "say", id: "b1.k1.n3", text: "The rest follows the same rule until both lists are empty." },
            { op: "move", id: "b1.k1.m6", from: { id: "A", index: 0 }, to: { id: "OUT" } },
            { op: "move", id: "b1.k1.m7", from: { id: "A", index: 0 }, to: { id: "OUT" } },
            { op: "move", id: "b1.k1.m8", from: { id: "B", index: 0 }, to: { id: "OUT" } },
          ],
        },
      ],
    },
    {
      id: "b2",
      title: "Split it down",
      summary: "Sorted lists come from splitting the input in half repeatedly until every list has one element, which is already sorted.",
      ops: [
        { op: "say", id: "b2.s1", text: "So where do sorted lists come from in the first place?" },
        { op: "clear", id: "b2.c1" },
        { op: "show", id: "b2.e1", element: { kind: "split_tree", id: "T", values: [8, 3, 5, 1, 9, 2, 7, 4], revealDepth: 0 } },
        { op: "say", id: "b2.s2", text: "Take an unsorted list of eight numbers and cut it in half." },
        { op: "update", id: "b2.u1", target: "T", patch: { revealDepth: 1 } },
        { op: "say", id: "b2.s3", text: "Cut each half in half again." },
        { op: "update", id: "b2.u2", target: "T", patch: { revealDepth: 2 } },
        { op: "say", id: "b2.s4", text: "And once more, until every list holds a single element." },
        { op: "update", id: "b2.u3", target: "T", patch: { revealDepth: 3 } },
        { op: "highlight", id: "b2.h1", targets: [{ id: "T", index: 3 }] },
        { op: "say", id: "b2.s5", text: "A list with one element is already sorted, so this is the base case, and it needs no work at all." },
        {
          op: "pin",
          id: "b2.p1",
          pin: {
            pinId: "T2",
            kind: "takeaway",
            title: "The base case is free",
            text: "A list of one element is already sorted, so splitting stops there and costs nothing.",
          },
        },
        { op: "clear_highlights", id: "b2.c2" },
        {
          op: "check",
          id: "b2.k1",
          kind: "choice",
          prompt: "How many rounds of splitting took eight elements down to single elements?",
          options: ["2", "3", "4", "8"],
          expected: ["3", "three"],
          onCorrect: [
            { op: "say", id: "b2.k1.y1", text: "Right, three rounds: eight to four, four to two, two to one." },
          ],
          onIncorrect: [
            { op: "highlight", id: "b2.k1.h1", targets: [{ id: "T", index: 1 }, { id: "T", index: 2 }, { id: "T", index: 3 }] },
            { op: "say", id: "b2.k1.n1", text: "Count the levels below the top: eight to four, four to two, two to one, so three rounds." },
            { op: "clear_highlights", id: "b2.k1.c1" },
          ],
        },
      ],
    },
    {
      id: "b3",
      title: "Merge back up",
      summary: "Merge the single elements back up level by level using the one-pass trick; that is the whole algorithm.",
      ops: [
        { op: "say", id: "b3.s1", text: "Now we merge our way back up using the trick from the start." },
        { op: "update", id: "b3.u1", target: "T", patch: { sortedFromDepth: 3 } },
        { op: "say", id: "b3.s2", text: "Each pair of single elements merges into a sorted pair." },
        { op: "update", id: "b3.u2", target: "T", patch: { sortedFromDepth: 2 } },
        { op: "highlight", id: "b3.h1", targets: [{ id: "T", index: 2 }] },
        { op: "say", id: "b3.s3", text: "Each pair of pairs merges into a sorted list of four." },
        { op: "update", id: "b3.u3", target: "T", patch: { sortedFromDepth: 1 } },
        { op: "highlight", id: "b3.h2", targets: [{ id: "T", index: 1 }] },
        { op: "say", id: "b3.s4", text: "And the two halves merge into the final sorted list." },
        { op: "update", id: "b3.u4", target: "T", patch: { sortedFromDepth: 0 } },
        { op: "highlight", id: "b3.h3", targets: [{ id: "T", index: 0 }] },
        { op: "say", id: "b3.s5", text: "That is the whole algorithm: split until trivial, then merge on the way back up." },
        { op: "say", id: "b3.s6", text: "Here it is as code." },
        {
          op: "pin",
          id: "b3.p1",
          pin: {
            pinId: "E1",
            kind: "code",
            title: "merge sort",
            text: "sort(list):\n  if list has one element, return it\n  left  = sort(first half)\n  right = sort(second half)\n  return merge(left, right)",
          },
        },
        { op: "clear_highlights", id: "b3.c1" },
        {
          op: "check",
          id: "b3.k1",
          kind: "choice",
          prompt: "After the first round of merging, how many sorted lists are there?",
          options: ["1", "2", "4", "8"],
          expected: ["4", "four"],
          onCorrect: [
            { op: "say", id: "b3.k1.y1", text: "Yes, eight singles become four sorted pairs." },
          ],
          onIncorrect: [
            { op: "highlight", id: "b3.k1.h1", targets: [{ id: "T", index: 2 }] },
            { op: "say", id: "b3.k1.n1", text: "Look at the level above the singles: eight singles merge into four pairs." },
            { op: "clear_highlights", id: "b3.k1.c1" },
          ],
        },
      ],
    },
    {
      id: "b4",
      title: "Why n log n",
      summary: "Every level touches all n elements once and there are log n levels, so the total work is n log n.",
      ops: [
        { op: "say", id: "b4.s1", text: "Why is this fast? Look at the work done on each level." },
        { op: "update", id: "b4.u1", target: "T", patch: { showWork: true, sortedFromDepth: 0 } },
        { op: "say", id: "b4.s2", text: "On every level, the merges together touch each of the eight elements exactly once." },
        { op: "say", id: "b4.s3", text: "There are three levels, because three is how many times you can halve eight." },
        { op: "say", id: "b4.s4", text: "In general that is log n levels, each doing n work." },
        {
          op: "pin",
          id: "b4.p1",
          pin: {
            pinId: "E2",
            kind: "equation",
            title: "Why it is n log n",
            tex: "\\text{work} \\approx n \\cdot \\log_2 n",
            text: "log n levels, and every level touches all n elements once.",
          },
        },
        {
          op: "check",
          id: "b4.k1",
          kind: "choice",
          prompt: "If we double the list to sixteen elements, how many more levels do we get?",
          options: ["1 more", "2 more", "twice as many", "8 more"],
          expected: ["1 more", "one more", "1", "one"],
          onCorrect: [
            { op: "say", id: "b4.k1.y1", text: "Exactly. Doubling the input adds one level, not double the levels, and that is what makes log n cheap." },
          ],
          onIncorrect: [
            { op: "say", id: "b4.k1.n1", text: "Halving sixteen takes four steps to reach one, and halving eight took three, so just one extra level." },
          ],
        },
      ],
    },
    {
      id: "b5",
      title: "Wrap up",
      summary: "Merge sort is stable, needs extra memory for merging, and is always n log n.",
      ops: [
        { op: "say", id: "b5.s1", text: "That is merge sort: split until trivial, merge with the one-pass trick, and pay n log n in total." },
        { op: "clear", id: "b5.c1" },
        {
          op: "show",
          id: "b5.e1",
          element: {
            kind: "text_card",
            id: "WRAP",
            title: "In practice",
            body: "Always n log n, even on bad inputs.\nStable: equal elements keep their order.\nNeeds extra memory for the merged lists.",
          },
        },
        { op: "say", id: "b5.s2", text: "Two things to remember in practice: it is stable, and it needs extra memory for the merges." },
        {
          op: "pin",
          id: "b5.p1",
          pin: {
            pinId: "T3",
            kind: "takeaway",
            title: "In practice",
            text: "Stable, so equal elements keep their order. Needs extra memory for the merges. Always n log n.",
          },
        },
        {
          op: "check",
          id: "b5.k1",
          kind: "choice",
          prompt: "Want to go deeper?",
          options: ["Show me real code", "Compare with quicksort", "I'm done"],
          graded: false,
          onCorrect: [
            { op: "say", id: "b5.k1.y1", text: "In this demo the lesson ends here. In the real product, the tutor would continue from your choice." },
          ],
        },
      ],
    },
  ],
  branches: [
    {
      id: "br.why-one",
      title: "Why split all the way to one?",
      match: {
        patterns: ["why.*(to|till|until) (one|1|single)", "stop at (two|2|pairs)", "all the way", "why not (two|2|pairs)"],
        beats: ["b2", "b3", "b4"],
      },
      ops: [
        { op: "say", id: "br1.s1", text: "Good question. You could stop at pairs and sort them by hand, but going to one means the base case needs zero logic." },
        { op: "highlight", id: "br1.h1", targets: [{ id: "T", index: 3 }] },
        { op: "say", id: "br1.s2", text: "A single element is already sorted, so there is nothing to do, and the merge step does all the real work either way." },
        {
          op: "pin",
          id: "br1.p1",
          pin: {
            pinId: "T2",
            kind: "takeaway",
            title: "The base case is free",
            text: "A list of one element is already sorted, so splitting stops there and costs nothing.",
          },
        },
      ],
      resume: { mode: "continue", bridge: "So, back to the splitting." },
    },
    {
      id: "br.merge-rule",
      title: "How does merge pick?",
      match: {
        patterns: [
          "how does (it|merge|the merge) (know|pick|choose|decide)",
          "which (one|element) to (take|pick)",
          "don'?t (get|understand).*(merge|compar)",
          "(confused|lost).*(merge|compar)",
          "^(how|what) .*compar",
        ],
        pointed: ["T1", "OUT", "A", "B"],
      },
      ops: [
        { op: "say", id: "br2.s1", text: "Let me show the merge step again, and this time you drive." },
        { op: "show", id: "br2.e1", element: { kind: "array_row", id: "A2", label: "left", values: [3, 8] } },
        { op: "show", id: "br2.e2", element: { kind: "array_row", id: "B2", label: "right", values: [1, 5] } },
        { op: "show", id: "br2.e3", element: { kind: "array_row", id: "OUT2", label: "merged", values: [], role: "output" } },
        { op: "highlight", id: "br2.h1", targets: [{ id: "A2", index: 0 }, { id: "B2", index: 0 }] },
        {
          op: "check",
          id: "br2.k1",
          kind: "click_cell",
          prompt: "The rule is always the same: compare the two fronts. Click the one that goes to the output first.",
          targets: [{ id: "A2", index: 0 }, { id: "B2", index: 0 }],
          expected: { id: "B2", index: 0 },
          onCorrect: [
            { op: "say", id: "br2.k1.y1", text: "Right. Take the smaller front, then compare the new fronts, and repeat. That is the whole rule." },
            { op: "move", id: "br2.k1.m1", from: { id: "B2", index: 0 }, to: { id: "OUT2" } },
            { op: "clear_highlights", id: "br2.k1.c1" },
          ],
          onIncorrect: [
            { op: "say", id: "br2.k1.n1", text: "Compare the fronts: three against one. One is smaller, so one goes first." },
            { op: "move", id: "br2.k1.m2", from: { id: "B2", index: 0 }, to: { id: "OUT2" } },
            { op: "clear_highlights", id: "br2.k1.c2" },
            { op: "say", id: "br2.k1.n2", text: "Then compare the new fronts, three against five, and keep taking the smaller one." },
          ],
        },
      ],
      resume: { mode: "continue", bridge: "Back to where we were." },
    },
    {
      id: "br.uneven",
      title: "What if one list runs out?",
      match: {
        patterns: ["runs? out", "uneven", "different (size|length)", "odd (number|length)", "one (list|side).*(empty|shorter|longer)", "not (the same|equal) (size|length)"],
      },
      ops: [
        { op: "say", id: "br3.s1", text: "When one list runs out, everything left in the other list is already sorted, so it is copied straight to the output." },
        { op: "say", id: "br3.s2", text: "That is also why odd lengths are no problem: a list of seven splits into three and four." },
      ],
      resume: { mode: "continue", bridge: "Okay, back to it." },
    },
    {
      id: "br.compare",
      title: "Versus quicksort",
      match: {
        patterns: ["quick ?sort", "stable", "memory", "space", "in place", "better than", "compared? (to|with)"],
      },
      ops: [
        { op: "say", id: "br4.s1", text: "Compared with quicksort, merge sort is always n log n and keeps equal elements in their original order." },
        { op: "say", id: "br4.s2", text: "The price is extra memory for the merged lists, where quicksort works in place." },
      ],
      resume: { mode: "continue", bridge: "Back to the lesson." },
    },
  ],
  fallback: {
    ops: [
      { op: "say", id: "fb.s1", text: "I can't answer that while I'm offline. Try again when the tutor is connected." },
    ],
    resume: { mode: "continue", bridge: "Let's pick up where we left off." },
  },
};
