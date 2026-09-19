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
