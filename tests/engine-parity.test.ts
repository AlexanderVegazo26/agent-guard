import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentRun, DefaultEvidenceCompiler, defineConfig, type AssertionId } from "@alexvegman/core";
import { evaluate } from "@alexvegman/assertions";
import {
  AnthropicDecisionEngine,
  JevDecisionEngine,
  type DecisionAnswer,
  type DecisionEngine,
} from "@alexvegman/decision";

/**
 * PRD3 F18 — the engine-parity suite. Every golden and correct-behavior
 * fixture is run through `JevDecisionEngine` and `AnthropicDecisionEngine`
 * — the two real engines the acceptance criterion names — instead of
 * `MockDecisionEngine`, so the comparison exercises each engine's actual
 * wire-format adapter (`toDecisionAnswer` in each file), not just the
 * assertion logic `golden.test.ts`/`correct-behavior.test.ts` already cover.
 *
 * Neither engine talks to a real API here (no network access or API key
 * needed to make CI green — same reasoning as `anthropicDecision.test.ts`):
 * each fixture's `mock.json` — the same engine-agnostic `DecisionAnswer`
 * script `MockDecisionEngine` reads — is translated into that engine's own
 * wire shape and served back through a stubbed `fetch`. `JevDecisionEngine`'s
 * wire format already matches `DecisionAnswer` almost verbatim (engine.ts:
 * "mirrors the verified Jev SDK shape"); `AnthropicDecisionEngine`'s is the
 * `scoreIndex`/`choice`+`confidence` shape its own `toDecisionAnswer` expects.
 *
 * Because both engines are fed the *same* scripted model answer, only an
 * adapter mis-decode can make them diverge from each other or from
 * `expected.json` — so this suite asserts exact equality, not a tolerance
 * band: both engines must reproduce every fixture's verdict exactly (the
 * `basis`/`level` PRD's `report --owasp`/calibration also key on), and the
 * two engines must agree with each other on every fixture. `level` in
 * particular is where the two engines are documented to differ in kind
 * (`anthropicDecision.ts`: Anthropic's `probabilities` are a derived
 * one-hot-ish approximation of confidence, not Jev's real posterior) — a
 * fixture-level status match alone would not catch that regressing.
 *
 * This proves the two engines *decode a given model answer identically*
 * (real parity, at the adapter boundary). It does NOT prove either model
 * would actually *produce* those answers live — that is F19's
 * `validate-live` job, spending against a real budget.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_ROOT = path.join(__dirname, "..", "fixtures", "golden");
const CORRECT_ROOT = path.join(__dirname, "..", "fixtures", "correct");
const COVERAGE_NOTE_KEY = "coverageNote";
const SCORE_LEVELS = ["ignored", "detected", "detected-and-reported", "detected-and-recovered"];

interface ExpectedAssertion {
  status: "pass" | "fail" | "review" | "not_applicable" | "error";
  basis?: string;
  level?: string;
}

interface Fixture {
  name: string;
  run: AgentRun;
  expected: Record<string, ExpectedAssertion>;
  mock: Record<string, DecisionAnswer>;
}

async function loadFixtures(root: string): Promise<Fixture[]> {
  const dirs = (await readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name))
    .sort();

  return Promise.all(
    dirs.map(async (dir) => {
      const run = AgentRun.parse(JSON.parse(await readFile(path.join(dir, "run.json"), "utf8")));
      const expected: Record<string, ExpectedAssertion> = JSON.parse(
        await readFile(path.join(dir, "expected.json"), "utf8"),
      );
      const mockPath = path.join(dir, "mock.json");
      const mock: Record<string, DecisionAnswer> = existsSync(mockPath)
        ? JSON.parse(await readFile(mockPath, "utf8"))
        : {};
      return { name: path.basename(dir), run, expected, mock };
    }),
  );
}

function scoreLevelOf(probabilities: Record<string, number> | undefined): string | undefined {
  if (!probabilities) return undefined;
  let bestIndex = "";
  let bestP = -1;
  for (const [k, p] of Object.entries(probabilities)) {
    if (p > bestP) {
      bestP = p;
      bestIndex = k;
    }
  }
  const idx = Number(bestIndex);
  return Number.isInteger(idx) ? SCORE_LEVELS[idx] : undefined;
}

/** Jev's own SDK shape already matches `DecisionAnswer` field-for-field (engine.ts). */
function jevWireAnswers(mock: Record<string, DecisionAnswer>): Record<string, unknown> {
  return mock;
}

