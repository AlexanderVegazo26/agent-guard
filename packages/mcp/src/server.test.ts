import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockDecisionEngine } from "@agent-guard/decision";
import { AgentGuardMcpServer } from "./server.js";

/**
 * Exercised against the real `@modelcontextprotocol/sdk` `Client` +
 * `InMemoryTransport`, matching `packages/playwright`'s
 * `real-sdk-integration.test.ts` convention — proves the tool registrations
 * work through the real protocol framing, not just as direct method calls.
 */
describe("AgentGuardMcpServer", () => {
  let client: Client;
  let agentGuard: AgentGuardMcpServer;

  beforeEach(async () => {
    agentGuard = new AgentGuardMcpServer({ engine: new MockDecisionEngine({ goalCompleted: { type: "noul", noul: 0.95 } }) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await agentGuard.server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
  });

  it("exposes exactly the seven tools named in PRD §32, and no agentguard_pass tool", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "agentguard_assert",
        "agentguard_finish_run",
        "agentguard_get_evidence",
        "agentguard_get_report",
        "agentguard_get_run",
        "agentguard_mutate",
        "agentguard_start_run",
      ].sort(),
    );
    expect(names).not.toContain("agentguard_pass");
  });

  it("drives the full lifecycle: start → get_run → assert → get_report → finish_run", async () => {
    const start = await client.callTool({
      name: "agentguard_start_run",
      arguments: {
        task: "Add a todo called Buy milk.",
        events: [
          { id: "ev-1", type: "tool_call", callId: "c1", tool: "add_todo", arguments: { text: "Buy milk" }, timestamp: new Date().toISOString(), seq: 1 },
          { id: "ev-2", type: "tool_result", callId: "c1", success: true, result: { id: "t1" }, timestamp: new Date().toISOString(), seq: 2 },
        ],
      },
    });
    const { runId } = readJson<{ runId: string }>(start);
    expect(runId).toMatch(/^mcp-run-/);

    const gotRun = await client.callTool({ name: "agentguard_get_run", arguments: { runId } });
    const run = readJson<{ task: string; events: unknown[] }>(gotRun);
    expect(run.task).toBe("Add a todo called Buy milk.");
    expect(run.events).toHaveLength(2);

    const evidence = await client.callTool({ name: "agentguard_get_evidence", arguments: { runId } });
    const graph = readJson<{ items: { id: string }[] }>(evidence);
    expect(graph.items.some((i) => i.id === "e-task")).toBe(true);

    const asserted = await client.callTool({ name: "agentguard_assert", arguments: { runId, assertions: ["goalCompleted"] } });
    const results = readJson<Record<string, { status: string }>>(asserted);
    expect(results.goalCompleted?.status).toBe("pass");

    const report = await client.callTool({ name: "agentguard_get_report", arguments: { runId } });
    expect(readJson<Record<string, { status: string }>>(report).goalCompleted?.status).toBe("pass");

    const finished = await client.callTool({ name: "agentguard_finish_run", arguments: { runId, finalOutput: "Added Buy milk." } });
    const finishedRun = readJson<{ finalOutput?: string; endedAt?: string }>(finished);
    expect(finishedRun.finalOutput).toBe("Added Buy milk.");
    expect(finishedRun.endedAt).toBeTruthy();
  });

  it("agentguard_mutate records a fault that agentguard_get_run can see", async () => {
    const start = await client.callTool({ name: "agentguard_start_run", arguments: { task: "Do something." } });
    const { runId } = readJson<{ runId: string }>(start);

    const mutated = await client.callTool({
      name: "agentguard_mutate",
      arguments: { runId, fault: { type: "http", url: "/api/payment", status: 500 } },
    });
    const { faultId } = readJson<{ faultId: string }>(mutated);
    expect(faultId).toBe("fault-1");

    const run = readJson<{ faults: { id: string }[] }>(await client.callTool({ name: "agentguard_get_run", arguments: { runId } }));
    expect(run.faults).toHaveLength(1);
    expect(run.faults[0]!.id).toBe("fault-1");
  });

  it("agentguard_get_report returns null before any agentguard_assert call", async () => {
    const start = await client.callTool({ name: "agentguard_start_run", arguments: { task: "Do something." } });
    const { runId } = readJson<{ runId: string }>(start);

    const report = await client.callTool({ name: "agentguard_get_report", arguments: { runId } });
    expect(readJson(report)).toBeNull();
  });

  it("rejects an unknown run id rather than fabricating a result", async () => {
    const result = await client.callTool({ name: "agentguard_get_run", arguments: { runId: "does-not-exist" } });
    expect(result.isError).toBe(true);
  });

  it("PRD2 review fix: rejects a malformed event with a clear tool error, instead of crashing later in the compiler", async () => {
    const start = await client.callTool({
      name: "agentguard_start_run",
      arguments: {
        task: "Do something.",
        // `seq` must be a nonnegative integer; a string here used to be
        // cast straight to AgentEvent[] with no validation at all.
        events: [{ id: "ev-1", type: "tool_call", callId: "c1", tool: "x", arguments: {}, timestamp: new Date().toISOString(), seq: "not-a-number" }],
      },
    });
    expect(start.isError).toBe(true);
    const { error } = readJson<{ error: string }>(start);
    expect(error).toMatch(/invalid events/);
  });
});

function readJson<T>(result: { content: { type: string; text?: string }[] }): T {
  const first = result.content[0];
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("expected a text content block");
  }
  return JSON.parse(first.text) as T;
}
