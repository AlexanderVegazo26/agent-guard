# AgentGuard — Product Requirements Document 3

**Version:** 1.0
**Status:** Proposed
**Date:** 2026-09-19
**Supersedes:** nothing. [`PRD.md`](./PRD.md) v0.6 remains the record of the MVP; [`PRD2.md`](./PRD2.md) remains the record of the second cycle and of what was shipped against it on 2026-09-19. PRD3 starts from the code as it exists at commit `9e0e19e`, not from either document's promises.
**Companions:** [`TRD.md`](./TRD.md) (architecture as designed), [`AUTOFIX.md`](./AUTOFIX.md) (fix loop, half built), [`dirty-requirement.md`](./dirty-requirement.md) (the original vision this document audits against).

---

## 0. Reading guide

| Section | Answers |
|---|---|
| §1 | What exists today, re-measured, and how PRD2's eleven features actually landed |
| §2 | What the original vision asked for that no cycle has scheduled |
| §3 | Where the code and its own documentation disagree |
| §4 | Architecture assessment: what is strong, what is load-bearing and untested, what to change |
| §5 | The PRD3 feature set (F12-F22), plus the PRD2 remainder it absorbs |
| §6 | Success criteria for the cycle |
| §7 | Roadmap |
| §8 | Risks |
| Appendices | Feature status matrix, test-coverage matrix, drift register, OWASP delta |

Two principles carry over verbatim from PRD v0.6 and PRD2 and still resolve every ambiguity here:

> **AgentGuard never assumes that what an agent says happened is what actually happened.**

> **A run is not only a test result. It is a record.**

PRD3 adds a third, forced by what §3 and §4 found:

> **A verdict is only as trustworthy as the path that produced it.** Every capture path, selection window, degradation rung and engine call must be observable in the run record and exercised by a test. A limitation that exists only as a prose comment is a defect.

---

## 1. Where the project actually is

### 1.1 Re-measured on 2026-09-19

Build, lint and the full test suite were run for this document with the real toolchain (`bun run build`, `bun run test`, `bun run lint`), not summarised proxies.

| Measurement | Value |
|---|---|
| `tsc -b` | clean |
| `oxlint .` | clean |
| Vitest files / tests | 46 / 345, all passing |
| Playwright e2e | 2 specs (`packages/playwright/e2e/agentguard.spec.ts`), run separately |
| Golden fixtures | 20 (`fixtures/golden/`) |
| Correct-behavior fixtures | 10 (`fixtures/correct/`) |
| Workspace packages | 7, all `"private": true`, all `0.1.0` |
| Commits | 32 |
| Live Jev runs to date | 2, both 2026-09-19 |

### 1.2 How PRD2's eleven features landed

PRD2 was edited in place as features shipped, so its §5 now reads as a strike-through log. The clean status is:

| Feature | Promised (PRD2) | Shipped | Remaining |
|---|---|---|---|
| F1 Adjudication | `review list/record`, held-out set, calibrate integration, JSON round-trip | `review list/record`, `adjudications.json`, calibration record conversion, JSON reporter round-trip | held-out report (`test --held-out`), `calibrate` distinguishing adjudicated from fixture records, `--from junit\|json` import |
| F2 Online guard | MCP proxy + fixture middleware, deterministic then Jev pre-checks, allow/block/review, guard events | All of it **deterministic-only**: `evaluateGuard`, `ObservingTransport` guard hook, `guard_decision` event, verified against the real MCP SDK | live-Jev pre-action checks; `review` routed to a human (today `review` = `block`); latency budget |
| F3 OWASP catalogue | `tool_definition` evidence, 3 assertions, 17-item mutation catalogue, `report --owasp` | `tool_definition` event + `tools/list` capture | all three assertions, every mutation, rug-pull re-capture, `--adversarial`, `report --owasp` |
| F4 Compliance pack | archive export, `verify-pack`, engine version, signing, `retain`, `COMPLIANCE.md` | directory export + SHA-256 manifest, `verify-pack` | archive format, engine/model identity in manifest, signing, retention, Article 12 mapping doc |
| F5 Trace ingestion | OTel importer, framework adapters, emit SDK, intent routing, `--format otel` | `AgentRun.source` tag + advisory | everything else; no importer of any kind |
| F6 Fleet view | `history`, drift test, Jev fleet classification, dashboard | `history --assertion --baseline` with a 30-point crude threshold | real statistical test, `--agent` filter, fleet classification, dashboard |
| F7 Hardening | G0a-c, G2, G3, G6-G9, G11, §4.1 list | G0a-c, G2, appendEvent, MITM leak, 4xx linker, calibration polarity, flag parser, MCP bin, dead branch, path matching, fixture 06 | G3 rewording, G6 boundary fixtures, G7 claim benchmark, G8 live ladder, G9 estimator, G11 parity (partial), ladder rungs, escalation for fan-outs, `reviewAsFailure` in CLI |
| F8 Coding vertical | 4 deterministic + 3 Noul assertions, GitHub Action, REVIEW into F1 | deterministic five (`testsAdded`, `testsPassed`, `claimedTestsExist`, `dependencyRisk`, mechanical `noSecretsInDiff`), `review-pr` over real `git diff` | `diffMatchesTask`, `noUnrelatedChanges`, semantic secrets, CI status source, GitHub Action, junit parser |
| F9 Multi-agent | `agent_spawn`/`agent_result` events, attributed claims, 2 assertions | events + attributed claims | both assertions; **no capture path emits these events** |
| F10 Autofix gate | AUTOFIX §4 prerequisites, §5 gate | `auditMustCite` (existence only), variance floor primitive | per-assertion held-out sets, the gate, `autofix validate/apply` |
| F11 Distribution | npm publish, `init` fix, `--lang` advisory | language advisory | npm publish, `npx agentguard`, runnable `init` output |

