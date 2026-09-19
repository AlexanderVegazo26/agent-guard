/**
 * PRD2 F10 / AUTOFIX.md §4.3 — the baseline-variance floor. Jev returns
 * probabilities, not labels; an assertion sitting near a band edge can
 * flip pass/review/fail between two runs of the *identical, unchanged*
 * agent, purely from resampling. `agentguard compare` cannot tell a real
 * improvement from this noise unless the loop first measures how much an
 * unchanged agent moves on its own — this is that measurement, computed
 * from real repeated-baseline confidence values, not assumed.
 */
export interface VarianceStats {
  n: number;
  min: number;
  max: number;
  /** `max - min` — the observed spread of an unchanged agent's confidence across repeated baseline runs. */
  range: number;
  mean: number;
}

export function computeVariance(confidences: number[]): VarianceStats | null {
  if (confidences.length === 0) return null;
  const min = Math.min(...confidences);
  const max = Math.max(...confidences);
  const mean = confidences.reduce((sum, v) => sum + v, 0) / confidences.length;
  return { n: confidences.length, min, max, range: max - min, mean };
}

/**
 * AUTOFIX.md §5 rule 4: "a proposed fix's compare result only counts as
 * a real signal if it moves further than the baseline's own observed
 * variance." A single-sample baseline (`n < 2`) has no measured variance
 * at all — refuses to call anything a real signal against an unmeasured
 * floor, rather than silently treating zero variance as "any movement
 * counts" (which would defeat the whole point of this check).
 */
export function exceedsVarianceFloor(
  baselineConfidence: number,
  proposedConfidence: number,
  baselineVariance: VarianceStats,
): boolean {
  if (baselineVariance.n < 2) return false;
  return Math.abs(proposedConfidence - baselineConfidence) > baselineVariance.range;
}
