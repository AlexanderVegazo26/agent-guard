import { describe, expect, it } from "vitest";
import { buildReportV1, buildReportV1FromRun, ReportV1 } from "./schema.js";
import { AgentRun, type AssertionResult } from "@agent-guard/core";

const PASS: AssertionResult = { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e-task"], durationMs: 5 };

describe("ReportV1 schema", () => {
  it("accepts a minimal valid report", () => {
    const report = buildReportV1({ runId: "run-1", decisions: { goalCompleted: PASS } });
    expect(ReportV1.safeParse(report).success).toBe(true);
  });

  it("rejects a report missing schemaVersion", () => {
    const report = buildReportV1({ runId: "run-1", decisions: { goalCompleted: PASS } }) as Record<string, unknown>;
    delete report.schemaVersion;
    const result = ReportV1.safeParse(report);
    expect(result.success).toBe(false);
  });

  it("rejects a report whose schemaVersion isn't 1", () => {
    const report = { ...buildReportV1({ runId: "run-1", decisions: { goalCompleted: PASS } }), schemaVersion: 2 };
    expect(ReportV1.safeParse(report).success).toBe(false);
  });

  it("omits adjudications entirely when none were passed, rather than an empty object", () => {
    const report = buildReportV1({ runId: "run-1", decisions: { goalCompleted: PASS } });
    expect(report).not.toHaveProperty("adjudications");
  });

  it("includes adjudications when passed", () => {
    const report = buildReportV1({
      runId: "run-1",
      decisions: { goalCompleted: PASS },
      adjudications: { goalCompleted: { assertionId: "goalCompleted", humanVerdict: "pass", reason: "checked", adjudicator: "alex", at: "2026-09-20T00:00:00.000Z" } },
    });
    expect(report.adjudications?.goalCompleted?.humanVerdict).toBe("pass");
  });
});

describe("buildReportV1FromRun", () => {
  it("derives task/agent/source/startedAt from the run", () => {
    const run = AgentRun.parse({
      id: "run-1",
      task: "Add a todo",
      agent: { name: "test-agent" },
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      schemaVersion: 1,
      events: [],
      source: "observed",
    });

    const report = buildReportV1FromRun(run, { goalCompleted: PASS });
    expect(report.task).toBe("Add a todo");
    expect(report.agent?.name).toBe("test-agent");
    expect(report.source).toBe("observed");
    expect(report.startedAt).toBe("2026-09-20T00:00:00.000Z");
  });

  it("extracts guard_decision events into guardDecisions, omitted when there are none", () => {
    const withoutGuard = AgentRun.parse({
      id: "run-1",
      task: "x",
      agent: { name: "a" },
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      schemaVersion: 1,
      events: [],
    });
    expect(buildReportV1FromRun(withoutGuard, {}).guardDecisions).toBeUndefined();

    const withGuard = AgentRun.parse({
      id: "run-2",
      task: "x",
      agent: { name: "a" },
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      schemaVersion: 1,
      events: [
        {
          id: "ev-1",
          type: "guard_decision",
          tool: "delete_account",
          arguments: {},
          decision: "block",
          reason: "unauthorized",
          timestamp: "2026-09-20T00:00:01.000Z",
          seq: 1,
        },
      ],
    });
    const report = buildReportV1FromRun(withGuard, {});
    expect(report.guardDecisions).toEqual([
      { tool: "delete_account", decision: "block", reason: "unauthorized", timestamp: "2026-09-20T00:00:01.000Z" },
    ]);
  });
});
