# @alexvegman/toolsmith-engine

A pure static rule engine for **Toolsmith** — evaluates a `ToolSurface` ([`@alexvegman/toolsmith-core`](https://www.npmjs.com/package/@alexvegman/toolsmith-core)) against a catalog of rules and returns `Finding[]`, deterministically (same IR + same config → byte-identical output).

## What's in here

- **Rule contract** (`rule.ts`) — `id`, `phase`, `run(ctx)`.
- **Runner** (`runner/runner.ts`) — dispatches tool-scoped and surface-scoped rules, sorts output for determinism.
- **Starter rule set** — `NAM-001..005` (naming defects: empty/invalid/duplicate/near-duplicate tool names) and `SCH-001,003,005,006,007,008,021` (schema defects: missing `properties`, no `required`, dangling `required` reference, `additionalProperties` not `false`, empty schema, array without `items`).

This is a first slice of a much larger check catalog — see `docs/Architecture-check.md` in the main repo for the full spec and what's intentionally not implemented yet (semantic/runtime/eval-phase rules, adapters, the fix loop).

## Install

```
npm install @alexvegman/toolsmith-engine
```

## Depends on

[`@alexvegman/toolsmith-core`](https://www.npmjs.com/package/@alexvegman/toolsmith-core).

Full documentation: [github.com/AlexanderVegazo26/agent-guard](https://github.com/AlexanderVegazo26/agent-guard).
