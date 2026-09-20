import { describe, expect, it } from "vitest";
import { AgentRun, DefaultEvidenceCompiler, defineConfig } from "@agent-guard/core";
import { estimateQuestionsTokens, estimateStateTokens, MockDecisionEngine } from "@agent-guard/decision";
import { evaluate } from "./pipeline.js";

/**
 * §6.5/§6.7 — the token-budget check and degradation ladder. These tests
 * force degradation by shrinking `MockDecisionEngine`'s reported budget
 * rather than by constructing enormous payloads — the thresholds are
 * derived from measuring the engine's own real calls (via `engine.calls`),
 * not guessed constants, so they stay correct if the question/state
 * wording in `definitions.ts` changes size.
 */

const RUN = AgentRun.parse({
  id: "run-budget-test",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:05.000Z",
  schemaVersion: 1,
  task: "Create the todo 'Buy milk' and confirm it was added.",
  finalOutput: "Added Buy milk to the list.",
  events: [
    { id: "ev-1", timestamp: "2026-09-20T00:00:00.300Z", seq: 1, type: "tool_call", callId: "c1", tool: "add_todo", arguments: { text: "Buy milk" } },
    { id: "ev-2", timestamp: "2026-09-20T00:00:00.600Z", seq: 2, type: "tool_result", callId: "c1", success: true, result: { id: "t1" } },
  ],
});

const ANSWERS = {
  goalCompleted: { type: "noul" as const, noul: 0.92 },
  finalStateMatchesIntent: { type: "noul" as const, noul: 0.9 },
};

describe("evaluate — budget and degradation ladder", () => {
  it("uses one batched call when the ample default budget fits everything", async () => {
    const graph = await new DefaultEvidenceCompiler().compile(RUN);
    const engine = new MockDecisionEngine(ANSWERS);

    const results = await evaluate(graph, ["goalCompleted", "finalStateMatchesIntent"], engine, defineConfig());

    expect(engine.calls.length).toBe(1);
    expect(Object.keys(engine.calls[0]!.questions).sort()).toEqual(["finalStateMatchesIntent", "goalCompleted"]);
    expect(results.goalCompleted!.status).toBe("pass");
    expect(results.finalStateMatchesIntent!.status).toBe("pass");
  });

  it("splits into one call per assertion when the combined batch doesn't fit but each alone does", async () => {
    const graph = await new DefaultEvidenceCompiler().compile(RUN);

    // Measure reality: how big is each assertion's own call, and the combined one?
    const probeCombined = new MockDecisionEngine(ANSWERS);
    await evaluate(graph, ["goalCompleted", "finalStateMatchesIntent"], probeCombined, defineConfig());
    const combinedQuestionTokens = estimateQuestionsTokens(probeCombined.calls[0]!.questions);
    const combinedStateTokens = estimateStateTokens(probeCombined.calls[0]!.state);

    const probeGoal = new MockDecisionEngine(ANSWERS);
    await evaluate(graph, ["goalCompleted"], probeGoal, defineConfig());
    const goalQuestionTokens = estimateQuestionsTokens(probeGoal.calls[0]!.questions);

    const probeFinal = new MockDecisionEngine(ANSWERS);
    await evaluate(graph, ["finalStateMatchesIntent"], probeFinal, defineConfig());
    const finalQuestionTokens = estimateQuestionsTokens(probeFinal.calls[0]!.questions);

    // A reserve bigger than either alone but smaller than the combined
    // total forces a split: each individual call fits, the union doesn't.
    const tightReserve = Math.max(goalQuestionTokens, finalQuestionTokens) + 5;
    expect(tightReserve).toBeLessThan(combinedQuestionTokens);

    const engine = new MockDecisionEngine(ANSWERS, { tokenBudget: combinedStateTokens + tightReserve + 100 });
    const policy = defineConfig({ decision: { reserveForQuestions: tightReserve } });

    const results = await evaluate(graph, ["goalCompleted", "finalStateMatchesIntent"], engine, policy);

    expect(engine.calls.length).toBe(2);
    expect(engine.calls.map((c) => Object.keys(c.questions))).toEqual([["goalCompleted"], ["finalStateMatchesIntent"]]);
    expect(results.goalCompleted!.status).toBe("pass");
    expect(results.finalStateMatchesIntent!.status).toBe("pass");
    // PRD3 A3 — every result reached via the split-batch rung records why.
    expect(results.goalCompleted!.degradation).toEqual({
      strategy: "split-batch",
      reason: "the union of all pending assertions' evidence exceeded the engine's token budget; this assertion was evaluated in its own call",
    });
    expect(results.finalStateMatchesIntent!.degradation).toEqual(results.goalCompleted!.degradation);
  });

  it("records no degradation when the union-batch fast path is taken", async () => {
    const graph = await new DefaultEvidenceCompiler().compile(RUN);
    const engine = new MockDecisionEngine(ANSWERS);

    const results = await evaluate(graph, ["goalCompleted", "finalStateMatchesIntent"], engine, defineConfig());

    expect(results.goalCompleted!.degradation).toBeUndefined();
    expect(results.finalStateMatchesIntent!.degradation).toBeUndefined();
  });

  it("abstains at capacity, without calling the engine, when even a single assertion cannot fit", async () => {
    const graph = await new DefaultEvidenceCompiler().compile(RUN);
    // A budget too small for any real payload — the terminal §6.7 rung.
    const engine = new MockDecisionEngine(ANSWERS, { tokenBudget: 10 });
    const policy = defineConfig({ decision: { reserveForQuestions: 1 } });

    const results = await evaluate(graph, ["goalCompleted"], engine, policy);

    expect(engine.calls.length).toBe(0);
    expect(results.goalCompleted).toMatchObject({
      status: "review",
      reviewVia: "capacity",
      explanation: "evidence exceeds engine capacity",
      degradation: { strategy: "review" },
    });
  });
});

