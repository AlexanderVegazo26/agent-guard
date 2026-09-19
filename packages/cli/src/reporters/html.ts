import type { AssertionResult, AssertionStatus } from "@agent-guard/core";

/**
 * FR-015 — a single self-contained HTML file (no external assets, so it
 * survives being uploaded as a CI artifact and opened offline). One row per
 * run, one row per assertion within it, using the same three-way status
 * split as `junit.ts` (`fail`/`error` vs. `review`/`not_applicable` vs.
 * `pass`) so the two reporters never disagree about what counts as a
 * problem worth a human's attention.
 */
export function formatHtml(runs: Record<string, Record<string, AssertionResult>>): string {
  const runNames = Object.keys(runs).sort();
  const totals = { pass: 0, fail: 0, review: 0, error: 0 };

  const sections = runNames.map((runName) => {
    const results = Object.values(runs[runName]!);
    for (const r of results) tally(totals, r.status);
    return formatRunSection(runName, runs[runName]!);
  });

  const summary = `${totals.pass} pass, ${totals.fail} fail, ${totals.review} review, ${totals.error} error`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AgentGuard report</title>
<style>
  body { font: 14px/1.5 -apple-system, Segoe UI, Helvetica, Arial, sans-serif; margin: 2rem; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.4rem; }
  .summary { color: #555; margin-bottom: 1.5rem; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 2rem; }
  th, td { text-align: left; padding: 0.4rem 0.7rem; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  th { color: #555; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.02em; }
  .status { font-weight: 600; padding: 0.1rem 0.5rem; border-radius: 0.3rem; display: inline-block; }
  .status-pass { background: #e6f4ea; color: #1e7a34; }
  .status-fail { background: #fce8e6; color: #b3261e; }
  .status-error { background: #fce8e6; color: #b3261e; }
  .status-review { background: #fef7e0; color: #8a6100; }
  .status-not_applicable { background: #f1f3f4; color: #5f6368; }
  .evidence { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem; color: #555; }
  .explanation { color: #333; }
  .run-heading { font-size: 1.05rem; margin: 1.5rem 0 0.5rem; }
</style>
</head>
<body>
<h1>AgentGuard report</h1>
<p class="summary">${runNames.length} run(s) &mdash; ${escapeHtml(summary)}</p>
${sections.join("\n")}
</body>
</html>
`;
}

function tally(totals: { pass: number; fail: number; review: number; error: number }, status: AssertionStatus): void {
  if (status === "pass") totals.pass += 1;
  else if (status === "fail") totals.fail += 1;
  else if (status === "error") totals.error += 1;
  else totals.review += 1; // review + not_applicable, same grouping as junit.ts's "skipped"
}

function formatRunSection(runName: string, results: Record<string, AssertionResult>): string {
  const rows = Object.values(results)
    .map((r) => formatRow(r))
    .join("\n");

  return `<h2 class="run-heading">${escapeHtml(runName)}</h2>
<table>
  <thead><tr><th>Assertion</th><th>Status</th><th>Basis</th><th>Evidence</th><th>Explanation</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

function formatRow(result: AssertionResult): string {
  const statusLabel = result.status === "not_applicable" ? "n/a" : result.status;
  const evidenceCell = result.evidence.length > 0 ? escapeHtml(result.evidence.join(", ")) : "&mdash;";
  return `    <tr>
      <td>${escapeHtml(result.id)}</td>
      <td><span class="status status-${result.status}">${escapeHtml(statusLabel)}</span></td>
      <td>${escapeHtml(result.basis)}</td>
      <td class="evidence">${evidenceCell}</td>
      <td class="explanation">${escapeHtml(result.explanation ?? "")}</td>
    </tr>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
