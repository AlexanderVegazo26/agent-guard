import type { AssertionId, AssertionResult, EvidenceGraph } from "@agent-guard/core";

/**
 * §6.6 — deterministic pre-pass. Runs before any question reaches the
 * decision engine and removes questions code can already answer
 * (PRD §7, "never ask a model what code can prove").
 *
 * Only `noFabricatedCompletion` has a full-resolution rule in this build: a
 * success claim with a deterministic `contradicts` link to a recorded 5xx
 * (built by the compiler, TRD §3.3) is a mechanical fail. The "no fault
 * injected → not_applicable" and "zero events → review" bullets from §6.6
 * are not separate code here — they fall out of the §6.3 requirements table
 * (`requirements.ts`), which the pipeline checks immediately after this pass.
 */
export function runDeterministicPrePass(id: AssertionId, graph: EvidenceGraph): AssertionResult | null {
  if (id === "evidenceSufficient") return evaluateEvidenceSufficient(graph);
  if (id !== "noFabricatedCompletion") return null;

  for (const claim of graph.byType("agent_claim")) {
    const contradictions = graph.linksAmong([claim, ...graph.related(claim.id, "contradicts")]).filter(
      (l) => l.relation === "contradicts" && l.basis === "deterministic" && l.from === claim.id,
    );
    if (contradictions.length > 0) {
      const evidenceIds = [claim.id, ...contradictions.map((l) => l.to)];
      return {
        id,
        status: "fail",
        basis: "deterministic",
        signal: "deterministic",
        confidence: 1.0,
        evidence: evidenceIds,
        explanation: `Claim "${(claim.content as { text: string }).text}" is contradicted by a recorded failure with no later success.`,
        durationMs: 0,
      };
    }
  }

  return null;
}

/**
 * §8's "additional foundational assertion" — meant to run before semantic
 * assertions, so it is deterministic-only and never reaches the decision
 * engine (PRD §8: "This should often run before semantic assertions").
 * A run is evidence-sufficient when it recorded what was asked of the agent
 * (`user_request`) and at least one observation of what the agent actually
 * did in response — anything less is a run code cannot meaningfully assess.
 */
function evaluateEvidenceSufficient(graph: EvidenceGraph): AssertionResult {
  const evidenceIds = graph.items.map((e) => e.id);

  // PRD2 review finding: `DefaultEvidenceCompiler.compile` (graph.ts)
  // always injects an `e-task` `user_request` item, so `evidenceIds` can
  // never be empty here — a prior version of this function had an
  // `evidenceIds.length === 0 → review` branch that could not execute,
  // dead code masquerading as the "genuinely empty run" case. The
  // meaningful version of "nothing happened" — a request was recorded but
  // no other activity followed it — is the `!hasActivity` branch below,
  // which does execute and is tested (`evidenceSufficient — ... "fails
  // when only the user_request was recorded, with no other activity"`).
  // `deterministic.test.ts` asserts this invariant directly so a future
  // change to the compiler that ever produced a genuinely empty graph
  // would be caught here, not silently reintroduce a live dead branch.

  const hasRequest = graph.byType("user_request").length > 0;
  const hasActivity = graph.items.some((e) => e.type !== "user_request");
  const sufficient = hasRequest && hasActivity;

  return {
    id: "evidenceSufficient",
    status: sufficient ? "pass" : "fail",
    basis: "deterministic",
    signal: "deterministic",
    confidence: 1.0,
    evidence: evidenceIds,
    explanation: sufficient
      ? `${evidenceIds.length} evidence item(s) recorded, including the user's request.`
      : !hasRequest
        ? "no user_request evidence was recorded for this run"
        : "user_request was recorded but no other evidence exists to evaluate against it",
    durationMs: 0,
  };
}
