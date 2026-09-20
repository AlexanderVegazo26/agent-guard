import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionAnswer, DecisionEngine, DecisionResult, DecisionState, QuestionSet } from "@agent-guard/decision";
import { runValidateLiveCommand } from "./validateLive.js";

const FIXTURES_ROOT = path.join(process.cwd(), "fixtures", "golden");

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
    const exitCode = await runValidateLiveCommand({ fixturesRoot: FIXTURES_ROOT, repeat: 3, budget: NaN, storeRoot: root });
    expect(exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toMatch(/--budget <usd> is required/);
  });

  it("refuses to run with no --repeat", async () => {
    const exitCode = await runValidateLiveCommand({ fixturesRoot: FIXTURES_ROOT, repeat: NaN, budget: 5, storeRoot: root });
    expect(exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toMatch(/--repeat <n> is required/);
  });

  it("records real repeated calls to .agentguard/validation/<date>.jsonl and reports spread", async () => {
    const engine = new ScriptedEngine([0.2, 0.9, 0.5], { inputTokens: 10, outputTokens: 2 });
    const exitCode = await runValidateLiveCommand({
      fixturesRoot: FIXTURES_ROOT,
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

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toMatch(/confidence range=/);
  });

  it("stops issuing new calls once the running cost would exceed the budget", async () => {
    const engine = new ScriptedEngine([0.5], { inputTokens: 1_000_000, outputTokens: 0 }); // $3/repeat at the documented rate
    const exitCode = await runValidateLiveCommand({
      fixturesRoot: FIXTURES_ROOT,
      repeat: 50,
      budget: 5, // enough for ~1-2 repeats, not 50
      storeRoot: root,
      engineFactory: () => engine,
    });

    expect(exitCode).toBe(0);
    expect(engine.calls).toBeLessThan(50);
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/stopped early/);
  });
});
