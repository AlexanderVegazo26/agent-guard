#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadPolicyConfig } from "@alexvegman/core";
import {
  JevDecisionEngine,
  type DecisionEngine,
  type DecisionResult,
  type DecisionState,
  type EngineCapabilities,
  type QuestionSet,
} from "@alexvegman/decision";
import { AgentGuardMcpServer } from "./server.js";

/**
 * `new JevDecisionEngine()` constructs the SDK client eagerly, which
 * throws synchronously when `TYPESAFE_API_KEY` is unset — confirmed by
 * hand: launching the server without a key crashed on startup before it
 * ever registered a single tool. That's wrong for a server whose other
 * six tools (start/get_run/get_evidence/mutate/get_report/finish_run)
 * need no engine at all — only `agentguard_assert` does. This defers
 * construction (and therefore the missing-key error) until the moment an
 * engine method is actually called, mirroring the CLI's own `--live`
 * lazy-construction pattern elsewhere in this codebase.
 */
class LazyJevDecisionEngine implements DecisionEngine {
  private engine: JevDecisionEngine | null = null;

  private get(): JevDecisionEngine {
    this.engine ??= new JevDecisionEngine();
    return this.engine;
  }

  capabilities(): EngineCapabilities {
    return this.get().capabilities();
  }

  async decide(state: DecisionState, questions: QuestionSet): Promise<DecisionResult> {
    return this.get().decide(state, questions);
  }
}

/**
 * PRD2 G4 — the launcher this package never had. Registers AgentGuard's
 * seven lifecycle tools (`agentguard_start_run`, `agentguard_get_run`,
 * `agentguard_get_evidence`, `agentguard_assert`, `agentguard_mutate`,
 * `agentguard_get_report`, `agentguard_finish_run` — server.ts) with an
 * MCP client over stdio, exactly the way any other MCP server is
 * registered (a client's own config, an orchestrating agent's tool
 * config). Before this file existed, `@alexvegman/mcp` had no `bin` and
 * no transport, so there was no way to actually run it.
 *
 * Loads `agentguard.config.ts` the same way every other entry point does
 * (PRD2 G0b) rather than the bare `defineConfig()` default the
 * `AgentGuardMcpServer` constructor falls back to when no policy is
 * passed in.
 */
async function main(): Promise<void> {
  const { policy, configPath } = await loadPolicyConfig();
  // stdio is the wire protocol here — every diagnostic line must go to
  // stderr. A stray console.log on stdout would corrupt the JSON-RPC
  // framing the connected client is parsing.
  if (configPath) console.error(`agentguard-mcp: using config ${configPath}`);

  const server = new AgentGuardMcpServer({ engine: new LazyJevDecisionEngine(), policy });
  const transport = new StdioServerTransport();
  await server.server.connect(transport);

  console.error("agentguard-mcp: connected over stdio");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 3;
});
