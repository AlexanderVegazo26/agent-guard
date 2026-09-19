import path from "node:path";
import {
  DefaultEvidenceCompiler,
  FilesystemRunStore,
  appendCalibrationRecords,
  computeExitCode,
  formatConsole,
  languageAdvisory,
  loadPolicyConfig,
  toCalibrationRecord,
  type AssertionResult,
} from "@agent-guard/core";
import { AnthropicEscalationEngine, MockDecisionEngine, JevDecisionEngine, type DecisionEngine } from "@agent-guard/decision";
import { escalateReviews } from "@agent-guard/assertions";
import { loadFixtureSuite } from "../fixtures.js";
import { runFixture } from "../runner.js";

export interface TestCommandOptions {
  fixturesRoot: string;
  live: boolean;
  storeRoot?: string;
  /** PRD §10.2 — send uncertainty-band REVIEW results to a frontier LLM for a root-cause explanation. Costs a separate API call per REVIEW; needs ANTHROPIC_API_KEY. */
  escalate?: boolean;
  /** Explicit `--config <path>`, overriding the default search for `agentguard.config.{ts,js,...}` in cwd (PRD2 G0b). */
  configPath?: string;
}

/**
 * `agentguard test` — TRD §9.2: the golden suite runs against the mock
 * engine by default (fast, free, deterministic) and against the real Jev
 * engine only with `--live` (network, costs money, PRD §12's numbers).
 *
 * Every fixture run is persisted (§10.1), and every `basis: "jev"` result
 * is appended to `.agentguard/calibration.jsonl` (§6.9) — this is how the
 * repeated golden-suite runs accumulate toward the ≥100-sample floor
 * `agentguard calibrate` requires before declaring calibration validated.
 */
export async function runTestCommand(options: TestCommandOptions): Promise<number> {
  const { policy, configPath } = await loadPolicyConfig({ path: options.configPath });
  if (configPath) console.log(`agentguard: using config ${configPath}`);

  const fixtures = await loadFixtureSuite(options.fixturesRoot);
  const allResults: Record<string, AssertionResult> = {};
  const store = new FilesystemRunStore(options.storeRoot);
  const calibrationPath = path.join(options.storeRoot ?? path.join(process.cwd(), ".agentguard"), "calibration.jsonl");

  let escalationEngine: AnthropicEscalationEngine | null = null;
  if (options.escalate) {
    try {
      escalationEngine = new AnthropicEscalationEngine();
    } catch (err) {
      console.warn(`agentguard: --escalate requested but no escalation engine is available (${err instanceof Error ? err.message : String(err)}) — REVIEWs will be left unexplained.`);
    }
  }

  for (const fixture of fixtures) {
    const engine: DecisionEngine = options.live ? new JevDecisionEngine() : new MockDecisionEngine(fixture.mock);
    let results = await runFixture(fixture, engine, policy);

    const graph = await new DefaultEvidenceCompiler().compile(fixture.run);

    // Calibration measures Jev's own raw signal, so it's recorded against
    // the pre-escalation results — `toCalibrationRecord` only accepts
    // `basis: "jev"` anyway, which escalation replaces with `"escalated"`.
    const calibrationRecords = Object.entries(results)
      .map(([id, result]) => {
        const expected = fixture.expected[id];
        if (!expected) return null;
        return toCalibrationRecord(result, expected.status);
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    await appendCalibrationRecords(calibrationPath, calibrationRecords);

    if (escalationEngine) {
      results = await escalateReviews(graph, results, escalationEngine);
    }

    console.log(formatConsole(fixture.name, results));
    const advisory = languageAdvisory(graph);
    if (advisory) console.log(`\n  ${advisory}`);

    await store.saveRun(fixture.run);
    await store.saveEvidence(fixture.run.id, { task: graph.task, items: graph.items, links: graph.links });
    await store.saveDecisions(fixture.run.id, results);

    for (const [id, result] of Object.entries(results)) {
      allResults[`${fixture.name}::${id}`] = result;
    }
  }

  return computeExitCode(allResults);
}
