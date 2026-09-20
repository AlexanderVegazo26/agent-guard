import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

export const sch003: Rule = {
  id: "SCH-003",
  family: "SCH",
  title: "properties missing on an object type",
  defaultSeverity: "error",
  phase: "static",
  scope: "tool",
  run(ctx: StaticCtx): Finding[] {
    const tool = ctx.tool!;
    const schema = tool.inputSchema;
    if (schema.type !== "object") return []; // SCH-001's territory
    if (schema.properties !== undefined) return [];
    return [
      {
        ruleId: "SCH-003",
        severity: "error",
        confidence: "high",
        target: { kind: "tool", id: tool.id, path: "$" },
        message: 'Input schema is type "object" but declares no properties.',
        rationale: "Without a properties map the model has no field-level guidance on what to pass.",
        evidence: [{ kind: "schema", detail: "properties undefined" }],
        suppressible: true,
        baselineStatus: "new",
      },
    ];
  },
};
