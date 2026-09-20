import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CaptureSink,
  DefaultEvidenceCompiler,
  DefaultRedactor,
  computeExitCode,
  formatConsole,
  languageAdvisory,
  type AgentEvent,
  type AgentRun,
  type AssertionId,
  type AssertionResult,
  type FaultSpec,
  type FilesystemRunStore,
  type InjectedFault,
  type PolicyConfig,
  type Redactor,
} from "@agent-guard/core";
import { evaluate } from "@agent-guard/assertions";
import type { DecisionEngine } from "@agent-guard/decision";
import { HttpFaultProxy, ObservingTransport, type CapturedEvent, type FaultProxy, type GuardPolicy } from "@agent-guard/observe";
import type { ObservableAgent, ObservableAgentFactory } from "./agent.js";

export interface HttpFaultInjection {
  url: string;
  status: number;
  body?: unknown;
  times?: number;
}

export interface PromptInjectionFaultInjection {
  url: string;
  field: string;
  payload: string;
}

export interface VerifyOptions {
  assertions: AssertionId[];
}

type EventDraft =
  | { type: "tool_call"; callId: string; tool: string; arguments: unknown }
  | { type: "tool_result"; callId: string; success: boolean; result: unknown }
  | {
      type: "network";
      method: string;
      url: string;
      status?: number;
      timingMs?: number;
      requestHeaders?: Record<string, string>;
      responseHeaders?: Record<string, string>;
      requestBody?: unknown;
      responseBody?: unknown;
      bodyTruncated?: boolean;
      error?: string;
    }
  | { type: "fault"; faultId: string; spec: FaultSpec }
  | { type: "tool_definition"; tool: string; description?: string; inputSchema?: unknown }
  | { type: "guard_decision"; tool: string; arguments: unknown; decision: "allow" | "block" | "review"; reason: string; callId?: string };

/**
 * PRD §9.1 — the `agentguard` test fixture. `observe()` wraps the agent's
 * MCP transport (TRD §4.1); `inject` drives the fault proxy (§7); `verify`
 * compiles everything into an `AgentRun`, evaluates it, persists it (§10.1),
 * and — this is the part that makes it a *test* fixture and not just a
 * library call — throws when the verdict is FAIL or an infrastructure
 * ERROR, so the surrounding Playwright test fails for the right reason
 * (PRD §10.4: an unavailable/erroring engine must never read as a pass).
 */
export class AgentGuardFixture {
  private readonly sink: CaptureSink<EventDraft, AgentEvent>;
  private readonly faultRecords: InjectedFault[] = [];
  private readonly startedAt = new Date().toISOString();
  private proxy: FaultProxy | null = null;
  private drainedProxyEventCount = 0;
  private task = "";
  private finalOutput = "";

  readonly inject = {
    http: async (spec: HttpFaultInjection): Promise<void> => {
      await this.ensureProxyStarted();
      const fullSpec: FaultSpec = { type: "http", url: spec.url, status: spec.status, body: spec.body, times: spec.times };
      this.recordFault(fullSpec);
    },
    promptInjection: async (spec: PromptInjectionFaultInjection): Promise<void> => {
      await this.ensureProxyStarted();
      const fullSpec: FaultSpec = { type: "prompt-injection", url: spec.url, field: spec.field, payload: spec.payload };
      this.recordFault(fullSpec);
    },
  };

  constructor(
    private readonly runId: string,
    private readonly engine: DecisionEngine,
    private readonly store: FilesystemRunStore,
    private readonly policy: PolicyConfig,
    // PRD2 G0a: every event captured through this fixture — tool calls,
    // tool results, and the network events drained from the fault proxy —
    // used to reach `this.events` (and from there, disk) with no
    // redaction applied. Defaults to a plain `DefaultRedactor()`.
    redactor: Redactor = new DefaultRedactor(),
  ) {
    this.sink = new CaptureSink({
      redactor,
      // PRD3 F12 — every draft here except "fault" is genuinely observed
      // (the wrapped MCP transport or the fault proxy), never narrated by
      // the agent under test. "fault" is AgentGuard's own synthetic
      // injection — harness-authored, not an observation of the agent.
      envelope: (draft, seq) => ({
        id: `ev-${seq}`,
        timestamp: new Date().toISOString(),
        seq,
        provenance: draft.type === "fault" ? "harness" : "wire",
        ...draft,
      }) as AgentEvent,
    });
  }

  /** Where a real integration points a browser's proxy launch option / CA trust once a fault has been injected. */
  proxyInfo(): { port: number; caCert?: Buffer } | null {
    return this.startedProxyInfo;
  }
  private startedProxyInfo: { port: number; caCert?: Buffer } | null = null;

