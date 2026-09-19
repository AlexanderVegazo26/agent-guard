import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { describe, expect, it } from "vitest";
import { ObservingTransport, type CapturedEvent } from "./mcp.js";

/**
 * A minimal in-memory pair of linked transports simulating a real MCP
 * client/server connection: whatever one side `send()`s, the other side
 * receives via `onmessage`. No live agent or process boundary is needed —
 * this is exactly the shape a real `StdioClientTransport`/`Server` pair
 * has from the wrapper's point of view.
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

describe("ObservingTransport", () => {
  it("records a tool_call event on outbound tools/call, and forwards it unchanged to the inner transport", async () => {
    const [client, server] = createLinkedPair();
    const events: CapturedEvent[] = [];
    const observed = new ObservingTransport(client, (e) => events.push(e));

    let receivedByServer: JSONRPCMessage | undefined;
    server.onmessage = (m) => {
      receivedByServer = m;
    };

    const request: JSONRPCMessage = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "add_todo", arguments: { text: "Buy milk" } },
    };
    await observed.send(request);

    expect(events).toEqual([{ kind: "tool_call", callId: "1", tool: "add_todo", arguments: { text: "Buy milk" } }]);
    expect(receivedByServer).toEqual(request); // pass-through, unaltered
  });

  it("records a matching tool_result on the inbound response, correlated by id", async () => {
    const [client, server] = createLinkedPair();
    const events: CapturedEvent[] = [];
    const observed = new ObservingTransport(client, (e) => events.push(e));

    let receivedByCaller: JSONRPCMessage | undefined;
    observed.onmessage = (m) => {
      receivedByCaller = m;
    };

    await observed.send({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "delete_todo", arguments: { id: "t1" } } });

    const response: JSONRPCMessage = { jsonrpc: "2.0", id: 42, result: { content: [{ type: "text", text: "deleted" }] } };
    server.onmessage = undefined; // server doesn't need to react
    client.onmessage!(response); // simulate the response arriving from the server

    expect(events).toEqual([
      { kind: "tool_call", callId: "42", tool: "delete_todo", arguments: { id: "t1" } },
      { kind: "tool_result", callId: "42", success: true, result: { content: [{ type: "text", text: "deleted" }] } },
    ]);
    expect(receivedByCaller).toEqual(response); // still passed through to the real handler
  });

  it("records a tool_result with success:false when the response is a JSON-RPC error", async () => {
    const [client] = createLinkedPair();
    const events: CapturedEvent[] = [];
    const observed = new ObservingTransport(client, (e) => events.push(e));

    await observed.send({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "submit_payment", arguments: {} } });
    client.onmessage!({ jsonrpc: "2.0", id: 7, error: { code: -32000, message: "upstream failure" } });

    expect(events[1]).toEqual({
      kind: "tool_result",
      callId: "7",
      success: false,
      result: { code: -32000, message: "upstream failure" },
    });
  });

  it("records success:false for MCP's own CallToolResult.isError — a JSON-RPC SUCCESS response whose tool execution failed", async () => {
    // Per the MCP spec, a failed tool call is still a JSON-RPC success
    // response (no top-level `error`) — the failure is `result.isError`.
    const [client] = createLinkedPair();
    const events: CapturedEvent[] = [];
    const observed = new ObservingTransport(client, (e) => events.push(e));

    await observed.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "submit_payment", arguments: {} } });
    client.onmessage!({
      jsonrpc: "2.0",
      id: 3,
      result: { content: [{ type: "text", text: "Internal Server Error" }], isError: true },
    });

    expect(events[1]).toEqual({
      kind: "tool_result",
      callId: "3",
      success: false,
      result: { content: [{ type: "text", text: "Internal Server Error" }], isError: true },
    });
  });

  it("ignores a response that doesn't correlate to a tracked tool call", async () => {
    const [client] = createLinkedPair();
    const events: CapturedEvent[] = [];
    new ObservingTransport(client, (e) => events.push(e));

    // A response to some other, untracked request (e.g. "initialize").
    client.onmessage!({ jsonrpc: "2.0", id: 999, result: { protocolVersion: "2025-06-18" } });

    expect(events).toEqual([]);
  });

  it("forwards onclose and onerror callbacks from the inner transport", async () => {
    const [client] = createLinkedPair();
    const observed = new ObservingTransport(client, () => {});

    let closed = false;
    let seenError: Error | undefined;
    observed.onclose = () => {
      closed = true;
    };
    observed.onerror = (e) => {
      seenError = e;
    };

    client.onclose?.();
    client.onerror?.(new Error("boom"));

    expect(closed).toBe(true);
    expect(seenError?.message).toBe("boom");
  });

  it("does not intercept a non-tools/call request (e.g. resources/list)", async () => {
    const [client, server] = createLinkedPair();
    const events: CapturedEvent[] = [];
    const observed = new ObservingTransport(client, (e) => events.push(e));

    let receivedByServer: JSONRPCMessage | undefined;
    server.onmessage = (m) => {
      receivedByServer = m;
    };

    const request: JSONRPCMessage = { jsonrpc: "2.0", id: 1, method: "resources/list", params: {} };
    await observed.send(request);

    expect(events).toEqual([]);
    expect(receivedByServer).toEqual(request);
  });
});

// Type-only sanity check that the wrapper actually implements the SDK's
// Transport interface (would fail to compile otherwise).
function _typeCheck(t: Transport, opts?: TransportSendOptions): void {
  void t.send({ jsonrpc: "2.0", id: 1, method: "x", params: {} }, opts);
}
