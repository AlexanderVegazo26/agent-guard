import { describe, expect, it } from "vitest";
import { formatSite } from "./site.js";
import { buildReportV1 } from "./schema.js";
import type { AssertionResult } from "@agent-guard/core";

/**
 * PRD3 F21 — `formatSite` (the `report --site` fleet dashboard). Each test
 * targets one section's observable content, not just "it renders without
 * throwing" — a template that silently drops a row still returns 200
 * characters of valid HTML.
 */
describe("formatSite — PRD3 F21 fleet dashboard", () => {
  const passResult: AssertionResult = {
    id: "goalCompleted",
    status: "pass",
    basis: "jev",
    confidence: 0.9,
    evidence: ["e-task-1"],
    durationMs: 5,
  };

  const reviewNoAdjudication: AssertionResult = {
    id: "noGoalHijack",
    status: "review",
    basis: "jev",
    confidence: 0.5,
    evidence: [],
    explanation: "ambiguous tool call",
    durationMs: 5,
  };

  const reviewAdjudicated: AssertionResult = {
    id: "noCascadingFailure",
    status: "review",
    basis: "jev",
    confidence: 0.5,
    evidence: [],
    explanation: "needs a human look",
    durationMs: 5,
  };

  it("renders every run in the run list with its pass/fail/review/error tally", () => {
    const reports = [
      buildReportV1({ runId: "run-1", decisions: { goalCompleted: passResult }, agent: { name: "agent-x" }, task: "do the thing" }),
      buildReportV1({ runId: "run-2", decisions: { goalCompleted: passResult } }),
    ];
    const html = formatSite(reports);
    expect(html).toContain("run-1");
    expect(html).toContain("run-2");
    expect(html).toContain("agent-x");
    expect(html).toContain("do the thing");
    expect(html).toContain("1 pass, 0 fail, 0 review, 0 error");
  });

  it("shows the honest empty state when there are no stored runs at all", () => {
    const html = formatSite([]);
    expect(html).toContain("No stored runs.");
  });

  it("evidence graph lists assertion -> evidence-id edges and omits assertions with no evidence", () => {
    // "review" is one status TRD §6.8 doesn't require evidence for.
    const noEvidence: AssertionResult = { ...passResult, id: "diffMatchesTask", status: "review", evidence: [] };
    const reports = [buildReportV1({ runId: "run-1", decisions: { goalCompleted: passResult, diffMatchesTask: noEvidence } })];
    const html = formatSite(reports);
    expect(html).toContain("e-task-1");
    expect(html).toContain("goalCompleted");
    // The evidence-graph section shouldn't render a row for the no-evidence assertion.
    const graphSection = html.split("<h2>Evidence graph</h2>")[1]!.split("<h2>")[0]!;
    expect(graphSection).not.toContain("diffMatchesTask");
  });

  it("renders the evidence-graph empty state when nothing carries evidence", () => {
    const noEvidence: AssertionResult = { ...passResult, status: "review", evidence: [] };
    const html = formatSite([buildReportV1({ runId: "run-1", decisions: { goalCompleted: noEvidence } })]);
    expect(html).toContain("No assertion carries evidence ids yet.");
  });

  it("assertion history groups by assertion id across the whole fleet, not per run", () => {
    const failResult: AssertionResult = { ...passResult, status: "fail" };
    const reports = [
      buildReportV1({ runId: "run-1", decisions: { goalCompleted: passResult } }),
      buildReportV1({ runId: "run-2", decisions: { goalCompleted: failResult } }),
    ];
    const html = formatSite(reports);
    const historySection = html.split("<h2>Assertion history</h2>")[1]!.split("<h2>")[0]!;
    expect(historySection).toContain("goalCompleted");
    expect(historySection).toContain("(2 run(s))");
    expect(historySection).toContain("status-pass");
    expect(historySection).toContain("status-fail");
  });

  it("mutation dimensions render the honest empty state when no report has populated it (F14 unimplemented)", () => {
    const html = formatSite([buildReportV1({ runId: "run-1", decisions: { goalCompleted: passResult } })]);
    expect(html).toContain("No mutation coverage recorded");
    expect(html).toContain("PRD3 F14");
  });

  it("mutation dimensions aggregate resisted/total across reports when present", () => {
    const reports = [
      buildReportV1({
        runId: "run-1",
        decisions: { goalCompleted: passResult },
        mutationDimensions: { promptInjection: { resisted: 18, total: 20 } },
      }),
      buildReportV1({
        runId: "run-2",
        decisions: { goalCompleted: passResult },
        mutationDimensions: { promptInjection: { resisted: 2, total: 2 } },
      }),
    ];
    const html = formatSite(reports);
    const dimSection = html.split("<h2>Mutation dimensions</h2>")[1]!.split("<h2>")[0]!;
    expect(dimSection).toContain("promptInjection");
    expect(dimSection).toContain("20/22");
  });

  it("adjudication queue includes a review assertion with no matching adjudication", () => {
    const html = formatSite([buildReportV1({ runId: "run-1", decisions: { noGoalHijack: reviewNoAdjudication } })]);
    const queueSection = html.split("<h2>Adjudication queue</h2>")[1]!;
    expect(queueSection).toContain("noGoalHijack");
    expect(queueSection).toContain("ambiguous tool call");
  });

  it("adjudication queue drops out a review assertion once it has a matching adjudication", () => {
    const html = formatSite([
      buildReportV1({
        runId: "run-1",
        decisions: { noCascadingFailure: reviewAdjudicated },
        adjudications: { noCascadingFailure: { assertionId: "noCascadingFailure", humanVerdict: "pass", reason: "confirmed", adjudicator: "alex", at: "2026-09-20T00:00:00.000Z" } },
      }),
    ]);
    const queueSection = html.split("<h2>Adjudication queue</h2>")[1]!;
    expect(queueSection).toContain("Nothing awaiting adjudication.");
    expect(queueSection).not.toContain("noCascadingFailure");
  });

  it("adjudication queue never includes a passing or failing assertion, only review", () => {
    const failResult: AssertionResult = { ...passResult, id: "diffMatchesTask", status: "fail" };
    const html = formatSite([buildReportV1({ runId: "run-1", decisions: { goalCompleted: passResult, diffMatchesTask: failResult } })]);
    const queueSection = html.split("<h2>Adjudication queue</h2>")[1]!;
    expect(queueSection).toContain("Nothing awaiting adjudication.");
  });

  it("escapes user-controlled content (task, explanation) to prevent HTML injection", () => {
    const xssResult: AssertionResult = { ...reviewNoAdjudication, explanation: "<script>alert(1)</script>" };
    const html = formatSite([buildReportV1({ runId: "run-1", decisions: { noGoalHijack: xssResult }, task: "<img src=x onerror=alert(1)>" })]);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;");
  });
});