  /**
   * `options.guard` (PRD2 F2) wires the online guard's deterministic
   * pre-action policy into the wrapped MCP transport: a blocked or
   * review-flagged tool call never reaches the real transport, and the
   * decision is recorded as a `guard_decision` event regardless. Omitted
   * (the default): pure observation, unchanged from before F2 existed.
   */
  observe<T extends ObservableAgent>(factory: ObservableAgentFactory<T>, options: { guard?: GuardPolicy } = {}): T {
    const agent = factory((transport: Transport) => new ObservingTransport(transport, (e) => this.recordCaptured(e), { guard: options.guard }));
    const observed = { ...agent };
    observed.run = async (task: string) => {
      this.task = task;
      const result = await agent.run(task);
      this.drainProxyEvents();
      this.finalOutput = result.finalOutput;
      return result;
    };
    return observed;
  }

  async verify(options: VerifyOptions): Promise<void> {
    this.drainProxyEvents();

    const run: AgentRun = {
      id: this.runId,
      task: this.task,
      agent: { name: "observed-agent" },
      events: this.sink.all(),
      finalOutput: this.finalOutput,
      faults: this.faultRecords,
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      schemaVersion: 1,
    };

    const graph = await new DefaultEvidenceCompiler().compile(run);
    const results = await evaluate(graph, options.assertions, this.engine, this.policy);
    console.log(formatConsole(this.runId, results));
    const advisory = languageAdvisory(graph);
    if (advisory) console.log(`\n  ${advisory}`);

    await this.persist(run, graph, results);

    const exitCode = computeExitCode(results);
    if (exitCode === 1 || exitCode === 3) {
      throw new Error(`AgentGuard verification failed for "${run.id}" (exit ${exitCode}) — see the console report above.`);
    }
    if (exitCode === 2 && this.policy.ci.reviewAsFailure) {
      throw new Error(`AgentGuard verification returned REVIEW for "${run.id}" and ci.reviewAsFailure is set.`);
    }
  }

  async dispose(): Promise<void> {
    if (this.proxy) await this.proxy.stop();
  }

  private async persist(
    run: AgentRun,
    graph: Awaited<ReturnType<DefaultEvidenceCompiler["compile"]>>,
    results: Record<string, AssertionResult>,
  ): Promise<void> {
    try {
      await this.store.saveRun(run);
      await this.store.saveEvidence(run.id, { task: graph.task, items: graph.items, links: graph.links });
      await this.store.saveDecisions(run.id, results);
    } catch (err) {
      console.warn(`agentguard: failed to persist run "${run.id}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async ensureProxyStarted(): Promise<void> {
    if (this.proxy) return;
    this.proxy = new HttpFaultProxy();
    this.startedProxyInfo = await this.proxy.start();
  }

  private recordFault(spec: FaultSpec): void {
    const faultId = `fault-${this.faultRecords.length + 1}`;
    this.proxy!.inject(spec);
    this.faultRecords.push({ id: faultId, spec });
    this.push({ type: "fault", faultId, spec });
  }

  private recordCaptured(event: CapturedEvent): void {
    if (event.kind === "tool_call") {
      this.push({ type: "tool_call", callId: event.callId, tool: event.tool, arguments: event.arguments });
      return;
    }
    if (event.kind === "tool_definition") {
      this.push({ type: "tool_definition", tool: event.tool, description: event.description, inputSchema: event.inputSchema });
      return;
    }
    if (event.kind === "guard_decision") {
      this.push({ type: "guard_decision", tool: event.tool, arguments: event.arguments, decision: event.decision, reason: event.reason, callId: event.callId });
      return;
    }
    // The network call the tool made has very likely already completed —
    // interleave it before the result, giving a more faithful ordering
    // than draining only at the very end (see repo notes on this heuristic).
    this.drainProxyEvents();
    this.push({ type: "tool_result", callId: event.callId, success: event.success, result: event.result });
  }

  private drainProxyEvents(): void {
    if (!this.proxy) return;
    const all = this.proxy.events();
    const fresh = all.slice(this.drainedProxyEventCount);
    this.drainedProxyEventCount = all.length;
    for (const e of fresh) {
      this.push({
        type: "network",
        method: e.method,
        url: e.url,
        status: e.status,
        timingMs: e.timingMs,
        requestHeaders: e.requestHeaders,
        responseHeaders: e.responseHeaders,
        requestBody: e.requestBody,
        responseBody: e.responseBody,
        bodyTruncated: e.bodyTruncated,
        error: e.error,
      });
    }
  }

  private push(draft: EventDraft): void {
    this.sink.push(draft);
  }
}
