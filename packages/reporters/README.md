# @alexvegman/reporters

Report formatters for [AgentGuard](https://github.com/AlexanderVegazo26/agent-guard) run results.

## What's in here

- **Console** (`console.ts`) — human-readable terminal output.
- **JSON** (`json.ts`) — the machine-readable report shape (`ReportV1`), validated with Zod.
- **JUnit** (`junit.ts`) — CI-friendly XML for test-result dashboards.
- **HTML** (`html.ts`) — a standalone, shareable report page.
- **Compare** (`compare.ts`) — diffs two runs' reports (used by `agentguard review-pr`).

## Install

```
npm install @alexvegman/reporters
```

## Depends on

[`@alexvegman/core`](https://www.npmjs.com/package/@alexvegman/core).

## Used by

[`@alexvegman/cli`](https://www.npmjs.com/package/@alexvegman/cli), [`@alexvegman/mcp`](https://www.npmjs.com/package/@alexvegman/mcp).

Full documentation: [github.com/AlexanderVegazo26/agent-guard](https://github.com/AlexanderVegazo26/agent-guard).
