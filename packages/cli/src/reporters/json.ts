import type { AssertionResult } from "@agent-guard/core";

/** PRD §10.3 — machine-readable, full evidence citations. */
export interface JsonReport {
  runs: Record<string, Record<string, AssertionResult>>;
}

export function formatJson(runs: Record<string, Record<string, AssertionResult>>): string {
  const report: JsonReport = { runs };
  return JSON.stringify(report, null, 2);
}
