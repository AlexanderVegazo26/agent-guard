import type { AssertionId, AssertionResult, EvidenceGraph } from "@agent-guard/core";
import type { EscalationEngine } from "@agent-guard/decision";
import { DEFINITIONS } from "./definitions.js";
import { selectEvidenceForAssertion } from "./selection.js";
import { buildUnionState } from "./state.js";

/**
 * PRD §10.2's escalation step, run as a post-pass over `evaluate()`'s
 * output. Scope, stated plainly (a deliberate v1 limitation, not an
 * oversight):
 *
 *  - Only `status: "review"` results with `basis: "jev"` and
 *    `reviewVia: "uncertainty-band"` are escalated. A `"structural-gap"` or
 *    `"capacity"` REVIEW has no Jev signal to explain — the frontier model
 *    would be explaining an absence, not a genuine uncertain judgment
 *    (PRD §10.2: "invoked on the small uncertain tail").
 *  - Only **single-question** assertions are escalated. A fan-out
 *    assertion's REVIEW is an aggregate over many items; escalating it
 *    would require picking which item's uncertainty to explain (or
 *    explaining the aggregate, which is a different, unspecified prompt
 *    shape). Left for a follow-up rather than guessed at here.
 *
 * A successful escalation never changes `status` — PRD §10.2: "the
 * frontier LLM produces explanation, not verdict." It sets
 * `basis: "escalated"` and replaces `explanation` with the frontier
 * model's root-cause text, so a report can tell "REVIEW, unexplained"
 * from "REVIEW, here's probably why" without a new status value.
 *
 * A single assertion's escalation failing (network error, no API key)
 * never fails the run — it's logged and the result is left as an
 * ordinary, unescalated REVIEW. TRD §10.4's rule ("an unavailable engine
 * must never yield PASS") is about verdicts; escalation produces no
 * verdict, so its failure mode is "less helpful," never "wrong."
 */
export async function escalateReviews(
  graph: EvidenceGraph,
  results: Record<string, AssertionResult>,
  engine: EscalationEngine,
): Promise<Record<string, AssertionResult>> {
  const out: Record<string, AssertionResult> = { ...results };

  for (const [id, result] of Object.entries(results)) {
    if (!isEscalationCandidate(id, result)) continue;

    const def = DEFINITIONS[id as AssertionId];
    if (def.kind !== "single") continue;

    try {
      const question = def.buildQuestion(graph);
      const evidence = selectEvidenceForAssertion(graph, id as AssertionId, def.selectorTypes);
      const state = buildUnionState(graph, evidence);
      const { explanation } = await engine.explain({
        assertionId: id,
        question,
        state,
        priorConfidence: result.confidence ?? 0.5,
      });
      out[id] = { ...result, basis: "escalated", explanation };
    } catch (err) {
      console.warn(`agentguard: escalation failed for "${id}" — leaving it as an unexplained REVIEW (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  return out;
}

function isEscalationCandidate(id: string, result: AssertionResult): boolean {
  return result.status === "review" && result.basis === "jev" && result.reviewVia === "uncertainty-band" && id in DEFINITIONS;
}
