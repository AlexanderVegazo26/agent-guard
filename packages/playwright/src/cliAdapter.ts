import { AgentRun, type AgentEvent, type AgentIdentity } from "@agent-guard/core";

/**
 * TRD §17/§30, FR-009 — the Playwright CLI is an *external* execution
 * source (PRD §10 Mode B): a coding agent drives it as a subprocess AgentGuard
 * does not own, issuing commands like `playwright-cli open/snapshot/click/fill`
 * and reading back concise, token-efficient text output. AgentGuard's job is
 * to observe that command/output stream and turn it into the same `AgentRun`
 * shape every other integration mode produces — never to launch or manage the
 * CLI process itself, which would duplicate the agent's own control loop.
 *
 * This is therefore a pure *transcript* adapter: the caller (whatever is
 * actually invoking the real `playwright-cli` binary and reading its stdout)
 * calls `captureCommand` before issuing each command and `captureOutput` with
 * whatever text came back, in strict alternation. `stop()` compiles
 * everything captured into an `AgentRun`, exactly like `AgentGuardFixture`
 * does for the Playwright Test / MCP modes.
 */
export interface PlaywrightCliAdapterOptions {
  task: string;
  agent?: AgentIdentity;
}

export interface ParsedCliCommand {
  verb: string;
  args: string[];
}

/**
 * Splits a CLI invocation into a verb and its arguments — e.g.
 * `open https://example.com` → `{ verb: "open", args: ["https://example.com"] }`.
 * Quoted arguments (`fill "#name" "Jane Doe"`) are kept together.
 */
export function parseCliCommand(command: string): ParsedCliCommand {
  const tokens = command.trim().match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const [verb = "", ...rest] = tokens;
  const args = rest.map((t) => (t.startsWith('"') || t.startsWith("'") ? t.slice(1, -1) : t));
  return { verb, args };
}

/**
 * The real CLI's output is prose, not JSON (PRD §30: "concise snapshots ...
 * after commands"). This extracts the two fields every assertion actually
 * needs (URL, title) from the `Page URL: ...` / `Page Title: ...` lines —
 * confirmed against a real `@playwright/cli` session (2026-09-19) to appear
 * after **every** command, not just `snapshot`/`screenshot` as PRD §30's
 * prose reads: `open`, `goto`, `click`, `fill`, etc. all print the same
 * `### Page` block. Anything else in the output is kept verbatim in
 * `snapshot`/`raw` rather than parsed further (TRD §6.5 rule 1 —
 * accessibility-snapshot text, not DOM).
 */
function parseSnapshotFields(output: string): { url?: string; title?: string } {
  const urlMatch = /page url:\s*(\S+)/i.exec(output);
  const titleMatch = /page title:\s*(.+)/i.exec(output);
  return {
    url: urlMatch?.[1],
    title: titleMatch?.[1]?.trim(),
  };
}

/** Deliberately narrow (TRD §6.6 discipline: don't guess semantics code can't verify). */
function looksLikeError(output: string): boolean {
  return /^\s*error[:\s]/i.test(output) || /\berror:/i.test(output);
}

/** Verbs whose output *is* an explicit snapshot request, vs. incidental page state on any other command. */
const SNAPSHOT_VERBS = new Set(["snapshot", "screenshot"]);

// Mirrors `AgentGuardFixture`'s `EventDraft` (fixture.ts): TS cannot
// discriminate-union-check an object literal against `Omit<AgentEvent, ...>`
// directly (the `Omit` collapses the discriminant), so `push()` needs its
// own explicit union of the event shapes this adapter actually produces.
type EventDraft =
  | { type: "tool_call"; callId: string; tool: string; arguments: unknown }
  | { type: "tool_result"; callId: string; success: boolean; result: unknown }
  | { type: "browser_state"; kind: "snapshot" | "navigation"; url?: string; title?: string; snapshot: unknown };

export class PlaywrightCliAdapter {
  private readonly events: AgentEvent[] = [];
  private seq = 0;
  private callCounter = 0;
  private startedAt = "";
  private task = "";
  private agentIdentity: AgentIdentity = { name: "playwright-cli-agent" };
  private runId = "";
  private pending: { callId: string; verb: string } | null = null;
  private started = false;

  async start(options: PlaywrightCliAdapterOptions): Promise<void> {
    this.runId = `cli-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.task = options.task;
    if (options.agent) this.agentIdentity = options.agent;
    this.startedAt = new Date().toISOString();
    this.started = true;
  }

  /** Records a command about to be sent to the real `playwright-cli` process. */
  captureCommand(command: string): void {
    this.assertStarted();
    if (this.pending) {
      // The caller issued a second command before reporting the first
      // command's output — treat the first as unobserved rather than
      // silently dropping the tool_call with no matching result.
      this.resolvePending(true, { note: "no output captured before the next command was issued" });
    }
    const { verb, args } = parseCliCommand(command);
    const callId = `cli-${++this.callCounter}`;
    this.pending = { callId, verb };
    this.push({ type: "tool_call", callId, tool: `playwright-cli:${verb || "unknown"}`, arguments: { raw: command, args } });
  }

  /** Records the real process's stdout/stderr in response to the most recent `captureCommand`. */
  captureOutput(output: string): void {
    this.assertStarted();
    if (!this.pending) {
      throw new Error("PlaywrightCliAdapter.captureOutput: no command is pending — call captureCommand() first");
    }
    const verb = this.pending.verb;
    const success = !looksLikeError(output);
    this.resolvePending(success, { raw: output });

    const { url, title } = parseSnapshotFields(output);
    if (url !== undefined || title !== undefined) {
      const kind = SNAPSHOT_VERBS.has(verb.toLowerCase()) ? "snapshot" : "navigation";
      this.push({ type: "browser_state", kind, url, title, snapshot: output });
    }
  }

  async stop(): Promise<AgentRun> {
    this.assertStarted();
    if (this.pending) this.resolvePending(true, { note: "no output captured before stop()" });

    return AgentRun.parse({
      id: this.runId,
      task: this.task,
      agent: this.agentIdentity,
      events: this.events,
      faults: [],
      startedAt: this.startedAt,
      endedAt: new Date().toISOString(),
      schemaVersion: 1,
    });
  }

  private resolvePending(success: boolean, result: unknown): void {
    const pending = this.pending!;
    this.pending = null;
    this.push({ type: "tool_result", callId: pending.callId, success, result });
  }

  private assertStarted(): void {
    if (!this.started) throw new Error("PlaywrightCliAdapter: start() must be called first");
  }

  private push(draft: EventDraft): void {
    this.seq += 1;
    this.events.push({ id: `ev-${this.seq}`, timestamp: new Date().toISOString(), seq: this.seq, ...draft } as AgentEvent);
  }
}
