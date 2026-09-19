import type { Adjudication, AssertionResult } from "@agent-guard/core";

/**
 * PRD §10.3 — machine-readable, full evidence citations.
 *
 * PRD2 F1: `adjudications` rides alongside `decisions` per run, never
 * merged into it — the machine verdict and a human's verdict on it are
 * two different things, and the JSON reporter is where "an adjudication
 * round-trips through the CLI and JSON reporter" (F1's acceptance
 * criterion) is satisfied. `adjudications` is omitted entirely for a run
 * nothing has been adjudicated on yet, rather than an empty object,
 * keeping an un-adjudicated run's JSON the same shape it always was.
 */
export interface JsonReportRun {
  decisions: Record<string, AssertionResult>;
  adjudications?: Record<string, Adjudication>;
}

export interface JsonReport {
  runs: Record<string, JsonReportRun>;
}

export function formatJson(runs: Record<string, JsonReportRun>): string {
  const report: JsonReport = { runs };
  return JSON.stringify(report, null, 2);
}
