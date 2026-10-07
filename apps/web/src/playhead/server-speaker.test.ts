import { describe, expect, it } from "vitest";
import { charEnds } from "./server-speaker";

describe("charEnds", () => {
  it("maps timestamped words to character offsets, carrying trailing punctuation", () => {
    const text = "One is smaller than two, so one goes to the output.";
    const words = ["One", "is", "smaller", "than", "two", "so", "one", "goes", "to", "the", "output"].map((w, i) => ({ text: w, start: i, end: i + 1 }));
    const ends = charEnds(text, words);
    expect(ends[0]).toEqual({ end: 1, charEnd: 3 });
    expect(ends[4]).toEqual({ end: 5, charEnd: "One is smaller than two,".length });
    expect(ends[ends.length - 1]?.charEnd).toBe(text.length);
  });

  it("keeps going when a word is not found in the text", () => {
    const ends = charEnds("Hello there.", [
      { text: "Hello", start: 0, end: 0.3 },
      { text: "mystery", start: 0.3, end: 0.6 },
      { text: "there", start: 0.6, end: 0.9 },
    ]);
    expect(ends).toHaveLength(3);
    expect(ends[2]?.charEnd).toBe("Hello there.".length);
  });
});
