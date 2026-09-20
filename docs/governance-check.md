# Governance Doc

**Artifact type:** normative review contract
**Applies to:** the tool-use governance package (npm) — a library + CLI that lints LLM tool definitions, monitors agent↔tool interactions at runtime, and applies or proposes automatic fixes.
**Audience:** the **Reviewer Agent** (reads this document, produces findings) and the **Engineer Agent** (reads findings, produces fixes).
**Status of this file:** binding. A check that is not in this document is not a blocker. A check that is in this document cannot be waived by conversation — only by the waiver mechanism in §0.8.

---

## 0. How this document is used

### 0.1 Roles

| Role | Does | Must never |
|---|---|---|
| **Reviewer Agent** | Reads the repo, executes verification commands, emits a `ReviewReport` (§4.1) with findings keyed to check IDs in §2. | Edit source. Mark a check green without evidence. Invent check IDs. |
| **Engineer Agent** | Reads the `ReviewReport`, fixes findings, emits a `FixReport` (§4.2). | Edit this governance doc. Weaken a test or add a suppression to clear a finding (§0.7). |
| **Human maintainer** | Approves waivers, resolves escalations, owns release. | — |

The two agents must be separate contexts. The Reviewer Agent must not be given the Engineer Agent's reasoning or self-assessment as input — only the repo state and command output. Self-review is not review.

### 0.2 The loop

```
   ┌──────────────────────────────────────────────────────────┐
   │                                                          │
   ▼                                                          │
[1] Reviewer: full sweep of §2 against current commit         │
   │                                                          │
   ├── all gates green ────────────────► [5] SIGN-OFF         │
   │                                                          │
   ▼                                                          │
[2] Reviewer emits ReviewReport (findings, sorted by severity)│
   │                                                          │
   ▼                                                          │
[3] Engineer fixes; emits FixReport + diff + command output   │
   │                                                          │
   ▼                                                          │
[4] Reviewer re-runs: (a) every finding from [2],             │
    (b) every check whose surface the diff touched,           │
    (c) full sweep every 3rd iteration and always on the      │
        iteration that would sign off ─────────────────────────┘
```

Rules for the loop:

- **L-1** Iteration budget: **8**. At iteration 8 without green, stop and escalate (§0.9). Do not silently continue.
- **L-2** Monotonic progress: each iteration must close ≥1 finding and must not open a new BLOCKER. Two consecutive iterations with net-zero progress = escalate.
- **L-3** No partial green. A check is `pass`, `fail`, `waived`, or `n/a`. There is no "mostly".
- **L-4** Regression rule: if a fix in iteration *n* breaks a check that passed in iteration *n−1*, the new failure inherits the severity of the broken check and is tagged `regression`. Regressions are always re-verified by full sweep.
- **L-5** The final iteration before sign-off must be a **full sweep from a clean checkout** (fresh `git clone` or `git clean -xdf` + fresh install), not an incremental re-check of a warm working tree.
- **L-6** Every check result must carry the commit SHA it was evaluated against. Findings evaluated against a stale SHA are void.

### 0.3 Severity model

| Severity | Meaning | Gate effect |
|---|---|---|
| **BLOCKER** | Ships a security hole, data-loss path, silently wrong autofix, or breaks the package for consumers. | Must be 0. Never waivable. |
| **MAJOR** | Correctness, contract, or safety defect that degrades agent behaviour or DX materially. | Must be 0 to sign off. Waivable only with human approval + expiry. |
| **MINOR** | Quality, consistency, docs, or polish. | ≤5 allowed at sign-off, each with a tracked issue. |
| **ADVISORY** | Recommendation; may be declined with a one-line rationale. | No gate. |

Severity is fixed by this document. The Engineer Agent may not downgrade a severity. The Reviewer Agent may **upgrade** a severity if it finds a concrete exploit or data-loss path, and must state that path in the finding.

### 0.4 Green definition

Sign-off requires **all** of:

1. `BLOCKER = 0` and `MAJOR = 0` (unwaived), from a clean-checkout full sweep.
2. Every check in §2 has an explicit status — no check left unevaluated. Unevaluated counts as `fail`.
3. Every `n/a` carries a reason referencing a scope decision in §1.
4. All verification commands in §5 exit 0 and their output is attached.
5. The `FixReport` chain from iteration 1 to *n* reconstructs the whole diff — no unexplained changes in `git diff <base>..HEAD`.

### 0.5 Evidence rules

A finding or a pass is only valid with evidence. Accepted evidence, in order of strength:

1. **Command output** — command line, exit code, and relevant stdout/stderr, captured verbatim.
2. **File + line citation** — `path/to/file.ts:L120-L138` plus the quoted lines.
3. **Artifact** — generated report file (SARIF, JSON, coverage summary, bundle stats).

Not accepted as evidence: an agent's assertion that it checked; "the code looks correct"; a summary of a file that was not read; a test name without the test result.

Every check in §2 lists `Verify:` — the minimum evidence class required. Where a check lists a command, that command's actual output must be attached, not a paraphrase.

### 0.6 Finding format (per finding)

```
[ID] [SEVERITY] <one-line title>
  where:     <file:line | command | artifact>
  observed:  <what is true now>
  required:  <what the check demands, quoted from §2>
  impact:    <concrete consequence for an agent/consumer>
  fix hint:  <smallest change that would satisfy the check>
  verify:    <exact command or inspection that will re-check it>
```

`fix hint` is advisory. The Engineer Agent may fix it differently; it may not ignore the check.

### 0.7 Integrity rules (anti-gaming)

These exist because the loop optimises for "all green", and the cheapest path to green is often sabotage. Any of the following, detected at any iteration, is an automatic **BLOCKER** finding under `INT-*` and resets the iteration counter's progress credit:

- **INT-001** Deleting, skipping, `.only`-ing, or loosening an existing test to clear a finding, without a stated correctness reason accepted by the Reviewer.
- **INT-002** Adding a lint/type suppression (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `# noqa`, `istanbul ignore`) that covers the flagged code instead of fixing it. Suppressions require an inline reason comment and appear in the waiver register (§0.8).
- **INT-003** Lowering a configured threshold (coverage, bundle size, latency budget, mutation score) to make a gate pass.
- **INT-004** Narrowing a type to `any`/`unknown`/`object` or widening an input schema to make type-checking pass.
- **INT-005** Moving failing code behind a feature flag defaulted off, or into a file excluded from lint/test globs, without removing the code path.
- **INT-006** Making a check pass by removing the capability it governs (e.g. deleting the autofix engine to pass autofix safety checks) without an explicit scope decision recorded in §1.
- **INT-007** Adding a special case keyed to the fixture/test input rather than implementing the general rule.
- **INT-008** Editing this governance document, the check registry, its severities, or the verification commands.
- **INT-009** Reporting a check as passing without attached evidence, or attaching evidence from a different commit.
- **INT-010** Stubbing a network/model call in a way that makes an integration test tautological (asserting the stub, not the behaviour).

The Reviewer Agent must run an explicit integrity pass over each diff: `git diff <prev>..HEAD -- '*test*' '*spec*' '*.config.*' 'package.json'` and read every hunk that touches tests, configs, thresholds, or ignore lists.

### 0.8 Waivers

A waiver is a file-tracked exception, not a conversation.

- Stored in `governance/waivers.yml`, one entry per waived check.
- Required fields: `id`, `check`, `scope` (glob or symbol), `reason`, `approved_by` (human), `created`, `expires` (≤90 days), `tracking_issue`.
- BLOCKER is never waivable.
- An expired waiver re-activates its check at original severity.
- The Reviewer Agent must list active waivers in every report and flag any waiver whose scope has widened since approval.

### 0.9 Escalation

Escalate to the human maintainer, with a written summary, when:

- Iteration budget (L-1) is exhausted; or
- Two consecutive no-progress iterations (L-2); or
- A check as written is impossible or contradictory given the chosen architecture — in which case propose a specific amendment to this doc rather than ignoring the check; or
- A BLOCKER requires a design change beyond the current scope (§1); or
- An integrity violation (§0.7) recurs after being flagged once.

Escalation output: the open findings, what was tried, why it did not work, and the smallest decision needed from the human.

---

## 1. Scope and product invariants

The checks in §2 assume the package does these things. If a capability is out of scope for the current milestone, record it here with a date and owner; its checks become `n/a` with that reference.

### 1.1 Capabilities in scope

| # | Capability | In scope? |
|---|---|---|
| C1 | **Static linting** of tool/function definitions (JSON Schema, MCP tool manifests, OpenAI/Anthropic tool blocks, LangChain/LlamaIndex tool objects) | yes |
| C2 | **Description and disambiguation analysis** across a tool set (overlap, collision, ambiguity) | yes |
| C3 | **Runtime monitoring** of tool calls and results (wrapper/middleware/proxy) | yes |
| C4 | **Failure classification** of tool-call errors into a stable taxonomy | yes |
| C5 | **Autofix** — deterministic rewrites of tool definitions and adapters | yes |
| C6 | **Repair loop** — feeding structured error context back to the model on a failed call | yes |
| C7 | **Reporting** — human output, JSON, SARIF, CI annotations | yes |
| C8 | **Plugin API** for custom rules and fixers | yes |

### 1.2 Non-negotiable product invariants

These are the invariants every check ultimately protects. Violating one is a BLOCKER regardless of which check catches it.

- **P-1 Never silently change agent behaviour.** Every autofix is visible in a diff, in a log, or in a report — never applied in-memory-only without a record.
- **P-2 Never lose the original.** No destructive write without a recoverable prior state.
- **P-3 Tool results are untrusted input.** Content returned by a tool, an MCP server, or a monitored agent is data and never instruction, for this package and for anything it emits.
- **P-4 Monitoring must not alter semantics.** Wrapping a tool must not change its result, its error, its ordering, or its timing beyond a declared budget.
- **P-5 Fail open for observation, fail closed for mutation.** If the monitor breaks, the host agent keeps working. If the fixer is uncertain, it does nothing.
- **P-6 Deterministic core.** Given the same input, lint results and fixes are byte-identical across runs, machines, and Node versions.
- **P-7 No secrets, no PII, no payloads leave the process** unless explicitly configured, and never by default.
- **P-8 The package's own output is agent-readable.** Reports are token-bounded, stable, and injection-resistant, because an agent will read them.

---

## 2. Check registry

