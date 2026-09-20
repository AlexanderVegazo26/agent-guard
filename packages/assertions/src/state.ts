import type { Evidence, EvidenceGraph, EvidenceLink } from "@alexvegman/core";
import type { DecisionState } from "@alexvegman/decision";

/**
 * §6.4 — one state per request, shared by every question in the batch
 * (union-first default). Only deterministic links are serialized —
 * heuristic links are hypotheses the decision engine exists to evaluate, and
 * putting one in the state would hand the model its own answer as an input.
 *
 * `claims` is derived from `selected`, not from the full graph — TRD §6.4:
 * "claims are capped on the state side too, not only on the question side
 * ... a 45-claim run paid budget for 25 claims no question referenced."
 * `selected` already reflects each pending assertion's own selector *and*
 * `noUnsupportedClaims`'s fan-out cap (`pipeline.ts`'s `plan.included`), so
 * a claim trimmed by the cap is trimmed here too, not sent anyway.
 */
export function buildUnionState(graph: EvidenceGraph, selected: Evidence[]): DecisionState {
  return {
    task: graph.task,
    injectedFaults: graph.byType("injected_fault").map(serializeEvidence),
    claims: selected.filter((e) => e.type === "agent_claim").map(serializeEvidence),
    evidence: [...selected].sort((a, b) => a.seq - b.seq).map(serializeEvidence),
    links: graph
      .linksAmong(selected)
      .filter((l) => l.basis === "deterministic")
      .map(serializeLink),
  };
}

function serializeEvidence(e: Evidence) {
  return { id: e.id, type: e.type, content: e.content };
}

function serializeLink(l: EvidenceLink) {
  return { from: l.from, to: l.to, relation: l.relation };
}
