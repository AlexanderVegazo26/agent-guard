import type { AssertionStatus } from "./schema.js";
import type { RunStore } from "./store.js";

/**
 * PRD2 F6 — per-assertion history across stored runs. The primitive
 * `agentguard history` and, later, a dashboard's history view are built
 * on: "was this assertion evaluated in this run, and if so, what did it
 * say" for every stored run, in chronological order.
 */
export interface HistoryEntry {
  runId: string;
  startedAt: string;
  status: AssertionStatus;
  confidence?: number;
}

export async function collectAssertionHistory(
  store: RunStore,
  assertionId: string,
): Promise<HistoryEntry[]> {
  const runIds = await store.listRunIds();
  const entries: HistoryEntry[] = [];

  for (const runId of runIds) {
    const run = await store.loadRun(runId);
    const decisions = await store.loadDecisions(runId);
    if (!run || !decisions) continue;
    const result = decisions[assertionId];
    if (!result) continue;
    entries.push({ runId, startedAt: run.startedAt, status: result.status, confidence: result.confidence });
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
  regressed: boolean;
}

/**
 * Splits the series at `baselineRunId` (everything at or before it is the
 * baseline window, everything after is the recent window) and compares
 * pass rates between the two.
 *
 * Deliberately not a real two-sample statistical test (a proportion
 * z-test, say) — PRD2 F6 asks for one, but a threshold on the raw pass-
 * rate delta is what this ships with; a real test needs a sample-size-
 * aware confidence calculation this pass doesn't build. `REGRESSION_THRESHOLD`
 * is a stated, crude cutoff, not a statistically justified one.
 */
export const REGRESSION_THRESHOLD = 0.3;

export function compareToBaseline(entries: HistoryEntry[], baselineRunId: string): BaselineComparison | null {
  const baselineIndex = entries.findIndex((e) => e.runId === baselineRunId);
  if (baselineIndex === -1) return null;

  const baselineWindow = entries.slice(0, baselineIndex + 1);
  const recentWindow = entries.slice(baselineIndex + 1);
  const baselinePassRate = passRate(baselineWindow);
  const recentPassRate = passRate(recentWindow);
  const delta = baselinePassRate !== null && recentPassRate !== null ? recentPassRate - baselinePassRate : null;

  return {
    baselineWindow,
    recentWindow,
    baselinePassRate,
    recentPassRate,
    delta,
    regressed: delta !== null && delta <= -REGRESSION_THRESHOLD,
  };
}
