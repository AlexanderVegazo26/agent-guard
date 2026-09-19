import { describe, expect, it } from "vitest";
import { AgentRun, DefaultEvidenceCompiler, defineConfig, toCalibrationRecord } from "@agent-guard/core";
import { MockDecisionEngine } from "@agent-guard/decision";
import { evaluate } from "./pipeline.js";

/**
 * §6.9 calibration gap, closed: `aggregateFanOut` never set `confidence`,
 * so `toCalibrationRecord` (which requires it) silently excluded every
 * fan-out assertion — `toolWasAppropriate`, `noUnsupportedClaims`, and
 * every fan-out added later — from the calibration curve entirely. This
 * file proves the fix: a fan-out result now carries a real confidence
 * derived from its own underlying engine answers, not a fabricated number.
 */

const BASE_RUN = {
  id: "run-fanout-calibration",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:05.000Z",
  schemaVersion: 1 as const,
};

async function buildTwoClaimGraph() {
  const run = AgentRun.parse({
    ...BASE_RUN,
    task: "Verify the account and confirm the balance.",
    finalOutput: "I verified the account. The balance is positive.",
    events: [],
  });
  return new DefaultEvidenceCompiler().compile(run);
}

async function buildTwoToolCallGraph() {
  const run = AgentRun.parse({
    ...BASE_RUN,
    task: "Add a todo and list the todos.",
    finalOutput: "Done.",
    events: [
      { id: "call-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "tool_call", callId: "c1", tool: "add_todo", arguments: {} },
      { id: "result-1", timestamp: "2026-09-20T00:00:00.200Z", seq: 2, type: "tool_result", callId: "c1", success: true, result: {} },
      { id: "call-2", timestamp: "2026-09-20T00:00:00.300Z", seq: 3, type: "tool_call", callId: "c2", tool: "list_todos", arguments: {} },
      { id: "result-2", timestamp: "2026-09-20T00:00:00.400Z", seq: 4, type: "tool_result", callId: "c2", success: true, result: {} },
    ],
  });
  return new DefaultEvidenceCompiler().compile(run);
}

describe("fan-out results now carry a real confidence, closing the calibration gap", () => {
  it("noUnsupportedClaims (noul fanout): confidence is the MAX raw probability across items", async () => {
    const graph = await buildTwoClaimGraph();
    const claims = graph.byType("agent_claim");
    expect(claims.length).toBe(2);

    const engine = new MockDecisionEngine({
      [`noUnsupportedClaims::${claims[0]!.id}`]: { type: "noul", noul: 0.2 },
      [`noUnsupportedClaims::${claims[1]!.id}`]: { type: "noul", noul: 0.65 },
    });
    const results = await evaluate(graph, ["noUnsupportedClaims"], engine, defineConfig());
    const result = results.noUnsupportedClaims!;

    expect(result.confidence).toBe(0.65);
    expect(result.signal).toBe("noul-probability");

    // And it's now visible to calibration, where before it was silently excluded.
    const record = toCalibrationRecord(result, "review");
    expect(record).not.toBeNull();
    expect(record!.confidence).toBe(0.65);
    expect(record!.assertionId).toBe("noUnsupportedClaims");
  });

  it("toolWasAppropriate (choice fanout): confidence is the MIN confidence across items", async () => {
    const graph = await buildTwoToolCallGraph();
    const calls = graph.byType("tool_call");
    expect(calls.length).toBe(2);

    const engine = new MockDecisionEngine({
      [`toolWasAppropriate::${calls[0]!.id}`]: {
        type: "choice",
        choice: "appropriate",
        confidence: 0.95,
        probabilities: { appropriate: 0.95, unnecessary: 0.02, "wrong-tool": 0.02, "wrong-target": 0.01 },
      },
      [`toolWasAppropriate::${calls[1]!.id}`]: {
        type: "choice",
        choice: "appropriate",
        confidence: 0.72,
        probabilities: { appropriate: 0.72, unnecessary: 0.1, "wrong-tool": 0.1, "wrong-target": 0.08 },
      },
    });
    const results = await evaluate(graph, ["toolWasAppropriate"], engine, defineConfig());
    const result = results.toolWasAppropriate!;

    expect(result.status).toBe("pass");
    expect(result.confidence).toBe(0.72);
    expect(result.signal).toBe("derived-confidence");

    const record = toCalibrationRecord(result, "pass");
    expect(record).not.toBeNull();
    expect(record!.confidence).toBe(0.72);
    expect(record!.correct).toBe(true);
  });

  it("a fully deterministic fan-out result (no engine call) still carries no confidence — nothing to calibrate", async () => {
    const run = AgentRun.parse({
      ...BASE_RUN,
      task: "Verify the account.",
      finalOutput: "I used `verify_account` to confirm this.",
      events: [],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const engine = new MockDecisionEngine({});

    const results = await evaluate(graph, ["noFabricatedToolUsage"], engine, defineConfig());
    const result = results.noFabricatedToolUsage!;

    expect(result.basis).toBe("deterministic");
    expect(result.confidence).toBeUndefined();
    expect(toCalibrationRecord(result, "fail")).toBeNull();
  });
});
