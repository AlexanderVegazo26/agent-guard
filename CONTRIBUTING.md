# Contributing to AgentGuard

## Setup

```bash
bun install
```

Node.js >= 26 is required at runtime (see `engines` in `package.json` and `.nvmrc`); the workspace itself is built and tested with Bun.

## Working on the codebase

```bash
bun run build       # tsc -b, project references across all 7 packages
bun run test         # vitest — the full unit/integration suite
bun run test:watch   # vitest, watch mode
bun run test:e2e     # real Playwright + @playwright/cli e2e specs (packages/playwright/e2e)
bun run lint         # oxlint .
```

All four (`build`, `test`, `lint`, and `test:e2e` where relevant) must be clean before a change is considered done. `tsc -b` and `oxlint .` are authoritative — do not rely on a summarized or cached report of either.

## Principles this project does not compromise on

These are load-bearing (see `docs/PRD.md`, `docs/PRD2.md`, `docs/PRD3.md` §4.1 for the full reasoning):

1. **AgentGuard never assumes that what an agent says happened is what actually happened.** Every assertion's evidence must trace to observed execution — tool calls, network traffic, application state — never to the agent's own narration.
2. **Deterministic-first, always.** Never ask the decision engine something code can already prove.
3. **Mechanical selection, never summarization.** Evidence sent to the decision engine is always whole, verbatim items. A "helpful" step that paraphrases or condenses evidence before sending it is a narrator, not a selector, and is not acceptable here regardless of how well-intentioned.
4. **Fail-closed.** An unavailable or erroring decision engine, guard, or config load must never be silently treated as a PASS or an ALLOW.
5. **No verdict API.** Nothing outside the `evaluate()` pipeline may produce or accept an `AssertionResult`. The MCP server in particular must never gain a tool that lets an agent under test assert its own verdict.

## Documentation integrity

A prose comment describing a limitation ("not implemented", "declared but not…", "see repo notes") is treated as a defect risk, not documentation — see `docs/PRD3.md` §3 for a full account of what happens when these drift from the code. When you fix or extend something a comment describes as missing, update or remove that comment in the same change. When you leave something genuinely unimplemented, say so precisely (what, why, and what would have to be true to implement it) rather than pointing at "repo notes" that may not exist by the time someone reads the comment.

## Tests

- A new assertion, CLI command, or capture path needs both a unit test and, where it changes a verdict, a fixture under `fixtures/golden/` or `fixtures/correct/`.
- A fixture ships only if it is *discriminating*: the evidence it provides must actually distinguish the expected verdict from its opposite (see `docs/AUTOFIX.md` §4.1 and `mustCiteAudit.ts`). A fixture whose mock is scripted to fail but whose evidence doesn't establish why is not a valid regression test.
- Golden and correct-behavior suites are re-run against the real Jev engine only under `--live`, deliberately, since that spends real API budget.

## Docs

`docs/` is tracked in this repository. `PRD.md` (v0.6, MVP), `PRD2.md`, and `PRD3.md` are a sequential record — do not edit an earlier one to match current reality; each documents what was true and decided when it was written. Add a new one, or an addendum, instead.
