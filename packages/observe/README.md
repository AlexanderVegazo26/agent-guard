# @alexvegman/observe

Runtime observation for AI agents, part of [AgentGuard](https://github.com/AlexanderVegazo26/agent-guard).

## What's in here

- **`HttpFaultProxy`** (`proxy.ts`) — an HTTP/HTTPS (MITM) fault-injection proxy for exercising an agent's tool-use error handling in tests, with redaction applied by default before anything is captured.
- **MCP guard** (`guard.ts`, `mcp.ts`) — `evaluateGuard()` and `ObservingTransport`, a fail-closed pre-execution check on MCP tool calls: a policy match returns a typed `GuardResult` (`allow` / `block` / `review`, with a stable `reasonCode`), and a thrown control never silently allows a call through.

## Install

```
npm install @alexvegman/observe
```

## Depends on

[`@alexvegman/core`](https://www.npmjs.com/package/@alexvegman/core).

## Used by

[`@alexvegman/mcp`](https://www.npmjs.com/package/@alexvegman/mcp), [`@alexvegman/playwright`](https://github.com/AlexanderVegazo26/agent-guard/tree/main/packages/playwright) (internal, not published).

Full documentation: [github.com/AlexanderVegazo26/agent-guard](https://github.com/AlexanderVegazo26/agent-guard).
