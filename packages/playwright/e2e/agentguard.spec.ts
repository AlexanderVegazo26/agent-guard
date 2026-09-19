import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { MockDecisionEngine } from "@agent-guard/decision";
import { test, expect } from "../dist/index.js";
import type { ObservableAgentFactory } from "../dist/index.js";

/**
 * Runs through the REAL `@playwright/test` CLI runner (`playwright test`),
 * proving `test.extend()`'s fixture wiring — worker-scoped options, per-test
 * teardown — works end to end, not just the `AgentGuardFixture` class in
 * isolation (that's `src/fixture.test.ts`, under Vitest). No browser
 * project is configured; this suite never touches `page`.
 */

function createLinkedPair(): [Transport, Transport] {
  const a: Transport = {
    async start() {},
    async send(message) {
      b.onmessage?.(message);
    },
    async close() {},
  };
  const b: Transport = {
    async start() {},
    async send(message) {
      a.onmessage?.(message);
    },
    async close() {},
  };
  return [a, b];
}

const happyPathAgent: ObservableAgentFactory = (wrap) => {
  const [clientTransport, serverTransport] = createLinkedPair();
  const observed = wrap(clientTransport);

  serverTransport.onmessage = (message: JSONRPCMessage) => {
    if (!("method" in message) || message.method !== "tools/call") return;
    void serverTransport.send({ jsonrpc: "2.0", id: (message as { id: string | number }).id, result: { id: "t1" } });
  };

  return {
    run: async () => {
      await new Promise<void>((resolve) => {
        observed.onmessage = () => resolve();
        void observed.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_todo", arguments: { text: "Buy milk" } } });
      });
      return { finalOutput: "Added Buy milk to the list." };
    },
  };
};

test.use({
  agentGuardEngine: new MockDecisionEngine({ goalCompleted: { type: "noul", noul: 0.95 } }),
});

test("agentguard fixture observes a tool call and verifies a passing run", async ({ agentguard }) => {
  const agent = agentguard.observe(happyPathAgent);
  await agent.run("Add 'Buy milk' to the todo list.");
  await agentguard.verify({ assertions: ["goalCompleted"] });
});

test.describe("with a scripted failing engine", () => {
  test.use({
    agentGuardEngine: new MockDecisionEngine({ goalCompleted: { type: "noul", noul: 0.05 } }),
  });

  test("verify() throws when the scripted verdict is FAIL", async ({ agentguard }) => {
    const agent = agentguard.observe(happyPathAgent);
    await agent.run("Add 'Buy milk' to the todo list.");
    await expect(agentguard.verify({ assertions: ["goalCompleted"] })).rejects.toThrow(/verification failed/);
  });
});
