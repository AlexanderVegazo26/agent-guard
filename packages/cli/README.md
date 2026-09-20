# @alexvegman/cli

The `agentguard` command-line tool for [AgentGuard](https://github.com/AlexanderVegazo26/agent-guard) — captures, reviews, and repairs AI agent tool-use behavior.

## Install

```
npm install -g @alexvegman/cli
```

## Commands

| Command | What it does |
|---|---|
| `agentguard init` | Scaffold an `agentguard.config.ts` in the current project. |
| `agentguard watch` | Capture a live agent run (from a transcript file or a wrapped command) and evaluate it. |
| `agentguard test` | Run AgentGuard's assertion suite against a captured run. |
| `agentguard review-pr` | Review a git diff for correctness/test/secret hygiene — used in CI. |
| `agentguard replay` | Re-run the evaluation pipeline over a stored run with no browser, agent, or network. |
| `agentguard report` | Render a stored run's results (console, JSON, JUnit, HTML). |
| `agentguard compare` | Diff two runs' results. |
| `agentguard calibrate` | Check assertion calibration/confidence against `@alexvegman/mutations` profiles. |
| `agentguard audit-fixtures` | Verify golden/correct-behavior fixtures are actually discriminable. |
| `agentguard autofix propose` / `show` | Propose and inspect an automatic fix from a pattern of failing runs. |
| `agentguard export-pack` | Export a run directory into a self-contained, integrity-checked evidence pack. |
| `agentguard doctor` | Diagnose local environment/config issues. |
| `agentguard history` | List and inspect prior runs. |
| `agentguard tokens` | Report token usage for a run. |
| `agentguard --version` | Print the installed version and build commit. |

## Depends on

[`@alexvegman/core`](https://www.npmjs.com/package/@alexvegman/core), [`@alexvegman/decision`](https://www.npmjs.com/package/@alexvegman/decision), [`@alexvegman/assertions`](https://www.npmjs.com/package/@alexvegman/assertions), [`@alexvegman/reporters`](https://www.npmjs.com/package/@alexvegman/reporters), [`@alexvegman/mutations`](https://www.npmjs.com/package/@alexvegman/mutations).

Full documentation: [github.com/AlexanderVegazo26/agent-guard](https://github.com/AlexanderVegazo26/agent-guard).
