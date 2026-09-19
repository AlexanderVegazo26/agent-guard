import type { GuardDecisionKind } from "@agent-guard/core";

/**
 * PRD2 F2 — the online guard's deterministic pre-action check. Evaluated
 * before a tool call is allowed to reach a real MCP server, wired into
 * `ObservingTransport` below.
 *
 * Deliberately deterministic-only for this pass — no live Jev call sits
 * in front of a tool call yet. PRD2's own §3 boundary ("Jev may verify,
 * never narrate") and this project's discipline about not shipping a
 * Noul-based check without live validation (the fixture-06 lesson) both
 * argue against rushing a live-model call into a hot path before it's
 * been measured. This is the reliability floor PRD v0.6 §10.4 already
 * requires regardless of what decides: an engine (or, here, a policy)
 * that can't confidently say "allow" never defaults to allowing.
 */
export interface GuardPolicy {
  /** A tool call to any of these names is blocked outright. */
  blockedTools?: readonly string[];
  /** A tool call to any of these names is held for review (treated as block today — no async human-approval flow exists yet; see the module doc comment). */
  reviewTools?: readonly string[];
  /** Checked against `JSON.stringify(arguments)` — outbound argument values, not tool names. Any match blocks the call. */
  blockedArgumentPatterns?: readonly RegExp[];
}

export interface GuardResult {
  decision: GuardDecisionKind;
  reason: string;
}

const ALLOW: GuardResult = { decision: "allow", reason: "no policy rule matched" };

export function evaluateGuard(tool: string, args: unknown, policy: GuardPolicy): GuardResult {
  if (policy.blockedTools?.includes(tool)) {
    return { decision: "block", reason: `tool "${tool}" is on the blocked-tools list` };
  }
  if (policy.reviewTools?.includes(tool)) {
    return { decision: "review", reason: `tool "${tool}" requires review before it may proceed` };
  }

  const argsText = safeStringify(args);
  for (const pattern of policy.blockedArgumentPatterns ?? []) {
    if (pattern.test(argsText)) {
      return { decision: "block", reason: `arguments to "${tool}" matched a blocked pattern (${pattern.source})` };
    }
  }

  return ALLOW;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}
