import { describe, expect, it } from "vitest";
import { formatJson } from "./json.js";
import { buildReportV1, type ReportV1 } from "./schema.js";

/**
 * PRD2 F1's acceptance criterion is that "an adjudication round-trips
 * through the CLI and JSON reporter" — this is the reporter half of that.
 */
describe("formatJson", () => {
  it("includes a run's adjudications alongside its decisions", () => {
    const report = buildReportV1({
      runId: "run-1",
      decisions: {
        goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e-task"], durationMs: 5 },
      },
      adjudications: {
        goalCompleted: { assertionId: "goalCompleted", humanVerdict: "pass", reason: "checked", adjudicator: "alex", at: "2026-09-20T00:00:00.000Z" },
      },
    });

    const parsed = JSON.parse(formatJson([report])) as { reports: ReportV1[] };
    expect(parsed.reports[0]!.decisions.goalCompleted!.status).toBe("pass");
    expect(parsed.reports[0]!.adjudications!.goalCompleted!.humanVerdict).toBe("pass");
  });

  it("omits adjudications entirely for a run nothing has been adjudicated on, rather than an empty object", () => {
    const report = buildReportV1({
      runId: "run-1",
      decisions: { goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e-task"], durationMs: 5 } },
    });

    const parsed = JSON.parse(formatJson([report])) as { reports: ReportV1[] };
    expect(parsed.reports[0]).not.toHaveProperty("adjudications");
  });

  it("carries schemaVersion at both the wrapper and each report", () => {
    const report = buildReportV1({ runId: "run-1", decisions: {} });
    const parsed = JSON.parse(formatJson([report])) as { schemaVersion: number; reports: ReportV1[] };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.reports[0]!.schemaVersion).toBe(1);
  });
});
