import { describe, expect, it } from "vitest";
import { formatConsole } from "./console.js";
import { buildReportV1 } from "./schema.js";
import type { AssertionResult } from "@agent-guard/core";

describe("formatConsole", () => {
  it("renders the run id, a pass icon, and an overall PASS label", () => {
    const report = buildReportV1({
      runId: "run-1",
      decisions: { goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", confidence: 0.9, signal: "noul-probability", evidence: ["e-task"], durationMs: 5 } },
    });
    const text = formatConsole(report);
    expect(text).toContain("run-1");
    expect(text).toContain("✓");
    expect(text).toContain("PASS");
  });

  it("renders an overall FAIL label when any assertion fails, never masked by other passing assertions", () => {
    const decisions: Record<string, AssertionResult> = {
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e-task"], durationMs: 5 },
      noFabricatedCompletion: { id: "noFabricatedCompletion", status: "fail", basis: "deterministic", evidence: ["e1"], explanation: "contradicted", durationMs: 0 },
    };
    const text = formatConsole(buildReportV1({ runId: "run-1", decisions }));
    expect(text).toContain("✗");
    expect(text).toContain("contradicted");
    expect(text).toMatch(/\n\s+FAIL\s*\n/);
  });
});