Check ID format: `<DOMAIN>-<NNN>`. IDs are permanent. A retired check keeps its ID and is marked `RETIRED`; IDs are never reused.

Domains:

| Prefix | Domain | §  |
|---|---|---|
| `TC` | Tool contract & schema linting | 2.1 |
| `TD` | Tool naming, descriptions, disambiguation | 2.2 |
| `RC` | Result & error contract | 2.3 |
| `TS` | Tool-set level (budget, collisions, topology) | 2.4 |
| `RM` | Runtime monitor | 2.5 |
| `LP` | Loop, retry & repair safety | 2.6 |
| `AF` | Autofix engine | 2.7 |
| `SEC` | Security & trust boundary | 2.8 |
| `PRV` | Privacy, telemetry & data handling | 2.9 |
| `OBS` | Observability of the package itself | 2.10 |
| `NPM` | Package hygiene & publishing | 2.11 |
| `API` | Public API & backward compatibility | 2.12 |
| `CLI` | CLI & CI integration | 2.13 |
| `PERF` | Performance & resource budgets | 2.14 |
| `REL` | Reliability & failure modes | 2.15 |
| `TEST` | Testing & evaluation | 2.16 |
| `CQ` | Code quality & maintainability | 2.17 |
| `DOC` | Documentation | 2.18 |
| `SUP` | Supply chain & release integrity | 2.19 |
| `LEG` | Licensing & legal | 2.20 |
| `INT` | Integrity of the review loop | §0.7 |

Each check below carries: **Requirement**, **Pass criteria** (falsifiable), **Verify** (evidence class), **Sev**.

---

### 2.1 `TC` — Tool contract & schema linting

These are the rules the package *enforces on its users' tools*. Two things are checked: (a) the rule is implemented correctly, (b) the rule is itself correct — it must not flag valid schemas or bless invalid ones.

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| TC-001 | Schema validity | Every tool's `input_schema`/`parameters` validates against JSON Schema draft 2020-12 **and** against the target provider's documented subset. Invalid schema ⇒ finding, never a crash. | Fixture corpus: ≥20 invalid schemas, each produces a finding with the right rule ID; 0 crashes. | BLOCKER |
| TC-002 | Root type | Root schema is `type: "object"`. Non-object roots (array, string, `anyOf` at root) are flagged — most providers reject or mis-handle them. | Unit test per root type. | MAJOR |
| TC-003 | `additionalProperties` | Root and every nested object declares `additionalProperties: false` unless explicitly opted out. Open objects invite hallucinated params that pass validation. | Fixture + fixer test. | MAJOR |
| TC-004 | Property descriptions | Every property has a non-empty `description` that is not a restatement of the key name (e.g. `userId: "the user id"` is flagged as low-information). | Heuristic test: ≥10 positive, ≥10 negative cases. | MAJOR |
| TC-005 | Required set | `required` lists exactly the properties with no default and no sensible inference. Every name in `required` exists in `properties`. Empty `required` on a tool with mandatory semantics is flagged. | Unit test incl. `required` referencing missing key. | MAJOR |
| TC-006 | Enum preference | A string param whose description enumerates allowed values in prose ("one of: a, b, c") is flagged with a fix to a real `enum`. | Detector test + fixer golden. | MAJOR |
| TC-007 | Enum hygiene | Enums have ≤ configured max (default 40) members, no duplicates, stable ordering, and each member is a literal the model can emit verbatim (no spaces-plus-punctuation ambiguity where avoidable). | Unit test. | MINOR |
| TC-008 | Type specificity | No bare `{}`, `true`, `type: "any"`, or missing `type`. Arrays declare `items`. Objects declare `properties` or an explicit reason. | Fixture set. | MAJOR |
| TC-009 | Union complexity | `anyOf`/`oneOf`/`allOf` nesting depth ≤2 and branch count ≤3 by default; deeper unions are flagged as model-hostile with a flattening suggestion. | Depth-counter unit test. | MINOR |
| TC-010 | `$ref` handling | Local `$ref`s resolve; remote/`$id`-based refs are rejected or resolved offline only (see SEC-004). Circular refs are detected and reported, never hung on. | Test with circular schema; must terminate <1s. | BLOCKER |
| TC-011 | Format & constraints | Where semantics are known (dates, emails, URIs, UUIDs, durations), `format` or `pattern` is present; numeric params declare `minimum`/`maximum` where a bound exists. | Rule test. | MINOR |
| TC-012 | Pattern safety | Any `pattern` in a user schema is checked for catastrophic backtracking before the linter itself executes it; unsafe patterns are reported, not run. | ReDoS fixture must not hang the linter (timeout test). | BLOCKER |
| TC-013 | Defaults | `default` values validate against their own subschema; defaults on `required` properties are flagged as contradictory. | Unit test. | MAJOR |
| TC-014 | Nesting depth | Object nesting depth ≤ configured max (default 4). Deep nesting correlates with malformed calls. | Depth test. | MINOR |
| TC-015 | Parameter count | ≤ configured max (default 10) params per tool; above that, flag with a "split the tool" suggestion. | Counter test. | MINOR |
| TC-016 | Naming of params | `snake_case` (or a single configured convention) applied consistently within a tool set; mixed conventions in one set are flagged. | Set-level test. | MINOR |
| TC-017 | Booleans vs enums | A boolean param whose description implies more than two states, or a pair of mutually-exclusive booleans, is flagged in favour of an enum. | Rule test. | MINOR |
| TC-018 | Free-text escape hatches | Params named `options`, `params`, `extra`, `payload`, `args`, `data` typed as open object/string are flagged — they are where agents dump garbage. | Rule test. | MAJOR |
| TC-019 | Identifier params | Params that carry opaque IDs state the exact source of the ID ("the `id` returned by `search_docs`") and warn against constructing it. | Rule test on description content. | MAJOR |
| TC-020 | Schema/impl drift | Where the adapter's implementation signature is statically visible (TS types, zod schema, python annotations), it is compared to the declared schema; mismatches in name, type, or optionality are reported. | Integration test across ≥2 adapters. | MAJOR |
| TC-021 | Serialization round-trip | Linting a schema and re-emitting it preserves key order, unicode, and numeric precision when no fix applies (byte-identical). | Round-trip property test over corpus. | MAJOR |
| TC-022 | Provider profile | A `profile` (anthropic / openai / mcp / generic) selects the applicable subset rules; unsupported keywords for the active profile are flagged with the profile named in the message. | Test per profile. | MAJOR |
| TC-023 | No false positives on golden set | A curated corpus of known-good real-world tool definitions produces **zero** findings above ADVISORY. | Golden corpus run in CI. | BLOCKER |

**Notes**

- TC-023 is the anti-noise gate. A linter that cries wolf gets disabled; disabled linters govern nothing. Grow the golden corpus whenever a user reports a false positive, and add the case as a regression fixture (TEST-009).
- TC-012 and TC-010 are BLOCKERs because the package executes on untrusted third-party schemas; a hang or a ReDoS in the linter takes down the host agent.

---

