import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

function normalize(name: string): string {
  return name.replace(/[_-]/g, "").toLowerCase();
}

export const nam005: Rule = {
  id: "NAM-005",
  family: "NAM",
  title: "Case-insensitive or separator-insensitive near-duplicate name",
  defaultSeverity: "error",
  phase: "static",
  scope: "surface",
  run(ctx: StaticCtx): Finding[] {
    const seen = new Map<string, Set<string>>(); // normalized -> set of distinct original names

    for (const tool of ctx.surface.tools) {
      const key = normalize(tool.name);
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(tool.name);
    }

    const findings: Finding[] = [];
    for (const tool of ctx.surface.tools) {
      const key = normalize(tool.name);
      const distinctNames = seen.get(key)!;
      // Exact duplicates are NAM-004's territory; NAM-005 fires only when
      // the normalized form collides across two *different* original names.
      if (distinctNames.size <= 1) continue;
      findings.push({
        ruleId: "NAM-005",
        severity: "error",
        confidence: "high",
        target: { kind: "tool", id: tool.id },
        message: `Tool name "${tool.name}" is a case/separator-insensitive near-duplicate of: ${[...distinctNames].filter((n) => n !== tool.name).join(", ")}.`,
        rationale: "Names that differ only by case or separator style are effectively indistinguishable to a model routing on name similarity.",
        evidence: [{ kind: "normalized", detail: key }],
        suppressible: true,
        baselineStatus: "new",
      });
    }
    return findings;
  },
};
