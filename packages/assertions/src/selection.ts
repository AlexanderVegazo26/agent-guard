import type { AssertionId, Evidence, EvidenceGraph, EvidenceType } from "@agent-guard/core";

/**
 * §6.4 — mechanical evidence selection per assertion, by declared window.
 * Selection is whole-item and verbatim, never summarized (TRD §6.4); a
 * window only decides *which* whole items are included, the same
 * discipline as the fan-out caps.
 *
 * `"full-run"` is the simplification this build otherwise runs on (filter
 * by type across the whole graph). The two narrower windows the TRD
 * actually specifies are implemented here:
 *
 *  - `"tool-call-neighborhood"` (`toolWasAppropriate`): ±5 events around
 *    *each* tool call being asked about — not every tool call in the run,
 *    which matters once the fan-out cap (§6.5 rule 4) has already trimmed
 *    which calls are even asked about. `user_request` is exempted from the
 *    numeric window: the task is global context the model needs for every
 *    tool-call judgment, not something whose relevance decays with
 *    sequence distance.
 *  - `"from-injection-onward"` (`noPromptInjectionSuccess`): only evidence
 *    at or after the prompt-injection fault's own `seq` — behavior before
 *    the injection existed can't be evidence of resisting it.
 */
export type SelectionWindow = "full-run" | "tool-call-neighborhood" | "from-injection-onward";

const WINDOWS: Record<AssertionId, SelectionWindow> = {
  goalCompleted: "full-run",
  finalStateMatchesIntent: "full-run",
  prematureCompletion: "full-run",
  requiredStepsCompleted: "full-run",
  noUnsupportedClaims: "full-run",
  claimsConsistentWithEvidence: "full-run",
  noFabricatedToolUsage: "full-run",
  noFabricatedCompletion: "full-run",
  toolWasAppropriate: "tool-call-neighborhood",
  toolArgumentsCorrect: "tool-call-neighborhood",
  // NOT "tool-call-neighborhood": both of these need `agent_claim`/
  // `state_change` evidence that can legitimately sit far from the tool
  // call in `seq` — e.g. the run's final-output claim, whose seq is
  // `Number.MAX_SAFE_INTEGER` (graph.ts) and is exempted from the ±5
  // radius only for `user_request`. Windowing these by tool-call proximity
  // silently starved them of exactly the evidence their question asks
  // about (caught by re-checking `engine.calls[0].state.evidence` against
  // fixture 07 — the claim `toolResultUsedCorrectly` is meant to judge
  // was absent from the state sent to the engine).
  toolResultUsedCorrectly: "full-run",
  noUnauthorizedToolUse: "tool-call-neighborhood",
  noPromptInjectionSuccess: "from-injection-onward",
  noSensitiveDataLeak: "full-run",
  noPolicyViolation: "full-run",
  noUnauthorizedSideEffect: "full-run",
  recoveredFromFailure: "full-run",
  handledAmbiguityCorrectly: "full-run",
  avoidedUnnecessaryActions: "full-run",
  stoppedWhenDone: "full-run",
  evidenceSufficient: "full-run",
};

const NEIGHBORHOOD_RADIUS = 5;

/**
 * `fanOutItem` is required for `"tool-call-neighborhood"` — the window is
 * centered on one specific tool call, not the assertion as a whole. It is
 * ignored by every other window.
 */
export function selectEvidenceForAssertion(
  graph: EvidenceGraph,
  id: AssertionId,
  selectorTypes: readonly EvidenceType[],
  fanOutItem?: Evidence,
): Evidence[] {
  const window = WINDOWS[id];

  if (window === "tool-call-neighborhood" && fanOutItem) {
    const lo = fanOutItem.seq - NEIGHBORHOOD_RADIUS;
    const hi = fanOutItem.seq + NEIGHBORHOOD_RADIUS;
    return graph.items.filter((e) => {
      if (!selectorTypes.includes(e.type)) return false;
      if (e.type === "user_request") return true;
      return e.seq >= lo && e.seq <= hi;
    });
  }

  if (window === "from-injection-onward") {
    const injectionFault = graph
      .byType("injected_fault")
      .find((e) => (e.content as { spec?: { type?: string } }).spec?.type === "prompt-injection");
    // No injection to anchor on — §6.3's sufficiency check already routes
    // this case to not_applicable/review before selection ever runs; this
    // fallback exists only so the function has a defined result if called
    // out of that order.
    if (!injectionFault) return graph.items.filter((e) => selectorTypes.includes(e.type));
    return graph.items.filter((e) => e.seq >= injectionFault.seq && selectorTypes.includes(e.type));
  }

  return graph.items.filter((e) => selectorTypes.includes(e.type));
}
