import { describe, expect, it } from "vitest";
import { staticRules } from "../rules/index.js";
import { cleanSurface, dirtySurface } from "../fixtures.js";
import { runStaticRules } from "./runner.js";

// All assertions go through runStaticRules (the public runner entry point),
// never by importing a rule's run() directly — a runner that silently never
// dispatches surface-scoped rules would otherwise leave tool-scoped tests
// green while missing half the catalog.

describe("runStaticRules", () => {
  it("produces zero findings on a clean surface (catches over-firing)", () => {
    const findings = runStaticRules(cleanSurface(), staticRules);
    expect(findings).toEqual([]);
  });

  it("fires every rule under test exactly once on the dirty surface (catches under-firing)", () => {
    const findings = runStaticRules(dirtySurface(), staticRules);

    const expected: Array<{ ruleId: string; toolId: string }> = [
      { ruleId: "NAM-001", toolId: "nam001-tool" },
      { ruleId: "NAM-002", toolId: "nam002-tool" },
      { ruleId: "NAM-003", toolId: "nam003-tool" },
      { ruleId: "NAM-004", toolId: "nam004-tool-a" },
      { ruleId: "NAM-004", toolId: "nam004-tool-b" },
      { ruleId: "NAM-005", toolId: "nam005-tool-a" },
      { ruleId: "NAM-005", toolId: "nam005-tool-b" },
      { ruleId: "SCH-001", toolId: "sch001-tool" },
      { ruleId: "SCH-003", toolId: "sch003-tool" },
      { ruleId: "SCH-005", toolId: "sch005-tool" },
      { ruleId: "SCH-006", toolId: "sch006-tool" },
      { ruleId: "SCH-007", toolId: "sch007-tool" },
      { ruleId: "SCH-008", toolId: "sch008-tool" },
      { ruleId: "SCH-021", toolId: "sch021-tool" },
    ];

    // Some fixture tools legitimately trigger more than one rule (e.g. a
    // 70-char name outside the charset trips both NAM-002 and NAM-003; an
    // empty schema {} trips both SCH-001 and SCH-008) — that overlap is
    // correct behavior, not a fixture bug, so the extra pairs are listed
    // explicitly rather than forced away.
    const extraOverlap: Array<{ ruleId: string; toolId: string }> = [
      { ruleId: "SCH-001", toolId: "sch008-tool" },
      { ruleId: "SCH-007", toolId: "sch003-tool" },
      { ruleId: "NAM-002", toolId: "nam003-tool" },
    ];

    for (const { ruleId, toolId } of [...expected, ...extraOverlap]) {

      const matches = findings.filter((f) => f.ruleId === ruleId && f.target.id === toolId);
      expect(matches, `${ruleId} on ${toolId}`).toHaveLength(1);
    }

    // Total count pins the catalog to exactly these findings — no
    // unaccounted-for extra firings beyond the documented overlaps.
    expect(findings).toHaveLength(expected.length + extraOverlap.length);
  });

  it("is deterministic: identical input produces byte-identical (sorted) output across runs", () => {
    const surface = dirtySurface();
    const first = runStaticRules(surface, staticRules);
    const second = runStaticRules(dirtySurface(), staticRules);
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first));
  });

  it("emits every finding at its rule's declared defaultSeverity", () => {
    const findings = runStaticRules(dirtySurface(), staticRules);
    const severityByRuleId = new Map(staticRules.map((r) => [r.id, r.defaultSeverity]));
    for (const finding of findings) {
      expect(finding.severity, finding.ruleId).toBe(severityByRuleId.get(finding.ruleId));
    }
  });

  it("sorts findings by (ruleId, target.id, target.path)", () => {
    const findings = runStaticRules(dirtySurface(), staticRules);
    const keys = findings.map((f) => `${f.ruleId}|${f.target.id}|${f.target.path ?? ""}`);
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});
