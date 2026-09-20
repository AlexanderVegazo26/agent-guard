import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeVariance, defineConfig, loadPolicyConfig, type AssertionResult, type PolicyConfig } from "@alexvegman/core";
import { JevDecisionEngine, type DecisionEngine } from "@alexvegman/decision";
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
  /** Wall-clock time for the single `runFixture` call this repeat belongs to (PRD3 A10: "every probability, cost and latency"). */
  latencyMs: number;
}

/**
 * PRD3 A10 / F19's definition of "validated", applied per `fixture::assertionId`
 * group across the recorded repeats:
 *
 *   1. verdicts match on >=3 repeats — the modal `status` was reached at least 3 times.
 *   2. the spread is inside the floor — the confidence range across repeats does not
 *      exceed the width of the assertion's configured uncertainty band
 *      (`policy.uncertaintyBand`, or `policy.perAssertion.<id>.uncertaintyBand` where
 *      one exists). That band width is the only "floor" this codebase already defines
 *      for confidence spread (`pipeline.ts` uses the same band to decide REVIEW
 *      eligibility) — `baselineVariance.ts#exceedsVarianceFloor` compares a baseline
 *      sample set against a *second, proposed* one and doesn't apply to a single
 *      group of repeats, so it isn't the mechanism used here.
 *   3. the mock's scripted answer agrees with the live majority — the fixture's
 *      `expected.json` status (which golden fixtures author *as* the mock-derived
 *      verdict) equals the live modal status.
 *
 * A group with fewer than 3 repeats can never satisfy (1) and is reported
 * `validated: false` rather than "unknown" — F19's acceptance ("all 21
 * assertions have >=3 recorded repeats") treats under-sampling as a gap to close,
 * not a pass.
 */
export interface ValidationVerdict {
  fixture: string;
  assertionId: string;
  n: number;
  modalStatus: AssertionResult["status"] | undefined;
  modalCount: number;
  confidenceRange: number | undefined;
  floor: number | undefined;
  expectedStatus: AssertionResult["status"] | undefined;
  verdictsMatch: boolean;
  spreadInsideFloor: boolean;
  mockAgrees: boolean;
  validated: boolean;
}

function modeOf<T>(values: T[]): { value: T | undefined; count: number } {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return { value: best, count: bestCount };
}

function uncertaintyBandFor(assertionId: string, policy: PolicyConfig): [number, number] {
  const perAssertion = (policy.perAssertion as Record<string, { uncertaintyBand?: [number, number] }>)[assertionId];
  return perAssertion?.uncertaintyBand ?? policy.uncertaintyBand;
}

export function computeValidation(
  records: ValidationRecord[],
  expected: Map<string, AssertionResult["status"]>,
  policy: PolicyConfig,
): ValidationVerdict[] {
  const byKey = new Map<string, ValidationRecord[]>();
  for (const record of records) {
    const key = `${record.fixture}::${record.assertionId}`;
    const list = byKey.get(key) ?? [];
    list.push(record);
    byKey.set(key, list);
  }

  const verdicts: ValidationVerdict[] = [];
  for (const [key, list] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const [fixture, assertionId] = key.split("::") as [string, string];
    const { value: modalStatus, count: modalCount } = modeOf(list.map((r) => r.status));
    const verdictsMatch = modalCount >= 3;

    const confidences = list.map((r) => r.confidence).filter((c): c is number => c !== undefined);
    const stats = confidences.length >= 2 ? computeVariance(confidences) : null;
    const [lo, hi] = uncertaintyBandFor(assertionId, policy);
    const floor = hi - lo;
    const spreadInsideFloor = stats === null ? confidences.length <= 1 : stats.range <= floor;

    const expectedStatus = expected.get(key);
    const mockAgrees = expectedStatus !== undefined && expectedStatus === modalStatus;

    verdicts.push({
      fixture,
      assertionId,
      n: list.length,
      modalStatus,
      modalCount,
      confidenceRange: stats?.range,
      floor,
      expectedStatus,
      verdictsMatch,
      spreadInsideFloor,
      mockAgrees,
      validated: verdictsMatch && spreadInsideFloor && mockAgrees,
    });
  }
  return verdicts;
}

