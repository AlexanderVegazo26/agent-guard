import type { AssertionResult } from "@agent-guard/core";
import type { ReportV1 } from "./schema.js";

/**
 * PRD3 F21 — `agentguard report --site`: a static, fleet-level dashboard
 * rendered from `ReportV1[]` (never a raw store read — same contract
 * `report`, `compare` and `history` already read from). Unlike `html.ts`'s
 * `formatHtml` (one table per run, meant as a CI artifact for a single
 * report), this is the multi-run view F21 asks for: a run list, an
 * evidence graph, per-assertion history across the fleet, mutation-
 * dimension coverage, and an adjudication queue. Self-contained (no
 * external assets, no bundler, no server) — same constraint `html.ts`
 * ships under.
 *
 * Two of the five sections are honestly thin because of what `ReportV1`
 * actually carries, not because this renderer under-builds them:
 *  - "Evidence graph" here is assertion → evidence-id edges, the only
 *    shape `AssertionResult.evidence` (a string list) gives us. The
 *    richer `EvidenceLink` graph lives in `@agent-guard/core`'s
 *    `StoredEvidence`, which this package's contract (`ReportV1`) does
 *    not carry — building that view means widening the schema, which is
 *    out of scope for this pass.
 *  - "Mutation dimensions" renders `report.mutationDimensions` exactly as
 *    given; no report produces it yet (F14, the mutation engine, is
 *    unimplemented), so every fleet renders this section as an honest
 *    empty state rather than synthesizing data.
 */
