import type { AssertionResult } from "@agent-guard/core";

/**
 * PRD §10.3 — JUnit XML, CI-native. Each run is a `<testsuite>`, each
 * assertion a `<testcase>`. JUnit has no native "review" concept; `review`
 * and `not_applicable` both map to `<skipped>` (an abstention, not a
 * pass/fail) — never to a silent pass, which is exactly the false-positive
 * shape PRD §10.4 forbids the reporter from producing.
 */
export function formatJunit(runs: Record<string, Record<string, AssertionResult>>): string {
  const suites = Object.entries(runs).map(([runName, results]) => formatSuite(runName, results));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join("")}</testsuites>\n`;
}

function formatSuite(runName: string, results: Record<string, AssertionResult>): string {
  const cases = Object.values(results);
  const failures = cases.filter((c) => c.status === "fail").length;
  const errors = cases.filter((c) => c.status === "error").length;
  const skipped = cases.filter((c) => c.status === "review" || c.status === "not_applicable").length;

  const testcases = cases.map((c) => formatCase(runName, c)).join("");
  return `  <testsuite name="${escapeXml(runName)}" tests="${cases.length}" failures="${failures}" errors="${errors}" skipped="${skipped}">\n${testcases}  </testsuite>\n`;
}

function formatCase(runName: string, result: AssertionResult): string {
  const time = ((result.durationMs ?? 0) / 1000).toFixed(3);
  const open = `    <testcase classname="${escapeXml(runName)}" name="${escapeXml(result.id)}" time="${time}">\n`;
  const close = "    </testcase>\n";

  if (result.status === "fail") {
    const message = escapeXml(result.explanation ?? "assertion failed");
    return `${open}      <failure message="${message}">${message}</failure>\n${close}`;
  }
  if (result.status === "error") {
    const message = escapeXml(result.explanation ?? "assertion errored");
    return `${open}      <error message="${message}">${message}</error>\n${close}`;
  }
  if (result.status === "review" || result.status === "not_applicable") {
    const message = escapeXml(result.status === "not_applicable" ? "not applicable" : `review (${result.reviewVia ?? "uncertainty-band"})`);
    return `${open}      <skipped message="${message}"/>\n${close}`;
  }
  return `${open}${close}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
