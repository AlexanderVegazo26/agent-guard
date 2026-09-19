/**
 * §4, §7, §8 — observation. `proxy.ts` (fault injection + network capture)
 * is a real, tested implementation. MCP transport wrapping (§4.1) lives in
 * `mcp.ts`. None of this has been wired to a live browser or a live MCP
 * agent — see the top-level project notes for what's built vs. declared.
 *
 * Redaction (`Redactor`/`DefaultRedactor`) now lives in `@agent-guard/core`
 * (PRD2 G0a) — `TranscriptAdapter`, also in `core`, needs it, and `core`
 * cannot depend on `observe` without a cycle. Re-exported here so nothing
 * that previously imported it from `@agent-guard/observe` breaks.
 */
export * from "./proxy.js";
export { DefaultRedactor, type Redactor, type RedactionAudit, type RedactionConfig } from "@agent-guard/core";
export * from "./mcp.js";
