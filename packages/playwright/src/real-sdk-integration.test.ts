import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemRunStore, defineConfig } from "@agent-guard/core";
import { MockDecisionEngine } from "@agent-guard/decision";
import { AgentGuardFixture } from "./fixture.js";
import type { ObservableAgentFactory } from "./agent.js";

/**
 * Every other test in this package uses a hand-rolled fake `Transport`.
 * This one uses the REAL `@modelcontextprotocol/sdk` `Client`, `McpServer`
 * and `InMemoryTransport` — proving `ObservingTransport` works against the
 * SDK's actual protocol implementation (the real `initialize` handshake,
 * the real `tools/call` request/response framing), not just a hand-built
 * JSON-RPC message shape that merely resembles it. Still not a live LLM
 * agent or a live browser — the tool logic and the "agent"'s decision to
 * call it are still scripted — but it closes the gap between "the wrapper
 * matches the SDK's types" and "the wrapper works against the SDK itself."
 */
describe("AgentGuardFixture against the real MCP SDK (Client/McpServer/InMemoryTransport)", () => {
  let root: string;
  let store: FilesystemRunStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-real-sdk-test-"));
    store = new FilesystemRunStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("captures a tool_call/tool_result pair through the real SDK, and verify() passes", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    server.tool("add_todo", async () => ({ content: [{ type: "text", text: JSON.stringify({ id: "t1" }) }] }));

    const factory: ObservableAgentFactory = (wrap) => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const observedTransport = wrap(clientTransport);
      const client = new Client({ name: "test-client", version: "1.0.0" });

      return {
        run: async () => {
          await server.connect(serverTransport);
          await client.connect(observedTransport);
          await client.callTool({ name: "add_todo", arguments: { text: "Buy milk" } });
          return { finalOutput: "Added Buy milk to the list." };
        },
      };
    };

    const engine = new MockDecisionEngine({
      "toolWasAppropriate::e-ev-1": {
        type: "choice",
        choice: "appropriate",
        confidence: 0.9,
        probabilities: { appropriate: 0.9, unnecessary: 0.03, "wrong-tool": 0.04, "wrong-target": 0.03 },
      },
    });
    const fixture = new AgentGuardFixture("real-sdk-run", engine, store, defineConfig());

    const agent = fixture.observe(factory);
    await agent.run("Add 'Buy milk' to the todo list.");

    await expect(fixture.verify({ assertions: ["toolWasAppropriate"] })).resolves.toBeUndefined();

    const decisions = await store.loadDecisions("real-sdk-run");
    expect(decisions!.toolWasAppropriate!.status).toBe("pass");

    const evidence = await store.loadEvidence("real-sdk-run");
    const toolCall = evidence!.items.find((e) => e.type === "tool_call");
    expect(toolCall).toMatchObject({ content: { tool: "add_todo", arguments: { text: "Buy milk" } } });
    const toolResult = evidence!.items.find((e) => e.type === "tool_result");
    expect((toolResult!.content as { success: boolean }).success).toBe(true);

    await fixture.dispose();
  });

  it("records success:false when the real server's tool handler reports isError", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    server.tool("submit_payment", async () => ({
      content: [{ type: "text", text: "Internal Server Error" }],
      isError: true,
    }));

    const factory: ObservableAgentFactory = (wrap) => {
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const observedTransport = wrap(clientTransport);
      const client = new Client({ name: "test-client", version: "1.0.0" });

      return {
        run: async () => {
          await server.connect(serverTransport);
          await client.connect(observedTransport);
          await client.callTool({ name: "submit_payment", arguments: {} });
          return { finalOutput: "Payment completed successfully." };
        },
      };
    };

    const engine = new MockDecisionEngine({});
    const fixture = new AgentGuardFixture("real-sdk-run-2", engine, store, defineConfig());

    const agent = fixture.observe(factory);
    await agent.run("Purchase the item.");

    // `noFabricatedCompletion` resolves to `review` (structural-gap — no
    // network evidence exists in an MCP-only run) without ever reaching the
    // mock engine, which is why this doesn't need a scripted answer. That
    // also keeps `verify()` from throwing: `review` without
    // `ci.reviewAsFailure` doesn't fail the run. This just exercises
    // persistence so the captured evidence can be inspected directly.
    await fixture.verify({ assertions: ["noFabricatedCompletion"] });

    const evidence = await store.loadEvidence("real-sdk-run-2");
    const toolResult = evidence!.items.find((e) => e.type === "tool_result");
    expect((toolResult!.content as { success: boolean }).success).toBe(false);

    await fixture.dispose();
  });
});
