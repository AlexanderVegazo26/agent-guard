import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * PRD §9.1's illustrated `agentguard.observe(myAgent)` takes an
 * already-constructed agent. That only works generically if the agent's
 * SDK exposes a transport property AgentGuard can swap before the agent
 * ever uses it — not a capability every agent SDK has (TRD §12: "MCP
 * transport wrapping across SDKs ... an agent that constructs its
 * transport internally may not be wrappable without modification").
 *
 * This build resolves that open question with a **factory** contract
 * instead: the caller hands AgentGuard a function that builds the agent
 * given a `wrap` callback, and calls `wrap(realTransport)` on whatever
 * real transport their own SDK requires (stdio, SSE, in-memory — agent-
 * specific and not something AgentGuard can construct generically) to get
 * back the *observed* transport to actually connect their MCP client
 * with. Wrapping is structural, not cooperative: the returned agent is
 * guaranteed to route every tool call through the observer by
 * construction, because it never sees the unwrapped transport. Adapting
 * an existing agent to this shape is the integration cost PRD §9.2 already
 * prices in for "wrap the tool layer" mode.
 */
export interface RunResult {
  finalOutput: string;
}

export interface ObservableAgent {
  run(task: string): Promise<RunResult>;
}

export type TransportWrapper = (transport: Transport) => Transport;

export type ObservableAgentFactory<T extends ObservableAgent = ObservableAgent> = (wrap: TransportWrapper) => T;