The pattern is consistent and deliberate: every feature that needed a Noul question shipped its deterministic half and stopped. That discipline was correct. It has also created a queue of six features (F2, F3, F5, F8, F9, F10) blocked on a single unscheduled activity, live validation against Jev, which PRD3 turns into a feature of its own (F19).

### 1.3 Package map, as built versus as envisioned

`dirty-requirement.md` §16 proposed `apps/{cli,dashboard}` and `packages/{core,jev,playwright,assertions,mutations,adapters,reporters}`. What exists:

| Envisioned | Built | Note |
|---|---|---|
| `core` | `@agent-guard/core` | Also absorbed redaction (from `observe`, PRD2 G0a), the transcript adapter, calibration, history, evidence pack, config loader. It is the only leaf and has grown to 18 modules |
| `jev` | `@agent-guard/decision` | Correct generalisation: `DecisionEngine`, `EscalationEngine`, `FixProposerEngine` with Jev, Anthropic and mock implementations |
| `playwright` | `@agent-guard/playwright` | Fixture, CLI adapter, factory-based agent wrapping |
| `assertions` | `@agent-guard/assertions` | 21 assertions, pipeline, selection, verdicts; also `codingVertical.ts`, which is standalone and not one of the 21 |
| `mutations` | none | `FaultSpec` has two variants and lives in `core/schema.ts`; the proxy that applies them lives in `observe` |
| `adapters` | none | Transcript adapter is in `core`; nothing else exists |
| `reporters` | `packages/cli/src/reporters/{json,junit,html}.ts` + `core/consoleReporter.ts` | Not importable by the Playwright fixture or the MCP server |
| `apps/cli` | `@agent-guard/cli` | 14 command modules |
| `apps/dashboard` | none | HTML report only |
| — | `@agent-guard/observe` | Proxy, MCP transport observation, guard. Not in the original layout; correct addition |
| — | `@agent-guard/mcp` | Seven-tool server plus stdio bin |

Dependency graph is acyclic: `core` ← `decision` ← `assertions` ← {`playwright`, `mcp`, `cli`}; `observe` depends only on `core`; `playwright` is the only consumer of `observe`. Two oddities: the root `package.json` lists three workspace packages as devDependencies of the root itself, and `vitest.config.ts` aliases every `@agent-guard/*` import to TS source, so tests never exercise the built `dist` entry points that `bin` fields and `exports` maps point at.

---

## 2. Vision items never scheduled

Items in `dirty-requirement.md` that neither PRD v0.6, PRD2 nor the code has addressed. Each is either scheduled in §5 or explicitly retired here.

| # | Vision item (source §) | State in code | PRD3 disposition |
|---|---|---|---|
| V1 | Mutation catalogue of 15 types (§13, PRD App. C) | `FaultSpec` (`packages/core/src/schema.ts:31-45`) has `http` and `prompt-injection` only. `agentguard_mutate` records an event and starts no proxy (`packages/mcp/src/server.ts`) | **F14** |
| V2 | `agentguard test --adversarial` with per-dimension mutation scores (§14) | absent | **F14** |
| V3 | `agentguard trace inspect <run>` (§33) | absent; `report` and the HTML reporter are the only inspection surface | **F17** (report contract) then dashboard |
| V4 | `agentguard replay <run>` as re-execution (§33) | `replay` re-evaluates stored evidence only | Retired as re-execution. Re-running an agent is the agent's job; AgentGuard replays *evaluation*. Rename is not worth the churn; document the meaning |
| V5 | `snapshots/`, `trace/`, `screenshots/` in the run dir (§36, TRD §10.1) | `store.ts:13-14`: "not implemented here… no browser capture exists in this build to produce them" | **F13** (capture pipeline gives artifacts a sink) |
| V6 | Reporters as a package with console/JSON/JUnit/HTML (§17) | in `cli` and `core`; no schema version on the JSON report | **F17** |
| V7 | HTML dashboard (§51 Phase 4, PRD2 F6) | HTML report per run only | **F21**, after F17 |
| V8 | PostgreSQL + object storage (§37) | filesystem only; no store interface | **F16** defines the port; Postgres stays P2 |
| V9 | Agent adapters: OpenAI, Anthropic, Gemini, MCP, LangGraph, generic (§17) | generic transcript adapter only | **F5** (OTel importer) is the right shape; framework-specific parsers are retired in favour of OTel |
| V10 | OpenTelemetry export of AgentGuard's own metrics (§45) | absent | **F20** |
| V11 | Meta-tests: "test whether AgentGuard correctly identifies known agent failures" (§46) | golden suite exists but a fixture can pass under the mock while the real path fails (PRD2 G0c proved it) | **F18** (discriminability + engine-parity tests) |
| V12 | Configurable `redact({apiKeys, cookies, authorizationHeaders, pii})` (§41) | `DefaultRedactor` redacts by key name, exact secret, and one login-URL rule; no pattern library; `redaction` config declared but not consumed (`policy.ts:3-5`) | **F13** |
| V13 | `ci.reviewAsFailure` (§43) | honoured by the Playwright fixture, ignored by `exitCode.ts` | **F15** |
| V14 | Observability of the framework itself: assertion latency, Jev calls, escalations (§45) | `durationMs` per assertion only | **F20** |
| V15 | Distributed runs, agent controller (§39 FR-019/020) | absent | Retired for this cycle. No user has asked; F16's store port is the only prerequisite worth laying |

