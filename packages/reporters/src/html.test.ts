import { describe, expect, it } from "vitest";
import { formatHtml } from "./html.js";
import { buildReportV1, type ReportV1 } from "./schema.js";

const REPORTS: ReportV1[] = [
  buildReportV1({
    runId: "01-happy-path",
    decisions: { goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e-task"], durationMs: 12 } },
  }),
  buildReportV1({
    runId: "02-false-completion",
    decisions: {
      noFabricatedCompletion: {
        id: "noFabricatedCompletion",
        status: "fail",
        basis: "deterministic",
        evidence: ["e-final-c1", "e-ev-1"],
        explanation: "contradicted by a recorded failure",
        durationMs: 0,
      },
    },
  }),
  buildReportV1({
    runId: "19-correct-but-low-evidence",
    decisions: {
      noFabricatedCompletion: {
        id: "noFabricatedCompletion",
        status: "review",
        basis: "jev",
        reviewVia: "structural-gap",
        missing: ["network"],
        evidence: [],
        durationMs: 0,
      },
    },
  }),
];

describe("formatHtml", () => {
  it("renders one section per run, one row per assertion, with a status class", () => {
    const html = formatHtml(REPORTS);
    expect(html).toContain('<h2 class="run-heading">01-happy-path</h2>');
    expect(html).toContain('<h2 class="run-heading">02-false-completion</h2>');
    expect(html).toContain('class="status status-pass"');
    expect(html).toContain('class="status status-fail"');
    expect(html).toContain('class="status status-review"');
  });

  it("summarizes totals across all reports", () => {
    const html = formatHtml(REPORTS);
    expect(html).toContain("1 pass, 1 fail, 1 review, 0 error");
  });

  it("escapes evidence/explanation/id so a run never breaks out of its table cell", () => {
    const html = formatHtml([
      buildReportV1({
        runId: "run <1>",
        decisions: { x: { id: "x<y>", status: "fail", basis: "jev", evidence: ['e"1'], explanation: 'a "quoted" & <tag>', durationMs: 0 } },
      }),
    ]);
    expect(html).toContain('<h2 class="run-heading">run &lt;1&gt;</h2>');
    expect(html).toContain("x&lt;y&gt;");
    expect(html).toContain("a &quot;quoted&quot; &amp; &lt;tag&gt;");
    expect(html).not.toContain("<tag>");
  });

  it("is a single self-contained document with no external asset references", () => {
    const html = formatHtml(REPORTS);
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script\s+src=/);
  });

  it("degradation cell reflects a populated DegradationRecord, and falls back to an em-dash when absent", () => {
    const html = formatHtml([
      buildReportV1({
        runId: "run-degraded",
        decisions: {
          x: {
            id: "x",
            status: "review",
            basis: "jev",
            reviewVia: "capacity",
            evidence: [],
            durationMs: 0,
            degradation: { strategy: "fanout-cap", reason: "too many candidates" },
          },
        },
      }),
    ]);
    expect(html).toContain("fanout-cap: too many candidates");
  });
});
