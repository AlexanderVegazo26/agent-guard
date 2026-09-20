# Performance Testing & Autofix Loop Specification

**Package scope:** monitoring, benchmarking, and automated remediation of tool-use performance in LLM-driven AI agents.
**Audience:** the CI pipeline, the k6 runner, and the SWE agent that consumes reports from this package and proposes fixes.

---

## 1. Purpose

This document defines:

1. Every performance dimension this tool must measure for an LLM agent's tool-use behavior.
2. How those dimensions map to concrete [k6](https://k6.io) test types, scripts, and thresholds.
3. The **review → fix → re-review** loop contract: the exact machine-readable report format this package emits, and the protocol the SWE agent must follow to consume it, apply fixes, and trigger re-verification — repeating until every threshold is green.

This is not a general web-perf doc. Every check here is scoped to **agentic tool-calling behavior**: latency and correctness of the loop between "model decides to call a tool" → "tool executes" → "result returns to model" → "model continues," including multi-step chains.

---

## 2. System Under Test (SUT) Model

Treat the agent as a pipeline with five instrumented boundaries. Every metric in this doc is tagged to one of these stages so failures can be localized:

| Stage | Boundary | Typical owner of a regression |
|---|---|---|
| `S1` | User/trigger → Agent orchestrator receives request | Orchestrator queue/ingress |
| `S2` | Orchestrator → LLM provider (prompt assembly, context build) | Prompt/context builder |
| `S3` | LLM response → Tool-call parse/validate/dispatch | Tool schema, router |
| `S4` | Tool execution (the actual function/API/DB call) | Tool implementation, downstream service |
| `S5` | Tool result → back into LLM context → next turn | Serialization, context re-injection |

A multi-tool-call agent turn traverses `S3→S4→S5` N times before final answer. All chain metrics (Section 4.6) are computed over the full traversal.

---

## 3. Performance Dimensions Checklist

Each item below must have: a metric name, a collection method, a default threshold, and a k6 test type it belongs to. Use this table as the master checklist the tool validates against.

### 3.1 Latency

| Check | Metric | Default Threshold | Stage |
|---|---|---|---|
| Time to first token (TTFT) from LLM provider | `llm_ttft_ms` | p95 < 1500ms | S2 |
| Full LLM completion latency (non-streaming) | `llm_completion_ms` | p95 < 6000ms | S2 |
| Tool-call decision latency (model emits tool_use block) | `tool_decision_ms` | p95 < 2000ms | S2/S3 |
| Tool schema validation latency | `tool_validate_ms` | p99 < 50ms | S3 |
| Single tool execution latency (per tool, per tool) | `tool_exec_ms{tool=<name>}` | p95 < 800ms (configurable per tool) | S4 |
| Tool result serialization + context re-injection | `tool_reinject_ms` | p95 < 100ms | S5 |
| End-to-end single-tool-call round trip | `e2e_single_tool_ms` | p95 < 4000ms | S2-S5 |
| End-to-end multi-step chain (N tools) | `e2e_chain_ms{n=<count>}` | p95 < N × 3000ms | S2-S5 loop |
| Agent cold start (first request after idle) | `agent_cold_start_ms` | p95 < 3000ms | S1-S2 |
| Agent warm request | `agent_warm_ms` | p95 < 1500ms | S1-S2 |
| Streaming inter-token latency (jitter) | `llm_itl_ms` | p95 < 150ms | S2 |

### 3.2 Throughput & Concurrency

| Check | Metric | Default Threshold | Stage |
|---|---|---|---|
| Concurrent agent sessions sustained | `vus_sustained` | ≥ target VU count with no threshold breach | S1 |
| Tool calls processed per second | `tool_calls_per_sec` | ≥ configured floor | S3/S4 |
| Max concurrent in-flight tool executions per tool | `tool_inflight_max{tool}` | ≤ tool's declared concurrency limit | S4 |
| Queue depth at orchestrator under load | `orchestrator_queue_depth` | bounded, no unbounded growth | S1 |
| Provider rate-limit headroom | `llm_rate_limit_remaining` | never hits 0 during test window | S2 |
| Connection pool saturation (tool HTTP clients) | `http_pool_saturation_pct` | < 90% | S4 |

### 3.3 Reliability / Correctness Under Load

| Check | Metric | Default Threshold | Stage |
|---|---|---|---|
| Tool call schema-validation failure rate | `tool_schema_fail_rate` | < 0.1% | S3 |
| Malformed/hallucinated tool-call rate (wrong tool name, missing required args) | `tool_hallucination_rate` | < 1% | S3 |
| Tool execution error rate (5xx, exceptions) | `tool_exec_error_rate` | < 1% per tool | S4 |
| Tool execution timeout rate | `tool_timeout_rate` | < 0.5% | S4 |
| Retry rate (how often auto-retry logic engages) | `tool_retry_rate` | tracked, alert if > 5% | S3/S4 |
| Retry storm detection (retries triggering more retries) | `retry_amplification_factor` | < 1.5x | S3/S4 |
| Duplicate tool-call execution (idempotency check) | `tool_duplicate_exec_rate` | 0% for non-idempotent tools | S4 |
| Partial-chain failure recovery rate | `chain_recovery_rate` | ≥ 95% resume-or-graceful-fail | S3-S5 loop |
| Context truncation incidents under load | `context_truncation_count` | 0 | S2 |
| Dropped tool results (result never reaches model) | `tool_result_drop_rate` | 0% | S5 |

### 3.4 Resource Efficiency

| Check | Metric | Default Threshold | Stage |
|---|---|---|---|
| Token usage per completed task (prompt + completion) | `tokens_per_task` | tracked against budget | S2 |
| Wasted tokens from failed/retried tool calls | `wasted_tokens_pct` | < 5% of total | S2/S3 |
| Cost per successful task ($) | `cost_per_task_usd` | tracked against budget | S2 |
| Memory footprint of orchestrator process under load | `process_rss_mb` | < declared ceiling | S1 |
| CPU utilization of orchestrator under load | `process_cpu_pct` | < 80% sustained | S1 |
| Event-loop lag (Node.js agents) | `event_loop_lag_ms` | p95 < 50ms | S1 |
| Context window utilization ratio | `context_window_util_pct` | < 90% before compaction triggers | S2 |
| Cache hit rate (prompt cache, tool-result cache) | `cache_hit_rate` | ≥ configured target | S2/S4 |

### 3.5 Degradation & Resilience

| Check | Metric | Default Threshold | Test type |
|---|---|---|---|
| Graceful degradation under 2x expected load | `degradation_slope` | latency grows sub-linearly, no cliff | Stress |
| Breakpoint (max sustainable load before failure) | `breakpoint_vus` | documented, must exceed capacity plan by 30% | Breakpoint |
| Spike recovery time (time to return to baseline after burst) | `spike_recovery_s` | < 30s | Spike |
| Long-duration stability (memory leak, latency creep) | `soak_latency_drift_pct` | < 10% drift over soak window | Soak |
| Circuit breaker engagement correctness | `circuit_breaker_trips` | trips only above configured error threshold | Stress |
| Provider failover behavior (if multi-provider) | `failover_success_rate` | ≥ 99% | Fault injection |
| Downstream tool dependency outage handling | `dependency_outage_graceful_pct` | 100% return structured error, no crash | Fault injection |

### 3.6 Multi-Step Chain / Agentic Workflow Specific

| Check | Metric | Default Threshold | Stage |
|---|---|---|---|
| Chain step latency distribution (not just total) | `chain_step_ms{step=n}` | each step within per-tool budget | S3-S5 |
| Chain depth vs. latency correlation | `chain_depth_latency_corr` | near-linear, flag superlinear growth | S3-S5 |
| Parallel tool-call fan-out efficiency | `fanout_speedup_ratio` | ≥ 0.7 × ideal parallel speedup | S4 |
| Loop/infinite-retry detection in agent reasoning | `agent_loop_detected_count` | 0 | S2-S5 |
| Tool-call ordering correctness under concurrency | `tool_order_violation_count` | 0 for order-dependent tools | S3-S4 |
| State consistency across chain steps | `chain_state_mismatch_count` | 0 | S5 |

---

## 4. k6 Integration Architecture

### 4.1 Directory layout

```
/perf
  /k6
    scenarios/
      smoke.js
      load.js
      stress.js
      spike.js
      soak.js
      breakpoint.js
      chain-fanout.js
    lib/
      agent-client.js       # wraps calls to the agent's HTTP/WS endpoint
      metrics.js            # custom Trend/Counter/Rate definitions (Section 4.3)
      thresholds.js         # threshold config, imported by every scenario
      payloads/
        single-tool-call.json
        multi-step-chain.json
        malformed-input.json
    config/
      thresholds.yaml       # source of truth, synced into thresholds.js
      environments.yaml     # base URLs, auth per env (local/staging/prod-shadow)
  reports/
    latest.json             # normalized report (Section 5)
    history/                # timestamped archive for trend/regression detection
```

### 4.2 Test types → scenario files

| k6 scenario | Executor | Purpose | Maps to Section |
|---|---|---|---|
| `smoke.js` | `constant-vus`, 1-2 VUs, 1 min | Fast sanity check pre-merge; fails fast on obvious breakage | 3.1, 3.3 (basic) |
| `load.js` | `ramping-vus` to expected peak concurrency | Validate normal-load thresholds | 3.1, 3.2, 3.4 |
| `stress.js` | `ramping-vus` beyond expected peak (1.5x–3x) | Find degradation slope and breaking point | 3.5 |
| `spike.js` | `ramping-arrival-rate` sharp burst then drop | Validate spike absorption + recovery | 3.5 |
| `soak.js` | `constant-vus` at ~70% capacity for 1-4+ hours | Detect memory leaks, latency creep, token-cost drift | 3.4, 3.5 |
| `breakpoint.js` | `ramping-arrival-rate` monotonic increase, no ceiling | Find exact VU/RPS where SLOs break | 3.5 |
| `chain-fanout.js` | `ramping-vus` with multi-tool-call payloads | Validate 3.6 chain-specific metrics | 3.6 |

### 4.3 Custom metrics (k6 `Trend`/`Counter`/`Rate`)

```javascript
// perf/k6/lib/metrics.js
import { Trend, Counter, Rate } from 'k6/metrics';

export const metrics = {
  llmTtft: new Trend('llm_ttft_ms'),
  llmCompletion: new Trend('llm_completion_ms'),
  toolDecision: new Trend('tool_decision_ms'),
  toolValidate: new Trend('tool_validate_ms'),
  toolExec: new Trend('tool_exec_ms', true), // tagged per-tool via .add(val, {tool: name})
  toolReinject: new Trend('tool_reinject_ms'),
  e2eSingleTool: new Trend('e2e_single_tool_ms'),
  e2eChain: new Trend('e2e_chain_ms', true),

  toolSchemaFailRate: new Rate('tool_schema_fail_rate'),
  toolHallucinationRate: new Rate('tool_hallucination_rate'),
  toolExecErrorRate: new Rate('tool_exec_error_rate'),
  toolTimeoutRate: new Rate('tool_timeout_rate'),
  toolRetryRate: new Rate('tool_retry_rate'),
  toolDuplicateExec: new Counter('tool_duplicate_exec_count'),
  chainRecoveryRate: new Rate('chain_recovery_rate'),
  contextTruncationCount: new Counter('context_truncation_count'),
  toolResultDropRate: new Rate('tool_result_drop_rate'),

  tokensPerTask: new Trend('tokens_per_task'),
  wastedTokensPct: new Trend('wasted_tokens_pct'),
  costPerTaskUsd: new Trend('cost_per_task_usd'),
  cacheHitRate: new Rate('cache_hit_rate'),

  agentLoopDetected: new Counter('agent_loop_detected_count'),
  toolOrderViolation: new Counter('tool_order_violation_count'),
  chainStateMismatch: new Counter('chain_state_mismatch_count'),
  fanoutSpeedupRatio: new Trend('fanout_speedup_ratio'),
};
```

The npm package's instrumentation SDK (the piece embedded in the agent process, not in k6) must emit these same metric names via response headers or a sidecar `/__perf_meta` payload on every call, so k6 can read `agent_cold_start_ms`, `tokens_per_task`, etc. directly out of the response rather than inferring them from wall-clock timing alone. Recommended contract:

```json
// Every agent response includes this block (dev/staging only, gated by header)
{
  "result": "...",
  "__perf_meta": {
    "stage_timings_ms": { "s1": 12, "s2": 1340, "s3": 45, "s4": 210, "s5": 8 },
    "tool_calls": [
      { "tool": "search_db", "duration_ms": 210, "status": "ok", "retries": 0, "schema_valid": true }
    ],
    "tokens": { "prompt": 1820, "completion": 340, "cached": 900 },
    "cost_usd": 0.0142,
    "chain_depth": 2,
    "loop_detected": false
  }
}
```

### 4.4 Example scenario: `load.js`

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';
import { metrics } from './lib/metrics.js';
import { thresholds } from './lib/thresholds.js';
import { buildAgentRequest } from './lib/agent-client.js';

export const options = {
  scenarios: {
    load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },
        { duration: '5m', target: 50 },
        { duration: '2m', target: 0 },
      ],
    },
  },
  thresholds: thresholds.load, // imported, see 4.5
};

