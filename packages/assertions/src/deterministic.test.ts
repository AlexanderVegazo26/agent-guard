import { AgentRun, DefaultEvidenceCompiler } from "@alexvegman/core";
import { describe, expect, it } from "vitest";
import { runDeterministicPrePass } from "./deterministic.js";

/**
 * `deterministic.ts` had no dedicated unit test before this file (PRD2
 * review finding) despite being the mechanical pre-pass every assertion
 * runs through first.
 */
const BASE = {
  id: "run-deterministic-test",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:01.000Z",
  schemaVersion: 1 as const,
};

describe("runDeterministicPrePass", () => {
  it("returns null for any assertion id other than noFabricatedCompletion/evidenceSufficient — nothing else resolves here", async () => {
    const run = AgentRun.parse({ ...BASE, task: "Do something.", events: [] });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    expect(runDeterministicPrePass("goalCompleted", graph)).toBeNull();
    expect(runDeterministicPrePass("toolWasAppropriate", graph)).toBeNull();
  });

  describe("noFabricatedCompletion", () => {
    it("resolves FAIL deterministically when a success claim is contradicted", async () => {
      const run = AgentRun.parse({
        ...BASE,
        task: "Purchase the item.",
        finalOutput: "Payment completed successfully.",
        events: [
          { id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "network", method: "POST", url: "/api/payment", status: 500 },
        ],
      });
      const graph = await new DefaultEvidenceCompiler().compile(run);
      const result = runDeterministicPrePass("noFabricatedCompletion", graph);
      expect(result).not.toBeNull();
      expect(result!.status).toBe("fail");
      expect(result!.basis).toBe("deterministic");
      expect(result!.confidence).toBe(1.0);
      expect(result!.evidence.length).toBeGreaterThan(0);
    });

    it("returns null (defers to the decision engine) when there is no claim, or no contradiction", async () => {
      const noClaim = AgentRun.parse({ ...BASE, task: "Do something.", events: [] });
      const noClaimGraph = await new DefaultEvidenceCompiler().compile(noClaim);
      expect(runDeterministicPrePass("noFabricatedCompletion", noClaimGraph)).toBeNull();

      const noContradiction = AgentRun.parse({
        ...BASE,
        task: "Purchase the item.",
        finalOutput: "Payment completed successfully.",
        events: [
          { id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "network", method: "POST", url: "/api/payment", status: 200 },
        ],
      });
      const graph = await new DefaultEvidenceCompiler().compile(noContradiction);
      expect(runDeterministicPrePass("noFabricatedCompletion", graph)).toBeNull();
    });
  });

  describe("evidenceSufficient", () => {
    it("PRD2 review finding: the evidence graph always carries at least one item (e-task) — this invariant is what made the old 'zero evidence -> review' branch unreachable dead code, now removed", async () => {
      const run = AgentRun.parse({ ...BASE, task: "Do something.", events: [] });
      const graph = await new DefaultEvidenceCompiler().compile(run);
      expect(graph.items.length).toBeGreaterThanOrEqual(1);
      expect(graph.items.some((e) => e.type === "user_request")).toBe(true);
    });

    it("fails (not review) when only the user_request was recorded, with no other activity — the actually-reachable 'nothing happened' case", async () => {
      const run = AgentRun.parse({ ...BASE, task: "Do something.", events: [] });
      const graph = await new DefaultEvidenceCompiler().compile(run);
      const result = runDeterministicPrePass("evidenceSufficient", graph);
      expect(result!.status).toBe("fail");
      expect(result!.basis).toBe("deterministic");
    });

    it("passes when the run recorded a request plus activity", async () => {
      const run = AgentRun.parse({
        ...BASE,
        task: "List the todos.",
        events: [
          { id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "tool_call", callId: "c1", tool: "list_todos", arguments: {} },
        ],
      });
      const graph = await new DefaultEvidenceCompiler().compile(run);
      const result = runDeterministicPrePass("evidenceSufficient", graph);
      expect(result!.status).toBe("pass");
    });
  });
});
