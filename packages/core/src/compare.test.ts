import { describe, expect, it } from "vitest";
import { compareRuns, formatComparison } from "./compare.js";
import type { AssertionResult } from "./schema.js";

function result(status: AssertionResult["status"], overrides: Partial<AssertionResult> = {}): AssertionResult {
  return { id: "x", status, basis: status === "not_applicable" ? "not-applicable" : "jev", evidence: status === "pass" || status === "fail" ? ["e1"] : [], durationMs: 0, ...overrides };
}

describe("compareRuns", () => {
  it("classifies fail -> pass as improved and pass -> fail as regressed", () => {
    const before = { goalCompleted: result("fail"), noUnsupportedClaims: result("pass") };
    const after = { goalCompleted: result("pass"), noUnsupportedClaims: result("fail") };

    const c = compareRuns("run-a", "run-b", before, after);

    expect(c.assertions.find((a) => a.id === "goalCompleted")!.verdict).toBe("improved");
    expect(c.assertions.find((a) => a.id === "noUnsupportedClaims")!.verdict).toBe("regressed");
    expect(c.counts.improved).toBe(1);
    expect(c.counts.regressed).toBe(1);
  });

  it("classifies review -> pass as improved and pass -> review as regressed", () => {
    const before = { a: result("review"), b: result("pass") };
    const after = { a: result("pass"), b: result("review") };

    const c = compareRuns("run-a", "run-b", before, after);

    expect(c.assertions.find((x) => x.id === "a")!.verdict).toBe("improved");
    expect(c.assertions.find((x) => x.id === "b")!.verdict).toBe("regressed");
  });

  it("classifies an identical status as unchanged", () => {
    const before = { goalCompleted: result("pass") };
    const after = { goalCompleted: result("pass", { confidence: 0.99 }) };

    const c = compareRuns("run-a", "run-b", before, after);

    expect(c.assertions[0]!.verdict).toBe("unchanged");
    expect(c.counts.unchanged).toBe(1);
  });

  it("classifies a swing across not_applicable/error as changed, never improved/regressed", () => {
    const before = { recoveredFromFailure: result("not_applicable") };
    const after = { recoveredFromFailure: result("pass") };

    const c = compareRuns("run-a", "run-b", before, after);

    expect(c.assertions[0]!.verdict).toBe("changed");
    expect(c.counts.changed).toBe(1);
    expect(c.counts.improved).toBe(0);
  });

  it("classifies an assertion present only in the after run as added, and only-before as removed", () => {
    const before = { onlyInBefore: result("pass") };
    const after = { onlyInAfter: result("fail") };

    const c = compareRuns("run-a", "run-b", before, after);

    expect(c.assertions.find((a) => a.id === "onlyInBefore")!.verdict).toBe("removed");
    expect(c.assertions.find((a) => a.id === "onlyInAfter")!.verdict).toBe("added");
    expect(c.counts.added).toBe(1);
    expect(c.counts.removed).toBe(1);
  });
});

describe("formatComparison", () => {
  it("renders both run ids, one line per assertion, and a summary count line", () => {
    const c = compareRuns("run-a", "run-b", { goalCompleted: result("fail") }, { goalCompleted: result("pass") });
    const text = formatComparison(c);

    expect(text).toContain("before: run-a");
    expect(text).toContain("after:  run-b");
    expect(text).toContain("goalCompleted");
    expect(text).toContain("fail → pass");
    expect(text).toContain("1 improved, 0 regressed, 0 changed, 0 added, 0 removed, 0 unchanged");
  });
});
