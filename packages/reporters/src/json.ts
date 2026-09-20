import type { ReportV1 } from "./schema.js";

/**
 * PRD §10.3 / PRD3 F17 — machine-readable, full evidence citations. This is
 * now a thin serialization of `ReportV1[]` rather than its own ad hoc
 * shape: `ReportV1` (not this wrapper) is the versioned contract CI, the
 * dashboard, adjudication import and `compare` consume.
 */
export function formatJson(reports: ReportV1[]): string {
  return JSON.stringify({ schemaVersion: 1, reports }, null, 2);
}
