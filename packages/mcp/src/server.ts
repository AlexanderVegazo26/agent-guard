import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  AgentEvent,
  AgentIdentity,
  DefaultEvidenceCompiler,
  FaultSpec,
  defineConfig,
  type AgentRun,
  type AssertionId,
  type AssertionResult,
  type InjectedFault,
  type PolicyConfig,
} from "@agent-guard/core";
import { evaluate } from "@agent-guard/assertions";
import type { DecisionEngine } from "@agent-guard/decision";
import { buildReportV1FromRun } from "@agent-guard/reporters";

/**
 * PRD §32 — the AgentGuard MCP server. Exposes exactly the seven tools the
 * PRD names, no more:
 *
 *   agentguard_start_run, agentguard_get_run, agentguard_get_evidence,
 *   agentguard_assert, agentguard_mutate, agentguard_get_report,
 *   agentguard_finish_run
 *
 * **§32's security requirement, enforced by construction:** there is no
 * `agentguard_pass` tool, and no tool here accepts a caller-supplied verdict
 * for any field of `AssertionResult`. `agentguard_assert` is the only tool
 * that produces a verdict, and it always does so by calling the real
 * `evaluate()` pipeline (deterministic pre-pass → requirements → the
 * configured `DecisionEngine`) — an agent under test can ask AgentGuard
 * "did I pass?", but it cannot tell AgentGuard the answer.
 *
 * **One real deviation from a literal reading of PRD §32, documented like
 * `AgentGuardFixture`'s `observe()` factory deviation:** this server does
 * not itself capture tool calls off the wire — that's `ObservingTransport`
 * and `AgentGuardFixture`'s job for the Playwright/MCP-agent modes, and
 * `PlaywrightCliAdapter`'s for the CLI mode. This server's job is to expose
 * the run/evidence/assertion/mutation *lifecycle* to an MCP client (e.g. an
 * orchestrating agent building its own test harness), so `agentguard_start_run`
 * accepts an optional pre-built `events` array — a run captured elsewhere can
 * be registered here for the same assert/report/finish flow, rather than
 * requiring every event to arrive through this transport one call at a time.
 */
export interface AgentGuardMcpServerOptions {
  engine: DecisionEngine;
  policy?: PolicyConfig;
}

interface RunState {
  id: string;
  task: string;
  agent: z.infer<typeof AgentIdentity>;
  events: AgentEvent[];
  faults: InjectedFault[];
  startedAt: string;
  endedAt?: string;
  finalOutput?: string;
  lastDecisions?: Record<string, AssertionResult>;
}

let runCounter = 0;
function nextRunId(): string {
  runCounter += 1;
  return `mcp-run-${Date.now()}-${runCounter}`;
}

export class AgentGuardMcpServer {
  readonly server: McpServer;
  private readonly runs = new Map<string, RunState>();
  private readonly engine: DecisionEngine;
  private readonly policy: PolicyConfig;

  constructor(options: AgentGuardMcpServerOptions) {
    this.engine = options.engine;
    // PRD2 G0b: this constructor is synchronous, so it cannot itself
    // `await loadPolicyConfig()`. A launcher (once one exists — see PRD2
    // F7/G4, the MCP package currently has no `bin`) should call
    // `loadPolicyConfig()` itself and pass the result as `options.policy`;
    // this bare `defineConfig()` is only the fallback for a caller that
    // doesn't.
    this.policy = options.policy ?? defineConfig();
    this.server = new McpServer({ name: "agentguard", version: "0.1.0" });
    this.registerTools();
  }

  /** Test/inspection hook — not an MCP tool. */
  getRunState(runId: string): RunState | undefined {
    return this.runs.get(runId);
  }

