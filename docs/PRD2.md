# AgentGuard — Product Requirements Document 2

**Version:** 1.0
**Status:** Proposed
**Date:** 2026-09-19
**Supersedes:** nothing. [`PRD.md`](./PRD.md) v0.6 remains the source of record for the MVP that shipped. This document starts where that one stops: it audits what was built against what was promised, reads the 2026 industry situation, and specifies the next product cycle.
**Companions:** [`TRD.md`](./TRD.md) (architecture as built), [`AUTOFIX.md`](./AUTOFIX.md) (the fix loop, half built).

---

## 0. Reading guide

| Section | Answers |
|---|---|
| §1 | What exists today, measured, and where it deviates from PRD v0.6 |
| §2 | What the industry is dealing with in September 2026, with sources |
| §3 | Where Jev can do more than it does today — and where it must not |
| §4 | Known defects, gaps and debt, ranked |
| §5 | The PRD2 feature set, each with requirements and acceptance criteria |
| §6 | Success criteria for the cycle |
| §7 | Roadmap |
| §8 | Risks |
| Appendices | Assertion catalogue delta, OWASP mapping, sources |

The PRD v0.6 principle carries over unchanged and still resolves every ambiguity in this document:

> **AgentGuard never assumes that what an agent says happened is what actually happened.**

PRD2 adds one corollary that the industry situation now forces (§2.2, §2.3):

> **A run is not only a test result. It is a record.** Evidence AgentGuard already collects to grade an agent is the same evidence regulators, security teams and incident reviewers now require. PRD2 treats the run store as a first-class product surface, not a cache.

---

## 1. Where the project actually is

### 1.1 Shipped, and verified in this review

Build, lint and the full test suite were re-run for this document on 2026-09-19.

| Surface | State |
|---|---|
| Assertions | All 21 from the source catalogue implemented (`packages/assertions/src/definitions.ts`): 18 Noul, 1 Score (`recoveredFromFailure`), 1 Choice (`toolWasAppropriate`), plus `evidenceSufficient` kept as a deterministic pre-check |
| Golden suite | Full 20 fixtures in `fixtures/golden/`, not the 15 PRD v0.6 scoped for MVP. The five "Phase 2" scenarios (07, 09, 10, 15, 17) exist and pass against the mock engine |
| Correct-behavior set | All 10 fixtures in `fixtures/correct/` |
| Tests | 25 files, 187 tests, green. 2 real Playwright-CLI e2e tests |
| Observation | HTTP/HTTPS fault proxy with MITM, capture-time redaction, MCP transport wrapping, Playwright Test fixture, Playwright CLI adapter, generic transcript adapter |
| Decision | Jev adapter (`@typesafe-ai/sdk` 0.6.x), scriptable mock, Anthropic escalation engine, Anthropic fix proposer |
| CLI | `init`, `watch`, `test`, `replay`, `calibrate`, `doctor`, `report`, `compare`, `autofix propose/show` |
| MCP server | Seven lifecycle tools, no `agentguard_pass`, verdicts only from `evaluate()` |
| Reporters | console, json, junit, html |

### 1.2 Live validation, and what it did and did not establish

Two live Jev runs have been performed (both on 2026-09-19, both under explicit spend authorization). Together they are the only non-synthetic evidence the project has.

| Observation | Value |
|---|---|
| Phase 0 thesis fixtures (01, 03, 11) | Every live verdict matched the fixture's intended verdict. `recoveredFromFailure` landed on Score level 2 ("detected-and-reported") for the honest agent and level 0 ("ignored") for the fabricating one, on the same rubric |
| Second run, 14 new assertions, 15 question instances | 10 exact matches, 3 REVIEW on genuine uncertainty (`noPolicyViolation` p=0.56, `handledAmbiguityCorrectly` p=0.41, `prematureCompletion` p=0.45), 2 outright disagreements caused by a fixture evidence gap (06) |
| Token estimator | chars/4 undershot the real tokenizer by ~1.53x; a 1.6x safety margin was added from that single sample |
| Latency | 689 ms for one batched 9-question call |
| Batching | Every run so far fit in one call. The degradation ladder (TRD §6.7) has never executed live |

What is **not** established: calibration (a handful of samples against a floor of 100 per curve), payload behavior on a realistic 30-40 step run, the split-call path, and any figure at all about real agents rather than hand-authored fixtures.

### 1.3 Deviations from PRD v0.6, and whether they were right

| PRD v0.6 said | What happened | Verdict |
|---|---|---|
| MVP ships 7 assertions; 13 deferred | All 21 shipped in the same cycle | Right for the product, wrong for the evidence. Assertions 8-21 have one live run behind them and three of them are already known to be weakly worded (§1.2). PRD2 treats them as shipped-but-unvalidated |
| MVP requires an MCP-based agent (§8.3) | `agentguard watch` and the generic transcript adapter accept any CLI-driven agent | Right. This was the adoption barrier PRD v0.6 §14 named as unsized. It is now partly removed, but the transcript format is bespoke (§4) |
| Phase 3 MCP server, Phase 4 dashboard | MCP server shipped; dashboard did not (HTML report only) | Reasonable ordering |
| No autofix | `autofix propose/show` shipped, validation gate deliberately not | Right, and AUTOFIX.md §4 prerequisites remain unmet |
| Storage is filesystem only | Still true | Right for CI. Becomes a constraint under §2.3 retention requirements |
| Playwright folded into `observe` (TRD §2.2) | Separate `@agent-guard/playwright` package | Fine; it is the pre-built default, not the only path |

### 1.4 What the README promises that the code does not yet deliver

- **"Calibration" as a product feature.** `agentguard calibrate` reports a curve that can never be validated on the data that exists. There is no path in the product for collecting the samples.
- **REVIEW as a workflow.** REVIEW is an exit code and a console line. Nothing captures who looked at it, what they decided, or feeds that decision anywhere.
- **"Point AgentGuard at literally anything."** True only for agents that can be expressed as a command/output alternation. Agents that already emit structured traces (OpenTelemetry, LangGraph, Vercel AI SDK, OpenAI Agents SDK) cannot be ingested without writing an adapter.

---

## 2. The industry situation, September 2026

Five pressures, each sourced, each with a direct implication for the product.

### 2.1 Prompt injection and tool poisoning moved from research to incidents

OWASP published the *Top 10 for Agentic Applications* (ASI01-ASI10) in December 2025; by mid-2026 OWASP's own analysis says prompt injection still drives most agentic security failures in production. The 2026 disclosures are concrete: the first malicious MCP server found in the wild (`postmark-mcp`, exfiltration added after fifteen clean versions), a LiteLLM supply-chain backdoor on PyPI (~47,000 downloads in a three-hour window), a Cursor CVE (CVE-2026-22708) that poisons the execution environment so allowlisted commands deliver payloads, and a disclosure of up to 200,000 exposed MCP instances. One enterprise survey reports 88% of organizations with a confirmed or suspected agent security incident in the prior year.

**Tool poisoning is the shape that matters most for AgentGuard.** The injected instruction lives in tool *metadata* the agent reads and the user never sees. AgentGuard's `noPromptInjectionSuccess` today only knows about injections it delivered through its own fault fixture. It has no evidence type for "the tool description itself carried an instruction," and so cannot grade the most common 2026 attack.

**Implication:** the safety category needs an evidence source for tool definitions and a set of assertions aligned to ASI01-ASI10 (Appendix B), and the mutation catalogue needs a `tool-description-injection` fault.

### 2.2 Coding agents flooded the PR queue

Empirical studies of agent-authored pull requests in 2026 converge: AI-authored PRs carry roughly 10.8 issues each versus 6.5 for human code, about 67% fail first review versus 16% for human PRs, they are ~154% larger, and they wait 4.6x longer before a reviewer opens them. Post-merge, they introduce more redundancy and more technical debt per change. Teams describe the situation as "10x PRs, 1x reviewers."

**Implication:** PRD v0.6 Appendix D sketched a coding-agent vertical (`testsAdded`, `testsPassed`, `diffRelevant`, `noUnrelatedChanges`) and did not commit to it. The market has since committed for us. A coding-agent PR is the single most common agent output an SDET now sees, and every one of its failure modes is a correspondence failure of exactly the kind AgentGuard grades: the agent *says* it added tests, *says* the change is scoped, *says* CI passed. Git, the test runner and CI are the evidence.

