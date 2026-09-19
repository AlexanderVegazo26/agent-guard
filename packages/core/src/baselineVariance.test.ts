import { describe, expect, it } from "vitest";
import { computeVariance, exceedsVarianceFloor } from "./baselineVariance.js";

describe("computeVariance — PRD2 F10 / AUTOFIX.md §4.3", () => {
  it("returns null for an empty sample — no baseline runs, no measured variance", () => {
    expect(computeVariance([])).toBeNull();
  });

  it("computes min/max/range/mean from real repeated-baseline confidence values", () => {
    const stats = computeVariance([0.9, 0.85, 0.95]);
    expect(stats).toEqual({ n: 3, min: 0.85, max: 0.95, range: expect.closeTo(0.1, 10), mean: expect.closeTo(0.9, 10) });
  });

  it("range is 0 for a single-sample or perfectly stable series", () => {
    expect(computeVariance([0.9])!.range).toBe(0);
    expect(computeVariance([0.9, 0.9, 0.9])!.range).toBe(0);
  });
});

describe("exceedsVarianceFloor — AUTOFIX.md §5 rule 4", () => {
  it("refuses to call anything a real signal against an unmeasured (n<2) baseline", () => {
    const oneSample = computeVariance([0.9])!;
    expect(exceedsVarianceFloor(0.9, 0.99, oneSample)).toBe(false);
  });

  it("does not count a movement smaller than the observed baseline range as signal", () => {
    // baseline observed to swing between 0.80 and 0.90 on its own (range 0.10)
    const baseline = computeVariance([0.8, 0.85, 0.9])!;
    expect(exceedsVarianceFloor(0.85, 0.92, baseline)).toBe(false); // moved 0.07, less than the 0.10 floor
  });

  it("counts a movement clearly larger than the observed baseline range as a real signal", () => {
    const baseline = computeVariance([0.8, 0.85, 0.9])!;
    expect(exceedsVarianceFloor(0.85, 0.99, baseline)).toBe(true); // moved 0.14, more than the 0.10 floor
  });
});