  private requireRun(runId: string): RunState {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`agentguard: unknown run id "${runId}"`);
    return run;
  }

  private toAgentRun(state: RunState): AgentRun {
    return {
      id: state.id,
      task: state.task,
      agent: state.agent,
      events: state.events,
      finalOutput: state.finalOutput,
      faults: state.faults,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
      schemaVersion: 1,
    };
  }

  private registerTools(): void {
    this.server.tool(
      "agentguard_start_run",
      "Register a new agent run with AgentGuard, optionally pre-populated with events already captured elsewhere.",
      {
        task: z.string(),
        agent: AgentIdentity.optional(),
        events: z.array(z.unknown()).optional(),
      },
      async ({ task, agent, events }) => {
        // PRD2 review finding: `events` used to be cast straight to
        // `AgentEvent[]` with no validation — a malformed event (wrong
        // `seq` type, missing a discriminant field) reached the evidence
        // compiler and assertion pipeline before failing, with an
        // unhelpful stack trace instead of a clear tool error.
        let validatedEvents: AgentEvent[] = [];
        if (events && events.length > 0) {
          const parsed = z.array(AgentEvent).safeParse(events);
          if (!parsed.success) {
            return errorResult(`agentguard_start_run: invalid events — ${parsed.error.message}`);
          }
          // PRD3 F12 — an event arriving through this tool was authored by
          // the orchestrating agent's own tool call, not observed by
          // AgentGuard on a wire. Only fills in a missing provenance; a
          // caller that already tagged its own events (e.g. re-submitting
          // events an OTel importer produced) is not overridden.
          validatedEvents = parsed.data.map((e) => (e.provenance ? e : { ...e, provenance: "self-reported" as const }));
        }

        const id = nextRunId();
        this.runs.set(id, {
          id,
          task,
          agent: agent ?? { name: "mcp-observed-agent" },
          events: validatedEvents,
          faults: [],
          startedAt: new Date().toISOString(),
        });
        return jsonResult({ runId: id });
      },
    );

    this.server.tool(
      "agentguard_get_run",
      "Fetch the full recorded run (task, agent identity, events, faults) by run id.",
      { runId: z.string() },
      async ({ runId }) => jsonResult(this.toAgentRun(this.requireRun(runId))),
    );

    this.server.tool(
      "agentguard_get_evidence",
      "Compile a run's events into the evidence graph (items + links) used by assertions.",
      { runId: z.string() },
      async ({ runId }) => {
        const run = this.toAgentRun(this.requireRun(runId));
        const graph = await new DefaultEvidenceCompiler().compile(run);
        return jsonResult({ task: graph.task, items: graph.items, links: graph.links });
      },
    );

    this.server.tool(
      "agentguard_assert",
      "Evaluate one or more assertions against a run's evidence, using the real decision engine. This is the ONLY tool that produces a verdict — there is no way to submit a pass/fail directly.",
      { runId: z.string(), assertions: z.array(z.string()) },
      async ({ runId, assertions }) => {
        const state = this.requireRun(runId);
        const graph = await new DefaultEvidenceCompiler().compile(this.toAgentRun(state));
        const results = await evaluate(graph, assertions as AssertionId[], this.engine, this.policy);
        state.lastDecisions = { ...state.lastDecisions, ...results };
        return jsonResult(results);
      },
    );

    this.server.tool(
      "agentguard_mutate",
      "Inject an adversarial fault (HTTP fault or prompt injection) into a run's record, for adversarial/mutation testing (PRD §13).",
      { runId: z.string(), fault: FaultSpec },
      async ({ runId, fault }) => {
        const state = this.requireRun(runId);
        const faultId = `fault-${state.faults.length + 1}`;
        state.faults.push({ id: faultId, spec: fault });
        state.events.push({
          id: `ev-fault-${faultId}`,
          type: "fault",
          faultId,
          spec: fault,
          timestamp: new Date().toISOString(),
          seq: state.events.length + 1,
          // PRD3 F12 — the server injected this itself; not an observation
          // of the agent, and not something the agent reported either.
          provenance: "harness",
        });
        return jsonResult({ faultId });
      },
    );

    this.server.tool(
      "agentguard_get_report",
      "Fetch the ReportV1 (PRD3 F17) built from the most recent assertion results recorded for a run (from the last agentguard_assert call), or null if none has run yet.",
      { runId: z.string() },
      async ({ runId }) => {
        const state = this.requireRun(runId);
        if (!state.lastDecisions) return jsonResult(null);
        return jsonResult(buildReportV1FromRun(this.toAgentRun(state), state.lastDecisions));
      },
    );

    this.server.tool(
      "agentguard_finish_run",
      "Mark a run finished, recording its final output and end time.",
      { runId: z.string(), finalOutput: z.string().optional() },
      async ({ runId, finalOutput }) => {
        const state = this.requireRun(runId);
        state.finalOutput = finalOutput;
        state.endedAt = new Date().toISOString();
        return jsonResult(this.toAgentRun(state));
      },
    );
  }
}

function jsonResult(value: unknown): { content: { type: "text"; text: string }[] } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function errorResult(message: string): { content: { type: "text"; text: string }[]; isError: true } {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true };
}
