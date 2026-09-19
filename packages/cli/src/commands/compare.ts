import { FilesystemRunStore, compareRuns, formatComparison } from "@agent-guard/core";

export interface CompareCommandOptions {
  beforeId: string;
  afterId: string;
  storeRoot?: string;
}

/**
 * `agentguard compare <before-run-id> <after-run-id>` — the lab mechanism:
 * every other command answers "is this run good," this one answers "did
 * this run get better." Reads both runs' persisted `decisions.json`
 * (`agentguard test`/`replay` already write these); does not re-evaluate
 * anything itself.
 *
 * Exit code mirrors `computeExitCode`'s CI-routing role: `1` if anything
 * regressed (so a CI gate can block a change that made agent.md worse),
 * `0` otherwise. Unlike `computeExitCode`, `"changed"` (a swing across the
 * not_applicable/error boundary) does not fail the gate on its own — it is
 * surfaced for a human to read, not something the ordered pass/review/fail
 * scale can call worse.
 */
export async function runCompareCommand(options: CompareCommandOptions): Promise<number> {
  const store = new FilesystemRunStore(options.storeRoot);

  const before = await store.loadDecisions(options.beforeId);
  if (!before) {
    console.error(`agentguard compare: no stored decisions found for "${options.beforeId}"`);
    return 3;
  }
  const after = await store.loadDecisions(options.afterId);
  if (!after) {
    console.error(`agentguard compare: no stored decisions found for "${options.afterId}"`);
    return 3;
  }

  const comparison = compareRuns(options.beforeId, options.afterId, before, after);
  console.log(formatComparison(comparison));

  return comparison.counts.regressed > 0 ? 1 : 0;
}
