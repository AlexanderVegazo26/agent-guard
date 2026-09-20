# @alexvegman/core

Canonical schema, config loading, redaction, run storage, and telemetry for [AgentGuard](https://github.com/AlexanderVegazo26/agent-guard) — the foundation every other `@alexvegman/*` package builds on.

## What's in here

- **Schema** (`schema.ts`) — the canonical types for an agent run, its events, assertion results, adjudications, and guard decisions (Zod-validated at every boundary).
- **Redaction** (`redaction.ts`) — `DefaultRedactor`, applied on the capture hot path and re-verified as defence-in-depth before anything is written to disk. Zero-config default: nothing is ever persisted unredacted.
- **Config loading** (`configLoader.ts`) — the one place ambient environment reads (`ANTHROPIC_API_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`) are resolved; the loaded policy config is deep-frozen so nothing can mutate it after startup.
- **Run storage** (`store.ts`) — `FilesystemRunStore`, a portable, replayable, tamper-evident (SHA-256 manifest) on-disk run store, validating everything it reads back with the schemas above.
- **Evidence packs** (`evidencePack.ts`) — exports a run directory into a self-contained, integrity-checked bundle.
- **Telemetry** (`observability.ts`) — optional OpenTelemetry span export for `engine.decide` calls.
- **Build info** (`buildInfo.ts`) — `getBuildInfo(import.meta.url)`, so any consuming package can report its own version and build commit.

## Install

```
npm install @alexvegman/core
```

## Used by

[`@alexvegman/decision`](https://www.npmjs.com/package/@alexvegman/decision), [`@alexvegman/assertions`](https://www.npmjs.com/package/@alexvegman/assertions), [`@alexvegman/mutations`](https://www.npmjs.com/package/@alexvegman/mutations), [`@alexvegman/reporters`](https://www.npmjs.com/package/@alexvegman/reporters), [`@alexvegman/observe`](https://www.npmjs.com/package/@alexvegman/observe), [`@alexvegman/mcp`](https://www.npmjs.com/package/@alexvegman/mcp), and [`@alexvegman/cli`](https://www.npmjs.com/package/@alexvegman/cli) (the `agentguard` CLI).

Full documentation: [github.com/AlexanderVegazo26/agent-guard](https://github.com/AlexanderVegazo26/agent-guard).