describe("evaluate — fan-out cap engages only on measured overflow (TRD §6.5 rule 4)", () => {
  async function buildClaimsRun(count: number) {
    const sentences = Array.from({ length: count }, (_, i) => `Step ${i + 1} completed.`).join(" ");
    return AgentRun.parse({
      id: "run-fanout-test",
      agent: { name: "test-agent" },
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      endedAt: "2026-09-20T00:00:05.000Z",
      schemaVersion: 1,
      task: "Do the steps.",
      finalOutput: sentences,
      events: [],
    });
  }

  it("asks about every claim, uncapped, when the ample default budget fits them all", async () => {
    const run = await buildClaimsRun(5);
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const script: Record<string, { type: "noul"; noul: number }> = {};
    for (let i = 1; i <= 5; i++) script[`noUnsupportedClaims::e-final-c${i}`] = { type: "noul", noul: 0.05 };

    // A deliberately tiny configured cap that must NOT engage, because the
    // measured payload fits comfortably under the (ample, default) budget.
    const policy = defineConfig({ questions: { maxClaimQuestions: 2, maxToolQuestions: 25, destructiveTools: [] } });
    const engine = new MockDecisionEngine(script);

    const results = await evaluate(graph, ["noUnsupportedClaims"], engine, policy);

    expect(results.noUnsupportedClaims!.status).toBe("pass");
    expect(results.noUnsupportedClaims!.coverageGaps).toBeUndefined();
    expect(results.noUnsupportedClaims!.evidence).toHaveLength(5);
  });

  it("caps in priority order when the assertion's own payload measurably overflows", async () => {
    const run = await buildClaimsRun(5);
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const script: Record<string, { type: "noul"; noul: number }> = {};
    for (let i = 1; i <= 5; i++) script[`noUnsupportedClaims::e-final-c${i}`] = { type: "noul", noul: 0.05 };

    // Measure the natural (uncapped) size, then force a budget that fits
    // only 2 of the 5 questions.
    const probe = new MockDecisionEngine(script);
    await evaluate(graph, ["noUnsupportedClaims"], probe, defineConfig({ questions: { maxClaimQuestions: 25, maxToolQuestions: 25, destructiveTools: [] } }));
    const fiveQuestionTokens = estimateQuestionsTokens(probe.calls[0]!.questions);
    const perQuestion = fiveQuestionTokens / 5;
    const tightReserve = Math.ceil(perQuestion * 2.5); // fits ~2, not 5

    const policy = defineConfig({
      questions: { maxClaimQuestions: 2, maxToolQuestions: 25, destructiveTools: [] },
      decision: { reserveForQuestions: tightReserve },
    });
    const engine = new MockDecisionEngine(script, { tokenBudget: 32_000 });

    const results = await evaluate(graph, ["noUnsupportedClaims"], engine, policy);

    expect(results.noUnsupportedClaims!.coverageGaps).toBeDefined();
    expect(results.noUnsupportedClaims!.coverageGaps!.length).toBeGreaterThan(0);
    // A capped assertion can never return "pass" (TRD §6.5 rule 4).
    expect(results.noUnsupportedClaims!.status).toBe("review");
    // PRD3 A3 — a fan-out-cap degradation, distinct from a plain split-batch.
    expect(results.noUnsupportedClaims!.degradation?.strategy).toBe("fanout-cap");
    // Priority order for unlinked, all-final claims falls back to
    // descending seq, and all 5 tie on seq (same closing message) — so the
    // stable sort keeps the first two claims in extraction order.
    expect(results.noUnsupportedClaims!.evidence.sort()).toEqual(["e-final-c1", "e-final-c2"]);
  });
});
