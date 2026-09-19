/**
 * §4, §7, §8 — observation. `proxy.ts` (fault injection + network capture)
 * and `redaction.ts` (capture-path redaction) are real, tested
 * implementations. MCP transport wrapping (§4.1) lives in `mcp.ts`. None of
 * this has been wired to a live browser or a live MCP agent — see the
 * top-level project notes for what's built vs. declared.
 */
export * from "./proxy.js";
export * from "./redaction.js";
export * from "./mcp.js";
