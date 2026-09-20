import type { AssertionStatus, RunStore } from "@alexvegman/core";
import { buildReportV1FromRun } from "./schema.js";

/**
 * PRD2 F6 — per-assertion history across stored runs. The primitive
 * `agentguard history` and, later, a dashboard's history view are built
 * on: "was this assertion evaluated in this run, and if so, what did it
 * say" for every stored run, in chronological order.
 *
 * PRD3 F17 A7: builds a `ReportV1` per run (via `buildReportV1FromRun`)
 * and reads the assertion off it, rather than indexing `decisions.json`
 * directly — the same contract `compare` and the dashboard consume.
 */
export interface HistoryEntry {
  runId: string;
  startedAt: string;
  status: AssertionStatus;
  confidence?: number;
  agent?: string;
}

export interface CollectAssertionHistoryOptions {
  /** PRD3 F21 (PRD2 F6 remainder) — restrict to runs whose `agent.name` matches exactly. */
  agentName?: string;
}

export async function collectAssertionHistory(
  store: RunStore,
  assertionId: string,
  options: CollectAssertionHistoryOptions = {},
): Promise<HistoryEntry[]> {
  const runIds = await store.listRunIds();
  const entries: HistoryEntry[] = [];

  for (const runId of runIds) {
    const run = await store.loadRun(runId);
    const decisions = await store.loadDecisions(runId);
    if (!run || !decisions) continue;
    const report = buildReportV1FromRun(run, decisions);
    if (options.agentName !== undefined && report.agent?.name !== options.agentName) continue;
    const result = report.decisions[assertionId];
    if (!result) continue;
    entries.push({
      runId: report.runId,
      startedAt: report.startedAt ?? run.startedAt,
      status: result.status,
      confidence: result.confidence,
      agent: report.agent?.name,
    });
  }

  entries.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return entries;
}

export function passRate(entries: HistoryEntry[]): number | null {
  if (entries.length === 0) return null;
  return entries.filter((e) => e.status === "pass").length / entries.length;
}

export interface BaselineComparison {
  baselineWindow: HistoryEntry[];
  recentWindow: HistoryEntry[];
  baselinePassRate: number | null;
  recentPassRate: number | null;
  /** `recentPassRate - baselinePassRate`, or `null` when either window is empty. */
  delta: number | null;
  /** Crude cutoff on the raw delta (`REGRESSION_THRESHOLD`) — kept for backward compatibility with existing callers/tests. Prefer `significant` for a sample-size-aware answer. */
  regressed: boolean;
  /** Two-proportion z-test statistic (pooled variance), or `null` when either window has zero runs. */
  zScore: number | null;
  /** Two-tailed p-value for `zScore` under the standard-normal approximation. */
  pValue: number | null;
  /** `pValue < 0.05` — PRD3 F21's real two-sample test, sample-size aware unlike `regressed`. `null` when `zScore` is `null`. */
  significant: boolean | null;
}

/**
 * Splits the series at `baselineRunId` (everything at or before it is the
 * baseline window, everything after is the recent window) and compares
 * pass rates between the two.
 *
 * `regressed` is the original PRD2 F6 heuristic — a stated, crude cutoff
 * on the raw pass-rate delta, not a statistically justified one — kept so
 * existing callers (`agentguard history --baseline`'s exit code) don't
 * change behavior underneath them. PRD3 F21 adds the real two-sample test
 * PRD2 F6 asked for alongside it: a two-proportion z-test (pooled
 * variance, standard-normal approximation) exposed as `zScore`/`pValue`/
 * `significant`, which accounts for sample size in a way a raw delta
 * cutoff cannot — five failing runs out of five is significant, five
 * failing runs out of five hundred is not, and `regressed` treats them
 * identically.
 */
export const REGRESSION_THRESHOLD = 0.3;

/** Standard normal CDF via the Abramowitz & Stegun 7.1.26 erf approximation (max error ~1.5e-7). */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/**
 * Two-proportion z-test (pooled variance), two-tailed. `null` when either
 * sample is empty (undefined pass rate) or the pooled variance is zero
 * (both proportions identical, or one sample is a single degenerate
 * point) — there is nothing to test in either case.
 */
export function twoProportionZTest(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): { zScore: number; pValue: number } | null {
  if (n1 === 0 || n2 === 0) return null;
  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const pooled = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  const zScore = (p2 - p1) / se;
  const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
  return { zScore, pValue };
}

export function compareToBaseline(entries: HistoryEntry[], baselineRunId: string): BaselineComparison | null {
  const baselineIndex = entries.findIndex((e) => e.runId === baselineRunId);
  if (baselineIndex === -1) return null;

  const baselineWindow = entries.slice(0, baselineIndex + 1);
  const recentWindow = entries.slice(baselineIndex + 1);
  const baselinePassRate = passRate(baselineWindow);
  const recentPassRate = passRate(recentWindow);
  const delta = baselinePassRate !== null && recentPassRate !== null ? recentPassRate - baselinePassRate : null;

  const x1 = baselineWindow.filter((e) => e.status === "pass").length;
  const x2 = recentWindow.filter((e) => e.status === "pass").length;
  const test = twoProportionZTest(x1, baselineWindow.length, x2, recentWindow.length);

  return {
    baselineWindow,
    recentWindow,
    baselinePassRate,
    recentPassRate,
    delta,
    regressed: delta !== null && delta <= -REGRESSION_THRESHOLD,
    zScore: test?.zScore ?? null,
    pValue: test?.pValue ?? null,
    significant: test ? test.pValue < 0.05 : null,
  };
}