export default function () {
  const payload = buildAgentRequest('single-tool-call');
  const res = http.post(`${__ENV.AGENT_BASE_URL}/agent/invoke`, payload.body, payload.params);

  const meta = res.json('__perf_meta');
  check(res, { 'status is 200': (r) => r.status === 200 });

  if (meta) {
    metrics.llmCompletion.add(meta.stage_timings_ms.s2);
    metrics.toolExec.add(meta.stage_timings_ms.s4, { tool: meta.tool_calls[0]?.tool });
    metrics.tokensPerTask.add(meta.tokens.prompt + meta.tokens.completion);
    metrics.costPerTaskUsd.add(meta.cost_usd);
    metrics.toolSchemaFailRate.add(meta.tool_calls.some(t => !t.schema_valid));
    metrics.toolExecErrorRate.add(meta.tool_calls.some(t => t.status !== 'ok'));
    metrics.agentLoopDetected.add(meta.loop_detected ? 1 : 0);
  }

  sleep(1);
}
```

### 4.5 Threshold config (single source of truth)

```yaml
# perf/k6/config/thresholds.yaml
load:
  llm_ttft_ms: ["p(95)<1500"]
  llm_completion_ms: ["p(95)<6000"]
  tool_exec_ms: ["p(95)<800"]
  tool_schema_fail_rate: ["rate<0.001"]
  tool_exec_error_rate: ["rate<0.01"]
  tool_timeout_rate: ["rate<0.005"]
  http_req_failed: ["rate<0.01"]