---

## 3. Where the code disagrees with itself

An independent read of every `packages/*/src` file for this document found **zero** `TODO` or `FIXME` tokens and twelve places where a prose comment or a README line states something the code beside it contradicts. None of these are bugs in behaviour. All of them are bugs in trust, because a reader who believes the comment will make a wrong decision.

| # | Location | Says | Reality |
|---|---|---|---|
| D1 | `packages/assertions/src/definitions.ts:5-13` | tighter selection windows are "declared but not implemented" | `selection.ts` implements `tool-call-neighborhood` (±5 seq) and `from-injection-onward`, with tests |
| D2 | `packages/core/src/graph.ts:7-8` | the verify-redaction stage "is intentionally not implemented" | `store.ts` runs `redactor.verify()` and refuses to write on a finding |
| D3 | `packages/observe/src/proxy.ts:18-19` | fidelity parity testing "is not attempted" | `proxy-fidelity.test.ts` runs three byte-identity comparisons including HTTPS MITM |
| D4 | `packages/observe/src/index.ts:4-5` | "none of this has been wired to a live… MCP agent" | `real-sdk-integration.test.ts` wires `ObservingTransport` to the real SDK `Client`/`McpServer`, four cases |
| D5 | `tests/golden.test.ts:11-14` | "only three of the fifteen MVP-scope fixtures are authored (01, 02, 11)" | 20 golden fixtures on disk and all run |
| D6 | `packages/core/src/schema.ts:330-353` | `DegradationRecord` with five strategies on `AssertionResult.degradation` | nothing anywhere constructs or writes it; `pipeline.ts` sets `reviewVia`/`coverageGaps` but never `degradation` |
| D7 | `packages/assertions/src/pipeline.ts:31-35` | names two of five ladder rungs as unimplemented | implies `split-batch`, `fanout-cap`, `review` are recorded; they are executed but not recorded (D6) |
| D8 | `packages/cli/src/index.ts:260` | "so `flagValue.test.ts` can cover it" | the test is `index.test.ts`; no `flagValue.test.ts` exists |
| D9 | `README.md` package table | `observe` owns redaction | redaction is in `core`; `observe` re-exports it for compatibility |
| D10 | `README.md` package table | `assertions` owns "all 21 assertions, the pipeline, the degradation ladder" | also owns `codingVertical.ts` (not one of the 21, not in the pipeline); the ladder is partial (D7) |
| D11 | `packages/core/src/policy.ts:3-5` | proxy, redaction, reporter config "declared for shape compatibility but not consumed" | true, and therefore `defineConfig` accepts fields that do nothing; `init` scaffolds them |
| D12 | `packages/mcp/package.json` | `bin: agentguard-mcp → dist/bin.js` | `exports` exposes only `./dist/index.js`; the bin works from the shell but is unreachable as a module |

Seven of these (D1-D5, D8, D9) are comments that were true when written and were not updated when the code moved. That is the expected failure mode of a project that documents limitations in prose. §4.3 and F15 make the fix structural, not editorial.

---

## 4. Architecture assessment

### 4.1 What is strong and must be protected

These are the properties that make AgentGuard something other than "ask an LLM if the agent was good." Every PRD3 feature is checked against them.

1. **Zod schemas are the single source of truth** (`core/schema.ts`), with invariants enforced in the schema itself: pass/fail must cite evidence, `not_applicable` must carry its own basis, `derivedFrom` is non-empty, `seq` is monotonic.
2. **Mechanical selection, never summarisation.** Evidence enters the engine whole and verbatim; only deterministic links are sent (`assertions/state.ts`); heuristic links are withheld so the model is never handed AgentGuard's own hypothesis.
3. **Deterministic-first with typed provenance.** `basis: deterministic | jev | escalated | not-applicable` on every result; calibration reads an allowlist on that field so certainties the model never produced cannot pollute the curve.
4. **Fail-closed everywhere it matters.** Store refuses unredacted evidence; guard never defaults to allow; engine errors map to exit 3 by `instanceof`, never by message; a capped fan-out can never `pass`.
5. **No verdict API.** The MCP server has seven tools and none accepts a verdict (`mcp/server.ts:19-32`).
6. **Escalation explains, never decides.** `escalateReviews` cannot change `status`.
7. **Real-SDK verification** for the two riskiest integrations (MCP transport, guard block).

### 4.2 What is load-bearing and untested

