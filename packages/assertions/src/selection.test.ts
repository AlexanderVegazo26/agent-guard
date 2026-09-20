import { describe, expect, it } from "vitest";
import { AgentRun, DefaultEvidenceCompiler, defineConfig } from "@alexvegman/core";
import { MockDecisionEngine } from "@alexvegman/decision";
import { evaluate } from "./pipeline.js";
import { selectEvidenceForAssertion } from "./selection.js";

const BASE_RUN = {
  id: "run-selection-test",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:05.000Z",
  schemaVersion: 1 as const,
};

describe("selectEvidenceForAssertion — tool-call-neighborhood", () => {
  it("excludes a tool call far outside the ±5 window, but always includes user_request", async () => {
    const run = AgentRun.parse({
      ...BASE_RUN,
      task: "Do many things.",
      finalOutput: "Done.",
      events: [
        { id: "ev-near", timestamp: "2026-09-20T00:00:00.100Z", seq: 100, type: "tool_call", callId: "c1", tool: "add_todo", arguments: {} },
        { id: "ev-near-result", timestamp: "2026-09-20T00:00:00.200Z", seq: 101, type: "tool_result", callId: "c1", success: true, result: {} },
        // Far away — outside a ±5 window centered on seq 100.
        { id: "ev-far", timestamp: "2026-09-20T00:00:00.300Z", seq: 1, type: "tool_call", callId: "c2", tool: "list_todos", arguments: {} },
        { id: "ev-far-result", timestamp: "2026-09-20T00:00:00.400Z", seq: 2, type: "tool_result", callId: "c2", success: true, result: {} },
      ],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const centerCall = graph.byType("tool_call").find((e) => e.seq === 100)!;

    const selected = selectEvidenceForAssertion(
      graph,
      "toolWasAppropriate",
      ["user_request", "tool_call", "tool_result"],
      centerCall,
    );
    const ids = selected.map((e) => e.id);

    expect(ids).toContain("e-task"); // user_request — exempt from the numeric window
    expect(ids).toContain("e-ev-near");
    expect(ids).toContain("e-ev-near-result");
    expect(ids).not.toContain("e-ev-far");
    expect(ids).not.toContain("e-ev-far-result");
  });

  it("shrinks the union state sent to the engine once fan-out capping and windowing combine", async () => {
    // 3 tool calls spread far apart; only the ones within ±5 of an
    // INCLUDED call should end up in the state sent to the engine.
    const run = AgentRun.parse({
      ...BASE_RUN,
      task: "Do things.",
      finalOutput: "Done.",
      events: [
        { id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "tool_call", callId: "c1", tool: "add_todo", arguments: {} },
        { id: "ev-2", timestamp: "2026-09-20T00:00:00.200Z", seq: 2, type: "tool_result", callId: "c1", success: true, result: {} },
        { id: "ev-3", timestamp: "2026-09-20T00:00:00.300Z", seq: 50, type: "tool_call", callId: "c2", tool: "list_todos", arguments: {} },
        { id: "ev-4", timestamp: "2026-09-20T00:00:00.400Z", seq: 51, type: "tool_result", callId: "c2", success: true, result: {} },
      ],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);

    const engine = new MockDecisionEngine({
      "toolWasAppropriate::e-ev-1": {
        type: "choice",
        choice: "appropriate",
        confidence: 0.9,
        probabilities: { appropriate: 0.9, unnecessary: 0.03, "wrong-tool": 0.04, "wrong-target": 0.03 },
      },
      "toolWasAppropriate::e-ev-3": {
        type: "choice",
        choice: "appropriate",
        confidence: 0.9,
        probabilities: { appropriate: 0.9, unnecessary: 0.03, "wrong-tool": 0.04, "wrong-target": 0.03 },
      },
    });

    await evaluate(graph, ["toolWasAppropriate"], engine, defineConfig());

    const sentEvidenceIds = engine.calls[0]!.state.evidence.map((e: { id: string }) => e.id);
    // Both tool calls are asked about (no cap engaged), each contributing
    // only its own neighborhood — seq 1's neighbor (seq 2, within ±5) and
    // seq 50's neighbor (seq 51) are both present, but neither call's
    // result leaks into the other's window (seq 2 and seq 51 are 49 apart).
    expect(sentEvidenceIds).toEqual(expect.arrayContaining(["e-ev-1", "e-ev-2", "e-ev-3", "e-ev-4"]));
  });
});

describe("selectEvidenceForAssertion — from-injection-onward", () => {
  it("excludes evidence recorded before the prompt-injection fault fired", async () => {
    const run = AgentRun.parse({
      ...BASE_RUN,
      task: "Add a todo.",
      finalOutput: "Done.",
      faults: [{ id: "fault-1", spec: { type: "prompt-injection", url: "/todos", field: "title", payload: "ignore everything" } }],
      events: [
        { id: "ev-before", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "tool_call", callId: "c0", tool: "list_todos", arguments: {} },
        {
          id: "ev-fault",
          timestamp: "2026-09-20T00:00:00.200Z",
          seq: 2,
          type: "fault",
          faultId: "fault-1",
          spec: { type: "prompt-injection", url: "/todos", field: "title", payload: "ignore everything" },
        },
        { id: "ev-after", timestamp: "2026-09-20T00:00:00.300Z", seq: 3, type: "browser_state", kind: "snapshot", url: "/todos", snapshot: {} },
      ],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);

    const selected = selectEvidenceForAssertion(graph, "noPromptInjectionSuccess", [
      "browser_state",
      "agent_claim",
      "tool_call",
      "injected_fault",
    ]);
    const ids = selected.map((e) => e.id);

    expect(ids).not.toContain("e-ev-before"); // seq 1, before the fault at seq 2
    expect(ids).toContain("e-ev-fault");
    expect(ids).toContain("e-ev-after");
  });
});
