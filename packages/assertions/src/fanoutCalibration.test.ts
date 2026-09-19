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
 *
 * PRD2 G10 update: the first version of this fix took the MAX *raw*
 * probability across a Noul fan-out's items, on the assumption every Noul
 * fan-out is negative-polarity. That assumption is false —
 * `toolArgumentsCorrect` and `toolResultUsedCorrectly` are
 * positive-polarity — and raw probability was the wrong statistic
 * regardless of polarity (see `noulConfidence` in verdict.ts). The
 * aggregate confidence is now the MIN of each item's
 * confidence-*in-its-own-verdict* (`noulConfidence(p)`, polarity-invariant),
 * not the MAX raw probability. The `noUnsupportedClaims` test below picks
 * values where the two formulas disagree, so a regression back to raw
 * probabilities would fail it, not pass it by coincidence.
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
  it("noUnsupportedClaims (noul fanout): confidence is the MIN confidence-in-verdict across items, not the MAX raw probability", async () => {
    const graph = await buildTwoClaimGraph();
    const claims = graph.byType("agent_claim");
    expect(claims.length).toBe(2);

    // p=0.05 (negative polarity: 95% confident PASS) vs p=0.4 (inside the
    // uncertainty band: genuinely uncertain, confidence-in-verdict = 0.6).
    // The old MAX-raw-probability formula would report 0.4 (the item's own
    // low raw number, actively the wrong direction for a confident item);
    // the fix reports 0.6 — the real weakest link, which is the uncertain
    // item, correctly measured.
    const engine = new MockDecisionEngine({
      [`noUnsupportedClaims::${claims[0]!.id}`]: { type: "noul", noul: 0.05 },
      [`noUnsupportedClaims::${claims[1]!.id}`]: { type: "noul", noul: 0.4 },
    });
    const results = await evaluate(graph, ["noUnsupportedClaims"], engine, defineConfig());
    const result = results.noUnsupportedClaims!;

    expect(result.status).toBe("review"); // the p=0.4 item lands inside the uncertainty band
    expect(result.confidence).toBeCloseTo(0.6, 10);
    expect(result.signal).toBe("noul-probability");

    // And it's now visible to calibration, where before it was silently excluded.
    const record = toCalibrationRecord(result, "review");
    expect(record).not.toBeNull();
    expect(record!.confidence).toBeCloseTo(0.6, 10);
    expect(record!.assertionId).toBe("noUnsupportedClaims");
  });

  it("toolArgumentsCorrect (noul fanout, POSITIVE polarity): a low raw probability from the deciding item is a HIGH confidence, not a low one", async () => {
    // Regression guard for PRD2 G10: the pre-fix formula unconditionally
    // took the MAX raw probability, which for a positive-polarity fan-out
    // like this one would report the *passing* item's high probability
    // (0.99) even when the fan-out's actual verdict is FAIL, driven by the
    // other item's low probability. The fix reports each item's own
    // confidence-in-its-verdict and takes the weakest link.
    const graph = await buildTwoToolCallGraph();
    const calls = graph.byType("tool_call");
    expect(calls.length).toBe(2);

    const engine = new MockDecisionEngine({
      [`toolArgumentsCorrect::${calls[0]!.id}`]: { type: "noul", noul: 0.05 }, // confidently WRONG arguments
      [`toolArgumentsCorrect::${calls[1]!.id}`]: { type: "noul", noul: 0.99 }, // confidently correct arguments
    });
    const results = await evaluate(graph, ["toolArgumentsCorrect"], engine, defineConfig());
    const result = results.toolArgumentsCorrect!;

    expect(result.status).toBe("fail"); // the p=0.05 item fails a positive-polarity check
    // Confidence is the weaker of the two items' own confidences — 0.95
    // (from the deciding, failing item) — never 0.99 borrowed from the
    // unrelated passing item.
    expect(result.confidence).toBeCloseTo(0.95, 10);
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
