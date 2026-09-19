import path from "node:path";
import {
  DefaultEvidenceCompiler,
  FilesystemRunStore,
  appendCalibrationRecords,
  computeExitCode,
  formatConsole,
  toCalibrationRecord,
  type AssertionResult,
} from "@agent-guard/core";
import { MockDecisionEngine, JevDecisionEngine, type DecisionEngine } from "@agent-guard/decision";
import { loadFixtureSuite } from "../fixtures.js";
import { runFixture } from "../runner.js";

export interface TestCommandOptions {
  fixturesRoot: string;
  live: boolean;
  storeRoot?: string;
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
  const fixtures = await loadFixtureSuite(options.fixturesRoot);
  const allResults: Record<string, AssertionResult> = {};
  const store = new FilesystemRunStore(options.storeRoot);
  const calibrationPath = path.join(options.storeRoot ?? path.join(process.cwd(), ".agentguard"), "calibration.jsonl");

  for (const fixture of fixtures) {
    const engine: DecisionEngine = options.live ? new JevDecisionEngine() : new MockDecisionEngine(fixture.mock);
    const results = await runFixture(fixture, engine);
    console.log(formatConsole(fixture.name, results));

    const graph = await new DefaultEvidenceCompiler().compile(fixture.run);
    await store.saveRun(fixture.run);
    await store.saveEvidence(fixture.run.id, { task: graph.task, items: graph.items, links: graph.links });
    await store.saveDecisions(fixture.run.id, results);

    const calibrationRecords = Object.entries(results)
      .map(([id, result]) => {
        const expected = fixture.expected[id];
        if (!expected) return null;
        return toCalibrationRecord(result, expected.status);
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    await appendCalibrationRecords(calibrationPath, calibrationRecords);

    for (const [id, result] of Object.entries(results)) {
      allResults[`${fixture.name}::${id}`] = result;
    }
  }

  return computeExitCode(allResults);
}
