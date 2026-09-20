import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

const MAX_LENGTH = 64;

export const nam003: Rule = {
  id: "NAM-003",
  family: "NAM",
  title: "Name exceeds provider length limit",
  defaultSeverity: "error",
  phase: "static",
  scope: "tool",
  run(ctx: StaticCtx): Finding[] {
    const tool = ctx.tool!;
    if (tool.name.length <= MAX_LENGTH) return [];
    return [
      {
        ruleId: "NAM-003",
        severity: "error",
        confidence: "high",
        target: { kind: "tool", id: tool.id },
        message: `Tool name is ${tool.name.length} characters, exceeding the ${MAX_LENGTH}-character provider limit.`,
        rationale: "Names beyond the provider length limit are rejected or truncated.",
        evidence: [{ kind: "length", detail: String(tool.name.length) }],
        suppressible: true,
        baselineStatus: "new",
      },
    ];
  },
};
