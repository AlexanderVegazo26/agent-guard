import { DefaultEvidenceCompiler, auditMustCite } from "@agent-guard/core";
import { loadFixtureSuite } from "../fixtures.js";

export interface AuditFixturesCommandOptions {
  fixturesRoot: string;
}

/**
 * PRD2 F10 / AUTOFIX.md §4.1 — `agentguard audit-fixtures`. The
 * mechanical, honest slice of "the discriminating-evidence audit":
 * checks every fixture's `mustCite` evidence ids actually exist in the
 * compiled evidence graph. Does NOT prove the cited evidence actually
 * *discriminates* the expected verdict from its opposite — that needs a
 * human or a live model (see `auditMustCite`'s own doc comment) — this
 * is the cheap, certain, mechanical half of it, run across the whole
 * suite instead of by hand per fixture (which is how fixture 06's gap
 * was originally found, PRD2 G2).
 */
export async function runAuditFixturesCommand(options: AuditFixturesCommandOptions): Promise<number> {
  const fixtures = await loadFixtureSuite(options.fixturesRoot);
  let totalFindings = 0;

  for (const fixture of fixtures) {
    const graph = await new DefaultEvidenceCompiler().compile(fixture.run);
    const findings = auditMustCite(graph, fixture.expected);
    if (findings.length === 0) continue;

    totalFindings += findings.length;
    console.error(`\n  ${fixture.name}`);
    for (const finding of findings) {
      console.error(`    ${finding.assertionId}: mustCite references evidence that doesn't exist — ${finding.missingEvidenceIds.join(", ")}`);
    }
  }

  if (totalFindings === 0) {
    console.log(`agentguard audit-fixtures: ${fixtures.length} fixture(s) checked, every mustCite id resolves to real evidence.`);
    return 0;
  }

  console.error(`\nagentguard audit-fixtures: ${totalFindings} finding(s) across ${fixtures.length} fixture(s).`);
  return 1;
}