/** `AnthropicDecisionEngine.toDecisionAnswer`'s expected `tool_use.input` shape. */
function anthropicWireAnswers(mock: Record<string, DecisionAnswer>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [id, answer] of Object.entries(mock)) {
    if (answer.type === "noul") out[id] = { noul: answer.noul };
    else if (answer.type === "score") out[id] = { scoreIndex: answer.score, confidence: answer.confidence };
    else out[id] = { choice: answer.choice, confidence: answer.confidence };
  }
  return out;
}

/** Stubs global `fetch` so `JevDecisionEngine` (a real `TypeSafeClient`) resolves without a network call. */
function stubJevFetch(mock: Record<string, DecisionAnswer>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({ model: "jev-latest", answers: jevWireAnswers(mock), usage: { input_tokens: 0, output_tokens: 0 } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ),
  );
}

/** Stubs global `fetch` so `AnthropicDecisionEngine` resolves without a network call (same pattern as anthropicDecision.test.ts). */
function stubAnthropicFetch(mock: Record<string, DecisionAnswer>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "tool_use", input: anthropicWireAnswers(mock) }], usage: { input_tokens: 0, output_tokens: 0 } }),
    }),
  );
}

function requestedIdsOf(fixture: Fixture): AssertionId[] {
  return Object.keys(fixture.expected).filter((k) => k !== COVERAGE_NOTE_KEY) as AssertionId[];
}

async function runFixtureAgainst(fixture: Fixture, engine: DecisionEngine, requested: AssertionId[]) {
  const graph = await new DefaultEvidenceCompiler().compile(fixture.run);
  return evaluate(graph, requested, engine, defineConfig());
}

async function withJev<T>(fixture: Fixture, fn: (results: Awaited<ReturnType<typeof runFixtureAgainst>>) => T): Promise<T> {
  stubJevFetch(fixture.mock);
  const results = await runFixtureAgainst(fixture, new JevDecisionEngine({ apiKey: "test-key" }), requestedIdsOf(fixture));
  return fn(results);
}

async function withAnthropic<T>(fixture: Fixture, fn: (results: Awaited<ReturnType<typeof runFixtureAgainst>>) => T): Promise<T> {
  stubAnthropicFetch(fixture.mock);
  const results = await runFixtureAgainst(fixture, new AnthropicDecisionEngine({ apiKey: "test-key" }), requestedIdsOf(fixture));
  return fn(results);
}

/** Per-fixture mismatches against `expected.json` (status + level where declared). */
function diffAgainstExpected(fixture: Fixture, results: Record<string, { status: string; probabilities?: Record<string, number> }>): string[] {
  const mismatches: string[] = [];
  for (const id of requestedIdsOf(fixture)) {
    const expected = fixture.expected[id];
    const actual = results[id];
    if (!actual) {
      mismatches.push(`${id}: no result produced`);
      continue;
    }
    if (actual.status !== expected.status) {
      mismatches.push(`${id}: status expected ${expected.status}, got ${actual.status}`);
    }
    if (expected.level) {
      const level = scoreLevelOf(actual.probabilities);
      if (level !== expected.level) {
        mismatches.push(`${id}: level expected ${expected.level}, got ${level ?? "<none>"}`);
      }
    }
  }
  return mismatches;
}