### 2.3 The EU AI Act became enforceable on 2 August 2026

High-risk obligations are now live. Article 12 requires high-risk systems to "technically allow for the automatic recording of events (logs) over the lifetime of the system," sufficient for traceability of outputs; commentary is explicit that for an agent this means *actions taken*, not only text generated. Article 26 obliges deployers to retain those logs for at least six months. Penalties reach EUR 15M or 3% of worldwide turnover.

**Implication:** AgentGuard's run directory (`run.json`, `events.jsonl`, `evidence.json`, `decisions.json`, all redacted at capture) is already very close to what a compliance team needs. What it lacks is integrity (nothing proves a run file was not edited), retention tooling, a documented export format, and any statement of which fields satisfy which article. This is a cheap feature with a large buyer.

### 2.4 OpenTelemetry GenAI conventions are becoming the trace lingua franca

The OTel GenAI semantic conventions (still experimental as of March 2026, but shipping) define `invoke_agent`, `chat`, and `execute_tool` spans with `gen_ai.*` attributes; Datadog, Greptime, Fiddler, OpenObserve and others ingest them natively. Teams that instrument once with OTel expect every tool to read that trace.

**Implication:** PRD v0.6 §3 said "offline scoring of existing traces" is where AgentGuard does not win, because "a pile of historical transcripts is exactly the input it is designed not to trust." That sentence conflated two things. A *transcript* is narration. An *OTel trace* with `execute_tool` spans, HTTP client spans, status codes and durations is observed execution recorded by instrumentation, not by the agent. It is evidence. PRD2 draws that line explicitly: **AgentGuard ingests execution traces from any source; it distrusts narration from every source.** An OTel importer is the highest-leverage attachment mode on the table, and it retires most of PRD v0.6's "MCP-only" market risk.

### 2.5 The eval market has learned trajectory evaluation is necessary and LLM-as-judge is not enough

2026 comparisons of LangSmith, Braintrust, Arize/Phoenix and others now all lead with trajectory-level evaluation; agents graded only on final output pass 20-40% more cases than trajectory grading reveals. The same literature restates the LLM-as-judge problems PRD v0.6 §3 named (position, verbosity and self-enhancement bias; uncalibrated confidence) and adds a new one: judges are too slow and expensive to run on every turn, so online evaluation needs a classifier that returns in milliseconds. Browser-agent reports single out **false completion** as the most frequent production failure and note the benchmark-to-production gap (78% on WebArena, 22% of carts actually booked).

**Implication:** the thesis holds and the market has moved toward it. Two things follow. First, "runs in the test loop" is no longer the ceiling; the ask is "runs on every turn," which is an online guard, not an offline grader (§5, F2). Second, the differentiator has to stay legible: evidence-derived, per-dimension, calibrated. Any drift toward a single quality score would put AgentGuard in a crowded category it cannot win.

### 2.6 Jev itself

TypeSafe launched Jev in early access on 15 September 2026 with a $40M seed. The published positioning names, verbatim, "Universal Verification: verify the input prompt, extractions, reasoning traces, tool calls, or inputs of any other AI," "LLM guardrails" on every input, output and tool call, and "classify giant agent traces" as headline use cases. AgentGuard is an instance of the vendor's own stated design centre, which is good for fit and bad for lock-in: Jev is four days old, the SDK has already had one breaking change (0.6.0), and there is no second System One vendor. §8 carries the risk.

---

## 3. Where Jev can do more, and where it must not

AgentGuard uses Jev today for exactly one thing: answering the per-assertion question over selected evidence. The Jev documentation bundled in this repo describes several capabilities the product does not yet use. Each is assessed against the load-bearing principle: **Jev may classify, score, rank and verify; Jev may never narrate.**

| Opportunity | Jev capability | Principle check | Where it lands |
|---|---|---|---|
| **Online guard on every tool call** | 70-500 ms latency, cost that permits "a million runs without a co-pilot," "confidence-gated routing" pattern | Compatible. A pre-action Noul ("this tool call would exfiltrate data") is a verdict about observed intent, not a summary | F2 |
| **Tool-description poisoning detection** | Noul on tool metadata: "this description contains an instruction directed at the model" | Compatible. Tool definitions are evidence, not narration | F3 |
| **Claim labelling** | Choice over mechanically segmented sentences: `factual-claim` / `intent` / `question` / `filler` | Compatible **only** if segmentation stays mechanical and every segment is sent verbatim. Jev labels; it does not rewrite. Closes TRD §12's "claim extraction is unbenchmarked" | F7 |
| **Evidence relevance ranking inside the budget** | "Select useful context for downstream AI workflows"; Score on relevance | Compatible with a hard constraint: Jev *orders* whole evidence items for the mechanical selector; selection still sends items verbatim, drops are still recorded as coverage gaps. This is ranking, not summarization | F7 |
| **Fleet-scale trace classification** | "AI map-reduce over big data," "classify giant agent traces" | Compatible. Same questions, many runs, drift measured per dimension | F6 |
| **Composite scoring** | Combine several Noul/Score dimensions into one number | **Rejected** at the product level. PRD v0.6 §6 forbids a single quality score. Permitted only *within* one assertion (e.g. an injection severity score from three sub-criteria) | F3, narrowly |
| **Intent routing** | Choice over the user's task to pick an assertion profile | Compatible and useful: `agentguard watch` currently runs every applicable assertion; an intent-routed profile runs the right ones | F5 |
| **Structured extraction** | Recover typed fields from unstructured input | **Rejected as an evidence source.** Extracting "what happened" from prose is narration by another name. Permitted only for extracting fields from *tool results* whose schema is known (e.g. an order id from a JSON body), never from agent output | not scheduled |
| **Calibration sample collection** | Every Jev answer carries a calibrated probability | Compatible. What is missing is the human label, not the probability. F4 supplies it | F4 |

The distinction the table enforces is this: Jev answers questions **about** evidence; it never becomes the source **of** evidence. Every PRD2 feature that touches Jev is required to say which side of that line it is on.

---

## 4. Known defects, gaps and debt

Ranked by the damage they do to the product's central claim. Items marked **[code]** were confirmed by an independent read of the source for this document; see §4.1.

### 4.0 Ranked list

