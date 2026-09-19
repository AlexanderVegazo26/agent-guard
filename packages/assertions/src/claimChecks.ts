import type { Evidence, EvidenceGraph } from "@agent-guard/core";

/**
 * §6.6 deterministic pre-pass, bullet 1: "No `tool_call` evidence for tool X
 * → a claim of having used X is fabricated. No model needed." Unlike
 * `noFabricatedCompletion`'s whole-assertion rule, this one resolves a
 * *single claim* inside `noUnsupportedClaims`'s fan-out — other claims in
 * the same run may still need the decision engine (TRD Appendix B scenario
 * `04`, `Jev: det.`, is this exact shape).
 *
 * Detection is mechanical and deliberately narrow: a claim naming a tool by
 * a backtick-quoted identifier — `` `tool_name` `` — that never appears as
 * a `ToolCallEvent.tool` anywhere in the run. This is a real but narrow
 * slice of "fabricated tool usage"; a claim that names the tool in plain
 * prose ("I used the payment tool") is not caught, and is left to the
 * decision engine as an ordinary unsupported-claim question.
 *
 * PRD2 G0c: several capture paths — `TranscriptAdapter.captureCommand`
 * (`watch:ls`), `PlaywrightCliAdapter` (`playwright-cli:click`) — record
 * `ToolCallEvent.tool` as `<adapter-prefix>:<verb>`, not the bare verb a
 * truthful agent's own claim names ("I ran `ls`"). Comparing only the raw
 * name made every adapter-captured run report a truthful tool mention as
 * fabricated, which is `agentguard watch`'s *default* assertion set. The
 * comparison below also checks each called tool's name with any
 * `prefix:` stripped, so both spellings count as the same tool. The
 * identifier pattern also now accepts `.` and `-`, since real tool names
 * (`browser_navigate.v2`, `get-user`) are not always a bare identifier.
 */
const BACKTICKED_IDENTIFIER = /`([a-zA-Z_][a-zA-Z0-9_.-]*)`/g;

function bareToolName(tool: string): string {
  const colonIndex = tool.indexOf(":");
  return colonIndex === -1 ? tool : tool.slice(colonIndex + 1);
}

export function findFabricatedToolMention(claim: Evidence, graph: EvidenceGraph): string | null {
  const text = (claim.content as { text: string }).text;
  const calledTools = new Set<string>();
  for (const e of graph.byType("tool_call")) {
    const tool = (e.content as { tool: string }).tool;
    calledTools.add(tool);
    calledTools.add(bareToolName(tool));
  }

  for (const match of text.matchAll(BACKTICKED_IDENTIFIER)) {
    const name = match[1];
    if (name !== undefined && !calledTools.has(name)) return name;
  }
  return null;
}
