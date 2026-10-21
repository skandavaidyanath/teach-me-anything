# Visual references

Things seen elsewhere that set a bar for the board. Each entry says what it is, what is worth borrowing, and how it maps to our primitives.

## Engraved plate explainer (Yunfan Ye, 2026-10-07)

Source: https://x.com/realYunfanYe/status/2107963467223457822 (91 s video, "Today it did Chemistry", the 2026 Chemistry Nobel on chirality). Stills are kept locally in `docs/references/nobel-chirality/`, which is gitignored; the link above is the source.

Why it was shared: the animation style and aesthetics, especially the drawings of the hands and the chemical structures. A target for a more polished version of our SVG format.

What it is: one large poster in a vintage scientific-plate style. Cream paper, a single sepia ink, hatched shading, a double-rule border. The camera pans and zooms around the one sheet while figures appear in narration order, each with a letterspaced serif caption ("FIG. 2 · CHIRAL MOLECULES") and an italic subline. A three-part "recipe" section uses circular hatched insets with a checkbox over each, ticked as its idea is narrated. It ends by zooming out to the finished poster. One narrated sentence at a time sits in a small italic caption box at the bottom.

It is non-interactive: no checks, no questions, no learner model. Same bones as our board, minus the learner.

### What to borrow, and where it lands

Pure SVG and CSS, achievable in the current scene and element primitives:

- **Paper and ink.** A cream board surface with a faint grain (an SVG `feTurbulence` filter over a flat fill), a thin double-rule plate border, and one ink color for all line work. This replaces the flat white card look.
- **Hatching instead of fills.** Shading as SVG `<pattern>` of parallel strokes, clipped to shapes, and a stipple pattern for dots. The circular insets use a hatched rim, which reads as engraved without any raster.
- **Figure captions on every element.** "FIG. N · TITLE" in letterspaced serif caps, with an optional italic subline. Numbered because the figures really are a sequence, which is also true of our beats.
- **Typography inside the board.** A Didone or high-contrast serif for figure titles and the poster title, an italic serif for sublines and the caption bar. Keep Atkinson Hyperlegible for the app chrome. Candidates on Google Fonts: Bodoni Moda or Playfair Display for display, Cormorant Garamond or EB Garamond italic for captions.
- **Molecules as a primitive.** Ball-and-stick with radial-gradient spheres and hatched shadow, a dashed mirror line between enantiomers. A `molecule` element or a scene item kind. The chemistry drawings the reviewer liked are this, and they are fully vector.
- **Outline drawn on the board.** The recipe's three checkboxed insets are our outline strip, but rendered as part of the lesson and ticked as each beat lands. A better progress signal than chips in the header.
- **Camera over a big canvas.** They never hide anything, they move the viewport. A `focus` op that animates the board's viewBox to an element would replace much of our show/clear rhythm and generalizes the pin flight.
- **Zoom out as the recap.** The finished poster, title on top, every figure in place, is the summary. Our finished overlay could pull back to the whole board instead.

Not achievable live in SVG:

- **The hands, the flask, the balance, the pill.** These are illustrations in a locked style. Three routes, in rising cost: a small curated library of engraved-style SVG assets the Planner can place; image generation at plan time in a locked style prompt, prefetched while beats 1 and 2 play; the model drawing paths directly, which is low quality today. Raster figures cannot be edited by the Tutor mid-lesson (no move, reveal, or highlight inside them), so they suit hero figures, and our live primitives stay for anything that changes under the learner's hands.

### Where it goes in the plan

Styling (paper, ink, hatching, captions, typography, molecule primitive) is board work and fits v0.3 alongside blackboard writing, since both are about what the board looks like while it is being written. Camera and recap zoom-out are playhead work and fit the same increment. The illustration library or generated hero images belong to v0.4 with the Animator.
