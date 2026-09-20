import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

export const sch006: Rule = {
  id: "SCH-006",
  family: "SCH",
  title: "required lists a key not in properties",
  defaultSeverity: "error",
  phase: "static",
  scope: "tool",
  run(ctx: StaticCtx): Finding[] {
    const tool = ctx.tool!;
    const schema = tool.inputSchema;
    if (!schema.required) return [];
    const propertyKeys = new Set(Object.keys(schema.properties ?? {}));
    const findings: Finding[] = [];
    for (const key of schema.required) {
      if (propertyKeys.has(key)) continue;
      findings.push({
        ruleId: "SCH-006",
        severity: "error",
        confidence: "high",
        target: { kind: "tool", id: tool.id, path: `$.required[${key}]` },
        message: `"${key}" is listed in required but is not a declared property.`,
        rationale: "A required key with no matching property definition cannot ever be validated or documented, and most schema validators reject it outright.",
        evidence: [{ kind: "key", detail: key }],
        suppressible: true,
        baselineStatus: "new",
      });
    }
    return findings;
  },
};