| # | Item | Severity | Why it matters |
|---|---|---|---|
| G0a | ~~**Redaction is not wired in.**~~ **FIXED 2026-09-19.** `DefaultRedactor` moved into `@agent-guard/core` (it had to — `TranscriptAdapter` needed it and `core` cannot depend on `observe`) and is now called from every capture path: `AgentGuardFixture.push()`, `TranscriptAdapter.push()`, `HttpFaultProxy.record()`. `FilesystemRunStore.saveEvidence` additionally runs the §5.1 `verify()` audit and refuses to write (fail-closed) if it finds anything. Regression tests: `packages/playwright/src/fixture.test.ts` ("redacts a secret-shaped tool argument and a proxied Authorization header"), `packages/core/src/transcriptAdapter.test.ts`, `packages/core/src/store.test.ts` ("refuses to write... fail-closed") | ~~Critical~~ | Was: credentials land in `.agentguard/runs/**`, the directory CI is told to upload as an artifact |
| G0b | ~~**`agentguard.config.ts` is never loaded.**~~ **FIXED 2026-09-19.** New `loadPolicyConfig()` in `@agent-guard/core` (`packages/core/src/configLoader.ts`) searches cwd for `agentguard.config.{ts,mts,mjs,js,cjs}`, dynamically imports it (Node 26 strips TS types natively — no build step), and re-validates through `defineConfig` so the Score/Choice required-field check still applies. Wired into `runner.ts`, `test.ts`, `replay.ts`, `watch.ts` (all gained a `--config <path>` flag), and the Playwright `test.ts` fixture (`agentGuardPolicy` option, default `loadPolicyConfig()`). The MCP server's constructor stays synchronous and still needs a caller to load and pass policy explicitly — noted in its code comment, not yet a full fix (folds into F7/G4's MCP launcher work). Regression tests: `packages/core/src/configLoader.test.ts` (5 tests: default fallback, real `.ts` override, explicit `--config` path, missing-path error, re-validation) | ~~Critical~~ | Was: the entire documented policy surface was inert |
| G0c | ~~**`watch` produces deterministic false FAILs on truthful agents.**~~ **FIXED 2026-09-19.** `findFabricatedToolMention` (`packages/assertions/src/claimChecks.ts`) now also compares each called tool's name with any `prefix:` stripped, and the identifier regex accepts `.` and `-`. Regression tests: `packages/assertions/src/claimChecks.test.ts` (6 tests covering bare names, `watch:`/`playwright-cli:` prefixes, genuine fabrication still caught, and dotted/hyphenated tool names) | ~~Critical~~ | Was: the zero-setup front door failed good agents |
| G1 | **No human adjudication path.** REVIEW verdicts have no owner, no destination and no record. Calibration can therefore never be validated, and the held-out real-run set PRD v0.6 §14 called "a post-MVP commitment, not an optional extra" cannot be collected | Critical | Every confidence number the product prints is advisory forever until this exists |
| G2 | **Fixture `06-wrong-tool-arguments` cannot discriminate.** Its `run.json` never establishes which todo id is "Pay electricity," so a real model correctly passes what the mock is scripted to fail. Known since the second live run, unfixed | High | A golden fixture that a correct evaluator fails is a false positive in the suite itself, and it poisons any future autofix validation (AUTOFIX §4.1) |
| G3 | **Three assertions are weakly worded** (`noPolicyViolation`, `handledAmbiguityCorrectly`, `prematureCompletion` on 18): live probabilities landed in the uncertainty band where the fixture expects a clean fail | High | REVIEW rate on real runs will exceed the ≤15% bound before any real-world noise is added |
| G4 | **No tool-definition evidence type.** Tool descriptions, MCP server manifests and their changes over time are not captured | High | The dominant 2026 attack (§2.1) is invisible |
| G5 | **Bespoke ingestion only.** `watch` accepts `{"command","output"}` JSONL; nothing reads OTel, LangGraph, Vercel AI SDK or OpenAI/Anthropic tool-call logs | High | PRD v0.6 §14's "market may not exist" risk survives in a new form |
| G6 | **Selection rules are untested at the window edge** (TRD §12). A selector that omits decisive evidence yields a confident wrong verdict silently | High | The 32K budget pushes selectors toward omission; nothing detects it |
| G7 | **Claim extraction is unbenchmarked** (TRD §12). Missed claims are false negatives on the flagship assertion | Medium-High | Quiet under-reporting |
| G8 | **Degradation ladder never executed live.** Split-call, chunked-aggregation and fan-out-cap paths have only mock coverage | Medium | The first realistic 40-step run will be the first test |
| G9 | **Token estimator margin from n=1.** 1.6x from one measurement | Medium | Undershoot causes mid-run rejections (TRD §6.5) |
| G10 | **Run store has no integrity or retention story.** Files are plain JSON; nothing hashes, signs, or expires them | Medium | Blocks the compliance use (§2.3) and weakens `compare` as an audit tool |
| G11 | **Proxy fidelity unmeasured** against an unproxied baseline (TRD §12) | Medium | Evidence about a system that does not ship |
| G12 | **Autofix validation gate unbuilt**, correctly blocked on G2 and per-assertion held-out sets | Medium | Proposals stay `NOT VALIDATED` |
| G13 | **Score/Choice assertions require manual config** (`passAtOrAbove`, `passOptions`); `defineConfig` rejects omissions | Low-Medium | Correct by TRD §10.2 reasoning, but a first-run wall for `init` users |
| G14 | **Non-English content degrades verdicts** (PRD v0.6 §14), unsized | Low | Unquantified, unreported to the user at run time |
| G15 | **No package publishing.** Everything is run as `node packages/cli/dist/index.js` | Low | Time-to-first-verdict criterion cannot be met by outsiders |

### 4.1 Findings from the code read

An independent read of every file under `packages/*/src` was performed for this document. The three critical items above (G0a-c) were re-verified by hand. The rest are listed with file references so they can be turned into issues directly.

**Correctness.**

- ~~`packages/observe/src/proxy.ts:100` matches faults by substring~~ **FIXED 2026-09-19.** Path-based matching against the target URL's own pathname (`matchesFaultUrl`), with an exact-match path for a caller passing a full absolute URL. Regression test added. Prompt-injection faults' infinite `timesRemaining` is unchanged — `FaultSpec`'s `prompt-injection` variant has no `times` field in its schema at all, so this isn't fixable without a schema change; left as a named open item, not silently worked around.
- ~~`packages/observe/src/proxy.ts:150-154` creates an inner `http.Server` per CONNECT and never closes it in `stop()`~~ **FIXED 2026-09-19.** Both the inner server and the TLS socket are now tracked per connection and released as soon as the connection closes naturally, not only when the whole proxy stops — verified with a new `activeMitmConnectionCount()` introspection method and a regression test proving the count returns to zero right after one HTTPS request completes. WebSocket and HTTP/2-over-ALPN traffic through the tunnel is still mangled silently, and no parity test against an unproxied baseline exists (G11) — **not fixed**, out of scope for this pass.
- ~~`packages/core/src/store.ts:56` implements `appendEvent` by reading and rewriting the whole `events.jsonl` per event~~ **FIXED 2026-09-19.** Replaced with a true `fs.appendFile`. Regression test fires 50 concurrent calls and confirms no lost writes.
- ~~`packages/core/src/graph.ts:238` links a success claim to a contradicting response only when the status is 5xx~~ **FIXED 2026-09-19.** Extended to `status >= 400`. New `packages/core/src/graph.test.ts` (this mechanical linker had no dedicated test before) covers 402/403/409/429/500/503, the 2xx no-op case, a non-success claim, a genuine later-recovery case, and a 3xx no-op case. Success-claim detection is still five hard-coded English regexes with no negation handling (`isSuccessClaim` matches "could not be **completed**") — **not fixed**, worked around in new tests by avoiding those words, not patched.
- `packages/cli/src/commands/watch.ts:72` assigns raw stdout to `finalOutput`, and `graph.ts:174` splits it on sentence punctuation. Stack traces, JSON and version strings become "claims" and feed `noFabricatedCompletion`. **Not yet fixed.**
- ~~`packages/assertions/src/pipeline.ts:317` stores the raw Noul probability as `confidence`~~ **FIXED 2026-09-19**, along with the related fan-out bug below — both traced to the same root cause and fixed together. Added `noulConfidence(p) = max(p, 1-p)`, polarity-invariant by construction, used for both the single-question and fan-out paths. `calibrationConfidence.test.ts` (new) proves a low raw probability on a negative-polarity assertion now stores as a high confidence.
- ~~`packages/assertions/src/pipeline.ts:441` takes the max probability for every fan-out on the stated assumption that fan-outs are negative-polarity~~ **FIXED 2026-09-19.** Aggregate confidence is now the MIN of each item's `noulConfidence`, not the MAX raw probability. `fanoutCalibration.test.ts` rewritten with inputs where the old and new formulas actually disagree, including a dedicated positive-polarity case (`toolArgumentsCorrect`).
- ~~`packages/assertions/src/deterministic.ts:55` checks for an empty evidence set, but the compiler always injects the task item, so the "no evidence" REVIEW branch is unreachable~~ **FIXED 2026-09-19.** Removed the dead branch and documented the invariant it depended on. New `deterministic.test.ts` (this module had no dedicated test before) asserts the invariant directly (`graph.items.length >= 1` always), and covers both `noFabricatedCompletion` and `evidenceSufficient`'s actually-reachable branches.
- `packages/decision/src/engine.ts:65-83` estimates tokens as chars/4 × 1.6 from one sample; an engine rejection propagates out of `evaluate()` with no retry or degradation (G9 in the original numbering — since renumbered; see the ranked list above). **Not yet fixed** — needs live-Jev measurement, not a code-only fix.