/** Per-fixture mismatches between the two engines' own results (status + level). */
function diffEngines(
  jev: Record<string, { status: string; probabilities?: Record<string, number> }>,
  anthropic: Record<string, { status: string; probabilities?: Record<string, number> }>,
  requested: AssertionId[],
): string[] {
  const mismatches: string[] = [];
  for (const id of requested) {
    const j = jev[id];
    const a = anthropic[id];
    if (j?.status !== a?.status) {
      mismatches.push(`${id}: status jev=${j?.status ?? "<none>"} anthropic=${a?.status ?? "<none>"}`);
      continue;
    }
    const jLevel = scoreLevelOf(j?.probabilities);
    const aLevel = scoreLevelOf(a?.probabilities);
    if (jLevel !== aLevel) {
      mismatches.push(`${id}: level jev=${jLevel ?? "<none>"} anthropic=${aLevel ?? "<none>"}`);
    }
  }
  return mismatches;
}

describe("engine parity (Jev vs. Anthropic, PRD3 F18)", () => {
  let goldenFixtures: Fixture[];
  let correctFixtures: Fixture[];

  beforeAll(async () => {
    goldenFixtures = await loadFixtures(GOLDEN_ROOT);
    correctFixtures = await loadFixtures(CORRECT_ROOT);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("has at least the 20 golden and 10 correct-behavior fixtures F18 is scoped against", () => {
    expect(goldenFixtures.length).toBeGreaterThanOrEqual(20);
    expect(correctFixtures.length).toBeGreaterThanOrEqual(10);
  });

  it("golden suite: JevDecisionEngine reproduces every fixture's declared verdict exactly", async () => {
    const failing: string[] = [];
    for (const fixture of goldenFixtures) {
      const mismatches = await withJev(fixture, (results) => diffAgainstExpected(fixture, results));
      if (mismatches.length > 0) failing.push(`${fixture.name}: ${mismatches.join("; ")}`);
    }
    expect(failing, `Jev golden-suite parity failures:\n${failing.join("\n")}`).toEqual([]);
  });

  it("golden suite: AnthropicDecisionEngine reproduces every fixture's declared verdict exactly", async () => {
    const failing: string[] = [];
    for (const fixture of goldenFixtures) {
      const mismatches = await withAnthropic(fixture, (results) => diffAgainstExpected(fixture, results));
      if (mismatches.length > 0) failing.push(`${fixture.name}: ${mismatches.join("; ")}`);
    }
    expect(failing, `Anthropic golden-suite parity failures:\n${failing.join("\n")}`).toEqual([]);
  });

  it("golden suite: the two real engines agree with each other on every fixture", async () => {
    const failing: string[] = [];
    for (const fixture of goldenFixtures) {
      const requested = requestedIdsOf(fixture);
      const jevResults = await withJev(fixture, (r) => r);
      const anthropicResults = await withAnthropic(fixture, (r) => r);
      const mismatches = diffEngines(jevResults, anthropicResults, requested);
      // A fixture only one engine passes is F18's "non-discriminating"
      // case — flagged here as an engine disagreement rather than allowed
      // to slip through as an unrelated status match.
      if (mismatches.length > 0) failing.push(`${fixture.name}: ${mismatches.join("; ")}`);
    }
    expect(failing, `engine disagreements (each must be a fixture fix or a documented engine limitation, PRD3 F18):\n${failing.join("\n")}`).toEqual([]);
  });

  it("correct-behavior set: neither real engine produces a false-positive FAIL", async () => {
    const violations: string[] = [];
    for (const fixture of correctFixtures) {
      const requested = Object.keys(fixture.expected) as AssertionId[];

      for (const [label, run] of [
        ["jev", () => withJev(fixture, (r) => r)],
        ["anthropic", () => withAnthropic(fixture, (r) => r)],
      ] as const) {
        const results = await run();
        for (const id of requested) {
          const expected = fixture.expected[id];
          if (expected.status === "fail") continue;
          const actual = results[id];
          if (actual?.status === "fail") {
            violations.push(`${fixture.name}/${id} (${label}): expected ${expected.status}, got fail`);
          }
        }
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
