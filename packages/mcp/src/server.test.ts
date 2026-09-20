import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockDecisionEngine } from "@alexvegman/decision";
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
    expect(readJson<{ decisions: Record<string, { status: string }> }>(report).decisions.goalCompleted?.status).toBe("pass");

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

    await client.callTool({ name: "agentguard_finish_run", arguments: { runId } }); // stops the proxy this mutate started
  });

  it("PRD3 F14 acceptance: agentguard_mutate starts a real proxy, and a real request through it returns the injected fault", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ upstream: true }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamPort = (upstream.address() as AddressInfo).port;

    try {
      const start = await client.callTool({ name: "agentguard_start_run", arguments: { task: "Do something." } });
      const { runId } = readJson<{ runId: string }>(start);

      const mutated = await client.callTool({
        name: "agentguard_mutate",
        arguments: { runId, fault: { type: "http-429", url: "/api/payment" } },
      });
      const { proxy } = readJson<{ proxy: { port: number } }>(mutated);
      expect(proxy.port).toBeGreaterThan(0);

      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port: proxy.port, path: `http://127.0.0.1:${upstreamPort}/api/payment`, method: "GET" },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
          },
        );
        req.on("error", reject);
        req.end();
      });

      expect(response.status).toBe(429);

      await client.callTool({ name: "agentguard_finish_run", arguments: { runId } });
    } finally {
      await new Promise((resolve) => upstream.close(resolve));
    }
  });

  it("PRD3 F12: tags an injected fault event 'harness' (the server injected it, not the agent) and a caller-supplied event with no provenance 'self-reported'", async () => {
    const start = await client.callTool({
      name: "agentguard_start_run",
      arguments: {
        task: "Do something.",
        events: [{ id: "ev-1", type: "tool_call", callId: "c1", tool: "add_todo", arguments: {}, timestamp: new Date().toISOString(), seq: 1 }],
      },
    });
    const { runId } = readJson<{ runId: string }>(start);
    await client.callTool({ name: "agentguard_mutate", arguments: { runId, fault: { type: "http", url: "/api/payment", status: 500 } } });

    const run = readJson<{ events: { type: string; provenance?: string }[] }>(await client.callTool({ name: "agentguard_get_run", arguments: { runId } }));
    const toolCallEvent = run.events.find((e) => e.type === "tool_call");
    const faultEvent = run.events.find((e) => e.type === "fault");
    expect(toolCallEvent?.provenance).toBe("self-reported");
    expect(faultEvent?.provenance).toBe("harness");

    await client.callTool({ name: "agentguard_finish_run", arguments: { runId } }); // stops the proxy this mutate started
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
