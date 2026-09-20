import { describe, expect, it } from "vitest";
import { formatJunit } from "./junit.js";
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

describe("formatJunit", () => {
  it("emits one testsuite per report and one testcase per assertion, with correct counts", () => {
    const xml = formatJunit(REPORTS);
    expect(xml).toContain('<testsuite name="01-happy-path" tests="1" failures="0" errors="0" skipped="0">');
    expect(xml).toContain('<testsuite name="02-false-completion" tests="1" failures="1" errors="0" skipped="0">');
    expect(xml).toContain('<testsuite name="19-correct-but-low-evidence" tests="1" failures="0" errors="0" skipped="1">');
  });

  it("renders a fail status as a <failure> element, never a silent pass", () => {
    const xml = formatJunit(REPORTS);
    expect(xml).toMatch(/<failure message="contradicted by a recorded failure">/);
  });

  it("renders review and not_applicable as <skipped>, never a pass or fail", () => {
    const xml = formatJunit(REPORTS);
    expect(xml).toMatch(/<skipped message="review \(structural-gap\)"\/>/);
  });

  it("escapes XML special characters in names and messages", () => {
    const xml = formatJunit([
      buildReportV1({
        runId: "run <1>",
        decisions: { x: { id: "x", status: "fail", basis: "jev", evidence: ["e"], explanation: 'a "quoted" & <tag>', durationMs: 0 } },
      }),
    ]);
    expect(xml).toContain('name="run &lt;1&gt;"');
    expect(xml).toContain("a &quot;quoted&quot; &amp; &lt;tag&gt;");
  });
});
