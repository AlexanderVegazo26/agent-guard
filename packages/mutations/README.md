# @alexvegman/mutations

Mutation-testing registry and profiles for [AgentGuard](https://github.com/AlexanderVegazo26/agent-guard) — validates that [`@alexvegman/assertions`](https://www.npmjs.com/package/@alexvegman/assertions) checks can actually detect the failures they claim to catch, not just pass on clean fixtures.

## What's in here

- **Registry** (`registry.ts`) — a catalog of mutation operators (small, targeted transformations of a passing fixture into a failing one).
- **Profiles** (`profiles.ts`) — named sets of mutations run against a given assertion, so a check's discriminability can be measured, not assumed.

## Install

```
npm install @alexvegman/mutations
```

## Depends on

[`@alexvegman/core`](https://www.npmjs.com/package/@alexvegman/core).

## Used by

[`@alexvegman/cli`](https://www.npmjs.com/package/@alexvegman/cli) (`agentguard audit-fixtures`), [`@alexvegman/mcp`](https://www.npmjs.com/package/@alexvegman/mcp).

Full documentation: [github.com/AlexanderVegazo26/agent-guard](https://github.com/AlexanderVegazo26/agent-guard).
