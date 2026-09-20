import type { Finding, ToolSurface } from "@alexvegman/toolsmith-core";
import type { Rule } from "../rule.js";

/**
 * §8.2 phase 2 (static), restricted to this slice's rule set. Dispatches
 * each rule once per its declared scope:
 *  - 'surface' rules run once per surface, with ctx.tool absent.
 *  - 'tool' rules run once per tool in the surface, with ctx.tool set.
 *
 * §4.3 determinism: results are sorted by (ruleId, target.id, target.path)
 * so two runs over identical input produce byte-identical ordering.
 */
export function runStaticRules(surface: ToolSurface, rules: Rule[]): Finding[] {
  const findings: Finding[] = [];

  for (const rule of rules) {
    if (rule.scope === "surface") {
      findings.push(...rule.run({ surface }));
    } else {
      for (const tool of surface.tools) {
        findings.push(...rule.run({ surface, tool }));
      }
    }
  }

  return sortFindings(findings);
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    if (a.ruleId !== b.ruleId) return a.ruleId < b.ruleId ? -1 : 1;
    if (a.target.id !== b.target.id) return a.target.id < b.target.id ? -1 : 1;
    const ap = a.target.path ?? "";
    const bp = b.target.path ?? "";
    if (ap !== bp) return ap < bp ? -1 : 1;
    return 0;
  });
}
