import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

export const sch007: Rule = {
  id: "SCH-007",
  family: "SCH",
  title: "additionalProperties not set to false at the root",
  defaultSeverity: "warn",
  phase: "static",
  scope: "tool",
  run(ctx: StaticCtx): Finding[] {
    const tool = ctx.tool!;
    const schema = tool.inputSchema;
    if (schema.type !== "object") return [];
    if (schema.additionalProperties === false) return [];
    return [
      {
        ruleId: "SCH-007",
        severity: "warn",
        confidence: "medium",
        target: { kind: "tool", id: tool.id, path: "$" },
        message: "additionalProperties is not set to false at the schema root.",
        rationale: "Without additionalProperties: false, the model may pass unexpected fields that silently do nothing or mask a typo in an intended field name.",
        evidence: [{ kind: "value", detail: JSON.stringify(schema.additionalProperties) }],
        suppressible: true,
        baselineStatus: "new",
      },
    ];
  },
};
