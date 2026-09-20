import type { AssertionId } from "@alexvegman/core";

/**
 * docs/AUTOFIX.md §9 — `FixProposerEngine`. Proposes a diff to an agent's
 * own instructions; it never decides anything and never applies anything.
 * §9's own scoping still holds: this engine is only ever given evidence
 * excerpts and escalated explanations (never an assertion's judge-facing
 * question text or any policy/threshold), and its output is a claim a
 * human reviews — never applied automatically (there is no `apply` path
 * anywhere in this codebase; see AUTOFIX.md §10).
 *
 * §9 also names why *validating* a proposal is still blocked
 * (AUTOFIX.md §4: no discriminating-evidence audit, no per-assertion
 * held-out fixture sets, no measured baseline-variance floor) — this
 * engine and the `propose` step built on it are the part of the design
 * that doesn't require those prerequisites. A `FixProposal` this engine
 * produces has no `validation` field until someone runs `agentguard
 * compare` against a real before/after re-evaluation themselves.
 */
export interface RecurringFinding {
  assertionId: AssertionId;
  /** How many stored runs this pattern recurred in — a proposer is never given a single-sample "finding" (PRD §12: n=1 is an anecdote). */
  occurrences: number;
  /** Verbatim evidence excerpts (tool calls/results/claims) — never paraphrased, never the assertion's own instruction text. */
  evidenceExcerpts: string[];
  /** The escalated root-cause explanation, when one exists (packages/assertions/src/escalate.ts) — still never grader internals. */
  explanation?: string;
}

export interface FixProposerRequest {
  targetPath: string;
  currentText: string;
  recurringEvidence: RecurringFinding[];
}

export interface FixProposerResult {
  diff: string;
  rationale: string;
}

export interface FixProposerEngine {
  propose(request: FixProposerRequest): Promise<FixProposerResult>;
}

export type FixProposerScript = FixProposerResult | ((request: FixProposerRequest) => FixProposerResult);

/** Scriptable, no network — the fix-proposer equivalent of `MockDecisionEngine`/`MockEscalationEngine`. */
export class MockFixProposerEngine implements FixProposerEngine {
  readonly calls: FixProposerRequest[] = [];

  constructor(private readonly script: FixProposerScript) {}

  async propose(request: FixProposerRequest): Promise<FixProposerResult> {
    this.calls.push(request);
    return typeof this.script === "function" ? this.script(request) : this.script;
  }
}
