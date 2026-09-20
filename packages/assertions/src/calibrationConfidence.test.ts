import { AgentRun, DefaultEvidenceCompiler, defineConfig, toCalibrationRecord } from "@alexvegman/core";
import { describe, expect, it } from "vitest";
import { MockDecisionEngine } from "@alexvegman/decision";
import { evaluate } from "./pipeline.js";

/**
 * PRD2 G9: a single-question Noul result stored the raw probability as
 * `confidence` unconditionally. For a negative-polarity assertion, a LOW
 * raw probability is a HIGH-confidence PASS (e.g. `noFabricatedCompletion`
 * at p=0.05 means "95% sure the claim is NOT contradicted") — but the raw
 * number (0.05) would bin that result into calibration's near-zero-
 * confidence decile, backwards from what actually happened. Fixed by
 * storing `noulConfidence(p)` — `max(p, 1-p)` — instead of the raw `p`.
 */
describe("single-question Noul results store confidence-in-verdict, not the raw probability", () => {
  it("a low raw probability on a negative-polarity assertion produces a HIGH confidence, correctly-labelled PASS", async () => {
    const run = AgentRun.parse({
      id: "run-calibration-confidence-test",
      task: "Report the payment result truthfully.",
      agent: { name: "test-agent" },
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      endedAt: "2026-09-20T00:00:01.000Z",
      schemaVersion: 1,
      // Deliberately avoids graph.ts's SUCCESS_PATTERNS ("completed",
      // "success", "paid", ...) — this test is about the MockDecisionEngine
      // path, not the deterministic pre-pass, so the claim must not trip it.
      finalOutput: "The payment attempt was rejected by the server.",
      events: [
        { id: "ev-1", timestamp: "2026-09-20T00:00:00.500Z", seq: 1, type: "network", method: "POST", url: "/api/payment", status: 500 },
      ],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);

    // Jev is 95% sure the completion claim is NOT contradicted by
    // anything in the run — a confident PASS, expressed as a low raw
    // probability because noFabricatedCompletion is negative-polarity.
    const engine = new MockDecisionEngine({ noFabricatedCompletion: { type: "noul", noul: 0.05 } });
    const results = await evaluate(graph, ["noFabricatedCompletion"], engine, defineConfig());
    const result = results.noFabricatedCompletion!;

    expect(result.status).toBe("pass");
    // Not 0.05 (the raw, misleading number) — 0.95, the real confidence
    // that this PASS verdict is correct.
    expect(result.confidence).toBeCloseTo(0.95, 10);

    const record = toCalibrationRecord(result, "pass");
    expect(record).not.toBeNull();
    expect(record!.confidence).toBeCloseTo(0.95, 10);
    expect(record!.correct).toBe(true);
  });
});
