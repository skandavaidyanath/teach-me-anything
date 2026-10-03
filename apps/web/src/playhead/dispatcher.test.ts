import { describe, expect, it } from "vitest";
import { mergeSortLesson } from "@/content/merge-sort";
import { dispatchInput, matchNav } from "./dispatcher";

describe("matchNav", () => {
  it("recognizes short navigation commands", () => {
    expect(matchNav("wait")).toBe("pause");
    expect(matchNav("go back")).toBe("back");
    expect(matchNav("again")).toBe("repeat");
    expect(matchNav("skip")).toBe("skip");
    expect(matchNav("start over")).toBe("restart");
    expect(matchNav("ok")).toBe("resume");
  });

  it("does not treat questions that contain nav words as nav", () => {
    expect(matchNav("wait, why do we split all the way down to one element?")).toBeNull();
    expect(matchNav("what does stop at pairs mean")).toBeNull();
  });
});

describe("dispatchInput against the merge sort lesson", () => {
  it("routes the base-case question to its branch inside the splitting beats", () => {
    const d = dispatchInput(mergeSortLesson, "why split all the way to one? why not stop at 2?", { beatId: "b2", pointed: null });
    expect(d.kind).toBe("branch");
    if (d.kind === "branch") expect(d.branch.id).toBe("br.why-one");
  });

  it("respects beat restrictions", () => {
    const d = dispatchInput(mergeSortLesson, "why go all the way to one", { beatId: "b1", pointed: null });
    expect(d.kind).toBe("fallback");
  });

  it("routes the merge-rule misconception from any beat", () => {
    const d = dispatchInput(mergeSortLesson, "wait, I don't get how the merge knows which one to take", { beatId: "b3", pointed: null });
    expect(d.kind).toBe("branch");
    if (d.kind === "branch") expect(d.branch.id).toBe("br.merge-rule");
  });

  it("uses what the learner pointed at when the words alone are vague", () => {
    const d = dispatchInput(mergeSortLesson, "explain this", { beatId: "b3", pointed: "T1" });
    expect(d.kind).toBe("branch");
    if (d.kind === "branch") expect(d.branch.id).toBe("br.merge-rule");
  });

  it("falls back for anything unpredicted", () => {
    const d = dispatchInput(mergeSortLesson, "is this how python's sort works?", { beatId: "b3", pointed: null });
    expect(d.kind).toBe("fallback");
  });
});
