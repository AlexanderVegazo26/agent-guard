import type { PolicyConfig } from "./policy.js";
import type { AssertionResult } from "./schema.js";

/**
 * §12 (TRD) / §9.3 (PRD) — run-level exit code. The one place the
 * architecture collapses per-assertion dimensions into a single number; it
 * is a CI routing decision, not a quality score (reporters still emit every
 * dimension separately).
 *
 *   any status === "error"                         → 3
 *   every status === "not_applicable" (incl. none)  → 3
 *   any status === "fail"                           → 1
 *   any status === "review"                         → 2
 *   otherwise (all pass / not_applicable)            → 0
 *
 * `ci.reviewAsFailure` is NOT consulted here — code 2 is always returned for
 * a review-dominant run. The config exists for downstream tooling that
 * wraps this exit code, not to make this function silently emit 1 instead
 * of 2 (that would defeat the reason a distinct code exists, PRD §9.3).
 */
export function computeExitCode(results: Record<string, AssertionResult>): 0 | 1 | 2 | 3 {
  const statuses = Object.values(results).map((r) => r.status);

  if (statuses.some((s) => s === "error")) return 3;
  if (statuses.every((s) => s === "not_applicable")) return 3; // true (and →3) for an empty run too
  if (statuses.some((s) => s === "fail")) return 1;
  if (statuses.some((s) => s === "review")) return 2;
  return 0;
}

/**
 * PRD3 — the CLI (`test`, `replay`, `watch`) used to call `computeExitCode`
 * directly and never consult `policy.ci.reviewAsFailure`, while the
 * Playwright fixture separately upgraded a `2` to a thrown error under the
 * same flag (`fixture.ts`). Same config, two call sites, two behaviors.
 * This is the one place both now go through: `computeExitCode` still never
 * sees the policy (its CI-routing contract is unchanged, see its own doc
 * comment), and this wrapper applies the *documented* meaning of the flag —
 * "a REVIEW-dominant run should fail CI" — by upgrading a `2` to a `1`.
 */
export function applyReviewAsFailurePolicy(exitCode: 0 | 1 | 2 | 3, policy: Pick<PolicyConfig, "ci">): 0 | 1 | 2 | 3 {
  if (exitCode === 2 && policy.ci.reviewAsFailure) return 1;
  return exitCode;
}
