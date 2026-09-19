import {
  DefaultEvidenceCompiler,
  FilesystemRunStore,
  computeExitCode,
  formatConsole,
  languageAdvisory,
  loadPolicyConfig,
  runSourceAdvisory,
  type AssertionId,
} from "@agent-guard/core";
import { escalateReviews, evaluate } from "@agent-guard/assertions";
import { AnthropicEscalationEngine, JevDecisionEngine, MockDecisionEngine, type DecisionEngine } from "@agent-guard/decision";

export interface ReplayCommandOptions {
  runId: string;
  storeRoot?: string;
  live: boolean;
  assertions?: AssertionId[];
  escalate?: boolean;
  /** Explicit `--config <path>`, overriding the default search for `agentguard.config.{ts,js,...}` in cwd (PRD2 G0b). */
  configPath?: string;
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

  const { policy, configPath } = await loadPolicyConfig({ path: options.configPath });
  if (configPath) console.log(`agentguard: using config ${configPath}`);

  let results;
  try {
    results = await evaluate(graph, requested, engine, policy);
  } catch (err) {
    console.error(`agentguard replay: evaluation failed — ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }

  if (options.escalate) {
    try {
      results = await escalateReviews(graph, results, new AnthropicEscalationEngine());
    } catch (err) {
      console.warn(`agentguard replay: --escalate requested but no escalation engine is available (${err instanceof Error ? err.message : String(err)}) — REVIEWs left unexplained.`);
    }
  }

  console.log(formatConsole(options.runId, results));
  const advisory = languageAdvisory(graph);
  if (advisory) console.log(`\n  ${advisory}`);
  const sourceAdvisory = runSourceAdvisory(run);
  if (sourceAdvisory) console.log(`\n  ${sourceAdvisory}`);
  await store.saveDecisions(options.runId, results);

  return computeExitCode(results);
}

const DEFAULT_ASSERTIONS: Record<AssertionId, true> = {
  goalCompleted: true,
  finalStateMatchesIntent: true,
  prematureCompletion: true,
  requiredStepsCompleted: true,
  noUnsupportedClaims: true,
  claimsConsistentWithEvidence: true,
  noFabricatedToolUsage: true,
  noFabricatedCompletion: true,
  toolWasAppropriate: true,
  toolArgumentsCorrect: true,
  toolResultUsedCorrectly: true,
  noUnauthorizedToolUse: true,
  noPromptInjectionSuccess: true,
  noSensitiveDataLeak: true,
  noPolicyViolation: true,
  noUnauthorizedSideEffect: true,
  recoveredFromFailure: true,
  handledAmbiguityCorrectly: true,
  avoidedUnnecessaryActions: true,
  stoppedWhenDone: true,
  evidenceSufficient: true,
};
