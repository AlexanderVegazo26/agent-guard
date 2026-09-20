import type { Finding, ToolSpec, ToolSurface } from "@alexvegman/toolsmith-core";

export type Family = "NAM" | "SCH";

/**
 * Context handed to a rule's run(). Every rule in this slice is
 * scope: 'tool' or scope: 'surface' (§8.1); both cases fit one context
 * shape carrying the whole surface plus (when applicable) the tool under
 * focus, so the runner can dispatch either kind through one code path
 * (per-scope generics were explicitly rejected as out of scope for this
 * session).
 */
export interface StaticCtx {
  surface: ToolSurface;
  /** Present when rule.scope === 'tool'; absent for 'surface'-scoped rules. */
  tool?: ToolSpec;
}

/**
 * Rule contract (§8.1), trimmed to the static phase: no `requires`,
 * `options`, `fix`, `docsUrl`/`stability` bookkeeping — those are real
 * fields in the doc but unused by anything this slice runs or tests.
 */
export interface Rule {
  id: string;
  family: Family;
  title: string;
  defaultSeverity: "error" | "warn" | "info";
  phase: "static";
  scope: "tool" | "surface";
  run(ctx: StaticCtx): Finding[];
}
