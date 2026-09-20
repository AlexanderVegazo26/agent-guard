import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { computeVariance, defineConfig, loadPolicyConfig, type AssertionResult } from "@agent-guard/core";
import { JevDecisionEngine, type DecisionEngine } from "@agent-guard/decision";
import { loadFixtureSuite, type GoldenFixture } from "../fixtures.js";
import { runFixture } from "../runner.js";

export interface ValidateLiveCommandOptions {
  fixturesRoot: string;
  repeat: number;
  /** USD, required (PRD3 F19: "refuses to start without an explicit budget"). */
  budget: number;
  storeRoot?: string;
  configPath?: string;
  /** Injectable for tests — defaults to a fresh `JevDecisionEngine()` per call, matching `agentguard test --live`. */
  engineFactory?: () => DecisionEngine;
}

export interface ValidationRecord {
  timestamp: string;
  fixture: string;
  assertionId: string;
  repeatIndex: number;
  status: AssertionResult["status"];
  confidence?: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

/**
 * PRD3 F19 — every deferred Noul assertion in F2/F3/F8/F9, and the
 * calibration curve, are blocked on a defined answer to "what does it cost,
 * and how much does the real engine's answer move, to run this fixture
 * more than once against real Jev." This is that measurement, not a
 * simulation of it: real `decide()` calls, real `usage`, real spread
 * (`computeVariance` — the same function `agentguard compare`'s baseline-
 * variance floor already uses, PRD2 F10).
 *
 * Deliberately refuses to run with no `--budget` (§6.5's "under-estimating
 * is the dangerous direction" applies here too — an unbounded live-Jev loop
 * is the same failure in a different shape) and stops issuing new calls,
 * mid-suite, the moment the running cost estimate would exceed it.
 *
 * Pricing is a rough, documented approximation (Jev's SDK reports token
 * counts, not USD) — good enough to bound spend, not a billing reconciliation.
 */
const ESTIMATED_USD_PER_MILLION_INPUT_TOKENS = 3;
const ESTIMATED_USD_PER_MILLION_OUTPUT_TOKENS = 15;

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * ESTIMATED_USD_PER_MILLION_INPUT_TOKENS + (outputTokens / 1_000_000) * ESTIMATED_USD_PER_MILLION_OUTPUT_TOKENS;
}

export async function runValidateLiveCommand(options: ValidateLiveCommandOptions): Promise<number> {
  if (!options.budget || options.budget <= 0) {
    console.error("agentguard validate-live: --budget <usd> is required and must be positive — this command spends real money against a real decision engine.");
    return 1;
  }
  if (!options.repeat || options.repeat < 1) {
    console.error("agentguard validate-live: --repeat <n> is required and must be at least 1.");
    return 1;
  }

  const { policy } = await loadPolicyConfig({ path: options.configPath });
  const fixtures = await loadFixtureSuite(options.fixturesRoot);
  const engineFactory = options.engineFactory ?? (() => new JevDecisionEngine());

  const validationDir = path.join(options.storeRoot ?? path.join(process.cwd(), ".agentguard"), "validation");
  await mkdir(validationDir, { recursive: true });
  const outPath = path.join(validationDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);

  const records: ValidationRecord[] = [];
  let spentUsd = 0;
  let budgetExhausted = false;

  console.log(`agentguard validate-live: ${fixtures.length} fixture(s) × ${options.repeat} repeat(s), budget $${options.budget.toFixed(2)}`);

  outer: for (const fixture of fixtures) {
    for (let repeatIndex = 0; repeatIndex < options.repeat; repeatIndex++) {
      if (spentUsd >= options.budget) {
        budgetExhausted = true;
        break outer;
      }

      const { results, costUsd } = await runOneRepeat(fixture, engineFactory(), policy, repeatIndex);
      spentUsd += costUsd;

      for (const record of results) records.push(record);
      await appendFile(outPath, results.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    }
  }

  if (budgetExhausted) {
    console.log(`agentguard validate-live: stopped early — running cost ($${spentUsd.toFixed(4)}) would exceed the $${options.budget.toFixed(2)} budget.`);
  }
  console.log(`agentguard validate-live: recorded ${records.length} repeat(s) to ${outPath} — estimated spend $${spentUsd.toFixed(4)}\n`);

  printSpread(records);
  return 0;
}

async function runOneRepeat(
  fixture: GoldenFixture,
  engine: DecisionEngine,
  policy: ReturnType<typeof defineConfig>,
  repeatIndex: number,
): Promise<{ results: ValidationRecord[]; costUsd: number }> {
  const timestamp = new Date().toISOString();
  const decisions = await runFixture(fixture, engine, policy);

  const results: ValidationRecord[] = [];
  let costUsd = 0;
  for (const [assertionId, result] of Object.entries(decisions)) {
    const inputTokens = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;
    costUsd += estimateCostUsd(inputTokens, outputTokens);
    results.push({
      timestamp,
      fixture: fixture.name,
      assertionId,
      repeatIndex,
      status: result.status,
      confidence: result.confidence,
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCostUsd(inputTokens, outputTokens),
    });
  }
  return { results, costUsd };
}

function printSpread(records: ValidationRecord[]): void {
  const byKey = new Map<string, ValidationRecord[]>();
  for (const record of records) {
    const key = `${record.fixture}::${record.assertionId}`;
    const list = byKey.get(key) ?? [];
    list.push(record);
    byKey.set(key, list);
  }

  for (const [key, list] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const confidences = list.map((r) => r.confidence).filter((c): c is number => c !== undefined);
    if (confidences.length < 2) {
      console.log(`  ${key}: ${list.length} repeat(s), no confidence to measure spread against (deterministic or single sample)`);
      continue;
    }
    const stats = computeVariance(confidences)!;
    console.log(`  ${key}: n=${stats.n} confidence range=${stats.range.toFixed(3)} (min=${stats.min.toFixed(3)} max=${stats.max.toFixed(3)} mean=${stats.mean.toFixed(3)})`);
  }
}