/**
 * [PRD3:F19] — every deferred Noul assertion in F2/F3/F8/F9, and the
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

  const expected = new Map<string, AssertionResult["status"]>();
  for (const fixture of fixtures) {
    for (const [assertionId, exp] of Object.entries(fixture.expected)) {
      if (assertionId === "coverageNote") continue;
      expected.set(`${fixture.name}::${assertionId}`, (exp as { status: AssertionResult["status"] }).status);
    }
  }
  const verdicts = computeValidation(records, expected, policy);
  printSpread(verdicts);

  const byFixture = new Map<string, ValidationVerdict[]>();
  for (const v of verdicts) {
    const list = byFixture.get(v.fixture) ?? [];
    list.push(v);
    byFixture.set(v.fixture, list);
  }
  for (const fixture of fixtures) {
    const fixtureVerdicts = byFixture.get(fixture.name);
    if (fixtureVerdicts) await writeValidationToReadme(fixture.dir, fixtureVerdicts);
  }

  return 0;
}

async function runOneRepeat(
  fixture: GoldenFixture,
  engine: DecisionEngine,
  policy: ReturnType<typeof defineConfig>,
  repeatIndex: number,
): Promise<{ results: ValidationRecord[]; costUsd: number }> {
  const timestamp = new Date().toISOString();
  const startedAt = Date.now();
  const decisions = await runFixture(fixture, engine, policy);
  const latencyMs = Date.now() - startedAt;

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
      latencyMs,
    });
  }
  return { results, costUsd };
}

const README_BLOCK_START = "<!-- agentguard:validate-live:start -->";
const README_BLOCK_END = "<!-- agentguard:validate-live:end -->";

/**
 * PRD3 F19: "writes a `validated: true|false` line per assertion into the
 * fixture's `README.md` coverage block." No such block existed anywhere in
 * any golden fixture's README before this — there is no prior convention
 * to match, so this introduces one delimited block per fixture, replaced
 * wholesale on every run (idempotent: rerunning does not accumulate lines).
 */
function renderReadmeBlock(verdicts: ValidationVerdict[]): string {
  const lines = [README_BLOCK_START, "", "## Live validation (agentguard validate-live)", ""];
  for (const v of verdicts) {
    const rangeStr = v.confidenceRange === undefined ? "n/a" : v.confidenceRange.toFixed(3);
    const assertionLabel = "`" + v.assertionId + "`";
    lines.push(
      `- ${assertionLabel}: validated: ${v.validated} (n=${v.n}, modal=${v.modalStatus ?? "n/a"} x${v.modalCount}, range=${rangeStr}, floor=${v.floor?.toFixed(3) ?? "n/a"})`,
    );
  }
  lines.push("", README_BLOCK_END);
  return lines.join("\n");
}

async function writeValidationToReadme(fixtureDir: string, verdicts: ValidationVerdict[]): Promise<void> {
  if (verdicts.length === 0) return;
  const readmePath = path.join(fixtureDir, "README.md");
  let existing = "";
  try {
    existing = await readFile(readmePath, "utf8");
  } catch {
    existing = `# ${path.basename(fixtureDir)}\n`;
  }

  const block = renderReadmeBlock(verdicts);
  const startIdx = existing.indexOf(README_BLOCK_START);
  const endIdx = existing.indexOf(README_BLOCK_END);
  let next: string;
  if (startIdx !== -1 && endIdx !== -1) {
    next = existing.slice(0, startIdx) + block + existing.slice(endIdx + README_BLOCK_END.length);
  } else {
    next = existing.replace(/\s*$/, "") + "\n\n" + block + "\n";
  }
  await writeFile(readmePath, next, "utf8");
}

function printSpread(verdicts: ValidationVerdict[]): void {
  for (const v of verdicts) {
    const key = `${v.fixture}::${v.assertionId}`;
    if (v.confidenceRange === undefined) {
      console.log(
        `  ${key}: ${v.n} repeat(s), no confidence to measure spread against (deterministic or single sample) — validated=${v.validated}`,
      );
      continue;
    }
    const withinFloor = v.spreadInsideFloor ? "within floor" : "EXCEEDS floor";
    console.log(
      `  ${key}: n=${v.n} confidence range=${v.confidenceRange.toFixed(3)} vs floor=${v.floor?.toFixed(3)} (${withinFloor}) — validated=${v.validated}`,
    );
  }
}
