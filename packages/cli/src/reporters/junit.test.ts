import type { AssertionResult } from "@agent-guard/core";
import { describe, expect, it } from "vitest";
import { formatJunit } from "./junit.js";
import { formatJson } from "./json.js";
import { formatHtml } from "./html.js";

const RUNS: Record<string, Record<string, AssertionResult>> = {
  "01-happy-path": {
    goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e-task"], durationMs: 12 },
  },
  "02-false-completion": {
    noFabricatedCompletion: {
      id: "noFabricatedCompletion",
      status: "fail",
      basis: "deterministic",
      evidence: ["e-final-c1", "e-ev-1"],
      explanation: "contradicted by a recorded failure",
      durationMs: 0,
    },
  },
  "19-correct-but-low-evidence": {
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
};

describe("formatJunit", () => {
  it("emits one testsuite per run and one testcase per assertion, with correct counts", () => {
    const xml = formatJunit(RUNS);
    expect(xml).toContain('<testsuite name="01-happy-path" tests="1" failures="0" errors="0" skipped="0">');
    expect(xml).toContain('<testsuite name="02-false-completion" tests="1" failures="1" errors="0" skipped="0">');
    expect(xml).toContain('<testsuite name="19-correct-but-low-evidence" tests="1" failures="0" errors="0" skipped="1">');
  });

  it("renders a fail status as a <failure> element, never a silent pass", () => {
    const xml = formatJunit(RUNS);
    expect(xml).toMatch(/<failure message="contradicted by a recorded failure">/);
  });

  it("renders review and not_applicable as <skipped>, never a pass or fail", () => {
    const xml = formatJunit(RUNS);
    expect(xml).toMatch(/<skipped message="review \(structural-gap\)"\/>/);
  });

  it("escapes XML special characters in names and messages", () => {
    const xml = formatJunit({
      "run <1>": {
        x: { id: "x", status: "fail", basis: "jev", evidence: ["e"], explanation: 'a "quoted" & <tag>', durationMs: 0 },
      },
    });
    expect(xml).toContain('name="run &lt;1&gt;"');
    expect(xml).toContain("a &quot;quoted&quot; &amp; &lt;tag&gt;");
  });
});

describe("formatJson", () => {
  it("round-trips every run and assertion verbatim", () => {
    const parsed = JSON.parse(formatJson(RUNS));
    expect(parsed.runs).toEqual(RUNS);
  });
});

describe("formatHtml", () => {
  it("renders one section per run, one row per assertion, with a status class", () => {
    const html = formatHtml(RUNS);
    expect(html).toContain('<h2 class="run-heading">01-happy-path</h2>');
    expect(html).toContain('<h2 class="run-heading">02-false-completion</h2>');
    expect(html).toContain('class="status status-pass"');
    expect(html).toContain('class="status status-fail"');
    expect(html).toContain('class="status status-review"');
  });

  it("summarizes totals across all runs", () => {
    const html = formatHtml(RUNS);
    expect(html).toContain("1 pass, 1 fail, 1 review, 0 error");
  });

  it("escapes evidence/explanation/id so a run never breaks out of its table cell", () => {
    const html = formatHtml({
      "run <1>": {
        x: { id: "x<y>", status: "fail", basis: "jev", evidence: ['e"1'], explanation: 'a "quoted" & <tag>', durationMs: 0 },
      },
    });
    expect(html).toContain('<h2 class="run-heading">run &lt;1&gt;</h2>');
    expect(html).toContain("x&lt;y&gt;");
    expect(html).toContain("a &quot;quoted&quot; &amp; &lt;tag&gt;");
    expect(html).not.toContain("<tag>");
  });

  it("is a single self-contained document with no external asset references", () => {
    const html = formatHtml(RUNS);
    expect(html).not.toMatch(/<link\b/);
    expect(html).not.toMatch(/<script\s+src=/);
  });
});
