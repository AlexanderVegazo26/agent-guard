import { TranscriptAdapter, parseCommand } from "@agent-guard/core";

/**
 * TRD §17/§30, FR-009 — the Playwright CLI adapter. Playwright is the
 * pre-built **default** on top of `@agent-guard/core`'s generic
 * `TranscriptAdapter` (added to make "point AgentGuard at any CLI-driven
 * agent" a real, generalized capability rather than a Playwright-only
 * one) — this class adds exactly the Playwright-specific enrichment:
 * parsing the `Page URL:`/`Page Title:` block real `@playwright/cli`
 * output carries, into `browser_state` events.
 *
 * Still a pure *transcript* adapter, not a process spawner: the caller
 * (whatever actually invokes the real `playwright-cli` binary and reads
 * its stdout) calls `captureCommand` before issuing each command and
 * `captureOutput` with whatever text came back, in strict alternation.
 * `stop()` compiles everything captured into an `AgentRun`, exactly like
 * `AgentGuardFixture` does for the Playwright Test / MCP modes.
 */
export { parseCommand as parseCliCommand };

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

/** Verbs whose output *is* an explicit snapshot request, vs. incidental page state on any other command. */
const SNAPSHOT_VERBS = new Set(["snapshot", "screenshot"]);

export class PlaywrightCliAdapter extends TranscriptAdapter {
  constructor() {
    super("playwright-cli");
  }

  protected override afterOutput(verb: string, output: string): void {
    const { url, title } = parseSnapshotFields(output);
    if (url === undefined && title === undefined) return;
    const kind = SNAPSHOT_VERBS.has(verb.toLowerCase()) ? "snapshot" : "navigation";
    this.push({ type: "browser_state", kind, url, title, snapshot: output });
  }
}
