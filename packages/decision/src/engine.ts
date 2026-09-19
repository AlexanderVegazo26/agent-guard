import type { EntryType } from "@typesafe-ai/sdk";

/**
 * §6.1 — the `DecisionEngine` interface. Mirrors the verified Jev SDK shape
 * (TRD §1.1) so `JevDecisionEngine` is a thin adapter rather than a
 * translation layer: NoulResponse carries `{ type, noul }` with no
 * `confidence`; ScoreCriteria is an ordered tuple with at least two entries.
 * `JsonEntry` is an alias for the SDK's own `EntryType`, not a parallel
 * redefinition, so the two can never drift apart.
 */

export type JsonEntry = EntryType;

export type DecisionQuestion =
  | { type: "noul"; instructions: JsonEntry; criteria?: { true?: JsonEntry; false?: JsonEntry } | null }
  | { type: "score"; instructions: JsonEntry; criteria: readonly [JsonEntry, JsonEntry, ...JsonEntry[]] }
  | { type: "choice"; instructions: JsonEntry; criteria: Record<string, JsonEntry> };

export type QuestionSet = Record<string, DecisionQuestion>;

export interface DecisionState {
  task: string;
  injectedFaults: unknown[];
  claims: unknown[];
  evidence: unknown[];
  links: unknown[];
}

export type DecisionAnswer =
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; confidence: number; legend: Record<string, JsonEntry>; probabilities: Record<string, number> }
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };

export interface DecisionResult {
  answers: Record<string, DecisionAnswer>;
  usage: { inputTokens: number; outputTokens: number };
}

export interface EngineCapabilities {
  /** ≈32,000 for Jev today (TRD §1.1) — read at runtime, never hard-coded at call sites. */
  tokenBudget: number;
  supportsBatch: boolean;
  primitives: Array<"noul" | "score" | "choice">;
}

export interface DecisionEngine {
  decide(state: DecisionState, questions: QuestionSet): Promise<DecisionResult>;
  capabilities(): EngineCapabilities;
}

/**
 * §6.5 rule 3 — a chars/4 heuristic with a safety margin. The Jev SDK
 * reports its own `usage.input_tokens` on every response, so the
 * estimator is meant to be self-correcting in production: record
 * estimate-vs-actual and tune the margin from observed drift.
 *
 * That measurement has now been taken once, live (Phase 0 question 1/4,
 * 2026-09-19): golden fixture `01-happy-path`, 9 questions in one batch,
 * chars/4 alone estimated 1432 tokens against `usage.input_tokens` of
 * 2196 — a ~1.53x undershoot. "Under-estimating is the dangerous
 * direction — it produces mid-run rejections," so `SAFETY_MARGIN` biases
 * the estimate upward. One sample is not a distribution; this constant
 * should be revisited as more live measurements accumulate.
 */
const SAFETY_MARGIN = 1.6;

export function estimateTokens(state: DecisionState, questions: QuestionSet): number {
  return estimateStateTokens(state) + estimateQuestionsTokens(questions);
}

/**
 * §6.5 rule 3 — "both sides are checked: state against its ~28K, and
 * questions against the ~4K reserve, independently. A payload can fit
 * while the questions do not." These two are exported separately so the
 * degradation ladder (assertions/budget.ts) can check each independently
 * rather than only the combined total.
 */
export function estimateStateTokens(state: DecisionState): number {
  return Math.ceil((JSON.stringify(state).length / 4) * SAFETY_MARGIN);
}

export function estimateQuestionsTokens(questions: QuestionSet): number {
  return Math.ceil((JSON.stringify(questions).length / 4) * SAFETY_MARGIN);
}
