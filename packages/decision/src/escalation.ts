import type { DecisionQuestion, DecisionState } from "./engine.js";

/**
 * PRD §10.2 / TRD §6.1 — `LlmDecisionEngine` (renamed here to
 * `EscalationEngine`, since it never *decides* anything — TRD's own line
 * is "producing explanations, never verdicts"). The escalation path:
 *
 *   Deterministic code → settles what's provable
 *   Jev                → settles semantic questions, batched
 *     ├── high-confidence PASS/FAIL → done
 *     └── uncertain (REVIEW)        → EscalationEngine → root-cause
 *                                      explanation for the human
 *
 * A frontier LLM here NEVER changes `status` — an escalated result is
 * still `"review"`, just no longer an unexplained one. It gets its own
 * `basis: "escalated"` so a report can distinguish "REVIEW, unexplained"
 * from "REVIEW, here's probably why" without inventing a new status.
 */
export interface EscalationRequest {
  assertionId: string;
  /** The exact question Jev was asked — the frontier model reasons about the same thing, not a rephrasing. */
  question: DecisionQuestion;
  /** The exact evidence state Jev saw — never a summary (TRD §6.4's "whole-item, never summarized" discipline applies here too). */
  state: DecisionState;
  /** Jev's own uncertain signal, so the frontier model explains *why the uncertainty*, not just re-answers the question. */
  priorConfidence: number;
}

export interface EscalationResult {
  explanation: string;
}

export interface EscalationEngine {
  /** API-009 — optional cancellation signal; see `DecisionEngine.decide`'s doc comment for the contract. */
  explain(request: EscalationRequest, signal?: AbortSignal): Promise<EscalationResult>;
}

export type EscalationScript = Record<string, string> | ((request: EscalationRequest) => string);

/** Scriptable, no network — the escalation-side equivalent of `MockDecisionEngine`. */
export class MockEscalationEngine implements EscalationEngine {
  readonly calls: EscalationRequest[] = [];

  constructor(private readonly script: EscalationScript) {}

  async explain(request: EscalationRequest, signal?: AbortSignal): Promise<EscalationResult> {
    signal?.throwIfAborted();
    this.calls.push(request);
    const explanation = typeof this.script === "function" ? this.script(request) : this.script[request.assertionId];
    if (explanation === undefined) {
      throw new Error(`MockEscalationEngine: no scripted explanation for assertion "${request.assertionId}"`);
    }
    return { explanation };
  }
}