| Surface | Why it is load-bearing | Coverage |
|---|---|---|
| `assertions/pipeline.ts` (478 lines) | Every verdict passes through it | No sibling test; exercised indirectly by 4 test files and the fixture suites |
| `decision/jev.ts`, `engine.ts` token estimator | The only path to a real verdict; the estimator gates the ladder | 2 tests in the whole package, neither on these files |
| `decision/anthropicEscalation.ts`, `anthropicFixProposer.ts` | Real HTTP to a paid API | No tests |
| `core/exitCode.ts` | CI's contract | No test; disagrees with fixture on `reviewAsFailure` |
| `core/schema.ts` invariants | The type system | No test of the `superRefine` branches |
| `cli/commands/{init,test,replay,calibrate,doctor,report,compare}.ts` | 7 of 14 user-facing commands | No tests |
| `cli/reporters/html.ts` | The only inspection surface | No test |
| Selection windows at the boundary | A window that drops decisive evidence yields a confident wrong verdict silently (PRD2 G6) | `selection.test.ts` covers inclusion, not the ±5 edge |
| Degradation ladder | First realistic 40-step run will be its first execution (PRD2 G8) | Mock-forced only |

34 source modules have no sibling test file (Appendix B). The number matters less than the distribution: the `decision` package, which is the seam to every external system, is the least tested package in the repository.

### 4.3 What to change

Each item names the problem, the evidence, the design, the boundary rule it must respect, and where it lands in §5.

