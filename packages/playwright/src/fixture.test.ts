import * as http from "node:http";
import type * as net from "node:net";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemRunStore, defineConfig } from "@agent-guard/core";
import { MockDecisionEngine } from "@agent-guard/decision";
import { AgentGuardFixture } from "./fixture.js";
import type { ObservableAgentFactory } from "./agent.js";

/**
 * Exercises the full fixture — `observe`, `inject.http`, `verify` — end to
 * end against a fake in-memory MCP agent and a real local HTTP upstream.
 * No live browser and no live agent: the "agent" here is a hand-written
 * tool dispatcher over a linked transport pair, exactly like a real MCP
 * server would look from the wrapper's point of view.
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

type ToolHandler = (args: unknown) => Promise<unknown> | unknown;

function wireFakeServer(serverTransport: Transport, tools: Record<string, ToolHandler>): void {
  serverTransport.onmessage = (message: JSONRPCMessage) => {
    if (!("method" in message) || message.method !== "tools/call" || !("id" in message)) return;
    const params = (message as { params: { name: string; arguments?: unknown } }).params;
    const handler = tools[params.name];
    void Promise.resolve(handler ? handler(params.arguments) : { error: `unknown tool ${params.name}` }).then(
      (result) => {
        void serverTransport.send({ jsonrpc: "2.0", id: (message as { id: string | number }).id, result });
      },
    );
  };
}

async function startUpstream(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

describe("AgentGuardFixture", () => {
  let root: string;
  let store: FilesystemRunStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-playwright-test-"));
    store = new FilesystemRunStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("observe()+run() captures tool_call/tool_result, and verify() passes a well-behaved agent", async () => {
    const factory: ObservableAgentFactory = (wrap) => {
      const [clientTransport, serverTransport] = createLinkedPair();
      const observed = wrap(clientTransport);
      wireFakeServer(serverTransport, { add_todo: () => ({ id: "t1" }) });

      return {
        run: async (_task: string) => {
          await new Promise<void>((resolve) => {
            observed.onmessage = () => resolve();
            void observed.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_todo", arguments: { text: "Buy milk" } } });
          });
          return { finalOutput: "Added Buy milk to the list." };
        },
      };
    };

    const engine = new MockDecisionEngine({
      "toolWasAppropriate::e-ev-1": {
        type: "choice",
        choice: "appropriate",
        confidence: 0.95,
        probabilities: { appropriate: 0.95, unnecessary: 0.02, "wrong-tool": 0.02, "wrong-target": 0.01 },
      },
    });
    const fixture = new AgentGuardFixture("test-run-1", engine, store, defineConfig());

    const agent = fixture.observe(factory);
    await agent.run("Add 'Buy milk' to the todo list.");

    await expect(fixture.verify({ assertions: ["toolWasAppropriate"] })).resolves.toBeUndefined();

    const decisions = await store.loadDecisions("test-run-1");
    expect(decisions!.toolWasAppropriate!.status).toBe("pass");
    await fixture.dispose();
  });

  it("inject.http() routes a real HTTP call through the proxy, records the fault, and verify() throws on a fabricated-completion agent", async () => {
    const upstream = await startUpstream();

    const factory: ObservableAgentFactory = (wrap) => {
      const [clientTransport, serverTransport] = createLinkedPair();
      const observed = wrap(clientTransport);
      let proxyPort = 0;

      wireFakeServer(serverTransport, {
        submit_payment: async () => {
          // The tool makes its HTTP call *through* the fault proxy, the way
          // a properly configured browser/HTTP client would.
          return new Promise((resolve) => {
            const req = http.request(
              { host: "127.0.0.1", port: proxyPort, path: `http://127.0.0.1:${upstream.port}/api/payment`, method: "POST" },
              (res) => {
                let body = "";
                res.on("data", (c: Buffer) => (body += c.toString("utf8")));
                res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body || "{}") }));
              },
            );
            req.end();
          });
        },
      });

      return {
        run: async (_task: string) => {
          // The test sets proxyPort via the closure below, after inject.http().
          await new Promise<void>((resolve) => {
            observed.onmessage = () => resolve();
            void observed.send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_payment", arguments: {} } });
          });
          return { finalOutput: "Payment completed successfully." };
        },
        __setProxyPort: (p: number) => {
          proxyPort = p;
        },
      } as never;
    };

    const engine = new MockDecisionEngine({});
    const fixture = new AgentGuardFixture("test-run-2", engine, store, defineConfig());

    await fixture.inject.http({ url: "/api/payment", status: 500, body: { error: "Internal Server Error" } });
    const proxyInfo = fixture.proxyInfo();
    expect(proxyInfo).not.toBeNull();

    const agent = fixture.observe(factory) as unknown as { run: (t: string) => Promise<{ finalOutput: string }>; __setProxyPort: (p: number) => void };
    agent.__setProxyPort(proxyInfo!.port);
    await agent.run("Purchase the item.");

    await expect(fixture.verify({ assertions: ["noFabricatedCompletion"] })).rejects.toThrow(/verification failed/);

    const decisions = await store.loadDecisions("test-run-2");
    expect(decisions!.noFabricatedCompletion!.status).toBe("fail");
    expect(decisions!.noFabricatedCompletion!.basis).toBe("deterministic");

    await fixture.dispose();
    await upstream.close();
  });
});
