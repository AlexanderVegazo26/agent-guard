import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

export const nam004: Rule = {
  id: "NAM-004",
  family: "NAM",
  title: "Duplicate name within a surface",
  defaultSeverity: "error",
  phase: "static",
  scope: "surface",
  run(ctx: StaticCtx): Finding[] {
    const counts = new Map<string, number>();
    for (const tool of ctx.surface.tools) {
      counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
    }

    const findings: Finding[] = [];
    for (const tool of ctx.surface.tools) {
      const count = counts.get(tool.name) ?? 0;
      if (count <= 1) continue;
      findings.push({
        ruleId: "NAM-004",
        severity: "error",
        confidence: "high",
        target: { kind: "tool", id: tool.id },
        message: `Tool name "${tool.name}" is used by ${count} tools in this surface.`,
        rationale: "A model cannot distinguish two tools that present the same name.",
        evidence: [{ kind: "count", detail: String(count) }],
        suppressible: true,
        baselineStatus: "new",
      });
    }
    return findings;
  },
};
