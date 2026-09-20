/**
 * `@agent-guard/mutations` — PRD3 F14 / A4: the mutation catalogue as a
 * package with a registry, separate from `HttpFaultProxy`'s mechanism
 * (`@agent-guard/observe`) and from `FaultSpec` itself, which stays in
 * `@agent-guard/core` because `AgentRun.faults` already references it and
 * `core` cannot depend on this package without a cycle. This package
 * depends on `core` for the `FaultSpec` type and re-exports nothing of it —
 * callers needing to construct a `FaultSpec` directly still import it from
 * `@agent-guard/core`.
 */
export * from "./registry.js";
export * from "./profiles.js";