**CLI.** ~~`flagValue` (`index.ts:141`) supports no `--flag=value` form and swallows the next flag as a value~~ **FIXED 2026-09-19.** Also fixed: `index.ts` ran `main()` unconditionally at module load, so it had no test file at all (importing it would trigger a real CLI invocation against the test runner's own argv) — added an entry-point guard and `index.test.ts`.

**Gaps against the documentation.**

- ~~`packages/mcp` has no `bin`, no stdio transport~~ **FIXED 2026-09-19.** Added `packages/mcp/src/bin.ts` (stdio launcher, registered as the `agentguard-mcp` bin) and verified it for real: spawned the compiled binary as a subprocess, connected a real MCP client with no `TYPESAFE_API_KEY` set, listed its tools, and started a run. That verification surfaced a second real bug — `JevDecisionEngine`'s constructor builds its SDK client eagerly and throws synchronously with no key, which crashed the server on startup before it registered a single tool even though six of its seven tools need no engine at all — fixed with a `LazyJevDecisionEngine` that defers construction until first use. `agentguard_start_run` accepting unvalidated `events` is also fixed (validated against the real `AgentEvent` schema, `isError: true` on a bad shape). Its run state is still an unbounded in-process `Map`, never persisted, and `agentguard_mutate` still records a fault event but starts no proxy — **not fixed**, larger scope (persistence design, real proxy wiring).
- Selection windows: 16 of 20 assertions use `"full-run"`; `definitions.ts:7-12` states the tighter windows are "declared but not implemented."
- The TRD §6.7 degradation ladder stops at the first rung: overflow goes straight to `reviewVia: "capacity"` (`pipeline.ts:165`); the "tighten selection" and "chunk with aggregation" rungs do not exist.
- Escalation covers only single-question REVIEWs (`escalate.ts:68`); fan-out REVIEWs, the common case, are never explained.
- `computeExitCode` ignores `ci.reviewAsFailure` (`exitCode.ts:16-18`) while the Playwright fixture honors it, so CLI and fixture disagree on the same config.
- The store writes no `snapshots/` or `trace/` directories despite TRD §10.1.
- Redaction, where it is eventually wired, has no built-in patterns for key shapes (`sk-`, JWT, AWS), emails, cards or bearer tokens inside URLs; it redacts by key name, exact secret match, and a login-URL body rule only.

**Test coverage.** No unit tests exist for `graph.ts` (the claim splitter and the contradiction linker), `deterministic.ts`, `pipeline.ts`, `definitions.ts`, `jev.ts`, the token estimator, `escalation.ts`, the CLI argument parser (`flagValue` returns the next token blindly, so `--task --store x` sets the task to `--store`), or any CLI command except `watch` and `autofix`. The golden suite is the only coverage for the evaluation core, and G0c shows a golden fixture can pass while the real path fails.

**Adoption friction.** `agentguard test` defaults to the repo's own `fixtures/golden`, so a fresh `init` has nothing to run. `watch --transcript` reads the file once and does not tail. Spawn mode records one tool call for the whole process. Malformed JSONL aborts with a raw stack trace. `proxyInfo()` returns a CA that nothing trusts or wires to a browser.

These items are folded into F7 (hardening) and F11 (first-run), with G0a-c pulled forward into Phase A as its first gate (§7).

---

## 5. PRD2 feature set

Each feature states its user, the requirement, what Jev does (if anything) and on which side of the §3 line, and the acceptance criteria. Priorities: **P0** this cycle, must ship; **P1** this cycle, should ship; **P2** next cycle.

### F1 — Adjudication and the held-out set (P0)

**Status: MVP shipped 2026-09-19.** `agentguard review list`/`agentguard review record <run-id> <assertion-id> <pass|fail|cannot-tell> --reason <text> [--by <name>]` are implemented (`packages/cli/src/commands/review.ts`), backed by `FilesystemRunStore.saveAdjudication`/`loadAdjudications` (a new `adjudications.json` per run directory) and a new `Adjudication`/`HumanVerdict` schema in `@agent-guard/core`. `toAdjudicatedCalibrationRecord` converts a decisive adjudication into a real calibration record appended to `calibration.jsonl` — the first calibration evidence in this codebase that comes from a human looking at a real run rather than a fixture's declared `expected.json`. 20 new tests (store round-trip/overwrite semantics, the calibration conversion's allowlist and `cannot-tell` exclusion, and the CLI commands against a real temp store); the compiled CLI binary was run by hand end-to-end against the golden suite's stored runs to confirm the full loop (`test` → `review list` → `review record` → `review list` again showing the item closed → a real line appended to `calibration.jsonl`).

**User:** the SDET who receives a REVIEW; the engineer who wants calibration to mean something.

**Requirement.** A REVIEW (and optionally any verdict) can be adjudicated by a human, the adjudication is stored with the run, and adjudicated runs form the held-out set that validates calibration and detection.

- ~~`agentguard review` lists open REVIEW items across the store~~ **Shipped.** `review list` walks every stored run's `decisions.json`, reports each `status: "review"` assertion with no existing adjudication (showing `reviewVia`, `explanation`, `missing`), and separately counts how many are already adjudicated. `review record` writes `{ assertionId, humanVerdict: pass|fail|cannot-tell, reason, adjudicator, at }` to `adjudications.json`.
- **Not shipped:** `--from junit|json` (importing adjudications made in another tool). Deferred — the terminal workflow is the MVP; a non-terminal import path is additive later.
- ~~Adjudications are append-only and never modify `decisions.json`~~ **Shipped, exactly as specified.** `saveAdjudication` writes to a separate file; re-adjudicating one assertion replaces only its own entry, `decisions.json` is never touched. Regression-tested.
- **Not yet shipped:** wiring adjudicated records into `agentguard calibrate` itself (currently `calibrate` only reads `calibration.jsonl`, which `review record` now also writes into — so the plumbing is connected, but `calibrate`'s own report doesn't yet distinguish a fixture-sourced record from an adjudicated one, and nothing yet flips `calibration.validated` based on crossing the ≥100-per-curve floor from adjudicated records specifically). `compare`/`report` do not yet surface adjudications alongside machine verdicts.
- **Not shipped:** the held-out real-run set as its own `agentguard test --held-out` command and its own detection/false-positive report. What exists today is the primitive (adjudicated ground truth, queryable via `loadAdjudications` across the store) that such a command would consume — the report itself isn't built.
- Jev's role: none new, as specified. F1 supplies the missing human label to probabilities Jev already emits.

**Acceptance.** ~~An adjudication round-trips through the CLI and JSON reporter.~~ An adjudication round-trips through the CLI (verified against a real store, both as unit tests and by hand against the compiled binary). **Not yet met:** round-tripping through the JSON reporter specifically (not built), `calibrate` refusing/validating based on the adjudicated-record floor specifically (the floor logic already exists and applies to whatever's in `calibration.jsonl`, but hasn't been exercised with ≥100 real adjudicated records — there aren't that many yet), and the REVIEW-rate criterion becoming computable on real runs (needs the held-out report, not built).

### F2 — Online guard: `@agent-guard/guard` (P0)

**User:** the team shipping an agent to production who cannot afford a frontier-model judge on every step.

**Requirement.** The same assertions, evaluated **before or immediately after** each tool call, in the hot path, with a block/allow/review decision, using Jev's latency and confidence-gated routing.

**Status: the deterministic guard shipped 2026-09-19 and is real — it stops a call from reaching a live MCP server, verified against the actual SDK, not simulated.** This was deliberately the last feature attempted this session, because blocking a live call in-flight is a genuine architecture decision, not an additive primitive — see the risk assessment below.

- ~~A guard sits ... as an MCP proxy in front of any MCP server (`ObservingTransport` gains a `decide` hook)~~ **Shipped exactly as specified.** `ObservingTransport` takes an optional `guard: GuardPolicy` in its constructor options; when set, every outbound `tools/call` is checked before being forwarded. A blocked or review-flagged call **never reaches `this.inner`** (the real transport) — the caller instead receives a synthesized JSON-RPC error, delivered asynchronously so it behaves exactly like a real response, never a hang. ~~as a middleware for the Playwright fixture's `observe()` wrapper~~ **Shipped**: `observe(factory, { guard })`.
- ~~Pre-action checks (deterministic first, then Jev)~~ **Deterministic only, shipped; Jev not attempted.** `packages/observe/src/guard.ts`'s `evaluateGuard` checks a blocked-tools list, a review-tools list, and outbound-argument patterns (reusing F8's secret-shape pattern set as one example configuration) — `noUnauthorizedToolUse`/`noUnauthorizedSideEffect`/`noSensitiveDataLeak`/`noToolDescriptionInjection` as live-Jev checks are **not implemented**. Putting an unvalidated live-model call in a hot path that can block a real action is a materially higher-stakes version of the same "don't ship a Noul check without live validation" discipline this pass already applied to F3/F8/F9 — here the downside of getting it wrong is worse (blocking legitimate actions or false-allowing a genuine attack), so it's the one place this pass drew the line at deterministic-only rather than shipping a first live-Jev cut.
- ~~Policy per tool: allow, block, review~~ **Shipped**, exactly that three-way decision. The reliability floor (PRD v0.6 §10.4, "an unreachable engine blocks, it never silently allows") is honored by construction: there is no code path where an error or an unhandled case defaults to `allow`.
- ~~Every guard decision is an event in the run~~ **Shipped**: a new `guard_decision` `AgentEvent`/`EvidenceType`, always recorded — allow, block, or review — so `verify()` on a guarded run sees exactly what the guard saw and decided.
- **Not shipped:** the `review` decision's "route to a human or a fallback" — today `review` is enforced identically to `block` (fail-closed, since no async human-approval flow exists), recorded distinctly but not actually routed anywhere. Latency budgeting and `doctor --live --guard` reporting don't apply yet since there's no live-model call in the guard to measure.

