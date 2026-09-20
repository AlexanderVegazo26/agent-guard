import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

export const sch001: Rule = {
  id: "SCH-001",
  family: "SCH",
  title: 'Root is not type: "object"',
  defaultSeverity: "error",
  phase: "static",
  scope: "tool",
  run(ctx: StaticCtx): Finding[] {
    const tool = ctx.tool!;
    if (tool.inputSchema.type === "object") return [];
    return [
      {
        ruleId: "SCH-001",
        severity: "error",
        confidence: "high",
        target: { kind: "tool", id: tool.id, path: "$" },
        message: `Input schema root type is ${JSON.stringify(tool.inputSchema.type)}, not "object".`,
        rationale: "Tool call arguments are always a JSON object; a non-object root cannot be populated by any provider.",
        evidence: [{ kind: "type", detail: JSON.stringify(tool.inputSchema.type) }],
        suppressible: true,
        baselineStatus: "new",
      },
    ];
  },
};
