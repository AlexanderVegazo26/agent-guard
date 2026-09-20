/**
 * §4, §7, §8 — observation. `proxy.ts` (fault injection + network capture)
 * is a real, tested implementation. MCP transport wrapping (§4.1) lives in
 * `mcp.ts`.
 *
 * PRD3 D4: this comment used to say none of this had been wired to a live
 * browser or a live MCP agent. `real-sdk-integration.test.ts` (in
 * `@agent-guard/playwright`, which is the consumer of this package) now
 * wires `ObservingTransport` to the real `@modelcontextprotocol/sdk`
 * `Client`/`McpServer`, including the guard's "a blocked call never reaches
 * the real handler" property. Still not wired to a live browser, and not to
 * a live LLM agent — those remain open.
 *

 * Redaction (`Redactor`/`DefaultRedactor`) now lives in `@agent-guard/core`
 * (PRD2 G0a) — `TranscriptAdapter`, also in `core`, needs it, and `core`
 * cannot depend on `observe` without a cycle. Re-exported here so nothing
 * that previously imported it from `@agent-guard/observe` breaks.
 */
export * from "./proxy.js";
export { DefaultRedactor, type Redactor, type RedactionAudit, type RedactionConfig } from "@agent-guard/core";
export * from "./mcp.js";
export * from "./guard.js";