stress:
  tool_exec_error_rate: ["rate<0.05"]   # relaxed on purpose to observe degradation, not fail fast
  http_req_duration: ["p(95)<10000"]

soak:
  soak_latency_drift_pct: ["value<10"]
  process_rss_mb: ["value<1024"]

chain:
  e2e_chain_ms: ["p(95)<9000"]
  chain_recovery_rate: ["rate>0.95"]
  tool_order_violation_count: ["count==0"]
  chain_state_mismatch_count: ["count==0"]
```

`thresholds.js` reads this YAML at build time (via a small Node script run pre-test) and exports it in k6's expected `{ metric: [conditions] }` shape per scenario. Keep this YAML as the only place humans/agents edit thresholds — never hand-edit the generated `.js`.

### 4.6 Fault injection payloads

k6 alone won't exercise Section 3.5's dependency-outage checks. Pair scenarios with a lightweight toxiproxy/mock-server config that this package also ships:

- `payloads/malformed-input.json` — intentionally missing required tool args, to score `tool_hallucination_rate` / `tool_schema_fail_rate`.
- Toxiproxy profile: inject 500ms–5s latency and 10% 500s into one downstream tool dependency during `stress.js`, verify `circuit_breaker_trips` and `dependency_outage_graceful_pct`.

---

## 5. Normalized Report Format

Every k6 run is post-processed by this package's CLI (`npx <pkg> analyze`) into a single normalized JSON — this is the artifact the SWE agent actually reads. k6's native summary JSON is too low-level; do not hand that to the agent directly.

```json
{
  "run_id": "2026-09-20T14:32:00Z_load_v14",
  "scenario": "load",
  "git_sha": "a1b2c3d",
  "overall_status": "FAIL",
  "checks": [
    {
      "id": "tool_exec_ms",
      "stage": "S4",
      "tool": "search_db",
      "status": "FAIL",
      "observed": { "p95": 1120, "p99": 2400 },
      "threshold": { "p95": 800 },
      "severity": "high",
      "suspected_cause_hint": "S4 execution regression, not LLM latency — check tool implementation or downstream dependency",
      "evidence_ref": "reports/history/2026-09-20T14:32:00Z_load_v14/raw.json#tool_exec_ms"
    },
    {
      "id": "tool_schema_fail_rate",
      "stage": "S3",
      "status": "PASS",
      "observed": { "rate": 0.0004 },
      "threshold": { "rate": 0.001 },
      "severity": "n/a"
    }
  ],
  "summary": {
    "total_checks": 42,
    "passed": 39,
    "failed": 3,
    "failed_ids": ["tool_exec_ms:search_db", "tokens_per_task", "chain_recovery_rate"]
  },
  "diff_from_previous_run": {
    "run_id_compared": "2026-09-20T09:10:00Z_load_v13",
    "regressions": ["tool_exec_ms:search_db (+340ms p95)"],
    "improvements": []
  }
}
```

Design rules for this report:

- **`overall_status`** is `PASS` only when every check in `checks[]` is `PASS`. This is the single boolean the loop controller checks.
- **`stage`** must always be populated (Section 2) so the SWE agent can go straight to the relevant code area instead of grepping.
- **`suspected_cause_hint`** is generated heuristically by this package (e.g., "S4 regression while S2/S3 stable ⇒ look at tool implementation, not prompt/model") — this narrows the SWE agent's search space and is the single highest-leverage field for making the loop converge quickly.
- **`evidence_ref`** points to raw per-request data so the agent (or a human) can inspect actual failing requests, not just aggregates.
- **`diff_from_previous_run`** is mandatory from the second run onward — it's what lets the agent confirm a fix actually worked rather than just "no longer red for unrelated reasons."

---

## 6. The Review → Fix → Re-Review Loop

### 6.1 Loop contract

```
┌──────────────┐     report.json      ┌──────────────────┐
│  k6 + analyze │ ───────────────────▶ │   Loop Controller  │
│  (this pkg)   │                      │  (this pkg's CLI)  │
└──────▲───────┘                      └────────┬──────────┘
       │                                        │ overall_status == FAIL?
       │ re-run after fix                       ▼
       │                              ┌──────────────────┐
       │                              │   SWE Agent       │
       │                              │ (Claude Code, etc)│
       │                              └────────┬──────────┘
       │                                        │ patch applied,
       └────────────────────────────────────────┘ commit created
```

### 6.2 Controller responsibilities (this package's `npx <pkg> loop` command)

1. Run the configured k6 scenario(s).
2. Produce the normalized report (Section 5).
3. If `overall_status == "PASS"` → exit 0, loop ends, emit final green report.
4. If `overall_status == "FAIL"` → invoke the SWE agent with a **fix request payload** (6.3), wait for it to signal completion (commit hash or "done" marker file), then go to step 1.
5. Enforce a **max iteration cap** (default 8, configurable) and a **regression guard**: if `diff_from_previous_run.regressions` is non-empty after a fix iteration (i.e., the agent's change made something new fail that was previously passing), immediately halt and flag for human review rather than continuing to loop — do not let the agent "fix" one metric by breaking another silently.
6. Track wall-clock and cost budget for the whole loop (each iteration re-runs k6 = real cost); if exceeded, halt and report partial progress.

### 6.3 Fix request payload (controller → SWE agent)

```json
{
  "task": "fix_performance_regression",
  "run_id": "2026-09-20T14:32:00Z_load_v14",
  "iteration": 2,
  "max_iterations": 8,
  "failing_checks": [ /* subset of checks[] with status FAIL, from Section 5 */ ],
  "instructions": [
    "Address each failing_checks entry. Use 'stage' and 'suspected_cause_hint' to scope your search.",
    "Do not modify k6 scenario files or threshold config to make checks pass — thresholds are fixed requirements.",
    "After changes, run `npx <pkg> verify --quick` locally (subset smoke run) before signaling done, to avoid burning a full loop iteration on an obviously incomplete fix.",
    "Signal completion by writing .perf-loop/done_<iteration>.json with {\"commit\": \"<sha>\", \"summary\": \"<what changed>\"}."
  ],
  "constraints": {
    "forbidden_files": ["perf/k6/config/thresholds.yaml", "perf/k6/scenarios/**"],
    "must_not_regress": ["all currently passing checks"]
  }
}
```

Key design decision: **the SWE agent is explicitly forbidden from editing thresholds or test scenarios to satisfy the loop.** The controller should diff the k6 config directory before/after each iteration and hard-fail the loop if those files changed — otherwise "all green" is trivially gameable.

### 6.4 Exit conditions (all of these are terminal states, not just "all green")

| Condition | Result |
|---|---|
| `overall_status == PASS` | ✅ Success — final report archived, exit 0 |
| Iteration cap reached, still failing | ⚠️ Halt — emit summary of remaining failures + all attempted diffs, exit 1, require human |
| Regression guard triggered (fix broke a previously-passing check) | 🛑 Halt immediately — do not continue looping, exit 1, require human |
| Threshold/scenario files modified by agent | 🛑 Halt immediately, revert those files, exit 1, flag as policy violation |
| Cost/time budget exceeded | ⚠️ Halt — exit 1, partial progress report |
| Same `failed_ids` set unchanged across 2 consecutive iterations | ⚠️ Halt — agent is stuck/not making progress, exit 1, require human |

### 6.5 CLI surface

```bash
# Full loop, CI entrypoint
npx <pkg> loop --scenario load --max-iterations 8 --agent claude-code

# Single run + report only, no loop (for local dev / smoke on PR)
npx <pkg> analyze --scenario smoke

# Quick subset re-check the SWE agent runs before signaling done
npx <pkg> verify --quick --checks tool_exec_ms,chain_recovery_rate

# Compare two historical runs manually
npx <pkg> diff --from <run_id> --to <run_id>
```

---

## 7. CI/CD Integration

- **Pre-merge (PR):** `smoke.js` only, hard gate, must pass, no loop (just fail the PR with the report attached as a comment).
- **Pre-release / nightly:** `load.js` + `chain-fanout.js` through the full loop controller (Section 6), auto-fix attempted, human notified either way with the final report.
- **Weekly:** `soak.js` and `stress.js`/`breakpoint.js` — these are slow and expensive; loop is available but typically run in report-only mode with a human triaging, since a soak-detected memory leak usually needs more context than an automated loop iteration budget allows.
- **Post-incident:** `spike.js` + targeted fault-injection reruns to validate a fix for a specific production incident before closing it.

Store every `analyze` output under `perf/reports/history/` and commit the `latest.json` symlink update as part of the CI job so trend regression (`diff_from_previous_run`) has history to compare against from day one.

---

## 8. "All Green" Definition (canonical)

A run is **all green** only when, simultaneously:

1. Every check in the normalized report has `status: PASS`.
2. `diff_from_previous_run.regressions` is empty relative to the last known-green baseline.
3. No forbidden files (thresholds, scenarios) were touched during the loop that produced this state.
4. The report's `overall_status` field itself reads `PASS` (never infer this from absence of errors — always check the explicit field).

Only state 8 is a valid reason for the loop controller to exit 0 and mark the pipeline stage successful.