import type { AssertionResult, AssertionStatus } from "@alexvegman/core";
import type { ReportV1 } from "./schema.js";

/**
 * `agentguard compare <runA> <runB>` — the missing mechanism for "did
 * agent.md v2 beat v1 on the same fixtures." Every other CLI command
 * answers "is this run good," this one answers "did this run get better."
 * Two `ReportV1`s in (PRD3 F17 A7: `compare` consumes `ReportV1` rather
 * than raw `decisions.json`), one verdict-per-assertion diff out.
 *
 * `pass`/`review`/`fail` sit on an explicit, ordered scale — `not_applicable`
 * and `error` do not (an assertion that stopped applying isn't "worse" than
 * one that passed; it measured something else). Comparing across that
 * boundary is reported as `"changed"`, not silently folded into
 * improved/regressed/unchanged, because a `pass → not_applicable` swing
 * (e.g. a fault stopped being injected) is not the same *kind* of fact as
 * `pass → fail`, and conflating them would make the CI gate wrong for a
 * reason nobody could see in the summary line.
 */
export type ComparisonVerdict = "improved" | "regressed" | "unchanged" | "changed" | "added" | "removed";

export interface AssertionComparison {
  id: string;
  before: AssertionResult | null;
  after: AssertionResult | null;
  verdict: ComparisonVerdict;
}

export interface RunComparison {
  beforeId: string;
  afterId: string;
  assertions: AssertionComparison[];
  counts: Record<ComparisonVerdict, number>;
}

/** Where each status sits on the ordered pass/review/fail scale. `null` = off the scale. */
const RANK: Record<AssertionStatus, number | null> = {
  fail: 0,
  review: 1,
  pass: 2,
  not_applicable: null,
  error: null,
};

export function compareRuns(before: ReportV1, after: ReportV1): RunComparison {
  const ids = new Set([...Object.keys(before.decisions), ...Object.keys(after.decisions)]);
  const assertions: AssertionComparison[] = [];
  const counts: Record<ComparisonVerdict, number> = { improved: 0, regressed: 0, unchanged: 0, changed: 0, added: 0, removed: 0 };

  for (const id of [...ids].sort()) {
    const b = before.decisions[id] ?? null;
    const a = after.decisions[id] ?? null;
    const verdict = classify(b, a);
    counts[verdict] += 1;
    assertions.push({ id, before: b, after: a, verdict });
  }

  return { beforeId: before.runId, afterId: after.runId, assertions, counts };
}

function classify(before: AssertionResult | null, after: AssertionResult | null): ComparisonVerdict {
  if (!before && after) return "added";
  if (before && !after) return "removed";
  if (!before || !after) return "unchanged"; // unreachable, satisfies the type checker

  if (before.status === after.status) return "unchanged";

  const rb = RANK[before.status];
  const ra = RANK[after.status];
  if (rb === null || ra === null) return "changed";
  return ra > rb ? "improved" : "regressed";
}

export function formatComparison(comparison: RunComparison): string {
  const lines: string[] = ["AgentGuard compare", "", `  before: ${comparison.beforeId}`, `  after:  ${comparison.afterId}`, ""];

  for (const a of comparison.assertions) {
    lines.push(`  ${icon(a.verdict)} ${a.id.padEnd(28)} ${detail(a)}`);
  }

  lines.push(
    "",
    `  ${comparison.counts.improved} improved, ${comparison.counts.regressed} regressed, ${comparison.counts.changed} changed, ` +
      `${comparison.counts.added} added, ${comparison.counts.removed} removed, ${comparison.counts.unchanged} unchanged`,
    "",
  );

  return lines.join("\n");
}

function icon(verdict: ComparisonVerdict): string {
  switch (verdict) {
    case "improved":
      return "▲";
    case "regressed":
      return "▼";
    case "changed":
      return "△";
    case "added":
      return "+";
    case "removed":
      return "-";
    case "unchanged":
      return "=";
  }
}

function detail(a: AssertionComparison): string {
  const beforeLabel = a.before ? a.before.status : "—";
  const afterLabel = a.after ? a.after.status : "—";
  if (a.verdict === "added") return `— → ${afterLabel}`;
  if (a.verdict === "removed") return `${beforeLabel} → —`;
  return `${beforeLabel} → ${afterLabel}`;
}