**A1. Per-event provenance instead of per-run `source`.**
`AgentRun.source` is a single enum over the whole run (`schema.ts`, PRD2 F5). A guarded MCP run whose agent also emits self-reported messages has both kinds of event in one run, and an OTel import will mix instrumentation-observed spans with agent-authored attributes. Design: `BaseEvent` gains `provenance: "wire" | "harness" | "self-reported" | "imported"` with a default per capture path; the evidence compiler copies it onto `Evidence`; `REQUIREMENTS` may declare a minimum provenance per evidence shape (a `network` item that is self-reported does not satisfy `noFabricatedCompletion`'s need for an observed status). Boundary: provenance is metadata about how evidence was captured; it never changes what the evidence says. Lands in **F12**.

**A2. A single capture pipeline.**
Redaction is called from three separate push paths (`AgentGuardFixture.push`, `TranscriptAdapter.push`, `HttpFaultProxy.record`) and the store re-verifies as defence in depth. Every new adapter (OTel importer, MCP server persistence, multi-agent capture) has to remember all of it. Design: `CaptureSink` in `core` with a fixed middleware order, redact → validate against `AgentEvent` → stamp `seq` and provenance → append to store → optional artifact sink for `snapshots/`/`trace/`. Adapters produce raw events and call `sink.push`; nothing else may write to a store. Boundary: the sink is mechanical; it never drops, reorders or rewrites event content beyond redaction placeholders. Lands in **F13**.

**A3. Degradation as recorded fact.**
`DegradationRecord` exists and is never written (D6). Design: every ladder branch in `pipeline.ts` populates `degradation` on the results it affects; the console, JSON and HTML reporters show it; a `degradation` row in `agentguard report`. Then implement the two missing rungs, `tighten-selection` (fall back from `full-run` to the assertion's declared narrower window) and `chunk-aggregate` (only for assertions whose `DEFINITIONS` entry declares an aggregation rule; none may chunk without one). Boundary: no rung may summarise. Lands in **F15**.

**A4. Mutations as a package with a registry.**
Two fault types in `core`, applied in `observe`, recorded by `mcp` without being applied. Design: `@agent-guard/mutations` owns `FaultSpec` variants, a `MutationRegistry` keyed by catalogue id, `--adversarial <profile>` profiles, and the per-dimension mutation report from vision §14. `observe` implements the network-shaped ones; browser- and data-shaped ones get a `Mutator` interface with a `notApplicable` result rather than a silent no-op. Boundary: a mutation that cannot be applied in the current attachment mode reports so; it never pretends. Lands in **F14**.

**A5. Break the single-vendor seam.**
`DecisionEngine` is pluggable and only the mock proves it. Design: a second real engine, `AnthropicDecisionEngine`, that answers the same Noul/Score/Choice contract by asking a Claude model for a JSON verdict with a probability. It is slower, costs more and is worse calibrated, and it is not the default. Its purpose is threefold: the golden suite runs against two real engines so a fixture that only one engine can pass is flagged (closes AUTOFIX §4.1 properly, where `auditMustCite` cannot); the guard has a fallback when Jev is unreachable that is still fail-closed but explains why; and Jev's SDK churn (one breaking change in its first four days) stops being a product risk. Boundary: the second engine classifies; it does not narrate. Its `explanation` field is discarded before the result is stored, exactly as Noul has none. Lands in **F18**.

**A6. Store as a port.**
`FilesystemRunStore` is imported concretely by nine CLI command modules, the Playwright fixture and its `test.ts` extension. Design: a `RunStore` interface in `core` with `FilesystemRunStore` as the default and the only implementation this cycle; integrity hashing moves from export time (`evidencePack.ts`) to write time, so `verify-pack` checks a manifest the store wrote rather than one export computed. SQLite for `history`/fleet queries is P2 and only justified once the port exists. Lands in **F16**.

**A7. The JSON report is the contract.**
Console, JUnit and HTML are renderings; JSON is what CI, the dashboard, adjudication import and `compare` consume, and it has no schema version. Design: `@agent-guard/reporters` with a versioned `ReportV1` Zod schema, all other reporters rendered from it, and the fixture and MCP server using the same package. Lands in **F17**.

**A8. Claim extraction as a component.**
`splitClaims` is a sentence regex and the success-claim linker is five English regexes with no negation (`graph.ts`). Design: `ClaimSegmenter` interface with the regex as default, the 50-sample benchmark PRD2 F7 specified, and a `{"final": ...}` transcript line so `watch` stops treating stdout as narration. Jev may label segments (Choice: `factual-claim | intent | question | filler`) only after mechanical segmentation, every segment verbatim. Boundary: the segmenter cuts; it never paraphrases. Lands in **F15**.

**A9. Documentation integrity as a mechanical check.**
Twelve drift items (§3) and the entire `docs/` tree gitignored. Design: re-track `docs/`; a test that greps `packages/*/src` for the phrases `not implemented`, `not yet`, `deferred`, `see repo notes` and fails unless the line carries a `[PRD3:Fxx]` or `[issue:#n]` tag; README package table generated from `package.json` descriptions. Lands in **F15**.

**A10. A live-validation protocol.**
Six features are blocked on "needs live Jev validation" with no definition of what that means or costs. Design: `agentguard validate-live --fixtures <subset> --repeat <n> --budget <usd>` runs the named fixtures against the real engine `n` times, records every probability, cost and latency into `.agentguard/validation/<date>.jsonl`, and prints per-assertion spread against the variance floor (`baselineVariance.ts`). A Noul assertion is "validated" when: its fixture verdicts match on ≥3 repeats, the spread is inside the floor, and the mock's scripted answer agrees with the live majority. Lands in **F19**.

---

## 5. PRD3 feature set

Priorities: **P0** this cycle, must ship; **P1** this cycle, should ship; **P2** next cycle. Numbering continues from PRD2. Each feature states the user, the requirement, which side of the "Jev classifies, never narrates" line it is on, and acceptance.

### F12 — Per-event provenance (P0)

**User:** anyone reading a verdict on a run that mixed observation modes; the F5 importer.
**Requirement.** `BaseEvent.provenance` as in A1, defaulted by each capture path (`wire` for proxy and `ObservingTransport`; `harness` for the Playwright fixture's own events; `self-reported` for `TranscriptAdapter`; `imported` for anything F5 reads). `Evidence` carries it. `REQUIREMENTS` entries may declare `minProvenance`. `AgentRun.source` becomes derived (the weakest provenance present) and is kept for compatibility.
**Jev:** none.
**Acceptance.** A self-reported `network` event with status 200 does not satisfy `noFabricatedCompletion`'s requirement; the same event captured by the proxy does. Every persisted run before this field existed still loads (default `wire` for observed runs, `self-reported` for runs tagged so).

### F13 — Capture pipeline and artifact sink (P0)

**User:** anyone adding an adapter; anyone uploading `.agentguard/` as a CI artifact.
**Requirement.** `CaptureSink` per A2. All three existing push paths and the MCP server route through it. Redaction gains the built-in pattern library vision §41 asked for (key prefixes `sk-`/`AKIA`/`ghp_`, JWTs, bearer tokens in URLs, card numbers, emails), configurable through the `redaction` policy field that today does nothing. Artifact sink writes `snapshots/` (a11y snapshots already in evidence, as files) and `trace/` when a Playwright trace is available.
**Jev:** none.
**Acceptance.** A test plants each secret shape in each capture path and greps the written run directory. `policy.redaction` changes behaviour or is removed (D11). No module outside `core` writes to a run directory.

### F14 — Mutation engine (P0)

**User:** the SDET running adversarial suites; the security engineer who needs the OWASP mapping to have mutations behind it.
**Requirement.** `@agent-guard/mutations` per A4. The 15 catalogue items from PRD App. C plus PRD2 F3's `tool-description-injection`, `tool-rug-pull`, `memory-poisoning`, `exfil-bait`. `HttpFaultProxy` gains `timeout`, `stale-data`, `missing-field`, `empty-response`, `malformed-response`, `permission-denied`, `duplicate-record`, `incorrect-data`, `contradictory-response`, `http-429` beyond the existing `http` status fault; `prompt-injection` gains `times`. `agentguard test --adversarial <profile>` and the per-dimension report ("Prompt injection 18/20 resisted"), never a single score. `agentguard_mutate` in the MCP server starts a real proxy.
**Jev:** none for the engine. The assertions that grade responses to mutations (`recoveredFromFailure`, `noPromptInjectionSuccess`) are unchanged.
**Acceptance.** One correct-behavior fixture and one golden fixture per mutation type. `--adversarial` on the TodoMVC example produces the per-dimension table. `agentguard_mutate` followed by a real request through the proxy returns the fault.

### F15 — Evaluator and documentation integrity (P0, engineering)

Closes D1-D12, PRD2 G3, G6, G7, G8, G9, and the unimplemented ladder.

- Populate `DegradationRecord` on every path; render it in all reporters (A3).
- Implement `tighten-selection` and `chunk-aggregate`; `DEFINITIONS` gains a `window` and optional `aggregation` field so `selection.ts`'s `WINDOWS` map is folded into the definition (one place, not two; fixes D1 by construction).
- Boundary fixtures: for each of the two narrow windows, a fixture whose decisive item sits at seq ±5 and ±6; expected verdict at ±6 is REVIEW-with-gap, never a confident wrong answer.
- `ClaimSegmenter` interface, the 50-sample benchmark, `doctor --extractor` reporting precision/recall, the `{"final": ...}` transcript line (A8).
- Escalation for fan-out REVIEWs: escalate the single in-band item with the lowest `noulConfidence`; structural-gap and capacity REVIEWs get a templated explanation without an engine call.
- `computeExitCode` honours `ci.reviewAsFailure`; the Playwright fixture calls the same function.
- Remove or consume `policy.proxy` and `policy.reporters`.
- Reword `noPolicyViolation`, `handledAmbiguityCorrectly`, `prematureCompletion`; re-validate under F19.
- Live-measure the token estimator over ≥20 calls (F19 supplies them); derive the margin from the observed distribution.
- Doc-integrity test and README table generation (A9). Fix D1-D12. Re-track `docs/` in git. Add `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`.
- Tests for every untested CLI command (Appendix B), `exitCode.ts`, `schema.ts` invariants, `html.ts`, and a direct `pipeline.test.ts` that walks each ladder branch with a mock budget.

**Acceptance.** Zero prose limitation statements without a tag. Every CLI command has a test. `pipeline.ts` has a sibling test covering all five `DegradationRecord` strategies. The golden suite passes with `degradation` populated on the runs that degrade.

### F16 — `RunStore` port and write-time integrity (P1)

**User:** the compliance deployer (PRD2 F4); the F21 dashboard.
**Requirement.** Per A6. `RunStore` interface; `FilesystemRunStore` implements it; every consumer takes the interface. The store writes `manifest.json` with per-file SHA-256 on every save; `export` copies it and `verify-pack` checks against it. The manifest gains `engine: {provider, model, sdkVersion}` from `engine.capabilities()`. `agentguard retain --older-than <days>` and `docs/COMPLIANCE.md` (Article 12 field mapping, with the disclaimer PRD2 §8 requires) complete F4.
**Jev:** none.
**Acceptance.** Modifying a byte in any run file fails `verify-pack` without an export step. All 345 existing tests pass with the concrete class swapped for the interface.

### F17 — Reporters package and report contract (P1)

**User:** CI; the dashboard; anyone parsing `agentguard` output.
**Requirement.** Per A7. `@agent-guard/reporters` with `ReportV1` schema (`schemaVersion`, run identity, per-assertion results including `degradation`, adjudications, guard decisions, mutation dimensions). Console, JUnit and HTML render from it. Fixture and MCP `agentguard_get_report` return it. `agentguard trace inspect <run>` (V3) is a text rendering of the evidence graph with links, from the same package.
**Jev:** none.
**Acceptance.** A schema test rejects a report missing `schemaVersion`. `compare` and `history` consume `ReportV1` rather than raw `decisions.json`.

### F18 — Second decision engine and engine-parity suite (P1)

**User:** the maintainer who cannot afford a Jev outage or SDK break to stop every verdict; AUTOFIX §4.1.
**Requirement.** Per A5. `AnthropicDecisionEngine` implementing `DecisionEngine` with the same three primitives via structured JSON output; `capabilities()` reports its own budget. `agentguard test --engine jev|anthropic|mock`. Engine-parity test: every golden and correct fixture is run against both real engines under F19's budget; a fixture that only one engine passes is flagged as non-discriminating.
**Jev:** Jev remains default and the calibration reference. The second engine's free-text is discarded; only `probability`/`option`/`level` survive.
**Acceptance.** Golden suite passes on both engines for ≥18 of 20 fixtures; each disagreement is either a fixture fix or a documented engine limitation.

### F19 — Live-validation protocol (P0)

**User:** every deferred Noul assertion in F2, F3, F8, F9; the calibration curve.
**Requirement.** Per A10. `agentguard validate-live` with `--fixtures`, `--repeat`, `--budget`; refuses to start without an explicit budget; records to `.agentguard/validation/`; prints spread against the variance floor; writes a `validated: true|false` line per assertion into the fixture's `README.md` coverage block. A documented definition of "validated" (A10) that F2/F3/F8/F9 cite as their ship gate.
**Jev:** this is the one feature that spends against Jev by design. Every call is recorded with `usage.input_tokens`, which also feeds the estimator margin (F15).
**Acceptance.** All 21 assertions have ≥3 recorded repeats on ≥1 fixture. The three reworded assertions land outside the uncertainty band. `noToolDescriptionInjection`, `noGoalHijack`, `diffMatchesTask`, `noUnrelatedChanges`, `noCascadingFailure` each reach "validated" or are documented as not.

### F20 — Self-observability (P1)

**User:** the team running AgentGuard in CI at volume.
**Requirement.** Vision §45. OTel spans for `evaluate`, each `engine.decide`, each escalation, each guard decision, with attributes for token estimate versus `usage.input_tokens`, latency, degradation strategy. Exported through the standard OTLP env vars; off by default.
**Jev:** none.
**Acceptance.** A run with `OTEL_EXPORTER_OTLP_ENDPOINT` set produces spans a collector accepts; the estimate-versus-actual ratio is an attribute on every engine span.

### F21 — Fleet view and dashboard (P2)

Absorbs PRD2 F6 remainder: real two-proportion test for `history --baseline`, `--agent` filter, static `report --site` rendering from `ReportV1` with run list, evidence graph, assertion history, mutation dimensions, adjudication queue. Blocked on F17.

### F22 — Distribution (P1)

Absorbs PRD2 F11 remainder: `private: false`, `publishConfig`, `files`, `license` on every package; `.github/workflows/ci.yml` running build, lint, test, e2e and `audit-fixtures` on every push (there is no CI today); `npx agentguard watch` with no clone; `init` writes a runnable TodoMVC example under `agentguard/examples/` so `agentguard test` has something to run in a fresh project.

### PRD2 remainder absorbed

| PRD2 item | PRD3 home |
|---|---|
| F1 held-out report, `calibrate` source split | F19 (adjudicated records are the held-out set; `validate-live` reports them separately) |
| F2 live-Jev guard, review routing | F19 gate, then F2 resumes; review routing needs F1's queue, wire it there |
| F3 assertions, mutations, `report --owasp` | F14 (mutations), F19 (assertions), F17 (report) |
| F4 archive, signing, retain, COMPLIANCE.md | F16 |
| F5 OTel importer, framework adapters | Stays F5, unblocked by F12 (`imported` provenance) and F13 (sink). P1 |
| F8 Noul assertions, GitHub Action | F19 gate; Action lands with F22's workflow |
| F9 assertions, capture path | F19 gate; `agent_spawn`/`agent_result` emitted by the MCP server when a tool named in `policy.subagentTools` is called |
| F10 held-out sets, gate | F18 parity + F19 records supply both prerequisites; gate follows |

---

## 6. Success criteria

Measured, not asserted.

| Criterion | Threshold |
|---|---|
| **Documentation integrity** | 0 untagged limitation statements in `packages/*/src`; `docs/` tracked; D1-D12 closed |
| **Capture** | 100% of events written to any store pass through `CaptureSink`; planted-secret test green on every path |
| **Provenance** | 100% of evidence items carry `provenance`; ≥1 requirement declares `minProvenance` and has a fixture proving it changes a verdict |
| **Degradation** | 100% of degraded results carry `degradation`; all five strategies exercised by `pipeline.test.ts`; ladder executed live on a ≥30-step run |
| **Mutations** | ≥15 catalogue items applicable through the proxy, each with a golden and a correct fixture; `--adversarial` report per dimension |
| **Engine parity** | ≥18/20 golden fixtures pass on two real engines |
| **Live validation** | Every assertion ≥3 repeats; estimator margin derived from ≥20 measured calls; the three reworded assertions outside the band |
| **Test coverage** | Every CLI command tested; `decision` package ≥1 direct test per module; `pipeline.ts` has a sibling test |
| **Distribution** | CI workflow green on `main`; `npx agentguard --help` works from a clean machine |
| **Carried from PRD2** | ≥50 adjudicated real runs; detection ≥90%, false positive ≤2%, REVIEW ≤15% on held-out; OWASP coverage ≥7/10 |

---

## 7. Roadmap

| Phase | Weeks | Delivers | Gate |
|---|---|---|---|
| **A — Honest record** | 1-2 | F15 doc integrity, D1-D12, `DegradationRecord` populated, CLI tests, re-track `docs/`, F22 CI workflow | Doc-integrity test green in CI; every command tested |
| **B — One path in** | 2-4 | F12 provenance, F13 capture sink + redaction library + artifact sink, F16 store port | Planted-secret test on all paths; no store write outside `core` |
| **C — Spend deliberately** | 4-6 | F19 validate-live, F18 second engine + parity suite, estimator margin, reworded assertions | ≥18/20 parity; all 21 assertions have repeats |
| **D — Challenge** | 6-9 | F14 mutation engine, `--adversarial`, F3 assertions through the F19 gate, `report --owasp` via F17 | OWASP ≥7/10 with a mutation each |
| **E — Reach** | 9-12 | F17 reporters contract, F5 OTel importer, F20 self-observability, F8/F9 Noul assertions, F22 npm publish | OTel-instrumented agent to first verdict <15 min |
| **F — Fleet** | after E | F21 dashboard, F10 gate, F2 live guard | — |

Phase A is first because it is cheap, it stops the drift compounding, and it gives every later phase a CI to land in. Phase C precedes D because no mutation is worth shipping until the assertions that grade responses to it have been observed live more than once.

---

## 8. Risks

**Provenance is a schema change on persisted runs.** Every stored run and all 30 fixtures predate the field. Mitigation: `schemaVersion` bump to 2 with a loader that defaults provenance from `source`; fixtures migrated by script and the migration itself tested.

**A second engine invites averaging.** Two verdicts tempt a "consensus" score. PRD3 forbids it: parity is a test-time property of fixtures, never a runtime aggregation. `--engine` selects one engine per run.

**The live-validation budget is real money with no owner.** F19 refuses to run without an explicit budget flag, and PRD2 §8's observation stands: adjudication and validation are human and financial commitments the roadmap cannot supply.

**The mutation package could become a general chaos tool.** Scope is faults an agent must notice and respond to correctly; infrastructure chaos (kill the proxy, partition the network) is out.

**Re-tracking `docs/` exposes them.** They were untracked on purpose (`aa9f0ac`). If the reason was secrecy, PRD3 recommends a private branch or a separate docs repository rather than an untracked directory, which loses history on every edit. That decision is the user's.

**Scope.** Eleven features again. The gates are the cut points; Phases A-C are the minimum that leaves the project more trustworthy than it is tonight, and D-F do not start until C's parity number exists.

---

## Appendix A — Feature status matrix (all cycles)

| Id | Feature | Cycle | Status 2026-09-19 |
|---|---|---|---|
| FR-001…012 | MVP observe/evidence/Jev/assertions/reporters/exit codes | v0.6 | shipped |
| FR-013 | Mutation engine | v0.6 P1 | 2 of 15 faults; → F14 |
| FR-014 | MCP server | v0.6 P1 | shipped, in-memory state |
| FR-015 | HTML dashboard | v0.6 P1 | per-run HTML only; → F21 |
| FR-016 | LLM escalation | v0.6 P1 | shipped, single-question only; → F15 |
| FR-017 | Replay | v0.6 P1 | shipped as re-evaluation |
| FR-018 | PostgreSQL | v0.6 P2 | not started; port → F16 |
| FR-019/020 | Distributed runs, controller | v0.6 P2/3 | retired this cycle |
| F1-F11 | see §1.2 | PRD2 | partial, see §1.2 |
| F12-F22 | see §5 | PRD3 | proposed |

## Appendix B — Module test-coverage matrix

Source modules with no sibling `*.test.ts` (34), by package. Indirect coverage noted where it exists.

| Package | Untested modules | Indirect |
|---|---|---|
| `assertions` | `definitions.ts`, `pipeline.ts`, `requirements.ts`, `state.ts`, `index.ts` | `pipeline` via `budget`, `selection`, `newAssertions`, `fanoutCalibration` tests and fixture suites |
| `cli` | `commands/{calibrate,compare,doctor,init,replay,report,test}.ts`, `fixtures.ts`, `runner.ts`, `reporters/html.ts` | `runner`/`fixtures` via `tests/golden.test.ts` |
| `core` | `schema.ts`, `policy.ts`, `exitCode.ts`, `consoleReporter.ts`, `index.ts` | `schema` via every test that builds an event |
| `decision` | `engine.ts`, `jev.ts`, `mock.ts`, `escalation.ts`, `anthropicEscalation.ts`, `anthropicFixProposer.ts`, `index.ts` | `mock` via every pipeline test; `jev` and both Anthropic adapters: none |
| `mcp` | `bin.ts`, `index.ts` | `bin` verified by hand only (PRD2 §4.1) |
| `observe` | `index.ts` | — |
| `playwright` | `agent.ts`, `test.ts`, `index.ts`, `playwright.config.ts` | `agent` via `fixture.test.ts` |

Tested with non-sibling names: `assertions/{budget,calibrationConfidence,fanoutCalibration,newAssertions,parseUnifiedDiff}.test.ts`, `observe/proxy-fidelity.test.ts`, `playwright/real-sdk-integration.test.ts`.

## Appendix C — Drift register

D1-D12 as in §3, to be closed in Phase A and prevented by F15's doc-integrity test. Fixture hygiene in the same pass: `fixtures/golden/11-http-500-recovery` and 7 of 10 `fixtures/correct/*` lack `README.md`.

## Appendix D — OWASP Agentic Top 10 delta from PRD2 Appendix B

| ASI | PRD2 status | PRD3 change |
|---|---|---|
| ASI01 Goal hijack | partial | `tool-description-injection` mutation in F14; `noGoalHijack` through F19 |
| ASI02 Tool misuse | shipped | `tool-hijacking` mutation in F14 |
| ASI03 Privilege abuse | evidence-limited | `permission-denied` mutation in F14; provenance (F12) lets `noUnauthorizedSideEffect` demand wire-observed evidence |
| ASI04 Supply chain | F3/F8 | `tool-rug-pull` mutation + re-capture on `tools/list` change in F14 |
| ASI05 Code execution | F2 | guard remains deterministic until F19 gate |
| ASI06 Memory poisoning | F3 | `memory-poisoning` mutation in F14 |
| ASI07 Inter-agent | F9 | capture path for `agent_spawn`/`agent_result` via MCP server (§5 remainder table) |
| ASI08 Cascading failure | F3/F9 | `noCascadingFailure` through F19 |
| ASI09 Trust exploitation | shipped | unchanged; `ClaimSegmenter` benchmark (F15) measures its false-negative rate for the first time |
| ASI10 Rogue agents | F6 | real drift test in F21 |

## Appendix E — Sources

This document draws on the repository at commit `9e0e19e`, the bundled Jev documentation ([`jev-overview.md`](./jev-overview.md), [`jev-client.md`](./jev-client.md)), and the industry sources listed in PRD2 Appendix C, which were not re-verified for this document. Every code claim above names a file and, where useful, a line range as of that commit.
