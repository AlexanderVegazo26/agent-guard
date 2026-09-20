import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionAnswer, DecisionEngine, DecisionResult, DecisionState, QuestionSet } from "@alexvegman/decision";
import { defineConfig } from "@alexvegman/core";
import { computeValidation, runValidateLiveCommand, type ValidationRecord } from "./validateLive.js";

const REAL_FIXTURES_ROOT = path.join(process.cwd(), "fixtures", "golden");

/** Reports increasing usage on every call and a scripted noul per call, so budget-exhaustion and variance are both observable without a real API key. */
class ScriptedEngine implements DecisionEngine {
  calls = 0;
  constructor(
    private readonly nouls: number[],
    private readonly usagePerCall: { inputTokens: number; outputTokens: number },
  ) {}

  capabilities() {
    return { tokenBudget: 32_000, supportsBatch: true, primitives: ["noul", "score", "choice"] as const };
  }

  async decide(_state: DecisionState, questions: QuestionSet): Promise<DecisionResult> {
    const noul = this.nouls[this.calls % this.nouls.length]!;
    this.calls += 1;
    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, question] of Object.entries(questions)) {
      if (question.type === "noul") {
        answers[id] = { type: "noul", noul };
      } else if (question.type === "choice") {
        answers[id] = { type: "choice", choice: Object.keys(question.criteria)[0]!, confidence: noul, probabilities: {} };
      } else {
        answers[id] = { type: "score", score: 0, confidence: noul, legend: {}, probabilities: {} };
      }
    }
    return { answers, usage: this.usagePerCall };
  }
}

