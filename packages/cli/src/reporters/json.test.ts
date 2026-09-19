import { describe, expect, it } from "vitest";
import { formatJson, type JsonReportRun } from "./json.js";

/**
 * PRD2 F1's acceptance criterion is that "an adjudication round-trips
 * through the CLI and JSON reporter" — this is the reporter half of that.
 */
describe("formatJson", () => {
  it("includes a run's adjudications alongside its decisions", () => {
    const runs: Record<string, JsonReportRun> = {
      "run-1": {
        decisions: {
          goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e-task"], durationMs: 5 },
        },
        adjudications: {
          goalCompleted: { assertionId: "goalCompleted", humanVerdict: "pass", reason: "checked", adjudicator: "alex", at: "2026-09-20T00:00:00.000Z" },
        },
      },
    };

    const report = JSON.parse(formatJson(runs)) as { runs: Record<string, JsonReportRun> };
    expect(report.runs["run-1"]!.decisions.goalCompleted!.status).toBe("pass");
    expect(report.runs["run-1"]!.adjudications!.goalCompleted!.humanVerdict).toBe("pass");
  });

  it("omits adjudications entirely for a run nothing has been adjudicated on, rather than an empty object", () => {
    const runs: Record<string, JsonReportRun> = {
      "run-1": {
        decisions: { goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e-task"], durationMs: 5 } },
      },
    };

    const report = JSON.parse(formatJson(runs)) as { runs: Record<string, JsonReportRun> };
    expect(report.runs["run-1"]).not.toHaveProperty("adjudications");
  });
});
