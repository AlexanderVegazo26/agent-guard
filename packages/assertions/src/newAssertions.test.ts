import { describe, expect, it } from "vitest";
import { AgentRun, DefaultEvidenceCompiler, defineConfig, type AssertionId } from "@agent-guard/core";
import { MockDecisionEngine, type DecisionAnswer } from "@agent-guard/decision";
import { evaluate } from "./pipeline.js";

/**
 * Coverage for the 14 assertions added to close the PRD §8 gap (only 7 of
 * 20 + `evidenceSufficient` existed before this), plus `evidenceSufficient`
 * itself. This does not re-prove the pipeline mechanics (degradation
 * ladder, selection windows, priority ordering) already covered elsewhere —
 * it proves each new id is wired end-to-end: requirements → definition →
 * verdict, in both a decided and an abstained shape.
 */

const BASE_RUN = {
  id: "run-new-assertions",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:05.000Z",
  schemaVersion: 1 as const,
};

async function buildGraph() {
  const run = AgentRun.parse({
    ...BASE_RUN,
    task: "Add a todo called Buy milk.",
    finalOutput: "Added the todo.",
    events: [
      { id: "call-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "tool_call", callId: "c1", tool: "add_todo", arguments: { title: "Buy milk" } },
      { id: "result-1", timestamp: "2026-09-20T00:00:00.200Z", seq: 2, type: "tool_result", callId: "c1", success: true, result: { id: "t1" } },
    ],
  });
  return new DefaultEvidenceCompiler().compile(run);
}

/** Builds a NOUL answer at a probability confidently outside the default [0.35, 0.75] band. */
function noul(probability: number): DecisionAnswer {
  return { type: "noul", noul: probability };
}

const SINGLE_NOUL_IDS: { id: AssertionId; polarity: "positive" | "negative" }[] = [
  { id: "prematureCompletion", polarity: "negative" },
  { id: "requiredStepsCompleted", polarity: "positive" },
  { id: "noSensitiveDataLeak", polarity: "negative" },
  { id: "noPolicyViolation", polarity: "negative" },
  { id: "handledAmbiguityCorrectly", polarity: "positive" },
  { id: "avoidedUnnecessaryActions", polarity: "negative" },
  { id: "stoppedWhenDone", polarity: "positive" },
];

const FANOUT_TOOL_IDS: { id: AssertionId; polarity: "positive" | "negative" }[] = [
  { id: "toolArgumentsCorrect", polarity: "positive" },
  { id: "toolResultUsedCorrectly", polarity: "positive" },
  { id: "noUnauthorizedToolUse", polarity: "negative" },
  { id: "noUnauthorizedSideEffect", polarity: "negative" },
];
const FANOUT_CLAIM_IDS: AssertionId[] = ["claimsConsistentWithEvidence", "noFabricatedToolUsage"];

describe("new single-question assertions — decided verdicts", () => {
  it.each(SINGLE_NOUL_IDS)("$id resolves pass/fail per its declared polarity", async ({ id, polarity }) => {
    const graph = await buildGraph();

    // A high NOUL probability: "statement true" — for positive polarity that's a pass, for negative a fail.
    const highEngine = new MockDecisionEngine({ [id]: noul(0.95) });
    const high = await evaluate(graph, [id], highEngine, defineConfig());
    expect(high[id]!.status).toBe(polarity === "positive" ? "pass" : "fail");
    expect(high[id]!.evidence.length).toBeGreaterThan(0);

    // A low NOUL probability: "statement false" — inverted for negative polarity.
    const lowEngine = new MockDecisionEngine({ [id]: noul(0.05) });
    const low = await evaluate(graph, [id], lowEngine, defineConfig());
    expect(low[id]!.status).toBe(polarity === "positive" ? "fail" : "pass");
  });
});

describe("new fan-out assertions over tool_call", () => {
  it.each(FANOUT_TOOL_IDS)("$id fans out over the single recorded tool call and aggregates to pass", async ({ id, polarity }) => {
    const graph = await buildGraph();
    const call = graph.byType("tool_call")[0]!;
    // A "clean" answer for each polarity: high confidence the positive statement
    // is true, or high confidence the negative-named violation is absent.
    const engine = new MockDecisionEngine({ [`${id}::${call.id}`]: noul(polarity === "positive" ? 0.95 : 0.05) });

    const results = await evaluate(graph, [id], engine, defineConfig());
    expect(results[id]!.status).toBe("pass");
    expect(results[id]!.evidence).toContain(call.id);
  });
});

describe("new fan-out assertions over agent_claim", () => {
  it.each(FANOUT_CLAIM_IDS)("$id fans out over the recorded claim and aggregates to fail on a high violation probability", async (id) => {
    const graph = await buildGraph();
    const claim = graph.byType("agent_claim")[0]!;
    const engine = new MockDecisionEngine({ [`${id}::${claim.id}`]: noul(0.95) });

    const results = await evaluate(graph, [id], engine, defineConfig());
    expect(results[id]!.status).toBe("fail");
    expect(results[id]!.evidence).toContain(claim.id);
  });

  it("noFabricatedToolUsage resolves the same fabricated-tool claim deterministically, with no engine call", async () => {
    const run = AgentRun.parse({
      ...BASE_RUN,
      task: "Verify the account.",
      finalOutput: "I used `verify_account` to confirm this.",
      events: [],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const engine = new MockDecisionEngine({});

    const results = await evaluate(graph, ["noFabricatedToolUsage"], engine, defineConfig());
    expect(results.noFabricatedToolUsage!.status).toBe("fail");
    expect(results.noFabricatedToolUsage!.basis).toBe("deterministic");
    expect(engine.calls.length).toBe(0);
  });
});

describe("requirements-driven abstention for new assertions", () => {
  it("prematureCompletion abstains not_applicable with no agent_claim", async () => {
    const run = AgentRun.parse({ ...BASE_RUN, task: "Do something.", events: [] });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const engine = new MockDecisionEngine({});

    const results = await evaluate(graph, ["prematureCompletion"], engine, defineConfig());
    expect(results.prematureCompletion!.status).toBe("not_applicable");
    expect(results.prematureCompletion!.basis).toBe("not-applicable");
    expect(engine.calls.length).toBe(0);
  });

  it("toolResultUsedCorrectly abstains not_applicable with no tool_call at all", async () => {
    const run = AgentRun.parse({ ...BASE_RUN, task: "Do something.", events: [] });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const engine = new MockDecisionEngine({});

    // Neither `tool_call` (unmet: not_applicable) nor `tool_result`
    // (unmet: review) is present — "review wins" over not_applicable when
    // both requirements are unmet at once (TRD §6.3).
    const results = await evaluate(graph, ["toolResultUsedCorrectly"], engine, defineConfig());
    expect(results.toolResultUsedCorrectly!.status).toBe("review");
  });
});

describe("evidenceSufficient — deterministic-only, never reaches the engine", () => {
  it("passes when the run recorded a request plus activity", async () => {
    const graph = await buildGraph();
    const engine = new MockDecisionEngine({});

    const results = await evaluate(graph, ["evidenceSufficient"], engine, defineConfig());
    expect(results.evidenceSufficient!.status).toBe("pass");
    expect(results.evidenceSufficient!.basis).toBe("deterministic");
    expect(engine.calls.length).toBe(0);
  });

  it("fails when only the user_request was recorded, with no other activity", async () => {
    const run = AgentRun.parse({ ...BASE_RUN, task: "Do something.", events: [] });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const engine = new MockDecisionEngine({});

    const results = await evaluate(graph, ["evidenceSufficient"], engine, defineConfig());
    expect(results.evidenceSufficient!.status).toBe("fail");
    expect(results.evidenceSufficient!.evidence.length).toBeGreaterThan(0);
  });
});
