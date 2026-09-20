import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

const CHARSET = /^[a-zA-Z0-9_-]{1,64}$/;

export const nam002: Rule = {
  id: "NAM-002",
  family: "NAM",
  title: "Name violates provider charset",
  defaultSeverity: "error",
  phase: "static",
  scope: "tool",
  run(ctx: StaticCtx): Finding[] {
    const tool = ctx.tool!;
    if (tool.name.length === 0) return []; // NAM-001's territory
    if (CHARSET.test(tool.name)) return [];
    return [
      {
        ruleId: "NAM-002",
        severity: "error",
        confidence: "high",
        target: { kind: "tool", id: tool.id },
        message: `Tool name "${tool.name}" contains characters outside the provider charset [a-zA-Z0-9_-].`,
        rationale: "Names outside the provider charset are rejected or silently mangled by the API.",
        evidence: [{ kind: "value", detail: tool.name }],
        suppressible: true,
        baselineStatus: "new",
      },
    ];
  },
};
