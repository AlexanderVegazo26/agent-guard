# @alexvegman/toolsmith-core

Canonical IR types (`ToolSpec`, `ToolSurface`, `Finding`, `Provenance`) for **Toolsmith** — a tool-surface linter for LLM agent tool definitions, distinct from [AgentGuard](https://github.com/AlexanderVegazo26/agent-guard) (the runtime tool-use reviewer this monorepo is otherwise about).

This package has zero internal dependencies by design — every adapter and rule in [`@alexvegman/toolsmith-engine`](https://www.npmjs.com/package/@alexvegman/toolsmith-engine) is normalized to these types.

## Install

```
npm install @alexvegman/toolsmith-core
```

## Used by

[`@alexvegman/toolsmith-engine`](https://www.npmjs.com/package/@alexvegman/toolsmith-engine).

Full documentation: [github.com/AlexanderVegazo26/agent-guard](https://github.com/AlexanderVegazo26/agent-guard) (see `docs/Architecture-check.md`).