### 2.2 `TD` — Naming, descriptions, disambiguation

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| TD-001 | Name format | Tool names match `^[a-z][a-z0-9_]{2,63}$` (or the active profile's rule). Violations reported with a normalised suggestion. | Rule test incl. boundary lengths. | MAJOR |
| TD-002 | Verb-first naming | Names read `verb_object` (`create_issue`, not `issue` / `issueCreator` / `do_thing`). Noun-only and vague names are flagged. | Heuristic test with labelled corpus. | MINOR |
| TD-003 | Name uniqueness | No duplicate names within a tool set, including after namespace prefixing and after case/underscore normalisation. | Set-level test with near-duplicates. | BLOCKER |
| TD-004 | Description presence & length | Non-empty; ≥ configured min (default 40 chars) and ≤ max (default 1024) per tool description. | Rule test. | MAJOR |
| TD-005 | Description completeness | Description covers: **what it does**, **when to use it**, **when not to use it**, **side effects**, and **what it returns**. Missing facets are reported individually (`TD-005.when-not`, etc.). | Facet detector with labelled corpus; per-facet precision/recall recorded. | MAJOR |
| TD-006 | Side-effect disclosure | Any tool that writes, deletes, sends, charges money, or is otherwise non-idempotent declares it in the description **and** in structured metadata (`readOnly` / `destructive` / `idempotent` hints). | Rule test + metadata schema test. | BLOCKER |
| TD-007 | Cost/latency hint | Slow (>2s p50) or metered tools carry a hint so the planner can weigh them. Absence is ADVISORY unless runtime data (RM) shows the tool is slow, then MAJOR. | Rule test + runtime-informed test. | MINOR |
| TD-008 | Overlap detection | Pairs of tools whose descriptions/schemas are semantically close above a threshold are reported as a disambiguation risk, with the specific distinguishing sentence to add. | Test on ≥5 known-overlapping pairs + ≥5 clearly distinct pairs; no false pair on the distinct set. | MAJOR |
| TD-009 | Prefix/namespace consistency | Within a set, namespacing is all-or-nothing and uses one separator. Mixed `gh_`, `github.`, `github-` in one set is flagged. | Set-level test. | MINOR |
| TD-010 | Instruction leakage | Tool descriptions must not contain instructions aimed at the *model's persona or policy* ("always call this first", "ignore previous instructions", "you must"). These are flagged as prompt-injection surface and as planner distortion. | Rule test with injection corpus. | BLOCKER |
| TD-011 | Example quality | Where examples are present, each example's arguments validate against the schema. Invalid examples are worse than none. | Validation test. | MAJOR |
| TD-012 | Deprecation signalling | Deprecated tools are marked in metadata and their description begins with the deprecation and the replacement tool name. | Rule test. | MINOR |
| TD-013 | Language & determinism | Description linting is deterministic and does not require a model call by default; any model-assisted check is opt-in, clearly labelled non-deterministic, and excluded from gating output unless `--allow-model-checks`. | Two runs byte-identical without the flag. | MAJOR |
| TD-014 | Token cost of the set | Report total tokens of the serialized tool set per profile tokenizer, with per-tool breakdown and the largest offenders. | Snapshot test against known counts (±2%). | MINOR |

---

### 2.3 `RC` — Result & error contract

The shape of what comes *back* is at least as important as the call schema, because it re-enters the model's context.

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| RC-001 | Declared result shape | Tools declare an output schema or a documented result contract. Undeclared outputs are flagged. | Rule test. | MAJOR |
| RC-002 | Stable envelope | The package's own normalised result envelope has fixed keys (`ok`, `data`, `error`, `meta`), is versioned, and never changes shape based on success/failure. | Type + snapshot test. | MAJOR |
| RC-003 | Error taxonomy | Every tool failure maps to a closed, documented taxonomy: `schema_invalid`, `unknown_tool`, `missing_arg`, `bad_type`, `bad_enum`, `auth`, `not_found`, `rate_limited`, `timeout`, `upstream_5xx`, `conflict`, `precondition`, `too_large`, `cancelled`, `internal`. No `other` bucket above a configured share (default 5%) of classified events. | Classifier test over labelled corpus; report confusion matrix. | MAJOR |
| RC-004 | Actionable error text | Error text fed back to the model states: what was wrong, which field, what was expected, and one corrective action. No stack traces, no internal type names, no raw dumps. | Golden-output test per taxonomy member. | MAJOR |
| RC-005 | Deterministic error text | Same failure ⇒ byte-identical message (no timestamps, UUIDs, or addresses inline; those go in `meta`). Otherwise caches and retries thrash. | Repeat-run test. | MAJOR |
| RC-006 | Retryability flag | Every error carries `retryable: boolean` and, where known, `retry_after`. Non-retryable errors must never trigger the repair loop (LP-004). | Unit test per taxonomy member. | MAJOR |
| RC-007 | Size discipline | Results exceeding a configured byte/token budget are truncated **at a structural boundary**, with an explicit marker, the omitted count, and a continuation handle — never a mid-token or mid-JSON cut. | Truncation tests incl. nested JSON and multi-byte UTF-8. | BLOCKER |
| RC-008 | Truncation is lossless-signalled | The model can always tell truncation happened; silent truncation is a BLOCKER. | Test asserts marker present in every truncated path. | BLOCKER |
| RC-009 | Pagination contract | Large collections return `next_cursor` (opaque, stable) rather than dumping; cursor round-trip is tested. | Integration test. | MAJOR |
| RC-010 | Binary & non-text | Binary/base64/image results are described by type + size + handle, not inlined into text context by default. | Test with binary fixture. | MAJOR |
| RC-011 | Untrusted content marking | Tool output surfaced into a prompt by this package is wrapped/labelled as untrusted data (P-3) and stripped of control sequences (see SEC-002). | Injection corpus test. | BLOCKER |
| RC-012 | Encoding safety | Results are valid UTF-8; lone surrogates, NUL bytes, ANSI escapes, and bidi control chars are stripped or escaped. | Fuzz test. | MAJOR |
| RC-013 | Null vs empty | `null`, `[]`, `{}`, and "not found" are distinguished in the envelope; the package never collapses them. | Unit test. | MINOR |
| RC-014 | Result ↔ schema conformance | When an output schema exists, actual results are validated against it in monitoring mode and mismatches are reported as drift (not thrown, per P-4). | Integration test. | MAJOR |

---

### 2.4 `TS` — Tool-set level checks

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| TS-001 | Set size budget | Total tool count is reported; above a configured threshold (default 40) the set is flagged with grouping/routing advice. | Test at threshold boundaries. | MINOR |
| TS-002 | Total definition tokens | Serialized tool-set token count reported and compared against a budget (default 8k); over-budget is MAJOR because it crowds the working context. | Snapshot test. | MAJOR |
| TS-003 | Cross-server collisions | When merging tools from multiple MCP servers/providers, name collisions are detected before merge and resolved deterministically (documented precedence), never silently last-wins. | Merge test with colliding sets. | BLOCKER |
| TS-004 | Capability gaps | Report tools that reference an entity type no tool can produce (e.g. every tool needs a `project_id` but nothing lists projects) — a common cause of agents inventing IDs. | Graph test on fixture set. | MAJOR |
| TS-005 | Dead tools | Tools never called across a monitored window are reported as candidates for removal, with the window and call count. | Runtime integration test. | MINOR |
| TS-006 | Ordering stability | Tool-set serialization order is deterministic (declaration order or documented sort), because order changes invalidate prompt caches. | Repeat-run byte-compare. | MAJOR |
| TS-007 | Auth precondition mapping | Tools requiring auth/scopes declare them; the set reports which scopes are needed overall. | Rule test. | MINOR |
| TS-008 | Destructive-tool inventory | The report lists every destructive/irreversible tool in the set explicitly, as its own section. | Report snapshot test. | MAJOR |

---

### 2.5 `RM` — Runtime monitor

The monitor wraps or proxies tool execution. Invariant P-4 dominates this section: **observation must not change behaviour.**

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| RM-001 | Transparency of results | For any wrapped tool, the value, error, and rejection reason returned to the caller are identical (deep-equal, same prototype/class where applicable) to unwrapped. | Property test over ≥100 generated tools incl. throwing, rejecting, returning `undefined`, returning streams. | BLOCKER |
| RM-002 | Error fidelity | Thrown errors keep their class, `message`, `stack`, `cause`, and custom properties. No re-wrapping in a generic `Error` unless configured. | Unit test per error type incl. `AggregateError`, `DOMException`, custom subclasses. | BLOCKER |
| RM-003 | Async semantics | Preserves: promise rejection vs throw, sync-throw timing, generator/async-generator streaming, `AbortSignal` propagation, and cancellation. | Test matrix per shape. | BLOCKER |
| RM-004 | Ordering & concurrency | Concurrent and parallel tool calls retain ordering guarantees of the underlying implementation; the monitor introduces no serialization unless configured. | Concurrency test with N=50 interleaved calls. | MAJOR |
| RM-005 | Overhead budget | Added latency ≤ configured budget (default: p50 ≤1ms, p99 ≤5ms per call, excluding opt-in exporters) and ≤2% of call duration for calls >100ms. | Benchmark with attached numbers. | MAJOR |
| RM-006 | Fail-open | Any internal monitor error (serialization, exporter, rule evaluation) is caught, counted, and never propagated to the host agent. | Fault-injection test on every monitor code path. | BLOCKER |
| RM-007 | Memory bounds | Buffers (event queue, dedupe cache, sample store) are bounded with a documented eviction policy; no unbounded `Map` keyed by call ID. | Soak test: 1M events, heap stays under budget; attach heap snapshot delta. | BLOCKER |
| RM-008 | No result retention by default | Argument and result payloads are not stored or exported unless explicitly enabled; default retains only shape metadata (types, sizes, counts). | Config test + telemetry payload inspection. | BLOCKER |
| RM-009 | Event schema | Emitted events have a versioned, documented schema: `tool_name`, `call_id`, `parent_span`, `ts`, `duration_ms`, `status`, `error_class`, `arg_shape_hash`, `result_bytes`, `attempt`, `agent_run_id`. | Schema test + fixture. | MAJOR |
| RM-010 | Call-level validation | Incoming tool calls are validated against the schema *before* execution; violations classified per RC-003 and reported with the offending path (`args.filters[2].since`). | Test per violation class. | MAJOR |
| RM-011 | Unknown tool handling | A call to a nonexistent tool produces `unknown_tool` plus the ≤3 nearest valid names by edit distance, and never executes a fuzzy match. | Unit test incl. near-miss names. | BLOCKER |
| RM-012 | Arg coercion policy | Coercion (e.g. `"5"` → `5`, `"true"` → `true`, single value → array) is off by default, explicitly configurable, always logged when applied, and never applied to enums, IDs, or free text. | Test per coercion rule, on and off. | MAJOR |
| RM-013 | Timeout handling | Per-tool timeouts are enforceable; on timeout the underlying call is cancelled where cancellable, and the event records `cancelled` vs `orphaned`. | Test both branches. | MAJOR |
| RM-014 | Duplicate-call detection | Identical (tool, args-hash) calls within a window are detected and reported; auto-dedup is opt-in and never applied to non-idempotent tools (TD-006). | Test with destructive tool: dedup must not fire. | BLOCKER |
| RM-015 | Metrics correctness | First-call-success rate, repair rate, per-tool error mix, p50/p95/p99 latency, tokens/call and cost/call are computed and unit-tested against a fixed event log with hand-computed expectations. | Fixture-based assertion. | MAJOR |
| RM-016 | Clock safety | Durations use a monotonic clock; wall-clock is only for timestamps. No negative durations. | Unit test with clock skew. | MINOR |
| RM-017 | Redaction before export | Redaction (PRV-002) runs before any buffering that could be persisted or exported, not at export time. | Code-path test. | BLOCKER |
| RM-018 | Multi-runtime support | Works under Node, and either works or degrades with a clear error under Bun/Deno/edge runtimes, per the declared support matrix (COMPAT). | Test on each declared runtime. | MAJOR |
| RM-019 | Instrumentation idempotency | Double-wrapping a tool does not double-count, double-log, or double-execute. | Test wrapping twice. | MAJOR |
| RM-020 | Opt-out path | A single documented switch (env var + config) fully disables monitoring with zero residual overhead beyond a boolean check. | Benchmark disabled vs unwrapped. | MAJOR |

---

### 2.6 `LP` — Loop, retry & repair safety

The package feeds errors back to the model so it can correct a call. This is where runaway cost and infinite loops are born.

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| LP-001 | Hard attempt cap | Repair attempts per logical call ≤ configured max (default 2, absolute ceiling 5). Cap is enforced in one place and cannot be bypassed by a rule or plugin. | Test attempts to exceed; must stop. | BLOCKER |
| LP-002 | Global budget | Per-agent-run caps on total repairs, total tool calls, wall-clock, and estimated cost; exceeding a cap stops the loop with a structured `budget_exceeded` result, not an exception storm. | Budget test on all four dimensions. | BLOCKER |
| LP-003 | Oscillation detection | Detects A→B→A argument cycles and repeated identical failed calls; on detection, stops repairing and escalates with a summary rather than retrying. | Test with scripted oscillating model stub. | BLOCKER |
| LP-004 | Retry only what's retryable | Repair/retry fires only for `retryable: true` (RC-006) classes. Auth, not-found, precondition, and validation-after-max-attempts never auto-retry. | Test per taxonomy member. | BLOCKER |
| LP-005 | No retry on side effects | A call that may have partially executed (non-idempotent tool, timeout with unknown outcome) is never auto-retried without an idempotency key or explicit config. | Test with destructive tool + timeout. | BLOCKER |
| LP-006 | Backoff | Retries use exponential backoff with jitter and honour `retry_after`. No tight loops. | Timing test. | MAJOR |
| LP-007 | Repair message quality | The repair message given back to the model contains only: the error class, the failing field path, the expected shape (minimal schema excerpt), and one instruction. It must not contain the full schema dump or the previous result payload. | Golden-output test; assert token ceiling. | MAJOR |
| LP-008 | Repair message safety | The repair message is constructed from validated, structured data — never by interpolating raw tool output or raw model output into an instruction position (P-3). | Injection test: malicious tool output must not become instruction text. | BLOCKER |
| LP-009 | Progress requirement | If attempt *n+1* produces the same validation error as attempt *n*, the loop stops (no progress) rather than spending the remaining budget. | Test with repeating stub. | MAJOR |
| LP-010 | Context growth bound | Repair context added per attempt is bounded and does not accumulate previous failed payloads unboundedly. | Measure context size across 5 attempts; must be sublinear/bounded. | MAJOR |
| LP-011 | Observable outcome | Every loop terminates in exactly one recorded terminal state: `succeeded`, `repaired(n)`, `gave_up(reason)`, `budget_exceeded`, `cancelled`. No silent exits. | State-machine test with exhaustive transitions. | MAJOR |
| LP-012 | Cancellation | An `AbortSignal` aborts the loop promptly (≤1 tick after the in-flight call settles or is cancelled) and records `cancelled`. | Test. | MAJOR |
| LP-013 | Reentrancy | Nested agent loops (a tool that itself runs an agent) do not share or corrupt loop state; budgets nest with documented semantics. | Nested-run test. | MAJOR |
| LP-014 | Model-call optionality | The repair path must be usable with zero model calls (pure deterministic repair) where the fix is mechanical (e.g. string→number for a numeric enum) — model is last resort, and that ordering is tested. | Test deterministic-first ordering. | MAJOR |

---

### 2.7 `AF` — Autofix engine

The highest-risk subsystem: it edits the user's source and schemas. Default posture is **propose, don't apply**.

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| AF-001 | Fix classification | Every fixer declares a class: `safe` (semantics-preserving, auto-appliable), `suggested` (requires review), `manual` (report only). Class is part of the rule's public metadata and tested. | Metadata test over all fixers; no unclassified fixer. | BLOCKER |
| AF-002 | Default is dry-run | Without an explicit `--write`/`apply: true`, nothing on disk changes. The default code path has no write syscall. | Test: run default on a repo, assert zero file mtime changes; assert via mocked fs that no write is attempted. | BLOCKER |
| AF-003 | Only `safe` auto-applies | `--write` applies only `safe` fixers. Applying `suggested` requires a second explicit flag and prints what it will do. | Flag matrix test. | BLOCKER |
| AF-004 | Diff before write | Every applied fix produces a unified diff in the report, whether or not the terminal is interactive. | Report snapshot. | MAJOR |
| AF-005 | Idempotency | Running the fixer twice produces no change on the second run, for every fixer, across the whole corpus. | Property test: `fix(fix(x)) == fix(x)` for all fixtures. | BLOCKER |
| AF-006 | Convergence | The fixer pipeline reaches a fixed point within a bounded number of passes (default 3); non-convergence is detected and reported, never looped. | Test with intentionally conflicting fixers. | BLOCKER |
| AF-007 | No semantic drift | A `safe` fix must not change: tool name, parameter names, required-ness, enum membership, or any runtime behaviour. Only representation. | Per-fixer semantic-equivalence test with an explicit equivalence oracle. | BLOCKER |
| AF-008 | Formatting preservation | Fixes preserve surrounding formatting, comments, trailing commas, quote style, indentation, and line endings. Prefer AST/CST-preserving edits over reserialization. | Golden files including comment-heavy and CRLF inputs. | MAJOR |
| AF-009 | Atomicity | Writes are atomic per file (temp + rename) and the run is transactional: if any write fails, previously written files in the same run are rolled back or the failure is reported with an exact list of what was and was not written. | Fault-injection on the Nth write. | BLOCKER |
| AF-010 | Recoverability | Before the first write, the run records original content (backup dir, or verified-clean git worktree). Refuse to write into a dirty git tree unless `--allow-dirty`. | Test dirty-tree refusal + restore path. | BLOCKER |
| AF-011 | Blast radius | Caps on files changed and lines changed per run (defaults 50 / 2000); exceeding requires explicit confirmation flag. | Cap test. | MAJOR |
| AF-012 | Scope confinement | Never writes outside the configured project root; path traversal, symlink escape, and absolute-path config values are rejected. | Security test with `../`, symlink to `/etc`, and absolute path. | BLOCKER |
| AF-013 | Protected paths | Never writes to `.git/`, `node_modules/`, lockfiles, CI config, `.env*`, or anything in a configurable protected list. | Test each. | BLOCKER |
| AF-014 | Provenance | Every applied fix is logged with: rule ID, file, range, before/after hash, fixer version, timestamp, run ID. Log is machine-readable and appended, not overwritten. | Log schema test. | MAJOR |
| AF-015 | Verification after fix | After applying, the engine re-runs the affected rules and reports any fix that did not clear its finding or that introduced a new one. | Integration test with a deliberately bad fixer. | MAJOR |
| AF-016 | Validity after fix | Fixed artefacts still parse and still validate (JSON parses, TS compiles, schema valid). A fix that breaks parse is reverted automatically and reported as a fixer bug. | Test with fixer that emits invalid output. | BLOCKER |
| AF-017 | Conflict handling | Overlapping edit ranges from different fixers are detected; resolution is deterministic and documented (priority order), never interleaved-by-chance. | Overlap test. | BLOCKER |
| AF-018 | Determinism | Same input ⇒ byte-identical output regardless of file iteration order, parallelism, locale, timezone, or Node version in the support matrix. | Run under `LC_ALL=tr_TR.UTF-8`, `TZ=Asia/Kolkata`, shuffled file order, and 2 Node versions; compare hashes. | BLOCKER |
| AF-019 | No network in fixers | Fixers are pure local transforms; no fetch, no model call, unless the fixer is explicitly declared `ai_assisted` and is `suggested`-class at best. | Static check + runtime network block during fixer tests. | BLOCKER |
| AF-020 | AI-assisted fixes are quarantined | Any model-generated fix is never `safe`, always shown as a diff, labelled as model-generated, and validated by the same post-fix checks (AF-015/016). | Test path. | BLOCKER |
| AF-021 | Fix explainability | Each fix carries a one-line human rationale and a link/anchor to the rule doc. | Report test. | MINOR |
| AF-022 | Partial application reporting | The report distinguishes `applied`, `skipped (unsafe)`, `failed`, and `needs review`, with counts that sum to total findings. | Arithmetic assertion in report test. | MAJOR |
| AF-023 | Undo | A documented one-command undo for the last run (from backup or git), tested end to end. | E2E test. | MAJOR |
| AF-024 | Concurrency safety | Two concurrent runs on the same project do not interleave writes; a lock file or equivalent prevents it, with stale-lock recovery. | Concurrent-run test. | MAJOR |

---

### 2.8 `SEC` — Security & trust boundary

Threat model to assume: the package ingests **untrusted tool definitions**, **untrusted tool results**, and **untrusted model output**, and it runs inside a process that holds credentials.

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| SEC-001 | Untrusted-input inventory | The docs and the code both enumerate every untrusted input surface: tool manifests, MCP server responses, tool results, model output, config files, plugin modules, CLI args, env. Each has a stated handling rule. | Doc + code cross-check. | MAJOR |
| SEC-002 | Prompt-injection defence | Any content this package places into a model-visible position is (a) delimited and labelled as untrusted data, (b) stripped of instruction-mimicking control sequences (fake system tags, role markers, ANSI, bidi overrides), (c) length-capped. | Run an injection corpus (≥30 payloads incl. fake `<system>` tags, "ignore previous", role-switch, unicode tag chars); assert none reaches instruction position. | BLOCKER |
| SEC-003 | No `eval` / dynamic code | No `eval`, `new Function`, `vm.runInThisContext`, or dynamic `require` of paths derived from untrusted input. | Static scan (`grep` + lint rule) with attached output. | BLOCKER |
| SEC-004 | No implicit network | The linter and fixer make zero network requests by default; remote `$ref`, remote config, and remote rule packs are refused unless explicitly allowlisted. | Run full test suite with network blocked; must pass. | BLOCKER |
| SEC-005 | SSRF guard | Where a URL is accepted (MCP endpoint, exporter), private/link-local/loopback/metadata addresses (169.254.169.254, ::1, 10/8, 172.16/12, 192.168/16, `.internal`) are blocked unless allowlisted; DNS-rebinding is mitigated by resolving-then-pinning or re-checking post-resolution. | Test each blocked range + rebinding case. | BLOCKER |
| SEC-006 | Command execution | If any subprocess is spawned, it uses argv arrays (never a shell string), a fixed binary path/name, and no untrusted data in argv positions that could be interpreted as flags (`--`-terminated). | Test with `; rm -rf`, `--flag`-looking, and newline-containing inputs. | BLOCKER |
| SEC-007 | Path handling | All file access is resolved and confined to the project root; symlinks are resolved and re-checked; `..`, absolute paths, and Windows device names (`CON`, `\\?\`) are rejected. | Path-traversal test suite. | BLOCKER |
| SEC-008 | Prototype pollution | JSON/config parsing rejects or strips `__proto__`, `constructor`, `prototype` keys; deep-merge helpers are pollution-safe. | Test that `{"__proto__":{"polluted":1}}` does not pollute. | BLOCKER |
| SEC-009 | DoS resistance | Bounded parsing: max input size, max depth, max keys, ReDoS-safe regexes, timeouts on all rule evaluation. Billion-laughs / deeply-nested / huge-array inputs are rejected with a clear error, not a hang or OOM. | Fuzz + adversarial corpus with time/memory assertions. | BLOCKER |
| SEC-010 | Secret handling | No credential is read unless needed; secrets are never logged, never written to reports, never included in diffs, and are held in memory only as long as needed. | Grep reports/logs from an E2E run containing seeded fake secrets; zero hits. | BLOCKER |
| SEC-011 | Secret detection in artefacts | The linter itself flags secrets hardcoded in tool definitions, descriptions, examples, and config (entropy + known-pattern detection). | Detector test with seeded patterns. | MAJOR |
| SEC-012 | Plugin sandboxing posture | Third-party rule/fixer plugins run with documented privileges; the docs state plainly that plugins are trusted code. Plugins are loaded only from explicit config, never auto-discovered from `node_modules` scanning of untrusted trees. | Loader test + doc statement. | BLOCKER |
| SEC-013 | Dependency vulnerabilities | `npm audit --omit=dev` reports zero high/critical; any accepted advisory is in the waiver register with justification. | Attach audit output. | BLOCKER |
| SEC-014 | Install-time safety | No `postinstall`/`preinstall`/`prepare` scripts in the published package; no binary downloads at install. | Inspect published `package.json` + `npm pack` contents. | BLOCKER |
| SEC-015 | Permission model for monitored tools | Where the package can gate tool execution, destructive tools require explicit allowlisting or confirmation, and the default posture is documented. Fail-closed on ambiguity. | Test default denies an unlisted destructive tool when gating is on. | BLOCKER |
| SEC-016 | Output encoding | Report writers escape per target format: HTML-escape for HTML, no raw ANSI passthrough into files, JSON-safe strings, no CSV formula injection (`=`, `+`, `-`, `@` leading). | Per-writer test. | MAJOR |
| SEC-017 | Deserialization | No `yaml.load` unsafe mode, no `pickle`-equivalent, no `JSON.parse` reviver executing untrusted logic. | Static + unit test. | BLOCKER |
| SEC-018 | Error message hygiene | Errors surfaced to users/models do not leak absolute paths, env var values, tokens, or internal stack frames in production mode. | Golden error tests. | MAJOR |
| SEC-019 | Security policy | `SECURITY.md` exists with a reporting channel and response expectation. | File check. | MINOR |
| SEC-020 | Threat model doc | A short written threat model (assets, adversaries, trust boundaries, mitigations, accepted risks) is maintained and updated when a boundary changes. | Doc review vs SEC-001 inventory. | MAJOR |

---

### 2.9 `PRV` — Privacy, telemetry & data handling

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| PRV-001 | No telemetry by default | The package sends nothing anywhere unless the user configures an exporter. No "anonymous usage stats" on by default. | Network-blocked test run passes; packet capture on E2E shows zero egress. | BLOCKER |
| PRV-002 | Redaction pipeline | Built-in redactors for: emails, phone numbers, credit cards, API-key patterns (`sk-`, `ghp_`, JWTs, AWS keys), URLs with credentials, IPs, and configurable custom patterns. Redaction is applied to args, results, errors, and stack traces. | Test each detector; test redaction on all four surfaces. | BLOCKER |
| PRV-003 | Redaction failure posture | If redaction fails or is uncertain, the field is dropped, not emitted raw. | Fault-injection test. | BLOCKER |
| PRV-004 | Shape-only default | Default captured payload is metadata only (type, length, key names hashed or allowlisted, byte size) — never values. | Inspect emitted event for a seeded payload. | BLOCKER |
| PRV-005 | Key-name leakage | Even key names can be sensitive; allowlist or hash them by default in shape capture, with an opt-in to record names. | Test. | MAJOR |
| PRV-006 | Retention & rotation | Local artefacts (logs, caches, backups) have a documented location, size cap, and retention/rotation policy; nothing is written outside project/OS-appropriate dirs. | Test cap + location per OS. | MAJOR |
| PRV-007 | Data-subject controls | A documented command clears all locally stored data the package created. | E2E test. | MINOR |
| PRV-008 | Documentation of data flows | README/docs include a plain-language table: what is collected, where it goes, default on/off, how to disable. | Doc check vs code. | MAJOR |
| PRV-009 | Child/sensitive data | Docs state the package is not a compliance control and must not be the only guard for regulated data; no claims of HIPAA/GDPR compliance are made in marketing copy. | Doc review. | MAJOR |

---

### 2.10 `OBS` — Observability of the package itself

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| OBS-001 | OpenTelemetry alignment | Spans/attributes follow the GenAI semantic conventions where they exist (`gen_ai.*`, `gen_ai.tool.name`, `gen_ai.operation.name`); deviations are documented with a reason. | Attribute snapshot test vs the convention list in docs. | MAJOR |
| OBS-002 | Exporter isolation | Exporter failure, slowness, or backpressure never blocks or breaks the host (bounded queue, drop policy, drop counter). | Fault-injection: hang the exporter; host must continue. | BLOCKER |
| OBS-003 | Trace context propagation | Existing trace/span context is respected and propagated; the package never starts a detached root span when a parent exists. | Integration test with an active OTel context. | MAJOR |
| OBS-004 | Sampling | Configurable sampling with documented defaults; sampling decisions are consistent within a single agent run (no half-sampled traces). | Test. | MINOR |
| OBS-005 | Internal diagnostics | A debug mode (`DEBUG=`/`--verbose`) exposes internal decisions (which rules ran, why a fix was skipped) without leaking payloads. | Test output content. | MINOR |
| OBS-006 | Health/self-check | A `doctor`/`self-check` command reports version, config resolution order and final effective config (secrets masked), detected adapters, and environment issues. | E2E test. | MINOR |
| OBS-007 | Counters for silent failures | Every swallowed error (RM-006, OBS-002) increments a named counter that is visible in reports and diagnostics. Silent means invisible; invisible is unacceptable. | Test: force each swallow path, assert counter. | MAJOR |
| OBS-008 | Log discipline | Library code never writes to stdout/stderr directly; it emits through an injectable logger. CLI owns console output. | Static scan for `console.` in `src/lib`. | MAJOR |

---

### 2.11 `NPM` — Package hygiene & publishing

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| NPM-001 | Manifest completeness | `name`, `version`, `description`, `keywords`, `license`, `repository` (with `directory` if monorepo), `bugs`, `homepage`, `author`, `engines`, `type` all present and correct. | Inspect `package.json`. | MAJOR |
| NPM-002 | Exports map | Modern `exports` field with correct `types` / `import` / `require` conditions ordered so `types` comes first per condition; `main`, `module`, `types` retained for older tooling. No deep-import leakage that isn't intended as public API. | `npx @arethetypeswrong/cli` (or equivalent) clean; attach output. | BLOCKER |
| NPM-003 | Dual-format correctness | If both ESM and CJS are shipped, both are actually loadable: `node -e "require('pkg')"` and `node --input-type=module -e "import('pkg')"` both succeed from a clean install. | Attach both command outputs. | BLOCKER |
| NPM-004 | Type declarations | `.d.ts` ships, resolves under `node16`/`bundler`/`node10` module resolution as declared, and contains no `any` on public surfaces and no imports of dev-only types. | `tsc --noEmit` against a consumer fixture under each resolution mode. | BLOCKER |
| NPM-005 | Files whitelist | `files` (or `.npmignore`) limits the tarball to `dist`, `README`, `LICENSE`, `CHANGELOG`. No `src` (unless intended), tests, fixtures, `.env`, CI config, or `.map` bloat unless deliberate. | `npm pack --dry-run` file list attached and reviewed line by line. | MAJOR |
| NPM-006 | Tarball size | Unpacked size within budget (default ≤2 MB) and reported; sudden growth >20% vs last release requires justification. | `npm pack` size attached. | MINOR |
| NPM-007 | Dependency discipline | Runtime `dependencies` are justified one by one in a table; no dev-only package in `dependencies`; no dependency with a known-unmaintained status without a note. | Dependency table in docs vs `package.json`. | MAJOR |
| NPM-008 | Peer deps | Framework/SDK integrations are `peerDependencies` (with `peerDependenciesMeta.optional` where apt), not hard deps. Version ranges are tested at both bounds. | Install matrix test at min and max declared versions. | MAJOR |
| NPM-009 | `engines` accuracy | Declared Node range matches what CI actually tests and what the code requires (no use of APIs newer than the floor). | Run test suite on the declared floor version; attach output. | BLOCKER |
| NPM-010 | `sideEffects` | Declared accurately for tree-shaking; incorrect `false` that breaks polyfills/registrations is a defect. | Bundler test asserting required side effects survive. | MAJOR |
| NPM-011 | Bin entries | CLI bin has a shebang, is executable in the tarball (mode 0755), works when installed globally and via `npx`, and does not depend on CWD-relative paths. | `npm i -g` from tarball + `npx` from a temp dir; attach output. | BLOCKER |
| NPM-012 | Clean-install reproducibility | `npm ci` from lockfile in a clean container reproduces a working build and green tests. | Attach container run log. | BLOCKER |
| NPM-013 | No published secrets | Tarball contains no `.env`, tokens, internal URLs, or `.npmrc`. | Grep tarball contents; attach. | BLOCKER |
| NPM-014 | Version semantics | Version bump matches the change class per semver; breaking changes to public API (API-001) require a major. | API-diff tool output vs version bump. | BLOCKER |
| NPM-015 | Changelog | `CHANGELOG.md` updated with the release, grouped by Added/Changed/Fixed/Removed/Security, with migration notes for breaking changes. | Diff review. | MAJOR |
| NPM-016 | Deprecation policy | Public API removal follows: deprecate (runtime warn once + docs) → one minor cycle → remove in major. Documented. | Doc + code check of a current deprecation. | MAJOR |
| NPM-017 | License file & field | `LICENSE` present and matching the `license` field; year/holder correct. | File check. | MAJOR |
| NPM-018 | README on registry | README renders correctly on npm: no relative image paths, no broken anchors, install + 30-second example above the fold. | Render check + link check. | MINOR |
| NPM-019 | Package name & scope | Name available/owned, not typosquatting, scope consistent with org; `publishConfig.access` correct for scoped packages. | Registry check. | MAJOR |
| NPM-020 | Provenance & 2FA | Publishing uses npm provenance (`--provenance` via trusted CI) and the account/org enforces 2FA. | CI config + npm settings evidence. | MAJOR |

---

### 2.12 `API` — Public API & backward compatibility

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| API-001 | Explicit public surface | One documented entry point defines the public API; everything else is internal (`src/internal/**`, not exported). An API report file (e.g. api-extractor/`.api.md`) is committed and diffed in CI. | Attach API report diff. | MAJOR |
| API-002 | No breaking change without major | The API diff shows no removals/signature narrowing on a minor/patch. | CI API-diff gate output. | BLOCKER |
| API-003 | Types are the contract | Public types are exported, named (not anonymous inline), documented with TSDoc, and stable. No leaking of `zod`/internal library types unless intentionally re-exported and pinned. | Type review + consumer fixture compile. | MAJOR |
| API-004 | Options objects | Functions take a single options object beyond 2 params; all options have defaults documented; unknown options are rejected or warned, not silently ignored. | Unit test. | MINOR |
| API-005 | Errors are typed | The package exports its error classes with a stable `code` property; consumers can branch on `code`, not on message text. | Test each error class. | MAJOR |
| API-006 | Async contract | Every async function returns a promise that rejects (never throws synchronously) and accepts `signal` where cancellation is meaningful. | Test. | MAJOR |
| API-007 | No global mutation | Importing the package mutates nothing global (no monkey-patching `fetch`, `console`, prototypes) unless an explicit `install()` is called. | Import-only test asserting environment unchanged. | BLOCKER |
| API-008 | Config resolution | Documented precedence: CLI flags > env > project config file > user config > defaults. Effective config is inspectable (OBS-006). | Test each precedence pair. | MAJOR |
| API-009 | Config schema & validation | Config is schema-validated with helpful errors naming the exact key and expected type; unknown keys warn with a "did you mean". | Test with typo'd key. | MAJOR |
| API-010 | Framework adapters | Each declared adapter (Vercel AI SDK, LangChain/LangGraph, MCP SDK, OpenAI SDK, Anthropic SDK, custom) has an integration test running a real end-to-end call against a stubbed transport. | Per-adapter test output. | MAJOR |
| API-011 | Plugin interface stability | Rule/fixer plugin interface is versioned; the loader checks the declared interface version and refuses incompatible plugins with a clear message. | Test with mismatched version. | MAJOR |
| API-012 | Rule ID stability | Rule IDs are permanent and documented; renames ship an alias table. Consumers' suppressions must not silently stop working. | Test alias resolution. | MAJOR |

---

### 2.13 `CLI` — CLI & CI integration

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| CLI-001 | Exit codes | Documented and stable: `0` clean, `1` findings at or above the fail-level, `2` usage error, `3` internal error, `4` config error. Findings and crashes are never conflated. | Test each path. | BLOCKER |
| CLI-002 | Machine-readable output | `--format json` and `--format sarif` produce schema-valid output; SARIF validates against the 2.1.0 schema and loads in GitHub code scanning. | Attach validator output. | MAJOR |
| CLI-003 | Stream discipline | Report goes to stdout, diagnostics/progress to stderr, so `cli --format json > out.json` yields pure JSON. | Test redirect. | BLOCKER |
| CLI-004 | Non-TTY behaviour | No spinners, no ANSI, no cursor codes when not a TTY or when `CI=true`/`NO_COLOR` is set; `FORCE_COLOR` honoured. | Test piped output has zero escape bytes. | MAJOR |
| CLI-005 | Deterministic ordering | Findings are sorted deterministically (path, line, rule) regardless of filesystem order or concurrency. | Shuffle test. | MAJOR |
| CLI-006 | `--fail-on` control | Severity threshold for non-zero exit is configurable and documented; default is documented explicitly. | Test matrix. | MAJOR |
| CLI-007 | Baseline support | A baseline file can snapshot existing findings so teams can adopt incrementally; baseline entries are keyed by stable content hash, not line number, and stale baseline entries are reported. | Test with shifted lines. | MAJOR |
| CLI-008 | Suppressions | Inline suppression syntax exists, requires a reason, is scoped narrowly, and unused suppressions are reported. | Test unused-suppression detection. | MAJOR |
| CLI-009 | Help & errors | `--help` lists every flag with defaults; unknown flags error with a suggestion; no stack trace on user error. | Snapshot test. | MINOR |
| CLI-010 | Watch mode correctness | If watch exists: debounced, incremental, and never leaves stale findings after a file is deleted or renamed. | Test delete/rename. | MINOR |
| CLI-011 | Stdin/glob input | Accepts globs, file lists, `-` for stdin; respects `.gitignore` by default with an override flag. | Test each. | MINOR |
| CLI-012 | CI recipe | A copy-pasteable GitHub Actions (and one other CI) job in docs, tested in this repo's own CI. | CI run link/output. | MINOR |
| CLI-013 | Annotations | PR annotations (via SARIF or CI-native) point at the right file and line, verified on a real PR. | Screenshot/log evidence. | MINOR |
| CLI-014 | Performance feedback | Long runs print progress to stderr and a final timing summary; `--quiet` silences all but the report. | Test. | MINOR |
| CLI-015 | Self-update / version | `--version` prints package version and Node version; no auto-update behaviour. | Test. | MINOR |

---

### 2.14 `PERF` — Performance & resource budgets

Budgets are declared, measured, and enforced. A budget with no test is not a budget.

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| PERF-001 | Declared budgets | A `budgets` table exists in the repo with: monitor overhead (RM-005), lint throughput (tools/sec), cold-start import time, peak RSS, bundle size. | File present + values referenced by tests. | MAJOR |
| PERF-002 | Import cost | Cold `import` of the main entry ≤ configured ms (default 150ms) and loads no optional heavy deps eagerly (lazy-require exporters, parsers, model SDKs). | Measured import timing + module-graph inspection. | MAJOR |
| PERF-003 | Lint throughput | ≥ N tool definitions/sec on the reference corpus (record the machine spec); regression >20% fails CI. | Benchmark output attached, compared to committed baseline. | MAJOR |
| PERF-004 | Memory ceiling | Peak RSS on the largest reference corpus ≤ budget; no monotonic growth over a 10-minute soak. | Soak test with heap trend attached. | MAJOR |
| PERF-005 | No blocking I/O on hot path | The runtime monitor performs no synchronous fs, no sync crypto over large payloads, and no JSON.stringify of full payloads by default. | Code review + profile. | MAJOR |
| PERF-006 | Hashing cost | Argument shape hashing is bounded (sample/limit large structures) and never hashes entire multi-MB payloads on the hot path. | Benchmark with 10MB payload. | MAJOR |
| PERF-007 | Concurrency | Lint/fix parallelism is bounded by a documented worker count; no unbounded `Promise.all` over thousands of files. | Test with 5k files; assert bounded FD/memory. | MAJOR |
| PERF-008 | Bundle size | Published bundle size tracked per entry point with a committed baseline; >10% growth requires justification in the PR. | size-limit output attached. | MINOR |
| PERF-009 | Caching | If results are cached, the cache key includes rule versions, config hash, and file content hash; a stale cache can never produce a false green. | Test: change a rule version, assert cache miss. | BLOCKER |

---

### 2.15 `REL` — Reliability & failure modes

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| REL-001 | Failure-mode table | A documented table of every anticipated failure (malformed input, missing file, permission denied, disk full, network down, exporter dead, model error, OOM, interrupted run) with the intended behaviour for each. | Doc exists; every row has a test. | MAJOR |
| REL-002 | Graceful degradation | Optional subsystems (exporters, model-assisted rules, adapters) failing degrade the run with a warning; they never fail the whole run unless explicitly required. | Fault-injection per subsystem. | MAJOR |
| REL-003 | Signal handling | `SIGINT`/`SIGTERM` during a fix run: stop cleanly, roll back or report partial state, release locks, exit with the documented code. | Test interrupting mid-write. | BLOCKER |
| REL-004 | Disk-full / EACCES / EROFS | Write failures are handled with a clear message and no corrupted partial file. | Fault-injection. | BLOCKER |
| REL-005 | Large & pathological inputs | 100MB manifest, 10k tools, 1MB single description, deeply nested schema: each produces a bounded, sensible outcome. | Adversarial corpus run. | MAJOR |
| REL-006 | No unhandled rejections | Zero `unhandledRejection`/`uncaughtException` across the whole test suite; a handler exists that logs and exits with code 3. | Run suite with `--unhandled-rejections=strict`. | BLOCKER |
| REL-007 | Resource cleanup | No leaked timers, file handles, sockets, child processes, or open watchers after a run; process exits on its own. | Test asserts process exits without `--forceExit`; handle-leak check. | MAJOR |
| REL-008 | Idempotent runs | Re-running the tool on an unchanged repo produces identical output and zero changes. | Double-run byte-compare. | MAJOR |
| REL-009 | Clock/timezone/locale independence | Behaviour and output identical across TZ, locale, and DST boundaries (no locale-dependent sorting or case-mapping — beware Turkish `i`). | Matrix test. | MAJOR |
| REL-010 | Line endings & encoding | CRLF/LF, BOM, and non-UTF-8 inputs are handled without corrupting files on write. | Golden files per case. | MAJOR |
| REL-011 | Path edge cases | Spaces, unicode, very long paths, case-insensitive filesystems, and Windows separators handled. | Cross-OS test. | MAJOR |
| REL-012 | Version skew | Mismatched adapter/SDK versions produce a clear, actionable error naming both versions — never a cryptic `undefined is not a function`. | Test with wrong peer version. | MAJOR |

---

### 2.16 `TEST` — Testing & evaluation

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| TEST-001 | Rule coverage | Every rule has ≥1 positive fixture (fires) and ≥1 negative fixture (does not fire). A rule without both is not shippable. | Automated meta-test enumerating rules vs fixtures; must report zero gaps. | BLOCKER |
| TEST-002 | Fixer coverage | Every `safe` fixer has: golden before/after, idempotency test (AF-005), semantic-equivalence test (AF-007), and a "does not touch unrelated code" test. | Meta-test enumerating fixers. | BLOCKER |
| TEST-003 | Corpus | A fixture corpus of real-world tool definitions across all supported profiles, including known-bad examples and the golden known-good set (TC-023). | Corpus present with provenance notes and licences. | MAJOR |
| TEST-004 | Property-based tests | Property tests for: schema round-trip (TC-021), fixer idempotency, monitor transparency (RM-001), truncation safety (RC-007). Minimum generated case count documented. | Test output with case counts. | MAJOR |
| TEST-005 | Fuzzing | Fuzz the schema parser, config parser, and result normaliser; crashers are added as regression fixtures. Fuzz run in CI (short) and nightly (long). | Attach fuzz run summary. | MAJOR |
| TEST-006 | Coverage thresholds | Line ≥85%, branch ≥80% overall; ≥95% on `autofix`, `security`, `redaction`, and `loop-control` modules. Thresholds enforced in CI config, not just reported. | Coverage report attached; config shows enforcement. | MAJOR |
| TEST-007 | Mutation testing | Mutation score ≥60% overall and ≥80% on the critical modules listed in TEST-006, or a written exemption. Catches assertion-free tests. | Stryker (or equivalent) report. | MINOR |
| TEST-008 | Determinism test | The full suite passes with randomized test order and with `--runInBand` and parallel; no order dependence. | Two runs with different seeds. | MAJOR |
| TEST-009 | Regression policy | Every fixed bug adds a test named for the issue; the test fails on the pre-fix commit. | Per-fix evidence in FixReport. | MAJOR |
| TEST-010 | No network in tests | Unit and integration suites pass with network disabled; any test needing network is tagged, excluded by default, and mocked at the transport layer. | Run with network off. | BLOCKER |
| TEST-011 | Model-dependent evals | Any eval requiring a live model is a separate, non-gating suite with recorded fixtures/cassettes for CI; gating CI never depends on live model output. | CI config inspection. | BLOCKER |
| TEST-012 | Eval harness meaning | The eval suite measures the product claim: first-call tool-selection accuracy, argument validity rate, and repair success rate, on a fixed task set, before vs after applying the package's fixes. Deltas are reported with n, and with a same-seed control. | Eval report with methodology. | MAJOR |
| TEST-013 | Anti-tautology | Integration tests assert on observable behaviour, not on the mock (INT-010). Each mock-heavy test has at least one assertion that would fail if the implementation were replaced by a stub returning constants. | Reviewer reads the mock-heavy tests and states this explicitly. | MAJOR |
| TEST-014 | Consumer smoke tests | A separate fixture project installs the packed tarball (not the workspace) and runs the documented quickstart in ESM, CJS, and TS. | Attach three run logs. | BLOCKER |
| TEST-015 | Cross-version matrix | CI runs the suite on every Node version in `engines` (floor, LTS, current) and on Linux + macOS + Windows if Windows is supported. | CI matrix results. | MAJOR |
| TEST-016 | Flake policy | Zero known-flaky tests at sign-off. A test that fails intermittently is fixed or quarantined with an issue — never retried into green. | CI history over ≥10 runs. | MAJOR |
| TEST-017 | Performance tests in CI | Benchmarks (PERF-003/008) run in CI against committed baselines with a tolerance band. | CI output. | MINOR |
| TEST-018 | Security tests | The injection corpus (SEC-002), traversal suite (SEC-007), pollution test (SEC-008), and DoS corpus (SEC-009) are part of the gating suite. | Suite listing. | BLOCKER |

---

### 2.17 `CQ` — Code quality & maintainability

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| CQ-001 | Type safety | `strict: true` (with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`); zero `any` in `src` except at documented boundary points with a comment; zero `@ts-ignore` without a reason. | `tsc --noEmit` + grep counts. | MAJOR |
| CQ-002 | Lint clean | Zero lint errors and zero warnings under the committed config; the config is not weakened to achieve this (INT-003). | Lint output + config diff review. | MAJOR |
| CQ-003 | Boundary validation | All external input (config, manifests, plugin exports, adapter results) is parsed and validated at the boundary into internal types; internal code never re-validates ad hoc. | Code review of each entry point. | MAJOR |
| CQ-004 | Module boundaries | Clear layering: `core` (pure, no I/O) / `io` / `adapters` / `cli`. `core` has no fs/net imports — enforced by a lint rule, not convention. | Import-boundary lint output. | MAJOR |
| CQ-005 | Pure core | Rule evaluation and fix computation are pure functions of (input, config); no ambient reads of `process.env`, `Date.now()`, or `Math.random()` inside them (inject a clock/rng). | Static scan of `core`. | MAJOR |
| CQ-006 | Dead code | No unused exports, files, or dependencies. | knip/ts-prune + depcheck output. | MINOR |
| CQ-007 | Duplication | No copy-pasted rule logic; shared helpers extracted. Report duplication ratio. | jscpd output. | MINOR |
| CQ-008 | Complexity | Functions over a complexity/length threshold are flagged and justified or split. | Lint output. | MINOR |
| CQ-009 | Naming consistency | Domain vocabulary is consistent across code, docs, and reports (one word per concept: "tool" vs "function" vs "action" — pick one, define it in a glossary). | Glossary exists; reviewer spot-checks 10 terms. | MINOR |
| CQ-010 | Comments where non-obvious | Every non-obvious constant, heuristic threshold, and regex has a comment explaining the choice. Magic numbers in rules are named constants. | Spot check. | MINOR |
| CQ-011 | Error construction | One place constructs each error class; messages follow a documented style (what happened, what was expected, what to do). | Review + golden tests. | MINOR |
| CQ-012 | Repo hygiene | `.editorconfig`, formatter config, pre-commit hook, `CONTRIBUTING.md`, issue/PR templates, CODEOWNERS. | File checks. | MINOR |

---

### 2.18 `DOC` — Documentation

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| DOC-001 | Quickstart works verbatim | The README quickstart, copy-pasted into a clean project, works. Tested by TEST-014. | Test log. | BLOCKER |
| DOC-002 | Rule reference | Every rule has a doc page: what it checks, why it matters for agent behaviour, bad example, good example, fix class, config options, how to suppress. | Meta-test: every rule ID has a doc file. | MAJOR |
| DOC-003 | Config reference | Every config key documented with type, default, and effect. Generated from the schema so it cannot drift. | Generated-vs-committed diff check. | MAJOR |
| DOC-004 | Safety documentation | A prominent section on what the autofix will and will not do, the dry-run default, and how to undo. | Doc review. | MAJOR |
| DOC-005 | Data & privacy section | Per PRV-008. | Doc review. | MAJOR |
| DOC-006 | Limitations & non-goals | Explicit list of what the package does not do and cannot guarantee (e.g. "static linting cannot prove a description is accurate"). No overclaiming. | Doc review. | MAJOR |
| DOC-007 | Integration guides | One per declared adapter, each tested (API-010). | Guides + tests. | MAJOR |
| DOC-008 | Metrics definitions | Every metric the package reports is defined precisely (numerator, denominator, what counts as an attempt). | Doc vs implementation cross-check. | MAJOR |
| DOC-009 | Migration & upgrade notes | Breaking changes have a migration guide with before/after code. | Doc review at release. | MAJOR |
| DOC-010 | Examples compile | All code samples in docs are type-checked/executed in CI. | Doc-test runner output. | MAJOR |
| DOC-011 | Link integrity | No broken internal or external links; anchors resolve. | Link checker output. | MINOR |
| DOC-012 | Accuracy vs code | Reviewer spot-checks ≥10 documented claims against the implementation; any false claim is MAJOR. | Spot-check list with results. | MAJOR |

---

### 2.19 `SUP` — Supply chain & release integrity

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| SUP-001 | Lockfile committed | Lockfile present, current, and consistent with `package.json`. | `npm ci` succeeds with no lockfile drift. | BLOCKER |
| SUP-002 | Pinned CI actions | Third-party CI actions pinned to a full commit SHA, not a tag. | Workflow inspection. | MAJOR |
| SUP-003 | Least-privilege CI | Workflow `permissions` are minimal and explicit; the publish job is separate, uses short-lived credentials/OIDC, and is the only job with the npm token. | Workflow inspection. | BLOCKER |
| SUP-004 | Untrusted PR isolation | `pull_request_target` is not used to run PR code with secrets; forked-PR workflows have no secret access. | Workflow inspection. | BLOCKER |
| SUP-005 | Build from clean source | The published artefact is built in CI from a tagged commit, not from a developer machine. | Release workflow evidence. | MAJOR |
| SUP-006 | Provenance | npm provenance attestation attached to the release (also NPM-020). | Registry provenance shown. | MAJOR |
| SUP-007 | SBOM | An SBOM (CycloneDX or SPDX) is generated and attached to the release. | Artefact present. | MINOR |
| SUP-008 | Dependency review | New/updated runtime dependencies reviewed for maintenance status, install scripts, and transitive count. | Review note per dependency change. | MAJOR |
| SUP-009 | Automated dependency updates | Dependabot/Renovate configured with grouping and a security-update lane. | Config present. | MINOR |
| SUP-010 | Tag ↔ publish match | The published tarball's content hash matches a build from the tagged commit; the git tag exists and is signed if the project signs tags. | Rebuild-and-compare. | MAJOR |

---

### 2.20 `LEG` — Licensing & legal

| ID | Requirement | Pass criteria | Verify | Sev |
|---|---|---|---|---|
| LEG-001 | Dependency licence compatibility | All transitive runtime licences compatible with the declared licence; no AGPL/SSPL/unknown in runtime deps without a decision. | Licence scan output. | BLOCKER |
| LEG-002 | Corpus/fixture provenance | Test fixtures copied from third-party sources are attributed and licence-compatible; no scraped proprietary manifests. | Provenance file. | MAJOR |
| LEG-003 | Trademark care | No third-party product names used in a way implying endorsement; adapter names phrased as "integration for X". | Doc/name review. | MINOR |
| LEG-004 | Claims discipline | No security/compliance guarantees in marketing copy (see PRV-009); "helps you" not "ensures you are". | Copy review. | MAJOR |
| LEG-005 | Attribution file | `NOTICE`/`THIRD-PARTY.md` if any vendored code is included. | File check when applicable. | MINOR |

---

## 3. Fix protocol (Engineer Agent)

### 3.1 Order of work

Fix in this order, regardless of how the report is sorted:

1. **INT-*** — integrity violations, first, always.
2. **BLOCKER** — within blockers: security (SEC) → data-loss/autofix (AF) → correctness (RM/LP/RC) → packaging (NPM/API).
3. **MAJOR** — grouped by module to keep diffs coherent.
4. **MINOR / ADVISORY** — only after the gates above are clean.

### 3.2 Rules for fixes

- **F-1 One finding, one intent.** A commit may fix several findings only if they share a root cause; say so.
- **F-2 Fix the cause, not the symptom.** If three findings share a root cause, fix the cause and say which three it closes.
- **F-3 Every behavioural fix ships a test that fails before it.** State the pre-fix failure output.
- **F-4 No opportunistic refactors** inside a fix commit. Refactors are separate and reviewed as such.
- **F-5 No scope expansion.** If a fix requires a design decision beyond §1, stop and escalate (§0.9) instead of inventing scope.
- **F-6 If you disagree with a check**, say so explicitly with reasoning and propose an amendment. Do not silently skip it; an unaddressed finding is a failed iteration, but a reasoned objection is a legitimate move.
- **F-7 Declare collateral.** List every check you believe your diff could affect, so the Reviewer re-runs them (loop step 4b).
- **F-8 Leave the tree clean.** No debug logs, commented-out code, `.only`, stray fixtures, or TODOs without an issue reference.

### 3.3 What "done" means for one finding

A finding is closed when: the required condition in §2 holds, the `verify` command/inspection has been run **and its output attached**, and no new finding was introduced by the change.

---

## 4. Report formats

### 4.1 `ReviewReport` (Reviewer Agent → Engineer Agent)

```json
{
  "schema": "review-report/1",
  "run_id": "rev-2026-09-20T10-02-11Z-7f3a",
  "iteration": 3,
  "commit": "9c1f0ab2e4d5",
  "clean_checkout": true,
  "scope": "full | incremental",
  "summary": {
    "evaluated": 187,
    "pass": 171,
    "fail": 12,
    "waived": 2,
    "na": 2,
    "by_severity": { "blocker": 2, "major": 6, "minor": 4, "advisory": 0 }
  },
  "gates": {
    "blocker_zero": false,
    "major_zero": false,
    "all_checks_evaluated": true,
    "commands_green": false
  },
  "findings": [
    {
      "id": "AF-002",
      "severity": "BLOCKER",
      "title": "Default run writes to disk without --write",
      "where": "src/fix/apply.ts:L44-L61",
      "observed": "applyFixes() calls fs.writeFile when options.write is undefined",
      "required": "Without an explicit --write/apply:true, nothing on disk changes",
      "impact": "Running the linter in CI silently rewrites a user's tool definitions",
      "fix_hint": "Default options.write=false; guard the write path; add mocked-fs assertion",
      "verify": "npm test -- fix/apply.dryrun.test.ts && ./scripts/assert-no-writes.sh",
      "evidence": { "type": "file", "quote": "await fs.writeFile(path, next)" },
      "tags": ["regression"]
    }
  ],
  "waivers_active": [{ "check": "PERF-008", "expires": "2026-11-01", "issue": "#214" }],
  "commands": [
    { "cmd": "npm ci", "exit": 0 },
    { "cmd": "npm run test:ci", "exit": 1, "excerpt": "..." }
  ],
  "integrity_pass": { "performed": true, "violations": [] },
  "next_action": "engineer_fix | escalate | sign_off"
}
```

Rules: findings sorted by severity then ID; `evaluated` must equal the total number of checks in §2 for a full sweep; a report with `scope: "full"` and `evaluated < total` is invalid.

### 4.2 `FixReport` (Engineer Agent → Reviewer Agent)

```json
{
  "schema": "fix-report/1",
  "responds_to": "rev-2026-09-20T10-02-11Z-7f3a",
  "commit": "b70de3c19a24",
  "fixes": [
    {
      "findings_closed": ["AF-002", "AF-004"],
      "root_cause": "write path was not gated on options.write",
      "change": "src/fix/apply.ts, src/cli/run.ts",
      "test_added": "test/fix/apply.dryrun.test.ts",
      "pre_fix_failure": "FAIL apply.dryrun > expected 0 writes, received 3",
      "post_fix_output": "PASS 4 tests",
      "risk": "low",
      "collateral_checks": ["AF-003", "AF-009", "CLI-001"]
    }
  ],
  "not_fixed": [
    { "id": "PERF-008", "reason": "requires baseline regeneration", "proposal": "waiver until #214" }
  ],
  "objections": [
    { "id": "TC-014", "argument": "depth 5 is required by the MCP spec example", "proposed_amendment": "raise default max depth to 5" }
  ],
  "diff_stat": "6 files changed, 142 insertions(+), 37 deletions(-)",
  "integrity_declaration": {
    "tests_deleted_or_skipped": [],
    "suppressions_added": [],
    "thresholds_changed": [],
    "config_excludes_changed": []
  }
}
```

The `integrity_declaration` is mandatory and must be empty or justified. A non-empty, unjustified entry is an automatic INT finding — and the Reviewer verifies it against the diff rather than trusting it.

---

## 5. Verification command set

These are the commands the Reviewer runs. All must exit 0 at sign-off, from a clean checkout. Adapt names to the repo's actual scripts once, then keep them stable (changing them is an INT-008 concern).

```bash
# environment
node -v && npm -v

# clean, reproducible install
rm -rf node_modules && npm ci

# static
npm run typecheck          # tsc --noEmit, strict
npm run lint               # zero errors AND zero warnings
npm run lint:boundaries    # core has no io/net imports (CQ-004)
npm run check:deps         # depcheck / knip
npm run check:api          # public API report diff (API-001/002)

# tests
npm run test:ci            # unit + integration, network blocked, random order
npm run test:coverage      # thresholds enforced (TEST-006)
npm run test:security      # injection, traversal, pollution, DoS corpora
npm run test:property      # idempotency, transparency, round-trip
npm run test:determinism   # two runs, byte-compare (AF-018, REL-008)

# self-application (the package must pass its own rules)
npm run selfcheck          # run the linter on this repo's own tool fixtures + golden corpus

# packaging
npm run build
npm pack --dry-run         # review file list (NPM-005)
npx @arethetypeswrong/cli --pack
npm run test:consumer      # ESM + CJS + TS smoke against the packed tarball (TEST-014)

# supply chain
npm audit --omit=dev
npm run check:licenses

# budgets
npm run bench              # compare to committed baseline (PERF-003)
npm run size               # bundle budget (PERF-008)
```

**Reviewer discipline:** run them, paste the real output, and read the output. An exit code of 0 on a script that silently skips its suite is a green that means nothing — check that the expected number of tests actually ran.

---

## 6. Sign-off checklist

Only complete this from a clean checkout, on the final iteration.

```
[ ] Every check in §2 has a status; count matches the registry total
[ ] BLOCKER = 0
[ ] MAJOR = 0 unwaived
[ ] MINOR ≤ 5, each with a tracked issue
[ ] All §5 commands exit 0, outputs attached, test counts sane
[ ] Integrity pass performed on the full diff; no INT findings
[ ] Waiver register reviewed; no expired, no widened scope
[ ] Product invariants P-1..P-8 each explicitly confirmed with a pointer to the check that proves it
[ ] Autofix run on a scratch repo: dry-run changes nothing; --write changes only what the diff showed; undo restores exactly
[ ] Consumer smoke: fresh project, packed tarball, quickstart works in ESM, CJS, TS
[ ] Docs spot-check: 10 claims verified against implementation
[ ] CHANGELOG and version bump match the API diff
[ ] Escalations: none open
```

Sign-off statement (the Reviewer's final output):

> Reviewed commit `<sha>` against governance-doc v`<n>` at iteration `<i>`, clean checkout. Checks evaluated `<N>`/`<N>`. Blockers 0, majors 0, minors `<m>` (issues: …), waivers `<w>` (expiring …). Commands attached. Integrity pass clean. Invariants P-1..P-8 confirmed. **GREEN.**

---

## Appendix A — Waiver file format

```yaml
# governance/waivers.yml
- id: W-003
  check: PERF-008
  scope: "dist/cli.js"
  reason: "CLI bundle grew 14% after adding SARIF writer; baseline regen scheduled"
  approved_by: "maintainer@example.com"
  created: 2026-09-12
  expires: 2026-11-01
  tracking_issue: "#214"
```

Reviewer must fail the run if: `expires` is past, `approved_by` is an agent, `check` is a BLOCKER, or the scope in the repo is broader than the scope recorded here.

## Appendix B — Suppression comment format

```ts
// governance-ignore TC-018 -- legacy `payload` param kept until v3 removes the v1 adapter (#188)
```

Required: rule ID, `--`, reason, issue reference. Unused suppressions are reported (CLI-008). Suppressions are counted in every report; a growing count is a signal, not a solution.

## Appendix C — Rule ID conventions

- Format `DOMAIN-NNN`, zero-padded to 3.
- Sub-facets use a dot: `TD-005.when-not`.
- IDs are permanent; retired checks stay listed with `RETIRED` and a pointer to the replacement.
- User-facing lint rule IDs (emitted by the package) are a **separate namespace** from these governance IDs; do not reuse.

## Appendix D — Reviewer pass order (efficient sweep)

1. **Cheap static first:** NPM-*, LEG-*, SUP-*, DOC file existence — fast, catches packaging blockers before expensive runs.
2. **Build + typecheck + lint** — if these fail, most downstream checks are meaningless; report and stop the sweep early with `scope: partial`.
3. **Test suite + coverage + security corpora.**
4. **Behavioural deep checks:** RM transparency, LP loop caps, AF safety — these need reading code, not just running it.
5. **Rule-quality checks:** TC/TD/RC/TS — including the false-positive gate TC-023.
6. **Budgets:** PERF, then packaging smoke (TEST-014).
7. **Integrity pass over the diff** — always last, always performed.

## Appendix E — Minimum evidence per domain (quick reference)

| Domain | Minimum acceptable evidence |
|---|---|
| TC, TD, RC, TS | Fixture run output showing rule fired / did not fire, per case |
| RM, LP | Property/fault-injection test output with case counts |
| AF | Golden diffs + idempotency + determinism hashes + rollback test log |
| SEC | Corpus run output, with the corpus size stated |
| PRV | Inspected emitted payload showing redaction/absence |
| NPM, SUP | `npm pack` file list, audit output, workflow file quotes |
| API | API report diff |
| PERF | Benchmark numbers with machine spec and baseline comparison |
| TEST | Test counts, coverage table, mutation score |
| DOC | Doc file quotes + the code lines they claim to describe |

## Appendix F — Amendment process for this document

This document changes only by human decision. The Engineer Agent may propose; the Reviewer Agent may flag a contradiction; neither edits it. An amendment records: date, version bump, checks added/changed/retired (with IDs), and the rationale. Existing waivers are re-evaluated against the new version.

---

**Document version:** 1.0
**Registry total: 289 checks** — 279 in §2 plus 10 `INT-*` in §0.7. The Reviewer uses this number to prove nothing was skipped; update it at every amendment.

| TC 23 | TD 14 | RC 14 | TS 8 | RM 20 | LP 14 | AF 24 | SEC 20 | PRV 9 | OBS 8 |
|---|---|---|---|---|---|---|---|---|---|
| **NPM 20** | **API 12** | **CLI 15** | **PERF 9** | **REL 12** | **TEST 18** | **CQ 12** | **DOC 12** | **SUP 10** | **LEG 5** |