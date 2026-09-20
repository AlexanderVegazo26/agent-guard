import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

export const sch005: Rule = {
  id: "SCH-005",
  family: "SCH",
  title: "required absent — everything optional",
  defaultSeverity: "warn",
  phase: "static",
  scope: "tool",
  run(ctx: StaticCtx): Finding[] {
    const tool = ctx.tool!;
    const schema = tool.inputSchema;
    if (schema.type !== "object") return [];
    const hasProperties = schema.properties !== undefined && Object.keys(schema.properties).length > 0;
    if (!hasProperties) return []; // nothing to require; SCH-003's territory
    if (schema.required !== undefined) return [];
    return [
      {
        ruleId: "SCH-005",
        severity: "warn",
        confidence: "medium",
        target: { kind: "tool", id: tool.id, path: "$" },
        message: "Input schema declares properties but no required array — everything is optional.",
        rationale: "When nothing is marked required, the model has no signal about which arguments are mandatory for a valid call.",
        evidence: [{ kind: "schema", detail: "required undefined" }],
        suppressible: true,
        baselineStatus: "new",
      },
    ];
  },
};
