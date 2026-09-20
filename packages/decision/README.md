# @alexvegman/decision

`DecisionEngine`, `EscalationEngine`, and `FixProposerEngine` abstractions for [AgentGuard](https://github.com/AlexanderVegazo26/agent-guard), plus real implementations: Anthropic-backed (`anthropicDecision.ts`, `anthropicEscalation.ts`, `anthropicFixProposer.ts`) and the production engine (`jev.ts`, built on `@typesafe-ai/sdk`).

## What's in here

- **Interfaces** (`engine.ts`, `escalation.ts`, `fixProposer.ts`) — the three ports `@alexvegman/assertions` and `@alexvegman/cli` depend on, each accepting an optional `AbortSignal` for cancellation.
- **Anthropic implementations** — call the Anthropic API directly; the API key is resolved once through [`@alexvegman/core`](https://www.npmjs.com/package/@alexvegman/core)'s `configLoader.ts`, never read from `process.env` ad hoc inside these files.
- **`JevDecisionEngine`** (`jev.ts`) — the real production decision engine, using `@typesafe-ai/sdk`'s own `AbortSignal` support for genuine mid-flight cancellation.

Every engine here ships a `Mock*Engine` counterpart for testing consumers without a live model call.

## Install

```
npm install @alexvegman/decision
```

## Depends on

[`@alexvegman/core`](https://www.npmjs.com/package/@alexvegman/core).

## Used by

[`@alexvegman/assertions`](https://www.npmjs.com/package/@alexvegman/assertions), [`@alexvegman/mcp`](https://www.npmjs.com/package/@alexvegman/mcp), [`@alexvegman/cli`](https://www.npmjs.com/package/@alexvegman/cli).

Full documentation: [github.com/AlexanderVegazo26/agent-guard](https://github.com/AlexanderVegazo26/agent-guard).
