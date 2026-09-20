import { describe, expect, it } from "vitest";
import { AgentRun, DefaultEvidenceCompiler } from "@alexvegman/core";
import { priorityOrder } from "./priority.js";

const BASE_RUN = {
  id: "run-priority-test",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:05.000Z",
  schemaVersion: 1 as const,
};

describe("priorityOrder — noUnsupportedClaims (TRD §6.5 rule 4)", () => {
  it("ranks a claim with a deterministic link first, then final-message claims, then by descending seq", async () => {
    const run = AgentRun.parse({
      ...BASE_RUN,
      task: "Purchase the item.",
      // A mid-run agent message claim (not from finalOutput, ranks last tier).
      // A success claim contradicted by a 5xx (gets a deterministic link, ranks first).
      finalOutput: "This is fine. The order shipped. Payment completed successfully.",
      events: [
        { id: "ev-msg", timestamp: "2026-09-20T00:00:00.500Z", seq: 1, type: "message", role: "agent", text: "Checking order status now." },
        {
          id: "ev-net",
          timestamp: "2026-09-20T00:00:01.000Z",
          seq: 2,
          type: "network",
          method: "POST",
          url: "/api/payment",
          status: 500,
        },
      ],
    });

    const graph = await new DefaultEvidenceCompiler().compile(run);
    const claims = graph.byType("agent_claim");
    // e-ev-msg-c1 (mid-run, unlinked), e-final-c1/c2 (final, unlinked), e-final-c3 (final, linked via contradicts)
    expect(claims.map((c) => c.id)).toEqual(["e-ev-msg-c1", "e-final-c1", "e-final-c2", "e-final-c3"]);

    const ordered = priorityOrder("noUnsupportedClaims", claims, graph, []);

    // The linked claim (contradicted success claim) must be first.
    expect(ordered[0]!.id).toBe("e-final-c3");
    // The mid-run message claim (not from finalOutput) must be last.
    expect(ordered[ordered.length - 1]!.id).toBe("e-ev-msg-c1");
    // Among the unlinked final claims, they tie on `seq` (every sentence of
    // one closing message shares it — TRD's ordering has no finer-grained
    // signal here), so the stable sort preserves extraction order.
    const finalUnlinkedIds = ordered.slice(1, 3).map((c) => c.id);
    expect(finalUnlinkedIds).toEqual(["e-final-c1", "e-final-c2"]);
  });
});

describe("priorityOrder — toolWasAppropriate (TRD §6.5 rule 4)", () => {
  it("ranks task-referencing calls first, then destructive tools, then by descending seq", async () => {
    const run = AgentRun.parse({
      ...BASE_RUN,
      task: "Delete the todo called 'Pay electricity'.",
      finalOutput: "Done.",
      events: [
        { id: "ev-1", timestamp: "2026-09-20T00:00:00.300Z", seq: 1, type: "tool_call", callId: "c1", tool: "list_todos", arguments: {} },
        { id: "ev-2", timestamp: "2026-09-20T00:00:00.600Z", seq: 2, type: "tool_call", callId: "c2", tool: "log_audit_event", arguments: { note: "checking" } },
        { id: "ev-3", timestamp: "2026-09-20T00:00:00.900Z", seq: 3, type: "tool_call", callId: "c3", tool: "delete_todo", arguments: { text: "Pay electricity" } },
      ],
    });

    const graph = await new DefaultEvidenceCompiler().compile(run);
    const calls = graph.byType("tool_call");

    const ordered = priorityOrder("toolWasAppropriate", calls, graph, ["delete_todo"]);

    // ev-3's arguments literally contain "Pay electricity", which appears in the task text — ranks first.
    expect(ordered[0]!.id).toBe("e-ev-3");
    // Among the remaining two (neither references the task, neither is destructive apart from
    // delete_todo already placed), higher seq comes first.
    expect(ordered.slice(1).map((c) => c.id)).toEqual(["e-ev-2", "e-ev-1"]);
  });

  it("ranks a destructive tool above a non-destructive, non-task-referencing one", async () => {
    const run = AgentRun.parse({
      ...BASE_RUN,
      task: "Tidy up the workspace.",
      finalOutput: "Done.",
      events: [
        { id: "ev-1", timestamp: "2026-09-20T00:00:00.300Z", seq: 1, type: "tool_call", callId: "c1", tool: "list_todos", arguments: {} },
        { id: "ev-2", timestamp: "2026-09-20T00:00:00.600Z", seq: 2, type: "tool_call", callId: "c2", tool: "delete_all_todos", arguments: {} },
      ],
    });

    const graph = await new DefaultEvidenceCompiler().compile(run);
    const calls = graph.byType("tool_call");

    const ordered = priorityOrder("toolWasAppropriate", calls, graph, ["delete_all_todos"]);
    expect(ordered[0]!.id).toBe("e-ev-2");
  });
});