describe("agentguard validate-live", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-validate-live-test-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it("refuses to run with no --budget", async () => {
    const exitCode = await runValidateLiveCommand({ fixturesRoot: REAL_FIXTURES_ROOT, repeat: 3, budget: NaN, storeRoot: root });
    expect(exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toMatch(/--budget <usd> is required/);
  });

  it("refuses to run with no --repeat", async () => {
    const exitCode = await runValidateLiveCommand({ fixturesRoot: REAL_FIXTURES_ROOT, repeat: NaN, budget: 5, storeRoot: root });
    expect(exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toMatch(/--repeat <n> is required/);
  });

  /**
   * These tests exercise the fixture-loading and README-writing paths, which
   * touch disk — copied into `root` rather than pointed at the real
   * `fixtures/golden` tree so a test run never mutates the repository's own
   * fixture READMEs (the real command does write those; the test fixture is
   * a disposable copy of exactly one).
   */
  async function copyFixtureSubset(names: string[]): Promise<string> {
    const fixturesRoot = path.join(root, "fixtures-subset");
    for (const name of names) {
      await cp(path.join(REAL_FIXTURES_ROOT, name), path.join(fixturesRoot, name), { recursive: true });
    }
    return fixturesRoot;
  }

  it("records real repeated calls to .agentguard/validation/<date>.jsonl and reports spread", async () => {
    const fixturesRoot = await copyFixtureSubset(["01-happy-path"]);
    const engine = new ScriptedEngine([0.2, 0.9, 0.5], { inputTokens: 10, outputTokens: 2 });
    const exitCode = await runValidateLiveCommand({
      fixturesRoot,
      repeat: 3,
      budget: 100,
      storeRoot: root,
      engineFactory: () => engine,
    });

    expect(exitCode).toBe(0);
    expect(engine.calls).toBeGreaterThan(0);

    const validationDir = path.join(root, "validation");
    const files = await import("node:fs/promises").then((fs) => fs.readdir(validationDir));
    expect(files.length).toBe(1);
    const lines = (await readFile(path.join(validationDir, files[0]!), "utf8")).trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toHaveProperty("assertionId");
    expect(parsed).toHaveProperty("inputTokens", 10);
    expect(parsed).toHaveProperty("latencyMs");
    expect(typeof parsed.latencyMs).toBe("number");

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toMatch(/confidence range=/);
  });

  it("stops issuing new calls once the running cost would exceed the budget", async () => {
    const fixturesRoot = await copyFixtureSubset(["01-happy-path"]);
    const engine = new ScriptedEngine([0.5], { inputTokens: 1_000_000, outputTokens: 0 }); // $3/repeat at the documented rate
    const exitCode = await runValidateLiveCommand({
      fixturesRoot,
      repeat: 50,
      budget: 5, // enough for ~1-2 repeats, not 50
      storeRoot: root,
      engineFactory: () => engine,
    });

    expect(exitCode).toBe(0);
    expect(engine.calls).toBeLessThan(50);
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/stopped early/);
  });

  describe("PRD3 F19 'validated' predicate and README coverage block", () => {
    it("writes validated: true into the fixture's README when >=3 repeats agree, agree with the expected status, and confidence spread stays inside the uncertainty-band floor", async () => {
      const fixturesRoot = await copyFixtureSubset(["01-happy-path"]);
      // 01-happy-path's expected.json says every assertion is "pass". A tight,
      // consistently-high noul keeps every repeat's status at "pass" and its
      // confidence spread well inside the default [0.35, 0.75] band's 0.40 width.
      const engine = new ScriptedEngine([0.9, 0.91, 0.92], { inputTokens: 10, outputTokens: 2 });
      const exitCode = await runValidateLiveCommand({
        fixturesRoot,
        repeat: 3,
        budget: 100,
        storeRoot: root,
        engineFactory: () => engine,
      });
      expect(exitCode).toBe(0);

      const readme = await readFile(path.join(fixturesRoot, "01-happy-path", "README.md"), "utf8");
      expect(readme).toMatch(/<!-- agentguard:validate-live:start -->/);
      expect(readme).toMatch(/`goalCompleted`: validated: true/);
    });

    it("writes validated: false when the live majority disagrees with the fixture's expected (mock-derived) status", async () => {
      const fixturesRoot = await copyFixtureSubset(["01-happy-path"]);
      // `noUnsupportedClaims` is negative-polarity (verdict.ts: a high
      // probability means the violation — an unsupported claim — DID
      // happen, so it FAILs). 01-happy-path expects "pass". A consistently
      // high noul across all repeats makes every claim look unsupported,
      // so the live majority for `noUnsupportedClaims` disagrees with the
      // fixture's recorded (mock-derived) expectation.
      const engine = new ScriptedEngine([0.99, 0.98, 0.97], { inputTokens: 10, outputTokens: 2 });
      const exitCode = await runValidateLiveCommand({
        fixturesRoot,
        repeat: 3,
        budget: 100,
        storeRoot: root,
        engineFactory: () => engine,
      });
      expect(exitCode).toBe(0);

      const readme = await readFile(path.join(fixturesRoot, "01-happy-path", "README.md"), "utf8");
      expect(readme).toMatch(/validated: false/);
    });

    it("re-running replaces the coverage block in place rather than appending a duplicate", async () => {
      const fixturesRoot = await copyFixtureSubset(["01-happy-path"]);
      const engine = new ScriptedEngine([0.9, 0.91, 0.92], { inputTokens: 10, outputTokens: 2 });
      for (let i = 0; i < 2; i++) {
        await runValidateLiveCommand({
          fixturesRoot,
          repeat: 3,
          budget: 100,
          storeRoot: root,
          engineFactory: () => engine,
        });
      }
      const readme = await readFile(path.join(fixturesRoot, "01-happy-path", "README.md"), "utf8");
      const starts = readme.split("<!-- agentguard:validate-live:start -->").length - 1;
      expect(starts).toBe(1);
    });
  });

  describe("computeValidation", () => {
    const policy = defineConfig();
    const baseRecord = (overrides: Partial<ValidationRecord>): ValidationRecord => ({
      timestamp: "2026-01-01T00:00:00.000Z",
      fixture: "f1",
      assertionId: "goalCompleted",
      repeatIndex: 0,
      status: "pass",
      confidence: 0.9,
      inputTokens: 1,
      outputTokens: 1,
      estimatedCostUsd: 0,
      latencyMs: 1,
      ...overrides,
    });

    it("validates when >=3 repeats agree, spread is inside the band's floor, and the expected status matches the majority", () => {
      const records = [0.9, 0.91, 0.89].map((confidence, i) => baseRecord({ repeatIndex: i, confidence }));
      const [verdict] = computeValidation(records, new Map([["f1::goalCompleted", "pass"]]), policy);
      expect(verdict!.validated).toBe(true);
      expect(verdict!.verdictsMatch).toBe(true);
      expect(verdict!.spreadInsideFloor).toBe(true);
      expect(verdict!.mockAgrees).toBe(true);
    });

    it("does not validate when fewer than 3 repeats share the same status", () => {
      const records = [
        baseRecord({ repeatIndex: 0, status: "pass" }),
        baseRecord({ repeatIndex: 1, status: "review" }),
        baseRecord({ repeatIndex: 2, status: "pass" }),
      ];
      const [verdict] = computeValidation(records, new Map([["f1::goalCompleted", "pass"]]), policy);
      expect(verdict!.verdictsMatch).toBe(false);
      expect(verdict!.validated).toBe(false);
    });

    it("does not validate when the confidence spread exceeds the uncertainty-band floor", () => {
      // Default band is [0.35, 0.75], floor width 0.40. A 0.05..0.99 spread exceeds it.
      const records = [0.05, 0.5, 0.99].map((confidence, i) => baseRecord({ repeatIndex: i, confidence, status: "pass" }));
      const [verdict] = computeValidation(records, new Map([["f1::goalCompleted", "pass"]]), policy);
      expect(verdict!.spreadInsideFloor).toBe(false);
      expect(verdict!.validated).toBe(false);
    });

    it("does not validate when the mock's scripted (expected) status disagrees with the live majority", () => {
      const records = [0.9, 0.91, 0.89].map((confidence, i) => baseRecord({ repeatIndex: i, confidence, status: "pass" }));
      const [verdict] = computeValidation(records, new Map([["f1::goalCompleted", "fail"]]), policy);
      expect(verdict!.mockAgrees).toBe(false);
      expect(verdict!.validated).toBe(false);
    });
  });
});
