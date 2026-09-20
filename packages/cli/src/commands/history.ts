import { FilesystemRunStore, type AssertionId } from "@agent-guard/core";
import { collectAssertionHistory, compareToBaseline } from "@agent-guard/reporters";

export interface HistoryCommandOptions {
  assertionId: AssertionId;
  baselineRunId?: string;
  storeRoot?: string;
}

/**
 * PRD2 F6 — `agentguard history --assertion <id> [--baseline <run-id>]`.
 * The primitive an AI engineer needs to answer "is today's agent worse
 * than last week's, in this specific dimension" — per-assertion, never a
 * single rolled-up score (PRD v0.6 §6's non-goal applies here too).
 */
export async function runHistoryCommand(options: HistoryCommandOptions): Promise<number> {
  const store = new FilesystemRunStore(options.storeRoot);
  const history = await collectAssertionHistory(store, options.assertionId);

  if (history.length === 0) {
    console.log(`agentguard history: no stored run has evaluated "${options.assertionId}" yet.`);
    return 0;
  }

  console.log(`${options.assertionId} — ${history.length} run(s)\n`);
  for (const entry of history) {
    const confidence = entry.confidence !== undefined ? `  conf=${entry.confidence.toFixed(2)}` : "";
    console.log(`  ${entry.startedAt}  ${entry.runId}  ${entry.status}${confidence}`);
  }

  if (!options.baselineRunId) return 0;

  const comparison = compareToBaseline(history, options.baselineRunId);
  if (!comparison) {
    console.error(`\nagentguard history: baseline run "${options.baselineRunId}" never evaluated "${options.assertionId}"`);
    return 3;
  }

  console.log("");
  const fmt = (r: number | null): string => (r === null ? "n/a" : `${(r * 100).toFixed(0)}%`);
  console.log(
    `baseline (n=${comparison.baselineWindow.length}): ${fmt(comparison.baselinePassRate)} pass rate  →  ` +
      `recent (n=${comparison.recentWindow.length}): ${fmt(comparison.recentPassRate)} pass rate`,
  );

  if (comparison.recentWindow.length === 0) {
    console.log("no runs after the baseline yet — nothing to compare.");
    return 0;
  }

  if (comparison.regressed) {
    console.log(
      `⚠ possible regression: pass rate dropped by ${Math.abs(comparison.delta! * 100).toFixed(0)} points since the baseline ` +
        "(a stated threshold, not a statistical significance test — PRD2 F6).",
    );
    return 1;
  }

  console.log("no regression detected.");
  return 0;
}
