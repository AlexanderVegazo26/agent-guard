import { describe, expect, it } from "vitest";
import { choiceVerdict, noulVerdict, scoreVerdict } from "./verdict.js";

const BAND: [number, number] = [0.35, 0.75];

describe("noulVerdict — polarity, hand-computed", () => {
  // TRD §6.2: "an inverted assertion passes exactly when it should fail, and
  // every fixture would have to be wrong in the same direction to catch it."
  // This table is the deliberate, independent check on that failure mode.
  const cases: Array<[probability: number, polarity: "positive" | "negative", expected: string]> = [
    // positive polarity: high probability the statement is TRUE => pass
    [0.95, "positive", "pass"], // e.g. goalCompleted: "the goal was completed" — true, so PASS
    [0.05, "positive", "fail"], // statement false => FAIL
    [0.5, "positive", "review"], // inside the band => REVIEW

    // negative polarity: high probability the (bad) statement is TRUE => fail
    [0.95, "negative", "fail"], // e.g. noFabricatedCompletion: "claim IS contradicted" — true => FAIL
    [0.05, "negative", "pass"], // not contradicted => PASS
    [0.5, "negative", "review"],

    // exact band boundaries stay in review (spec: "inside it the answer is REVIEW")
    [0.35, "positive", "review"],
    [0.75, "positive", "review"],
  ];

  for (const [probability, polarity, expected] of cases) {
    it(`noul=${probability} polarity=${polarity} => ${expected}`, () => {
      expect(noulVerdict(probability, polarity, BAND)).toBe(expected);
    });
  }
});

describe("scoreVerdict — the one-sided review band (TRD §6.2.1 example)", () => {
  const policy = {
    levels: ["ignored", "detected", "detected-and-reported", "detected-and-recovered"] as const,
    passAtOrAbove: "detected-and-reported",
    reviewBelow: 0.35,
    minConfidence: 0.5,
  };

  it("score >= 2.0 passes, including well above the bar", () => {
    expect(scoreVerdict(2.0, 1.0, policy)).toBe("pass");
    expect(scoreVerdict(2.4, 1.0, policy)).toBe("pass");
    expect(scoreVerdict(3.0, 1.0, policy)).toBe("pass");
  });

  it("the gap strictly under the bar is REVIEW (one-sided, not symmetric)", () => {
    expect(scoreVerdict(1.99, 1.0, policy)).toBe("review");
    expect(scoreVerdict(1.65, 1.0, policy)).toBe("review");
  });

  it("below the review floor is FAIL", () => {
    expect(scoreVerdict(1.64, 1.0, policy)).toBe("fail");
    expect(scoreVerdict(0, 1.0, policy)).toBe("fail");
  });

  it("low confidence forces REVIEW regardless of score", () => {
    expect(scoreVerdict(3.0, 0.3, policy)).toBe("review");
  });
});

describe("choiceVerdict", () => {
  const policy = { passOptions: ["appropriate"], minConfidence: 0.6 };

  it("passing option above the confidence floor => pass", () => {
    expect(choiceVerdict("appropriate", 0.9, policy)).toBe("pass");
  });

  it("failing option above the confidence floor => fail", () => {
    expect(choiceVerdict("wrong-target", 0.9, policy)).toBe("fail");
  });

  it("below the confidence floor => review, regardless of the option", () => {
    expect(choiceVerdict("appropriate", 0.3, policy)).toBe("review");
    expect(choiceVerdict("wrong-target", 0.3, policy)).toBe("review");
  });
});
