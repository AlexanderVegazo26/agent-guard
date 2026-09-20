import type { Finding, JSONSchema } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

/** Walks every property depth-first, looking for array schemas without `items`. */
function walk(schema: JSONSchema, path: string, toolId: string, findings: Finding[]): void {
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

  if (types.includes("array") && schema.items === undefined) {
    findings.push({
      ruleId: "SCH-021",
      severity: "error",
      confidence: "high",
      target: { kind: "tool", id: toolId, path },
      message: `Array property at "${path}" has no items schema.`,
      rationale: "Without an items schema, the model has no guidance on what each array element should look like, and array contents cannot be validated.",
      evidence: [{ kind: "schema", detail: "items undefined" }],
      suppressible: true,
      baselineStatus: "new",
    });
  }

  if (schema.properties) {
    for (const [key, child] of Object.entries(schema.properties)) {
      walk(child, `${path}.${key}`, toolId, findings);
    }
  }
  if (schema.items) {
    walk(schema.items, `${path}[]`, toolId, findings);
  }
}

export const sch021: Rule = {
  id: "SCH-021",
  family: "SCH",
  title: "Array without items schema",
  defaultSeverity: "error",
  phase: "static",
  scope: "tool",
  run(ctx: StaticCtx): Finding[] {
    const tool = ctx.tool!;
    const findings: Finding[] = [];
    walk(tool.inputSchema, "$", tool.id, findings);
    return findings;
  },
};
