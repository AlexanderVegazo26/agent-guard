import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

export const nam001: Rule = {
  id: "NAM-001",
  family: "NAM",
  title: "Name missing or empty",
  defaultSeverity: "error",
  phase: "static",
  scope: "tool",
  run(ctx: StaticCtx): Finding[] {
    const tool = ctx.tool!;
    if (tool.name.trim().length > 0) return [];
    return [
      {
        ruleId: "NAM-001",
        severity: "error",
        confidence: "high",
        target: { kind: "tool", id: tool.id },
        message: "Tool name is missing or empty.",
        rationale: "A model routes primarily on the tool name; an empty name cannot be selected meaningfully.",
        evidence: [{ kind: "value", detail: JSON.stringify(tool.name) }],
        suppressible: true,
        baselineStatus: "new",
      },
    ];
  },
};
