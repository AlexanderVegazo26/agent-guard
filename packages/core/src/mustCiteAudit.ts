import type { EvidenceGraph } from "./graph.js";

/**
 * PRD2 F10 / AUTOFIX.md §4.1 — a narrower, honest slice of "the
 * discriminating-evidence audit." AUTOFIX.md's full spec is a semantic
 * question no static check can answer: "for every fixture's every
 * expected assertion, is there evidence in `run.json` that would change
 * if the opposite verdict were true?" — that's exactly what a real model
 * has to judge (it's the question fixture 06 originally failed, PRD2 G2).
 * AUTOFIX.md itself warns against a fake-rigorous stand-in: "worse than
 * no gate — it looks like rigor and isn't."
 *
 * This audit checks something narrower but fully mechanical and real: a
 * fixture's `mustCite` evidence ids must actually exist in the compiled
 * evidence graph. A fixture citing an id that was never produced — a
 * stale id after a refactor, a typo, an id from a differently-shaped
 * evidence graph — cannot possibly ground the verdict it's attached to,
 * and this catches that class of error with certainty. It does NOT prove
 * the cited evidence actually *discriminates* the expected verdict from
 * its opposite (fixture 06's original problem: `mustCite` pointed at a
 * real event, `e-ev-1`, that simply didn't contain the fact needed) —
 * that judgment still needs a human or a live model, and this audit
 * makes no claim otherwise.
 */
export interface MustCiteFinding {
  assertionId: string;
  missingEvidenceIds: string[];
}

export function auditMustCite(
  graph: EvidenceGraph,
  expected: Record<string, { mustCite?: string[] } | undefined>,
): MustCiteFinding[] {
  const knownIds = new Set(graph.items.map((item) => item.id));
  const findings: MustCiteFinding[] = [];

  for (const [assertionId, exp] of Object.entries(expected)) {
    const mustCite = exp?.mustCite;
    if (!mustCite || mustCite.length === 0) continue;
    const missingEvidenceIds = mustCite.filter((id) => !knownIds.has(id));
    if (missingEvidenceIds.length > 0) {
      findings.push({ assertionId, missingEvidenceIds });
    }
  }

  return findings;
}