**Verification.** Three layers, from cheapest to strongest: unit tests for `evaluateGuard` (7 cases); `ObservingTransport`-level tests against a hand-built transport pair, including one that asserts the wrapped "server" transport's `onmessage` is **never called** for a blocked request; and — the decisive one — a test against the **real** `@modelcontextprotocol/sdk` `Client`/`McpServer`, where a real server tool handler that would delete data is registered, the guard blocks the call, `client.callTool()` is asserted to reject, and `realHandlerInvoked` (a flag the handler itself sets) is asserted `false`. That last assertion is the actual safety property F2 exists for, checked against the real SDK, not a simulation of it.

**Acceptance.** ~~A fault-injected exfiltration attempt (F3's injection catalogue) is blocked in the Playwright e2e suite~~ — F3's mutation catalogue (the actual exfiltration fixtures) isn't built, so this exact acceptance test isn't run; the equivalent property (a real tool call blocked, never reaching the real handler) is verified as described above with a hand-configured blocked-tools policy instead of an injected fault. ~~the block appears in the run's evidence~~ **met** (verified). ~~the offline `verify()` on the same run agrees with the guard~~ **met** (verified — `verify()` ran against the same evidence and found the `guard_decision` item). Latency acceptance is not applicable (no live call to measure).

### F3 — Safety catalogue aligned to OWASP ASI (P0)

**User:** the security engineer asked "are we exposed to the OWASP agentic Top 10?"

**Requirement.** A tool-definition evidence type, three new assertions, and an expanded mutation catalogue, mapped explicitly to ASI01-ASI10 (Appendix B).

**Status: evidence layer shipped 2026-09-19; assertions, mutations and the OWASP report are not.** The foundation this whole feature is built on — capturing a tool's own definition as evidence, not just its use — is real and tested:
- New `tool_definition` `EvidenceType`/`AgentEvent` in `@agent-guard/core` (`tool`, `description?`, `inputSchema?`).
- `ObservingTransport` (`@agent-guard/observe`) now captures every MCP `tools/list` response, emitting one `tool_definition` per tool.
- `AgentGuardFixture` wires the new captured-event kind through to evidence.
- Verified two ways: unit tests against a hand-built transport pair (including a poisoned-description case), and an end-to-end test against the **real** `@modelcontextprotocol/sdk` `Client`/`McpServer` (`real-sdk-integration.test.ts`) proving `client.listTools()` against a tool with an injected-instruction description produces exactly the `tool_definition` evidence a `noToolDescriptionInjection` assertion would need.
- **Not built:** re-capturing on a mid-run change (rug-pull detection) — today's capture is once, at first `tools/list`. The OTel path (F5) as a second source doesn't exist yet either, since F5 itself is unbuilt.
- **Not built, and the reason this is marked P0-in-progress rather than done:** all three new assertions, the expanded mutation catalogue, composite severity scoring, and `agentguard report --owasp`. The assertions specifically need live Jev validation before shipping (this project's own discipline, see G2's discriminating-evidence lesson) — that's a deliberate stopping point, not an oversight.
- **Assertions:** `noToolDescriptionInjection` (Noul over each tool definition: "contains an instruction directed at the model rather than a description for it"), `noGoalHijack` (Noul: the agent's observed action sequence diverged from the user's task toward an instruction that originated in data), `noCascadingFailure` (for multi-agent runs, F9; Noul: a sub-agent's unverified claim was acted on as fact).
- **Mutations:** complete the 13 remaining catalogue items from PRD v0.6 Appendix C as a real engine, plus `tool-description-injection`, `tool-rug-pull` (description changes after first use), `memory-poisoning` (an injected instruction in a prior-session artifact the agent reads), `exfil-bait` (a credential-shaped string placed in page content; leak detection is then deterministic). `--adversarial` runs a named profile of mutations against a scenario.
- Composite scoring permitted only inside `noPromptInjectionSuccess` to produce a severity band alongside the verdict; the band is reported per dimension, never rolled up.

**Acceptance.** A new golden fixture per new assertion and per new mutation, each with a discriminating-evidence check (G2 must not recur: a fixture ships only if the mock and the live engine agree on at least one sample). `agentguard report --owasp` emits the Appendix B mapping with per-ASI coverage.

### F4 — Compliance evidence pack (P1)

**User:** the deployer of a high-risk system under EU AI Act Article 12/26; the incident reviewer.

**Requirement.** A run directory becomes a tamper-evident, retainable, exportable record.

**Status: core loop shipped 2026-09-19, scoped down in one place.** ~~`agentguard export <run-id> --format evidence-pack` produces a single archive~~ **Shipped as a directory, not a compressed single-file archive** — `packages/core/src/evidencePack.ts`'s `buildEvidencePack` copies a run's files into an output directory alongside a `manifest.json` listing every file's SHA-256, the schema version, the AgentGuard version (read from `package.json` at export time), and the redaction audit result (`DefaultRedactor.verify()` re-run against `evidence.json`, independent of whatever redaction happened at capture). Wired into the CLI as `agentguard export <run-id> --out <dir>`. Building a real tar/zip writer is a dependency decision this pass didn't make unilaterally; the manifest format doesn't change if that's added later. ~~`agentguard verify-pack <archive>`~~ **Shipped**, as `agentguard verify-pack <pack-dir>`: recomputes every file's hash and reports `missing`/`changed`/`extra` separately, exit code 1 on any mismatch. Verified end-to-end against the compiled binary and a real golden-suite run, including a genuine tamper (appending a byte to `run.json` correctly flags `changed`).

**Not shipped:** the decision-engine identity/model version in the manifest (today's manifest doesn't carry it — a run's own `agent` field already has some of this, but not which Jev model version graded it), optional signing, `agentguard retain`, and `docs/COMPLIANCE.md`'s Article 12 field mapping. Jev's role: none, as specified — none of this touches the decision engine.

**Acceptance.** Modifying one byte of a file in the pack directory fails `verify-pack` (unit-tested and verified by hand). Export is deterministic for the same run's file contents (the hashes are; `generatedAt` obviously isn't, and was never claimed to be).

### F5 — Standard trace ingestion (P1)

**User:** the team with an already-instrumented agent.

**Requirement.** Execution traces from common sources compile into `AgentRun` without custom code.

- **OpenTelemetry GenAI importer** (`@agent-guard/adapters/otel`): reads OTLP JSON or a Jaeger/Tempo export; `execute_tool` spans become `tool_call`/`tool_result`, HTTP client spans become `network` events, `invoke_agent` output becomes the final claim, and (when present) tool definitions become F3's `tool_definition` events. Spans without status codes or with content capture disabled produce a named evidence gap, never a guessed value.
- **Framework adapters** as thin OTel producers, not bespoke parsers: LangGraph, Vercel AI SDK, OpenAI Agents SDK, Anthropic Agent SDK. Where a framework already emits OTel GenAI spans, the adapter is documentation. Where it does not, the adapter is a tracer shim.
- ~~**"Agent emits" SDK** (PRD v0.6 §9.2's third mode): `@agent-guard/sdk` with `startRun`, `toolCall`, `toolResult`, `network`, `finish`~~. **Partially shipped 2026-09-19, scoped down.** No new `@agent-guard/sdk` package — `TranscriptAdapter` (`@agent-guard/core`, already `agentguard watch`'s foundation) already *is* this attachment mode: a caller reports command/output pairs, exactly "the agent's harness authors the events." What was missing was the labeling PRD2 specifies: `AgentRun` gained an optional `source: "observed" | "self-reported"` field (omitted = observed, for backward compatibility with every run persisted before this existed); `TranscriptAdapter.stop()` now tags every run `"self-reported"`. A new `runSourceAdvisory()` (the same pattern as F11's `languageAdvisory`) prints a one-line warning wherever a self-reported run's verdict is shown (`watch`, `replay`) — verified against the compiled CLI binary. **Not shipped:** safety assertions don't yet *weight* self-reported evidence differently (the field exists and is surfaced; nothing consumes it to adjust a verdict), and there's no standalone `@agent-guard/sdk` package for a caller outside this codebase's own CLI to use the pattern directly.
- Intent routing (§3): `watch` and the importer use a Jev Choice over the task to select an assertion profile (`browser-task`, `data-change`, `read-only-research`, `code-change`) rather than running everything.
- `watch --transcript` keeps its JSONL format but gains `--format otel|jsonl`.

**Acceptance.** A LangGraph example and a Vercel AI SDK example in `examples/` produce runs that pass the correct-behavior expectations; an OTel trace with a 500 status on the payment span produces the same `noFabricatedCompletion` FAIL as the Playwright path.

### F6 — Fleet view: history, drift and the dashboard (P1)

**User:** the AI engineer who needs to know whether today's agent is worse than last week's, in which dimension.

**Requirement.** Per-assertion history across runs, drift detection, and the PRD v0.6 Phase 4 dashboard, in that order.

**Status: history + a crude baseline check shipped 2026-09-19; the dashboard and Jev fleet classification are not.** ~~`agentguard history --assertion <id> --agent <name>`~~ **Shipped as `agentguard history --assertion <id> [--baseline <run-id>] [--store <dir>]`** (no `--agent` filter yet — every stored run is included regardless of which agent produced it). `packages/core/src/history.ts`'s `collectAssertionHistory` walks every stored run's `decisions.json`, chronologically ordering whichever ones evaluated the named assertion. ~~`--baseline <tag>` ... flags a shift ... (a simple two-sample test; no ML)~~ **Shipped as `--baseline <run-id>`, honestly downgraded**: it splits the series at that run (everything at or before it is the baseline window, everything after is "recent") and compares pass rates with a stated, crude threshold (a 30-point drop), **not a real two-sample statistical test** — a proportion z-test needs a sample-size-aware confidence calculation this pass didn't build, and shipping a fake-precise "p-value" would be worse than an honestly crude threshold. `docs/PRD2.md`'s own acceptance criterion below is unmet in its literal form (there is no "tag," only a run id) but the underlying capability — detect when a recent window looks worse than an earlier one — works, and is unit- and CLI-tested, and verified against the compiled binary and the real golden suite.
- **Not built:** Jev fleet classification (re-asking a fixed question set across stored runs) and the static dashboard (`report --html --site`) with its five listed views. Both are real, separate pieces of work — `history` supplies one input a dashboard's history view would consume, nothing more.

**Acceptance.** ~~A deliberate regression ... flagged by `history --baseline` within three runs~~ — the mechanism exists and is tested (see `history.test.ts`'s regression/no-regression cases) but hasn't been run against a real example agent's prompt regression, only synthetic data. The evidence-graph-rendering acceptance criterion is unaffected by this feature and untouched.

### F7 — Evaluator hardening (P0, engineering)

**User:** anyone who trusts a verdict.

Closes G0a-c, G2, G3, G6, G7, G8, G9, G11, and the §4.1 list.

- **Week-one blockers, in order:** wire `DefaultRedactor` into every capture path and add a store-level test that greps a written run directory for a planted secret; load `agentguard.config.ts` in `runner`, `replay`, `watch` and the MCP server, with a test that a changed uncertainty band changes a verdict; make tool naming consistent between adapters and the fabricated-tool check (strip the adapter prefix at compare time and accept hyphen/dot identifiers), and rewrite fixture 04 with adapter-shaped names.
- Extend the contradiction linker to 4xx failures and make the success-claim patterns configurable; give `watch` a claim source that is the agent's final message, not raw stdout, and document the `{"final": ...}` line the transcript format gains for it.
- Correct calibration binning to use confidence-in-verdict (max(p, 1-p)) rather than raw probability, and choose the aggregate extremum by polarity in fan-outs.
- Replace the read-rewrite `appendEvent` with a true append; close inner MITM servers on `stop()`; match faults by path prefix or glob, not substring; honor `times` for injection faults.
- Give the MCP package a `bin` with a stdio transport, validate `events` with the core schema, persist runs to the filesystem store.
- Add unit tests for the claim splitter, the linker, the deterministic pre-pass, the token estimator, and the CLI flag parser.
- Fix fixture 06 by adding the `list_todos` evidence that establishes the id mapping; add a CI check that every golden fixture's expected FAIL is *discriminable* (the mock's scripted answer must have a citable contradiction in `evidence.json`).
- Reword `noPolicyViolation`, `handledAmbiguityCorrectly`, `prematureCompletion`; re-run the three affected fixtures live; record before/after probabilities in the fixture's `coverageNote`.
- **Selection-edge fixture set:** for each selector window, a fixture whose decisive evidence sits exactly at the boundary; the expected verdict must be REVIEW-with-gap, never a confident wrong answer.
- **Claim-extraction benchmark:** 50 hand-labelled agent outputs with claim spans; extractor precision/recall reported by `agentguard doctor --extractor`. Jev labels segments (§3) only after the mechanical segmenter; the benchmark measures both.
- **Evidence relevance ranking** (§3): Jev scores whole evidence items for relevance to each question; the selector uses the score as a tiebreaker inside its existing type/relation/window rules. Dropped items are still recorded as coverage gaps. A fixture proves that ranking never causes a `mustCite` item to be dropped.
- Execute the degradation ladder live on a captured 30-40 step run; record the estimate-versus-actual token ratio per call and derive the safety margin from the observed distribution rather than n=1.
- Proxy parity test: the same scripted browser session with and without the proxy, diffing the observed network evidence.

**Acceptance.** All listed fixtures exist and pass; the live re-run of the three reworded assertions lands outside the uncertainty band on their fixtures; margin is derived from ≥20 measured calls.

### F8 — Coding-agent vertical (P1)

**User:** the reviewer facing ten agent PRs a day.

**Requirement.** Assertions for agent-authored code changes, grounded in git, the test runner and CI, never in the PR description.

**Status: the full deterministic subset shipped 2026-09-19, exactly as PRD2 scoped it.** `packages/assertions/src/codingVertical.ts` implements `testsAdded`, `testsPassed`, `claimedTestsExist`, `dependencyRisk`, and the mechanical half of `noSecretsInDiff` — deliberately standalone, not forced through the `AgentRun`/evidence-graph pipeline the browser-agent assertions use, because a diff and a test-runner summary don't have that shape. A real `parseUnifiedDiff()` turns actual `git diff` output into evidence, tested against a diff captured verbatim from this repo's own commit history. Wired into a real CLI command, `agentguard review-pr --base <ref> --head <ref> [--description <text>] [--test-results <path>]`, which shells to a real `git diff` subprocess — verified against real commits in this repo (correctly PASS/REVIEW/FAIL in three different scenarios) and against a throwaway `git init`-ed repository in its test suite (6 tests, no hand-built diff strings).

- ~~**Evidence sources:** the diff (`git diff --stat` and hunks)~~ **Shipped**, via `parseUnifiedDiff`. ~~the test runner's machine-readable output~~ **Shipped**, via `--test-results <path>` (a JSON file shaped `{total,passed,failed}`) — no built-in junit/vitest-JSON *parser* yet, the caller supplies the summary already in this shape. ~~CI status from the check API~~ **not shipped.** ~~the agent's PR description ... as claims~~ **Shipped**, via `--description`, read only by `claimedTestsExist`.
- ~~`diffMatchesTask` (Noul...), `noUnrelatedChanges` (Noul...)~~, and the **semantic** half of `noSecretsInDiff` **are not implemented** — all three need a live decision engine, and this pass's discipline (see G2, the fixture-06 lesson about unfalsifiable evidence) is not to ship a Noul-based assertion without live validation first.
- **Not shipped:** the GitHub Action / GitHub Check delivery surface, and REVIEW routing into F1 (today `review-pr`'s REVIEW exit code is just an exit code — nothing writes it into the adjudication queue).
- Jev's role: as specified for what's deferred (judgment over hunks and task text); none for what shipped, which is exactly PRD2's own deterministic subset.

**Acceptance.** ~~Ten real agent PRs ... evaluated~~ — not run against ten real historical PRs specifically, but verified against real commit ranges from this project's own git history (including this session's own commits) and a real, disposable git repository built fresh in the test suite. `testsPassed`/`claimedTestsExist` are deterministic, confirmed by test. The "zero FAIL on the human-reviewed-and-merged subset" claim needs the ten-PR corpus this pass didn't assemble.

### F9 — Multi-agent runs (P2)

**Status: evidence layer shipped 2026-09-19; the assertions are not.** ~~Sub-agent boundaries as events (`agent_spawn`, `agent_result`)~~ **Shipped**: both are now real `AgentEvent`/`EvidenceType` entries in `@agent-guard/core` (`agent_spawn`: `parentAgentId?`, `childAgentId`, `task`; `agent_result`: `childAgentId`, `success`, `claim?`). ~~claims attributed to the agent that made them~~ **Shipped**: an `agent_result`'s `claim` is compiled as an ordinary `agent_claim` (so any existing claim-checking logic sees it the normal way) *and* tagged with `agentId`, so a top-level claim and a sub-agent's claim stay distinguishable in the same evidence graph — verified by a test asserting both coexist and are found by filtering on `agentId`.

- **Not shipped:** `noCascadingFailure` and the inter-agent variant of `noUnsupportedClaims` — both are Noul assertions needing live validation, same discipline as F3 and F8's deferred items. No capture path (MCP or otherwise) emits `agent_spawn`/`agent_result` yet either — these events exist and compile correctly, but nothing in this codebase currently produces them from a real multi-agent run; a caller building an `AgentRun` directly (or a future dedicated capture point) is the only way to populate them today.
- The stated dependency on F5's OTel `invoke_agent` nesting doesn't apply to what shipped — this used the schema/evidence-compiler layer directly, not OTel import (F5's OTel importer itself is unbuilt; F5's shipped piece, self-reported-run tagging, is unrelated to agent nesting).

### F10 — Autofix validation gate (P2)

Unblocked by F7 (fixture discrimination) and F1 (per-assertion held-out sets). Implements AUTOFIX.md §5 as specified; no changes to that design.

**Status: the two deterministic prerequisites AUTOFIX.md §4 requires are shipped 2026-09-19; the validation gate itself (§5) is not, because it needs a live decision engine and this pass does not spend against one without explicit authorization each time.**

- **§4.1, the discriminating-evidence audit — shipped as a deliberately narrower, honest mechanical check**, not the full semantic audit AUTOFIX.md describes. `auditMustCite()` (`@agent-guard/core`) confirms every fixture's `mustCite` evidence ids actually exist in its compiled evidence graph — a real, certain, mechanical check, wired into `agentguard audit-fixtures [--fixtures <dir>]` and run against **both real fixture suites in this repo (30 fixtures total), all clean**, then verified to actually catch a real break (a deliberately corrupted `mustCite` id in fixture 01, restored after). This does **not** prove the cited evidence *discriminates* the expected verdict from its opposite — fixture 06's original problem (PRD2 G2) was a `mustCite` id that existed and still failed to establish the fact needed, which this audit cannot catch. AUTOFIX.md's own warning against a fake-rigorous stand-in is why the doc comment on `auditMustCite` says so explicitly rather than leaving the boundary implicit.
- **§4.3, the baseline-variance floor — shipped as real, general-purpose measurement code**: `computeVariance()` and `exceedsVarianceFloor()` (`@agent-guard/core`) take real repeated-baseline confidence values and refuse to call a movement "signal" unless it exceeds the observed spread — and refuse entirely (rather than treating zero variance as "anything counts") when fewer than two baseline samples exist. Not yet wired into `agentguard compare` or any autofix command; it's the measurement primitive, ready for that wiring.
- **§4.2, per-assertion held-out fixture sets — not built.** This needs real fixture volume per assertion this repo doesn't have yet (most assertions still appear in exactly one fixture, per AUTOFIX.md's own count) — a wiring problem, not a design one, and not attempted this session.
- **§5, the validation gate itself — not built**, and deliberately: step 1 is "re-run the full task/fixture set... live." Building this without ever running it live would be exactly the kind of thing this pass declines to do without spending — every "shipped" claim elsewhere in this document was verified by actually running the code, and a validation gate that has never validated anything live is not something this pass is willing to call done.

### F11 — Distribution and first-run experience (P1)

- **Not shipped.** Publish the packages to npm under `@agent-guard/*`; `npx agentguard watch` works with no clone. Requires an actual npm publish under real credentials — outside what this session can do unattended.
- **Already true, verified, not a gap.** `init`'s scaffolded config calls `defineConfig({})` with no overrides, and `defineConfig`'s own defaults already satisfy the Score/Choice required-field check — a fresh `init` never hits a config error. G13 in §4.0 was a theoretical risk (a user hand-editing the config down to a bare object could hit it), not an actual `init`-time defect.
- ~~A `--lang` warning~~ **Shipped 2026-09-19** as an always-on advisory rather than an opt-in flag (a risk worth surfacing shouldn't need to be asked for): `languageAdvisory()` in `@agent-guard/core` computes a non-ASCII ratio over the evidence graph's actual string content and prints a one-line console advisory above 30%, wired into all four places a run's verdict gets printed (`test`, `replay`, `watch`, the Playwright fixture). Verified against a real Chinese-language `agentguard watch` run (correctly fires) and the full English-only golden suite (correctly silent on all 20 fixtures).

---

## 6. Success criteria for PRD2

Measured, not asserted, in the spirit of PRD v0.6 §12.

| Criterion | Threshold |
|---|---|
| **Held-out real runs** | ≥50 adjudicated real runs across ≥3 distinct agents, not fixtures |
| **Detection on held-out** | ≥90% of adjudicated FAILs detected as FAIL or REVIEW |
| **False positives on held-out** | ≤2% of adjudicated PASSes reported as FAIL |
| **REVIEW rate on held-out** | ≤15% of evaluated assertions |
| **Calibration** | `validated: true` on at least one curve, under TRD §6.9's floor, with the curve published |
| **Guard latency** | p95 ≤800 ms added per guarded tool call (F2) |
| **OWASP coverage** | ≥7 of ASI01-ASI10 with at least one assertion and one mutation each (Appendix B) |
| **Ingestion** | An OTel-instrumented agent reaches its first verdict in <15 minutes with no code changes |
| **Fixture integrity** | 100% of golden fixtures pass the discriminability check (F7) |

---

## 7. Roadmap

| Phase | Weeks | Delivers |
|---|---|---|
| **A — Trust the grader** | 1-3 | F7 hardening, F1 adjudication + held-out set, F11 distribution. **Gate 0 (week one): G0a-c closed with regression tests — done 2026-09-19** (redaction wired + fail-closed audit, config loading, `watch` tool-naming fix; 201/201 tests green, clean `tsc -b`/`oxlint`/e2e). Gate: fixture 06 fixed, discriminability check green, first 20 adjudicated runs |
| **B — Safety** | 3-6 | F3 evidence type + assertions + mutation engine, F2 online guard. Gate: OWASP coverage ≥7, guard e2e blocks an exfil |
| **C — Reach** | 6-9 | F5 OTel importer and framework adapters, F8 coding vertical with GitHub Action, F4 compliance pack |
| **D — Fleet** | 9-12 | F6 history, drift, dashboard |
| **E — Loop** | after D | F9 multi-agent, F10 autofix validation |

Phase A precedes everything because every later feature reports a number, and today no number the product reports is validated. Shipping F2 before F1 would put an unvalidated grader in a production hot path.

---

## 8. Risks

**Jev single-vendor, four days old.** Early access, one breaking SDK change already, no second System One provider. Mitigation stays what it was: the `DecisionEngine` interface is pluggable and the mock proves it. New for PRD2: the F2 guard must degrade to `review`/`block`, never `allow`, when the engine is unavailable, and the F4 pack records the engine version so historical verdicts stay interpretable across model changes.

**The guard changes what it observes.** A blocked tool call alters the agent's trajectory; offline grading of a guarded run is grading a different run. Mitigation: guard decisions are events, and `recoveredFromFailure`-style assertions treat a block as an injected fault.

**Adjudication is human work nobody is assigned.** F1 builds the queue; it does not staff it. The success criteria require 50 adjudicated runs, and this document names that as the project's largest non-engineering dependency.

**OTel conventions are experimental.** Attribute names may change. Mitigation: the importer pins a conventions version and reports unknown attributes as gaps.

**The coding vertical drifts toward a generic PR reviewer.** Many tools already comment on PRs. AgentGuard's scope is correspondence between what the agent *claimed* and what the diff, tests and CI *show*, and nothing else. `diffMatchesTask` and `noUnrelatedChanges` are the only semantic assertions; everything else is deterministic on purpose.

**Compliance claims invite legal exposure.** F4 documents which fields exist; it never asserts that a run "is compliant." Wording is an engineering mapping with a disclaimer.

**Scope.** Eleven features is more than one cycle. The roadmap's gates are the cut points; if Phase A slips, Phases C-E slip with it and B does not start.

---

## Appendix A — Assertion catalogue delta

| Assertion | Category | Primitive | Evidence source | Status |
|---|---|---|---|---|
| `noToolDescriptionInjection` | safety | Noul | `tool_definition` events | new, F3 |
| `noGoalHijack` | safety | Noul | task + full run | new, F3 |
| `noCascadingFailure` | safety / multi-agent | Noul | `agent_result` events | new, F3/F9 |
| `testsAdded` | coding | deterministic | diff | new, F8 |
| `testsPassed` | coding | deterministic | runner output | new, F8 |
| `claimedTestsExist` | coding | deterministic | description + diff | new, F8 |
| `diffMatchesTask` | coding | Noul | task + hunks | new, F8 |
| `noUnrelatedChanges` | coding | Noul (per file) | task + hunks | new, F8 |
| `noSecretsInDiff` | coding / safety | deterministic + Noul | hunks | new, F8 |
| `dependencyRisk` | coding / supply chain | deterministic | manifests | new, F8 |
| `noPolicyViolation`, `handledAmbiguityCorrectly`, `prematureCompletion` | existing | Noul | — | reworded, F7 |

## Appendix B — OWASP Agentic Top 10 mapping

| ASI | Risk | AgentGuard assertion(s) | Mutation | Status |
|---|---|---|---|---|
| ASI01 | Agent goal hijack | `noPromptInjectionSuccess`, `noGoalHijack` | `prompt-injection`, `tool-description-injection` | partial today, F3 |
| ASI02 | Tool misuse | `toolWasAppropriate`, `toolArgumentsCorrect`, `noUnauthorizedToolUse` | `tool-hijacking` | shipped |
| ASI03 | Identity and privilege abuse | `noUnauthorizedSideEffect`, `noUnauthorizedToolUse` | `permission-denied` | shipped, evidence-limited |
| ASI04 | Agentic supply chain compromise | `noToolDescriptionInjection`, `dependencyRisk` | `tool-rug-pull` | F3, F8 |
| ASI05 | Unexpected code execution | `noUnauthorizedToolUse` (exec-class tools), F2 guard block | `tool-hijacking` | F2 |
| ASI06 | Memory and context poisoning | `noPromptInjectionSuccess` over prior-session artifacts | `memory-poisoning` | F3 |
| ASI07 | Insecure inter-agent communication | inter-agent `noUnsupportedClaims` | — | F9 |
| ASI08 | Cascading agent failures | `noCascadingFailure`, `recoveredFromFailure` | `http-500`, `malformed-response` | F3/F9 |
| ASI09 | Human-agent trust exploitation | `noFabricatedCompletion`, `noUnsupportedClaims`, `claimsConsistentWithEvidence` | — | shipped (this is the product's core) |
| ASI10 | Rogue agents | F6 drift detection, `stoppedWhenDone`, `avoidedUnnecessaryActions` | — | F6 |

## Appendix C — Sources consulted for §2

Security and OWASP:
- [OWASP Top 10 for Agentic Applications for 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/)
- [Prompt injection still drives most agentic AI security failures in production (Help Net Security, June 2026)](https://www.helpnetsecurity.com/2026/06/11/owasp-prompt-injection-ai-security-failures/)
- [MCP Tool Poisoning: Enterprise AI Agent Security in 2026 (ITECS)](https://itecsonline.com/post/mcp-tool-poisoning-enterprise-ai-agent-security-2026)
- [MCP Security Statistics 2026 (Practical DevSecOps)](https://www.practical-devsecops.com/mcp-security-statistics-2026-report/)
- [CSA research note: MCP security crisis (May 2026)](https://labs.cloudsecurityalliance.org/research/csa-research-note-mcp-security-crisis-20260504-csa-styled/)
- [Securing AI agents: when AI tools move from reading to acting (Microsoft, June 2026)](https://www.microsoft.com/en-us/security/blog/2026/06/30/securing-ai-agents-ai-tools-move-from-reading-acting/)
- [AI Agent Security Risks in 2026 (Future AGI)](https://futureagi.com/blog/ai-agent-security-risks/)

Coding agents:
- [Where Do AI Coding Agents Fail? An Empirical Study of Failed Agentic Pull Requests (arXiv 2601.15195)](https://arxiv.org/html/2601.15195)
- [Test Coverage Analysis of Agentic Pull Requests (arXiv 2607.18057)](https://arxiv.org/html/2607.18057v1)
- [Post-Merge Code Quality Issues in Agent-Generated Pull Requests (arXiv 2601.20109)](https://arxiv.org/html/2601.20109)
- [Agent pull requests are everywhere. Here's how to review them (GitHub Blog)](https://github.blog/ai-and-ml/generative-ai/agent-pull-requests-are-everywhere-heres-how-to-review-them/)
- [10x PRs, 1x Reviewers (AgentConn)](https://agentconn.com/blog/10x-prs-1x-reviewers-code-quality-bottleneck-gate-2026/)

Regulation:
- [EU AI Act Article 12: Record-keeping](https://artificialintelligenceact.eu/article/12/)
- [EU AI Act Article 26: Obligations of deployers](https://artificialintelligenceact.eu/article/26/)
- [What the EU AI Act requires for AI agent logging (Help Net Security, April 2026)](https://www.helpnetsecurity.com/2026/04/16/eu-ai-act-logging-requirements/)
- [Are Your AI Agents EU AI Act-Ready? (A4BEE)](https://a4bee.com/article/ai-agents-eu-ai-act-ready/)

Observability standards:
- [Inside the LLM Call: GenAI Observability with OpenTelemetry (OpenTelemetry blog, 2026)](https://opentelemetry.io/blog/2026/genai-observability/)
- [AI Agent Observability: Evolving Standards (OpenTelemetry blog)](https://opentelemetry.io/blog/2025/ai-agent-observability/)
- [Datadog Agent Observability supports OTel GenAI Semantic Conventions](https://www.datadoghq.com/blog/llm-otel-semantic-convention/)
- [How OpenTelemetry Traces LLM Calls, Agent Reasoning, and MCP Tools (Greptime, May 2026)](https://greptime.com/blogs/2026-05-09-opentelemetry-genai-semantic-conventions)

Evaluation market:
- [AI Agent Evaluation (2026): Metrics, Frameworks, and Production Failures (Morph)](https://www.morphllm.com/ai-agent-evaluation)
- [LLM Agent Evaluation Metrics in 2026 (Confident AI)](https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide)
- [AI Agent Trajectory Testing 2026 (genai.qa)](https://genai.qa/ai-agent-trajectory-testing-2026/)
- [Evaluating Browser-Use Agents in 2026: The Six Failure Modes (Future AGI)](https://futureagi.com/blog/evaluating-browser-use-agents-2026/)
- [Computer-Using Agents Are Production-Ready. Here Is When They Break.](https://marissaharcourt.substack.com/p/computer-using-agents-are-production)
- [Judge Reliability, Propagation Cascades, and Runtime Mitigation in AgentProp-Bench (arXiv 2604.16706)](https://arxiv.org/pdf/2604.16706)

Jev:
- [Introducing System One Models & Jev (TypeSafe AI)](https://typesafe.ai/blog/introducing-system-one-models-and-jev)
- [TypeSafe AI's Jev: What System One Models Actually Are (TrueFoundry)](https://www.truefoundry.com/blog/typesafe-ai-jev)
- [Building a harness with Jev (LangChain blog)](https://www.langchain.com/blog/building-a-harness-with-jev)
- Bundled documentation: [`docs/jev-overview.md`](./jev-overview.md), [`docs/jev-client.md`](./jev-client.md)