export function formatSite(reports: ReportV1[]): string {
  const sorted = [...reports].sort((a, b) => a.runId.localeCompare(b.runId));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>AgentGuard fleet</title>
<style>
  body { font: 14px/1.5 -apple-system, Segoe UI, Helvetica, Arial, sans-serif; margin: 2rem; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.1rem; margin-top: 2.5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: 0.3rem; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { text-align: left; padding: 0.4rem 0.7rem; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  th { color: #555; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.02em; }
  .status { font-weight: 600; padding: 0.1rem 0.5rem; border-radius: 0.3rem; display: inline-block; font-size: 0.85em; }
  .status-pass { background: #e6f4ea; color: #1e7a34; }
  .status-fail { background: #fce8e6; color: #b3261e; }
  .status-error { background: #fce8e6; color: #b3261e; }
  .status-review { background: #fef7e0; color: #8a6100; }
  .status-not_applicable { background: #f1f3f4; color: #5f6368; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85rem; color: #555; }
  .empty { color: #888; font-style: italic; }
  .muted { color: #666; }
</style>
</head>
<body>
<h1>AgentGuard fleet</h1>
<p class="muted">${sorted.length} run(s)</p>

<h2>Run list</h2>
${formatRunList(sorted)}

<h2>Evidence graph</h2>
${formatEvidenceGraph(sorted)}

<h2>Assertion history</h2>
${formatAssertionHistory(sorted)}

<h2>Mutation dimensions</h2>
${formatMutationDimensions(sorted)}

<h2>Adjudication queue</h2>
${formatAdjudicationQueue(sorted)}
</body>
</html>
`;
}

function formatRunList(reports: ReportV1[]): string {
  if (reports.length === 0) return `<p class="empty">No stored runs.</p>`;

  const rows = reports
    .map((r) => {
      const counts = { pass: 0, fail: 0, review: 0, error: 0 };
      for (const result of Object.values(r.decisions)) tally(counts, result.status);
      return `    <tr>
      <td class="mono">${escapeHtml(r.runId)}</td>
      <td>${escapeHtml(r.startedAt ?? "—")}</td>
      <td>${escapeHtml(r.agent?.name ?? "—")}</td>
      <td>${escapeHtml(r.task ?? "—")}</td>
      <td>${escapeHtml(labelSource(r))}</td>
      <td>${counts.pass} pass, ${counts.fail} fail, ${counts.review} review, ${counts.error} error</td>
    </tr>`;
    })
    .join("\n");

  return `<table>
  <thead><tr><th>Run</th><th>Started</th><th>Agent</th><th>Task</th><th>Source</th><th>Assertions</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

function labelSource(report: ReportV1): string {
  return report.source ?? "—";
}

/**
 * Assertion → evidence-id edges, the graph shape `ReportV1` actually
 * supports (see module doc). One row per (run, assertion) pair that has
 * at least one evidence id.
 */
function formatEvidenceGraph(reports: ReportV1[]): string {
  const rows: string[] = [];
  for (const r of reports) {
    for (const result of Object.values(r.decisions)) {
      if (result.evidence.length === 0) continue;
      rows.push(`    <tr>
      <td class="mono">${escapeHtml(r.runId)}</td>
      <td>${escapeHtml(result.id)}</td>
      <td class="mono">${escapeHtml(result.evidence.join(", "))}</td>
    </tr>`);
    }
  }

  if (rows.length === 0) return `<p class="empty">No assertion carries evidence ids yet.</p>`;

  return `<table>
  <thead><tr><th>Run</th><th>Assertion</th><th>Evidence</th></tr></thead>
  <tbody>
${rows.join("\n")}
  </tbody>
</table>`;
}

/** Per-assertion, chronological (by report order — callers pass already-sorted reports) status sequence across the whole fleet. */
function formatAssertionHistory(reports: ReportV1[]): string {
  const byAssertion = new Map<string, { runId: string; status: AssertionResult["status"] }[]>();
  for (const r of reports) {
    for (const result of Object.values(r.decisions)) {
      const series = byAssertion.get(result.id) ?? [];
      series.push({ runId: r.runId, status: result.status });
      byAssertion.set(result.id, series);
    }
  }

  if (byAssertion.size === 0) return `<p class="empty">No decisions recorded.</p>`;

  const sections = [...byAssertion.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([assertionId, series]) => {
      const badges = series
        .map((e) => `<span class="status status-${e.status}" title="${escapeHtml(e.runId)}">${escapeHtml(statusLabel(e.status))}</span>`)
        .join(" ");
      return `<p><strong class="mono">${escapeHtml(assertionId)}</strong> (${series.length} run(s)): ${badges}</p>`;
    });

  return sections.join("\n");
}

function formatMutationDimensions(reports: ReportV1[]): string {
  const totals = new Map<string, { resisted: number; total: number }>();
  for (const r of reports) {
    if (!r.mutationDimensions) continue;
    for (const [dimension, summary] of Object.entries(r.mutationDimensions)) {
      const existing = totals.get(dimension) ?? { resisted: 0, total: 0 };
      existing.resisted += summary.resisted;
      existing.total += summary.total;
      totals.set(dimension, existing);
    }
  }

  if (totals.size === 0) {
    // PRD3 F14 (the mutation engine) is unimplemented — no report has
    // populated `mutationDimensions` yet. This is the honest empty
    // state, not a placeholder pending removal.
    return `<p class="empty">No mutation coverage recorded (the mutation engine, PRD3 F14, has not populated any report yet).</p>`;
  }

  const rows = [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dimension, { resisted, total }]) => `    <tr><td>${escapeHtml(dimension)}</td><td>${resisted}/${total}</td></tr>`)
    .join("\n");

  return `<table>
  <thead><tr><th>Dimension</th><th>Resisted</th></tr></thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

/** Assertions currently sitting at `review` with no adjudication recorded against them yet, across the fleet. */
function formatAdjudicationQueue(reports: ReportV1[]): string {
  const rows: string[] = [];
  for (const r of reports) {
    for (const result of Object.values(r.decisions)) {
      if (result.status !== "review") continue;
      if (r.adjudications?.[result.id]) continue;
      rows.push(`    <tr>
      <td class="mono">${escapeHtml(r.runId)}</td>
      <td>${escapeHtml(result.id)}</td>
      <td>${escapeHtml(result.explanation ?? "—")}</td>
    </tr>`);
    }
  }

  if (rows.length === 0) return `<p class="empty">Nothing awaiting adjudication.</p>`;

  return `<table>
  <thead><tr><th>Run</th><th>Assertion</th><th>Explanation</th></tr></thead>
  <tbody>
${rows.join("\n")}
  </tbody>
</table>`;
}

function tally(totals: { pass: number; fail: number; review: number; error: number }, status: AssertionResult["status"]): void {
  if (status === "pass") totals.pass += 1;
  else if (status === "fail") totals.fail += 1;
  else if (status === "error") totals.error += 1;
  else totals.review += 1;
}

function statusLabel(status: AssertionResult["status"]): string {
  return status === "not_applicable" ? "n/a" : status;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
