import type { AssertionStatus } from "@agent-guard/core";
import type { ChoicePolicy, ScorePolicy } from "@agent-guard/core";

/**
 * §6.2.1 — turning a primitive's answer into a verdict. Three shapes, three
 * rules, all declared in config rather than hard-coded, so a team can move
 * the bar without a code change.
 */

export type Polarity = "positive" | "negative";

/**
 * Noul → the uncertainty band. `polarity` decides which end is `pass`:
 * "positive" means a high probability that the statement is true is a PASS
 * (e.g. `goalCompleted`). "negative" means a high probability is the
 * violation holding, so it is a FAIL (e.g. `noFabricatedCompletion`,
 * `noUnsupportedClaims`, `noPromptInjectionSuccess` — the three assertions
 * named after the thing that must NOT be true).
 *
 * This is the single highest-risk function in the codebase (TRD §6.2): an
 * inverted polarity passes exactly when it should fail, and no golden fixture
 * can catch it if the fixture itself was authored against the same inverted
 * assumption. See verdict.test.ts's hand-computed table.
 */
export function noulVerdict(probability: number, polarity: Polarity, band: [number, number]): AssertionStatus {
  const [lo, hi] = band;
  // "Below the band's floor the statement is false, above its ceiling it is
  // true, inside it [inclusive] the answer is REVIEW" (TRD §6.2.1) — the
  // boundary points themselves are review, not a confident verdict.
  if (probability >= lo && probability <= hi) return "review";
  const statementIsTrue = probability > hi;
  const passes = polarity === "positive" ? statementIsTrue : !statementIsTrue;
  return passes ? "pass" : "fail";
}

/**
 * Score → a declared pass level, read as an interval (TRD §6.2.1):
 *   score ≥ passIndex                              → PASS
 *   passIndex - reviewBelow ≤ score < passIndex     → REVIEW  (one-sided!)
 *   score < passIndex - reviewBelow                 → FAIL
 *   confidence < minConfidence                      → REVIEW, whatever the score
 *
 * The review zone is *never* symmetric around the cut point — v0.3's bug,
 * documented in the TRD, made a clean pass-bar score land in REVIEW.
 */
export function scoreVerdict(score: number, confidence: number, policy: ScorePolicy): AssertionStatus {
  if (confidence < policy.minConfidence) return "review";
  const passIndex = policy.levels.indexOf(policy.passAtOrAbove);
  if (passIndex < 0) {
    throw new Error(`scoreVerdict: "${policy.passAtOrAbove}" is not one of the declared levels`);
  }
  if (score >= passIndex) return "pass";
  if (score >= passIndex - policy.reviewBelow) return "review";
  return "fail";
}

/** Choice → declared passing options plus a confidence floor. */
export function choiceVerdict(selected: string, confidence: number, policy: ChoicePolicy): AssertionStatus {
  if (confidence < policy.minConfidence) return "review";
  return policy.passOptions.includes(selected) ? "pass" : "fail";
}
