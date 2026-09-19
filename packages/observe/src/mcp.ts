import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { evaluateGuard, type GuardPolicy, type GuardResult } from "./guard.js";

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

/**
 * PRD2 F3 — a tool's own definition, captured from an MCP `tools/list`
 * response. This is the evidence source a description-based prompt
 * injection (an instruction hidden in the description text the agent
 * reads, not in page content) needs — invisible to `tool_call`/
 * `tool_result` capture, which only ever sees the tool being *used*.
 */
export interface CapturedToolDefinition {
  kind: "tool_definition";
  tool: string;
  description?: string;
  inputSchema?: unknown;
}

/** PRD2 F2 — the online guard's own decision on an outbound tool call, recorded as an event regardless of what it decided. */
export interface CapturedGuardDecision {
  kind: "guard_decision";
  tool: string;
  arguments: unknown;
  decision: GuardResult["decision"];
  reason: string;
  callId: string;
}

export type CapturedEvent = CapturedToolCall | CapturedToolResult | CapturedToolDefinition | CapturedGuardDecision;
export type EventSink = (event: CapturedEvent) => void;

interface ToolCallRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: "tools/call";
  params: { name: string; arguments?: unknown };
}

interface ToolsListRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: "tools/list";
}

function isToolCallRequest(message: JSONRPCMessage): message is ToolCallRequest {
  return (
    "method" in message &&
    (message as { method?: unknown }).method === "tools/call" &&
    "id" in message &&
    "params" in message
  );
}

function isToolsListRequest(message: JSONRPCMessage): message is ToolsListRequest {
  return "method" in message && (message as { method?: unknown }).method === "tools/list" && "id" in message;
}

function isResponseLike(message: JSONRPCMessage): boolean {
  return "id" in message && ("result" in message || "error" in message) && !("method" in message);
}

export interface ObservingTransportOptions {
  /**
   * PRD2 F2 — when provided, every outbound `tools/call` is checked
   * against this policy before being forwarded. Omitted (the default):
   * pure pass-through, exactly the behavior this transport had before
   * the guard existed — TRD §4.2's "the observer records; it never
   * filters, interprets or decides" describes the no-guard case, and
   * remains true for anyone who doesn't opt in.
   */
  guard?: GuardPolicy;
}

/**
 * Wraps an existing MCP `Transport`. Every `send()` (outbound) and every
 * `onmessage` delivery (inbound) passes through unchanged to the wrapped
 * transport / the caller's own handler by default — TRD §4.2: "the
 * observer records; it never filters, interprets or decides." Passing a
 * `guard` policy is the one deliberate exception PRD2 F2 adds: a blocked
 * or review-flagged tool call never reaches the real transport at all,
 * and the caller gets a real JSON-RPC error response instead of a
 * fabricated success — the reliability floor (PRD v0.6 §10.4) applies to
 * the guard exactly as it does to the decision engine: unable to
 * confidently allow means block, never a silent pass.
 */
export class ObservingTransport implements Transport {
  private readonly pendingCalls = new Map<string, { tool: string; arguments: unknown }>();
  private readonly pendingListRequests = new Set<string>();
  private readonly guardPolicy: GuardPolicy | undefined;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  constructor(
    private readonly inner: Transport,
    private readonly sink: EventSink,
    options: ObservingTransportOptions = {},
  ) {
    this.guardPolicy = options.guard;
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
    if (this.guardPolicy && isToolCallRequest(message)) {
      const result = evaluateGuard(message.params.name, message.params.arguments, this.guardPolicy);
      if (result.decision !== "allow") {
        this.blockOutbound(message, result);
        return;
      }
    }
    this.observeOutbound(message);
    return this.inner.send(message, options);
  }

  /**
   * The call never reaches `this.inner` (the real transport/server) —
   * that's the whole point. The caller still needs *some* response, or
   * their `client.callTool()` promise hangs forever, so a real JSON-RPC
   * error is synthesized and delivered the same way a real response
   * would arrive: via `onmessage`, on a fresh microtask rather than
   * synchronously inside `send()` (the caller may not have finished
   * registering its response handler for this call yet).
   */
  private blockOutbound(message: { id: string | number; params: { name: string; arguments?: unknown } }, result: GuardResult): void {
    const callId = String(message.id);
    this.sink({
      kind: "guard_decision",
      tool: message.params.name,
      arguments: message.params.arguments,
      decision: result.decision,
      reason: result.reason,
      callId,
    });

    const errorResponse = {
      jsonrpc: "2.0" as const,
      id: message.id,
      error: { code: -32000, message: `Blocked by AgentGuard (${result.decision}): ${result.reason}` },
    };
    queueMicrotask(() => this.onmessage?.(errorResponse as JSONRPCMessage));
  }

  async close(): Promise<void> {
    return this.inner.close();
  }

  private observeOutbound(message: JSONRPCMessage): void {
    if (isToolsListRequest(message)) {
      this.pendingListRequests.add(String(message.id));
      return;
    }
    if (!isToolCallRequest(message)) return;
    const callId = String(message.id);
    this.pendingCalls.set(callId, { tool: message.params.name, arguments: message.params.arguments });
    this.sink({ kind: "tool_call", callId, tool: message.params.name, arguments: message.params.arguments });
  }

  private observeInbound(message: JSONRPCMessage): void {
    if (!isResponseLike(message)) return;
    const response = message as { id: string | number; result?: unknown; error?: unknown };
    const responseId = String(response.id);

    if (this.pendingListRequests.has(responseId)) {
      this.pendingListRequests.delete(responseId);
      this.observeToolsListResponse(response.result);
      return;
    }

    const callId = responseId;
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

  /**
   * PRD2 F3 — a `tools/list` response's shape (verified against the SDK's
   * own `ListToolsResultSchema`): `{ tools: [{ name, description?,
   * inputSchema }] }`. Emits one `tool_definition` per tool. Malformed or
   * unexpected shapes are ignored rather than thrown — this is passive
   * observation (TRD §4.2), never a reason to break the agent's own
   * traffic.
   */
  private observeToolsListResponse(result: unknown): void {
    const tools = (result as { tools?: unknown } | undefined)?.tools;
    if (!Array.isArray(tools)) return;
    for (const tool of tools) {
      if (tool === null || typeof tool !== "object" || typeof (tool as { name?: unknown }).name !== "string") continue;
      const { name, description, inputSchema } = tool as { name: string; description?: unknown; inputSchema?: unknown };
      this.sink({
        kind: "tool_definition",
        tool: name,
        description: typeof description === "string" ? description : undefined,
        inputSchema,
      });
    }
  }
}
