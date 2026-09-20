import type { Finding } from "@alexvegman/toolsmith-core";
import type { Rule, StaticCtx } from "../../rule.js";

export const sch008: Rule = {
  id: "SCH-008",
  family: "SCH",
  title: 'Empty schema ({}) — "pass whatever you want"',
  defaultSeverity: "error",
  phase: "static",
  scope: "tool",
  run(ctx: StaticCtx): Finding[] {
    const tool = ctx.tool!;
    if (Object.keys(tool.inputSchema).length > 0) return [];
    return [
      {
        ruleId: "SCH-008",
        severity: "error",
        confidence: "high",
        target: { kind: "tool", id: tool.id, path: "$" },
        message: "Input schema is an empty object ({}) — it imposes no constraints at all.",
        rationale: 'An empty schema tells the model "pass whatever you want," producing unparseable or nonsensical calls.',
        evidence: [{ kind: "schema", detail: "{}" }],
        suppressible: true,
        baselineStatus: "new",
      },
    ];
  },
};
