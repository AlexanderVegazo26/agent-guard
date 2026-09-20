import { describe, expect, it } from "vitest";
import { AgentRun, DefaultEvidenceCompiler, defineConfig, type AssertionResult } from "@alexvegman/core";
import { MockDecisionEngine, MockEscalationEngine } from "@alexvegman/decision";
import { escalateReviews } from "./escalate.js";
import { evaluate } from "./pipeline.js";

const BASE_RUN = {
  id: "run-escalate-test",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:05.000Z",
  schemaVersion: 1 as const,
};

async function buildGraph() {
  const run = AgentRun.parse({
    ...BASE_RUN,
    task: "Cancel my subscription.",
    finalOutput: "I cancelled a subscription, though it wasn't clear which one you meant.",
    events: [
      { id: "call-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "tool_call", callId: "c1", tool: "cancel_subscription", arguments: { id: "sub-1" } },
      { id: "result-1", timestamp: "2026-09-20T00:00:00.200Z", seq: 2, type: "tool_result", callId: "c1", success: true, result: {} },
    ],
  });
  return new DefaultEvidenceCompiler().compile(run);
}

describe("escalateReviews", () => {
  it("escalates a single-question assertion's uncertainty-band REVIEW, setting basis: escalated and a new explanation", async () => {
    const graph = await buildGraph();
    const engine = new MockDecisionEngine({ handledAmbiguityCorrectly: { type: "noul", noul: 0.5 } });
    const results = await evaluate(graph, ["handledAmbiguityCorrectly"], engine, defineConfig());
    expect(results.handledAmbiguityCorrectly!.status).toBe("review");
    expect(results.handledAmbiguityCorrectly!.reviewVia).toBe("uncertainty-band");

    const escalation = new MockEscalationEngine({
      handledAmbiguityCorrectly: "The request names no specific subscription, and no earlier evidence disambiguates it.",
    });
    const escalated = await escalateReviews(graph, results, escalation);

    expect(escalated.handledAmbiguityCorrectly!.status).toBe("review"); // never changes the verdict
    expect(escalated.handledAmbiguityCorrectly!.basis).toBe("escalated");
    expect(escalated.handledAmbiguityCorrectly!.explanation).toBe(
      "The request names no specific subscription, and no earlier evidence disambiguates it.",
    );
    expect(escalation.calls).toHaveLength(1);
    expect(escalation.calls[0]!.assertionId).toBe("handledAmbiguityCorrectly");
    expect(escalation.calls[0]!.priorConfidence).toBe(0.5);
  });

  it("does not escalate a pass or fail result", async () => {
    const graph = await buildGraph();
    const engine = new MockDecisionEngine({ handledAmbiguityCorrectly: { type: "noul", noul: 0.95 } });
    const results = await evaluate(graph, ["handledAmbiguityCorrectly"], engine, defineConfig());
    expect(results.handledAmbiguityCorrectly!.status).toBe("pass");

    const escalation = new MockEscalationEngine({});
    const escalated = await escalateReviews(graph, results, escalation);

    expect(escalated).toEqual(results);
    expect(escalation.calls).toHaveLength(0);
  });

  it("does not escalate a structural-gap or capacity REVIEW — there's no Jev signal to explain", async () => {
    const structuralGap: Record<string, AssertionResult> = {
      goalCompleted: {
        id: "goalCompleted",
        status: "review",
        basis: "jev",
        reviewVia: "structural-gap",
        missing: ["user_request"],
        evidence: [],
        durationMs: 0,
      },
    };
    const graph = await buildGraph();
    const escalation = new MockEscalationEngine({});
    const escalated = await escalateReviews(graph, structuralGap, escalation);

    expect(escalated).toEqual(structuralGap);
    expect(escalation.calls).toHaveLength(0);
  });

  it("does not escalate a fan-out assertion's REVIEW — scope decision, not yet supported [PRD3:F15]", async () => {
    const graph = await buildGraph();
    const call = graph.byType("tool_call")[0]!;
    const engine = new MockDecisionEngine({ [`toolWasAppropriate::${call.id}`]: { type: "choice", choice: "appropriate", confidence: 0.3, probabilities: { appropriate: 0.3, unnecessary: 0.3, "wrong-tool": 0.2, "wrong-target": 0.2 } } });
    const results = await evaluate(graph, ["toolWasAppropriate"], engine, defineConfig());
    expect(results.toolWasAppropriate!.status).toBe("review");

    const escalation = new MockEscalationEngine({});
    const escalated = await escalateReviews(graph, results, escalation);

    expect(escalated).toEqual(results);
    expect(escalation.calls).toHaveLength(0);
  });

  it("leaves a result unescalated (with a warning, not a thrown error) when the escalation engine fails", async () => {
    const graph = await buildGraph();
    const engine = new MockDecisionEngine({ handledAmbiguityCorrectly: { type: "noul", noul: 0.5 } });
    const results = await evaluate(graph, ["handledAmbiguityCorrectly"], engine, defineConfig());

    const failing = new MockEscalationEngine(() => {
      throw new Error("network unavailable");
    });
    const escalated = await escalateReviews(graph, results, failing);

    expect(escalated.handledAmbiguityCorrectly).toEqual(results.handledAmbiguityCorrectly);
  });
});
