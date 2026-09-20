import { AgentRun, type AgentEvent, type AgentIdentity } from "./schema.js";
import { DefaultRedactor, type Redactor } from "./redaction.js";
import { CaptureSink } from "./captureSink.js";

/**
 * The generic transcript adapter — PRD §10's "AgentGuard observes an
 * external execution source" generalized past Playwright CLI specifically.
 * A caller (whatever actually drives the real agent process — a shell
 * wrapper, a log tailer, `agentguard watch`) reports each command it
 * issued and the output it got back, in strict alternation; `stop()`
 * compiles the transcript into a normal `AgentRun`.
 *
 * Deliberately dependency-free and tool-agnostic: this is the "point
 * AgentGuard at any CLI-driven agent" path, not just Playwright's.
 * Anything tool-specific (Playwright's `Page URL:`/`Page Title:` parsing,
 * `browser_state` events) belongs in a subclass — see
 * `@agent-guard/playwright`'s `PlaywrightCliAdapter`, which extends this
 * and adds exactly that on top. Playwright is the pre-built default, not
 * the only path.
 */
export interface TranscriptAdapterOptions {
  task: string;
  agent?: AgentIdentity;
}

export interface ParsedCommand {
  verb: string;
  args: string[];
}

/**
 * Splits a CLI invocation into a verb and its arguments — e.g.
 * `open https://example.com` → `{ verb: "open", args: ["https://example.com"] }`.
 * Quoted arguments (`fill "#name" "Jane Doe"`) are kept together.
 */
export function parseCommand(command: string): ParsedCommand {
  const tokens = command.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const [verb = "", ...rest] = tokens;
  const args = rest.map((t) => (t.startsWith('"') || t.startsWith("'") ? t.slice(1, -1) : t));
  return { verb, args };
}

/** Deliberately narrow (TRD §6.6 discipline: don't guess semantics code can't verify). Overridable per subclass/caller. */
export function looksLikeError(output: string): boolean {
  return /^\s*error[:\s]/i.test(output) || /\berror:/i.test(output);
}

/**
 * The full set of event shapes any transcript adapter (base or subclass)
 * may push. `browser_state` is included here — a legitimate core evidence
 * type — even though the base class never emits one itself, so a
 * subclass's own `push()` calls type-check against one shared union
 * rather than each subclass re-declaring its own (the excess-property
 * check TypeScript needs for a discriminated-union literal only works
 * against a single named union, not `Omit<AgentEvent, ...>` — see
 * `AgentGuardFixture`'s `EventDraft` for the same pattern).
 */
export type TranscriptEventDraft =
  | { type: "tool_call"; callId: string; tool: string; arguments: unknown }
  | { type: "tool_result"; callId: string; success: boolean; result: unknown }
  | { type: "browser_state"; kind: "snapshot" | "navigation" | "console" | "error"; url?: string; title?: string; snapshot?: unknown };

export class TranscriptAdapter {
  private readonly sink: CaptureSink<TranscriptEventDraft, AgentEvent>;
  private callCounter = 0;
  private startedAt = "";
  private task = "";
  private agentIdentity: AgentIdentity = { name: "external-cli-agent" };
  private runId = "";
  protected pending: { callId: string; verb: string } | null = null;
  private started = false;

  /**
   * PRD2 G0a: raw command args (`captureCommand`) and raw process
   * output (`captureOutput`) reach `this.events` — and from there
   * `run.json`/`events.jsonl` — with no redaction unless a redactor is
   * wired in here. Defaults to a plain `DefaultRedactor()`, since a
   * command-line agent's output is exactly the kind of place a
   * credential typed on the command line or echoed by a tool ends up.
   */
  constructor(
    private readonly toolPrefix: string = "cli",
    redactor: Redactor = new DefaultRedactor(),
  ) {
    this.sink = new CaptureSink({
      redactor,
      // PRD3 F12 — every event this adapter produces is authored by the
      // caller reporting a command/output pair, not observed by AgentGuard
      // on a wire (matches `run.source: "self-reported"` on `stop()`).
      envelope: (draft, seq) => ({ id: `ev-${seq}`, timestamp: new Date().toISOString(), seq, provenance: "self-reported", ...draft }) as AgentEvent,
    });
  }

  async start(options: TranscriptAdapterOptions): Promise<void> {
    this.runId = `${this.toolPrefix}-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.task = options.task;
    if (options.agent) this.agentIdentity = options.agent;
    this.startedAt = new Date().toISOString();
    this.started = true;
  }

  /** Records a command about to be sent to the real external process. */
  captureCommand(command: string): void {
    this.assertStarted();
    if (this.pending) {
      // The caller issued a second command before reporting the first
      // command's output — treat the first as unobserved rather than
      // silently dropping the tool_call with no matching result.
      this.resolvePending(true, { note: "no output captured before the next command was issued" });
    }
    const { verb, args } = parseCommand(command);
    const callId = `${this.toolPrefix}-${++this.callCounter}`;
    this.pending = { callId, verb };
    this.push({ type: "tool_call", callId, tool: `${this.toolPrefix}:${verb || "unknown"}`, arguments: { raw: command, args } });
  }

  /**
   * Records the real process's stdout/stderr in response to the most
   * recent `captureCommand`. `success`, when the caller already knows it
   * (e.g. a real process exit code), overrides the text-heuristic
   * fallback — an exit code is ground truth; `isError()` is a guess for
   * callers who only have text.
   */
  captureOutput(output: string, success?: boolean): void {
    this.assertStarted();
    if (!this.pending) {
      throw new Error(`${this.constructor.name}.captureOutput: no command is pending — call captureCommand() first`);
    }
    const verb = this.pending.verb;
    const resolvedSuccess = success ?? !this.isError(output);
    this.resolvePending(resolvedSuccess, { raw: output });
    this.afterOutput(verb, output);
  }

  async stop(): Promise<AgentRun> {
    this.assertStarted();
    if (this.pending) this.resolvePending(true, { note: "no output captured before stop()" });

    return AgentRun.parse({
      id: this.runId,
      task: this.task,
      agent: this.agentIdentity,
      events: this.sink.all(),
      faults: [],
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      schemaVersion: 1,
      // PRD2 F5 — every event here came from the caller reporting a
      // command/output pair, not from observing wire traffic directly.
      // That is PRD v0.6 §9.2's "agent emits" mode, the least-trusted of
      // the three attachment modes by design.
      source: "self-reported",
    });
  }

  protected isError(output: string): boolean {
    return looksLikeError(output);
  }

  /** Extension point for a tool-specific subclass (e.g. Playwright's browser_state parsing). No-op by default. */
  protected afterOutput(_verb: string, _output: string): void {}

  protected resolvePending(success: boolean, result: unknown): void {
    const pending = this.pending!;
    this.pending = null;
    this.push({ type: "tool_result", callId: pending.callId, success, result });
  }

  private assertStarted(): void {
    if (!this.started) throw new Error(`${this.constructor.name}: start() must be called first`);
  }

  protected push(draft: TranscriptEventDraft): void {
    this.sink.push(draft);
  }
}
