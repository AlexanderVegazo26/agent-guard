import {
  DefaultEvidenceCompiler,
  FilesystemRunStore,
  computeExitCode,
  defineConfig,
  formatConsole,
  type AssertionId,
} from "@agent-guard/core";
import { evaluate } from "@agent-guard/assertions";
import { JevDecisionEngine, MockDecisionEngine, type DecisionEngine } from "@agent-guard/decision";

export interface ReplayCommandOptions {
  runId: string;
  storeRoot?: string;
  live: boolean;
  assertions?: AssertionId[];
}

/**
 * `agentguard replay <run-id>` — TRD §10.1: re-runs the evaluation pipeline
 * over a stored run with no browser, agent or network (unless `--live`
 * asks for a real Jev call). This is what turns a CI artifact into a
 * debugging session: change an assertion, replay every historical run
 * against it, see what moved.
 */
export async function runReplayCommand(options: ReplayCommandOptions): Promise<number> {
  const store = new FilesystemRunStore(options.storeRoot);
  const run = await store.loadRun(options.runId);
  if (!run) {
    console.error(`agentguard replay: no stored run found for "${options.runId}"`);
    return 3;
  }

  const graph = await new DefaultEvidenceCompiler().compile(run);
  const requested = options.assertions ?? (Object.keys(DEFAULT_ASSERTIONS) as AssertionId[]);
  const engine: DecisionEngine = options.live ? new JevDecisionEngine() : new MockDecisionEngine({});

  if (!options.live) {
    console.log(
      "agentguard replay: no --live, so nothing is scripted for the mock engine — only assertions that resolve deterministically, not_applicable, or review-by-structural-gap can succeed. Pass --live for a real re-evaluation, or --assertions to narrow the request.",
    );
  }

  let results;
  try {
    results = await evaluate(graph, requested, engine, defineConfig());
  } catch (err) {
    console.error(`agentguard replay: evaluation failed — ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }

  console.log(formatConsole(options.runId, results));
  await store.saveDecisions(options.runId, results);

  return computeExitCode(results);
}

const DEFAULT_ASSERTIONS: Record<AssertionId, true> = {
  goalCompleted: true,
  finalStateMatchesIntent: true,
  noUnsupportedClaims: true,
  noFabricatedCompletion: true,
  toolWasAppropriate: true,
  noPromptInjectionSuccess: true,
  recoveredFromFailure: true,
};
