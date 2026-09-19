import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * §4.1 — MCP interception sits at the transport, not at the agent's
 * application code: a wrapping transport that forwards every JSON-RPC
 * message in both directions, recording as it goes. The agent under test
 * is unmodified and unaware (PRD §9.2, "wrap the tool layer").
 *
 * Scope: this captures `tools/call` requests and their matching responses
 * — the mapping verified against the SDK's own `Transport`/`JSONRPCMessage`
 * type declarations (`@modelcontextprotocol/sdk@1.30.0`). It does not
 * capture agent utterances that never cross this transport (an agent's own
 * text output is typically a separate LLM-completion channel, not MCP
 * traffic) — TRD §4.1's "agent messages" column item is only covered here
 * to the extent an agent SDK routes them through MCP itself, which this
 * build does not assume.
 */

export interface CapturedToolCall {
  kind: "tool_call";
  callId: string;
  tool: string;
  arguments: unknown;
}

export interface CapturedToolResult {
  kind: "tool_result";
  callId: string;
  success: boolean;
  result: unknown;
}

export type CapturedEvent = CapturedToolCall | CapturedToolResult;
export type EventSink = (event: CapturedEvent) => void;

interface ToolCallRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: "tools/call";
  params: { name: string; arguments?: unknown };
}

function isToolCallRequest(message: JSONRPCMessage): message is ToolCallRequest {
  return (
    "method" in message &&
    (message as { method?: unknown }).method === "tools/call" &&
    "id" in message &&
    "params" in message
  );
}

function isResponseLike(message: JSONRPCMessage): boolean {
  return "id" in message && ("result" in message || "error" in message) && !("method" in message);
}

/**
 * Wraps an existing MCP `Transport`. Every `send()` (outbound) and every
 * `onmessage` delivery (inbound) passes through unchanged to the wrapped
 * transport / the caller's own handler — this is a pass-through, not a
 * proxy that can drop or alter traffic (TRD §4.2: "the observer records;
 * it never filters, interprets or decides").
 */
export class ObservingTransport implements Transport {
  private readonly pendingCalls = new Map<string, { tool: string; arguments: unknown }>();

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  constructor(
    private readonly inner: Transport,
    private readonly sink: EventSink,
  ) {
    this.inner.onmessage = (message, extra) => {
      this.observeInbound(message);
      this.onmessage?.(message, extra);
    };
    this.inner.onclose = () => this.onclose?.();
    this.inner.onerror = (error) => this.onerror?.(error);
  }

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }

  async start(): Promise<void> {
    return this.inner.start();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    this.observeOutbound(message);
    return this.inner.send(message, options);
  }

  async close(): Promise<void> {
    return this.inner.close();
  }

  private observeOutbound(message: JSONRPCMessage): void {
    if (!isToolCallRequest(message)) return;
    const callId = String(message.id);
    this.pendingCalls.set(callId, { tool: message.params.name, arguments: message.params.arguments });
    this.sink({ kind: "tool_call", callId, tool: message.params.name, arguments: message.params.arguments });
  }

  private observeInbound(message: JSONRPCMessage): void {
    if (!isResponseLike(message)) return;
    const response = message as { id: string | number; result?: unknown; error?: unknown };
    const callId = String(response.id);
    const call = this.pendingCalls.get(callId);
    if (!call) return; // a response to something other than a tool call we're tracking
    this.pendingCalls.delete(callId);
    // Two distinct error shapes: a JSON-RPC-level `error` (the request
    // itself failed), or MCP's own `CallToolResult.isError: true` (the
    // request succeeded at the protocol level, but the tool execution
    // itself failed) — both must map to `success: false`.
    const jsonRpcError = response.error !== undefined;
    const toolExecutionError = (response.result as { isError?: boolean } | undefined)?.isError === true;
    const isError = jsonRpcError || toolExecutionError;
    this.sink({ kind: "tool_result", callId, success: !isError, result: isError ? (response.error ?? response.result) : response.result });
  }
}
