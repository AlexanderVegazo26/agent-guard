# @alexvegman/assertions

Assertion and verdict evaluation for AI agent transcripts against policy — the review logic behind `agentguard review-pr` ([`@alexvegman/cli`](https://www.npmjs.com/package/@alexvegman/cli)), part of [AgentGuard](https://github.com/AlexanderVegazo26/agent-guard).

## What's in here

- **Assertion checks** (`codingVertical.ts`, `claimChecks.ts`, `budget.ts`, `requirements.ts`, and more) — the individual pass/fail/review checks run against a captured agent run.
- **Verdict aggregation** (`verdict.ts`) — combines per-assertion results into a final PASS/FAIL/REVIEW, per AgentGuard's "review wins over not_applicable" rule.
- **Calibration** (`calibrationConfidence.ts`, `fanoutCalibration.ts`) — statistical checks on the assertion suite's own reliability.
- **Escalation** (`escalate.ts`) — hands an unclear verdict to an [`@alexvegman/decision`](https://www.npmjs.com/package/@alexvegman/decision) `EscalationEngine`, leaving it as an explained REVIEW rather than throwing if escalation itself fails.
- **Mutation-tested** — every assertion here is exercised by [`@alexvegman/mutations`](https://www.npmjs.com/package/@alexvegman/mutations)' profiles to confirm it can actually detect the failure it claims to catch.

## Install

```
npm install @alexvegman/assertions
```

## Depends on

[`@alexvegman/core`](https://www.npmjs.com/package/@alexvegman/core), [`@alexvegman/decision`](https://www.npmjs.com/package/@alexvegman/decision).

## Used by

[`@alexvegman/cli`](https://www.npmjs.com/package/@alexvegman/cli), [`@alexvegman/mcp`](https://www.npmjs.com/package/@alexvegman/mcp).

Full documentation: [github.com/AlexanderVegazo26/agent-guard](https://github.com/AlexanderVegazo26/agent-guard).
