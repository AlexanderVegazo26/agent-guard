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
 * PRD2 G9/G10 fix — a raw Noul probability is "how likely the *statement*
 * is true," never "how confident we are in the *verdict*." Those coincide
 * for a positive-polarity assertion at a high probability, but invert for
 * a negative-polarity one: `noFabricatedCompletion` at p=0.05 is a highly
 * confident PASS (95% sure the violation did NOT happen), yet the raw
 * probability (0.05) makes it look like a low-confidence result if binned
 * or aggregated directly.
 *
 * This is the polarity-invariant fix: `max(p, 1-p)` is "how far the
 * probability sits from the uncertain midpoint," which is exactly
 * "confidence in whichever way the decision landed" — and it is the same
 * value whether you compute it from `p` or from `1-p`, so it needs no
 * polarity argument at all. Used both to populate a single-question
 * result's `confidence` field (was previously the raw probability,
 * unconditionally — TRD §6.9's calibration curve is unusable without
 * this) and, per fan-out item, to pick the fan-out's own weakest-link
 * aggregate confidence (`aggregateFanOut` in pipeline.ts).
 */
export function noulConfidence(probability: number): number {
  return Math.max(probability, 1 - probability);
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
