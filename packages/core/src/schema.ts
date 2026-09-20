import { z } from "zod";

/**
 * Core type system — transcribed from TRD §3, §6.8 and §7.
 * Zod schemas are the source of truth; TypeScript types are inferred from them.
 */

// ---------------------------------------------------------------------------
// §3.1 Run and events
// ---------------------------------------------------------------------------

export const AgentIdentity = z.object({
  name: z.string(),
  provider: z.string().optional(),
  model: z.string().optional(),
  version: z.string().optional(),
});
export type AgentIdentity = z.infer<typeof AgentIdentity>;

/**
 * PRD3 F12 — how AgentGuard learned about this event, independent of what
 * the event says happened. `wire`: observed directly off a transport or
 * network proxy AgentGuard itself controls (the agent cannot lie about a
 * response it never controlled). `harness`: authored by AgentGuard's own
 * test scaffolding (an injected fault, the task text) — synthetic by
 * design, not a claim about the agent. `self-reported`: authored by the
 * agent's own harness reporting what it did (`TranscriptAdapter`,
 * `agentguard watch`, a caller-supplied `agentguard_start_run` event) — the
 * same party being evaluated, so a claim of this provenance is evidence of
 * what was *said*, not of what happened. `imported`: read from an external
 * instrumentation trace (e.g. a future OpenTelemetry importer) — observed
 * by that instrumentation, not narrated by the agent, but not captured by
 * this build's own proxy either.
 *
 * Optional and additive: every event persisted before this field existed
 * has no `provenance`, and nothing currently shipped requires one — see
 * `assertions/requirements.ts`'s `minProvenance` for where a future
 * assertion could start relying on it.
 */
export const EventProvenance = z.enum(["wire", "harness", "self-reported", "imported"]);
export type EventProvenance = z.infer<typeof EventProvenance>;

const BaseEvent = z.object({
  id: z.string(),
  timestamp: z.string().datetime(),
  // Monotonic per run. Timestamp resolution alone cannot order same-millisecond
  // events, and ordering is semantically load-bearing (TRD §3.1).
  seq: z.number().int().nonnegative(),
  provenance: EventProvenance.optional(),
});

// §7 — what AgentGuard did to the world. `url` is a string (a literal URL or a
// regex source) rather than a live RegExp so fixtures stay JSON-serializable;
// the observe package compiles it into a real matcher at runtime.
export const FaultSpec = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("http"),
    url: z.string(),
    status: z.number().int(),
    body: z.unknown().optional(),
    times: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("prompt-injection"),
    url: z.string(),
    field: z.string(),
    payload: z.string(),
    // PRD3 F14 — matches the existing "http" fault's own `times`: a prompt
    // injection that fires forever is a poor adversarial fixture (an agent
    // that never falls for it after the first attempt still "fails" every
    // request downstream). Unset stays infinite, the pre-F14 behavior.
    times: z.number().int().positive().optional(),
  }),
  // PRD3 F14 — a stalled upstream: the proxy never responds at all,
  // distinct from a fast HTTP error. `delayMs` is how long the proxy waits
  // before giving up and tearing down the connection (a real timeout, not
  // a fast synthetic error), so an agent under test experiences the same
  // "is it still coming?" uncertainty a real hang produces.
  z.object({
    type: z.literal("timeout"),
    url: z.string(),
    delayMs: z.number().int().nonnegative(),
    times: z.number().int().positive().optional(),
  }),
  // PRD3 F14 — a 200 with a body that isn't valid JSON, distinct from an
  // "http" fault's structured error body: this exercises an agent's
  // handling of a response it can't even parse, not just one it can parse
  // and disagrees with.
  z.object({
    type: z.literal("malformed-response"),
    url: z.string(),
    times: z.number().int().positive().optional(),
  }),
  // PRD3 F14 — the remainder of PRD App. C's catalogue that `HttpFaultProxy`
  // can synthesize as a fast, well-formed response (no real upstream body
  // needed), the same shape as "http" but named for the specific scenario
  // rather than left to a caller to encode via a bare status code.
  z.object({
    type: z.literal("http-429"),
    url: z.string(),
    retryAfterMs: z.number().int().nonnegative().optional(),
    times: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("empty-response"),
    url: z.string(),
    times: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("permission-denied"),
    url: z.string(),
    times: z.number().int().positive().optional(),
  }),
  // PRD3 F14 — mutations of a REAL upstream response body, distinct from
  // the synthesized faults above: these need an actual response to alter,
  // so the proxy applies them after the upstream request completes rather
  // than short-circuiting it.
  z.object({
    type: z.literal("stale-data"),
    url: z.string(),
    field: z.string(),
    staleValue: z.unknown(),
    times: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("missing-field"),
    url: z.string(),
    field: z.string(),
    times: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("duplicate-record"),
    url: z.string(),
    times: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("incorrect-data"),
    url: z.string(),
    field: z.string(),
    incorrectValue: z.unknown(),
    times: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("contradictory-response"),
    url: z.string(),
    field: z.string(),
    value: z.unknown(),
    conflictField: z.string(),
    conflictValue: z.unknown(),
    times: z.number().int().positive().optional(),
  }),
]);
export type FaultSpec = z.infer<typeof FaultSpec>;

export const InjectedFault = z.object({
  id: z.string(),
  spec: FaultSpec,
});
export type InjectedFault = z.infer<typeof InjectedFault>;

export const MessageEvent = BaseEvent.extend({
  type: z.literal("message"),
  role: z.enum(["user", "agent", "system"]),
  text: z.string(),
});

export const ToolCallEvent = BaseEvent.extend({
  type: z.literal("tool_call"),
  callId: z.string(),
  tool: z.string(),
  arguments: z.unknown(),
});

export const ToolResultEvent = BaseEvent.extend({
  type: z.literal("tool_result"),
  callId: z.string(),
  success: z.boolean(),
  result: z.unknown(),
});

export const NetworkEvent = BaseEvent.extend({
  type: z.literal("network"),
  method: z.string(),
  url: z.string(),
  status: z.number().int().optional(),
  timingMs: z.number().nonnegative().optional(),
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  requestBody: z.unknown().optional(),
  responseBody: z.unknown().optional(),
  // TRD §6.5 rule 2 — response bodies are truncated at a declared byte limit,
  // and truncation is recorded as a fact about the evidence.
  bodyTruncated: z.boolean().optional(),
  error: z.string().optional(),
});

export const BrowserEvent = BaseEvent.extend({
  type: z.literal("browser_state"),
  kind: z.enum(["navigation", "snapshot", "console", "error"]),
  url: z.string().optional(),
  title: z.string().optional(),
  // Accessibility snapshot only — TRD §6.5 rule 1: full DOM snapshots never
  // enter evidence. `domSnapshotRef` points at a stored artifact for humans.
  snapshot: z.unknown().optional(),
  domSnapshotRef: z.string().optional(),
  consoleLevel: z.string().optional(),
  message: z.string().optional(),
});

export const StateEvent = BaseEvent.extend({
  type: z.literal("state_change"),
  kind: z.enum(["storage", "cookies", "app_state"]),
  data: z.unknown(),
});

export const FaultEvent = BaseEvent.extend({
  type: z.literal("fault"),
  faultId: z.string(),
  spec: FaultSpec,
});

// PRD2 F3 — a tool's own definition (name, description, input schema) as
// the agent saw it, captured at the moment it was first exposed (e.g. an
// MCP `tools/list` response). This is the evidence source ASI01/ASI04's
// dominant 2026 attack shape needs: an instruction hidden in a tool's
// *description*, which the agent reads but the user never sees, is
// invisible without recording the definition itself as evidence — a
// `tool_call`/`tool_result` pair only shows the tool being used, never
// what it claimed to be.
export const ToolDefinitionEvent = BaseEvent.extend({
  type: z.literal("tool_definition"),
  tool: z.string(),
  description: z.string().optional(),
  inputSchema: z.unknown().optional(),
});

// PRD2 F9 — a multi-agent run's sub-agent boundaries, as evidence rather
// than as an assumption. Without recording *which* agent produced a
// claim, "the agent said X" is ambiguous the moment there's more than
// one agent in the run — a sub-agent's unverified claim, acted on by the
// orchestrator as fact, is exactly the ASI08 (cascading agent failure)
// shape, and it's invisible unless the boundary itself is captured.
export const AgentSpawnEvent = BaseEvent.extend({
  type: z.literal("agent_spawn"),
  /** The orchestrating agent's own id, when known — omitted for a top-level spawn. */
  parentAgentId: z.string().optional(),
  childAgentId: z.string(),
  task: z.string(),
});

export const AgentResultEvent = BaseEvent.extend({
  type: z.literal("agent_result"),
  childAgentId: z.string(),
  success: z.boolean(),
  /** The sub-agent's own final claim, verbatim — never paraphrased by the orchestrator (TRD §5.1's rule applies across the agent boundary too). */
  claim: z.string().optional(),
});

// PRD2 F2 — the online guard's own decision, recorded as an event so
// "every guard decision is an event in the run" (F2's own requirement)
// and offline `verify()` can be run against the exact same evidence the
// guard saw. `GuardDecisionKind` deliberately excludes any notion of a
// pending/async "review" outcome resolving later — PRD v0.6 §10.4's
// reliability floor applies here too: an engine that can't decide
// blocks, it never allows.
export const GuardDecisionKind = z.enum(["allow", "block", "review"]);
export type GuardDecisionKind = z.infer<typeof GuardDecisionKind>;

export const GuardDecisionEvent = BaseEvent.extend({
  type: z.literal("guard_decision"),
  tool: z.string(),
  arguments: z.unknown(),
  decision: GuardDecisionKind,
  reason: z.string(),
  /** The tool_call this decision governed, when the guard sits in front of a real MCP transport. */
  callId: z.string().optional(),
});

export const AgentEvent = z.discriminatedUnion("type", [
  MessageEvent,
  ToolCallEvent,
  ToolResultEvent,
  NetworkEvent,
  BrowserEvent,
  StateEvent,
  FaultEvent,
  ToolDefinitionEvent,
  AgentSpawnEvent,
  GuardDecisionEvent,
  AgentResultEvent,
]);
export type AgentEvent = z.infer<typeof AgentEvent>;

// PRD2 F5 — PRD v0.6 §9.2's three agent-attachment modes differ in how
// trustworthy their own events are. "Wrap the tool layer" (the Playwright
// fixture's MCP observation) and a real trace importer both *observe*
// wire traffic — the agent cannot lie about a network response it never
// controlled. "Agent emits" (TranscriptAdapter, `agentguard watch`) has
// the agent's own harness *authoring* every event: a self-reported "no
// network calls happened" is not evidence of no network calls, it's a
// claim from the same party being evaluated. `source` records which kind
// of run this is; omitted (the default) means observed, for backward
// compatibility with every run persisted before this field existed.
export const RunSource = z.enum(["observed", "self-reported"]);
export type RunSource = z.infer<typeof RunSource>;

/**
 * PRD3 F12 — `AgentRun.source` derived from its constituent events' own
 * `provenance`, rather than a literal a capture path hardcodes. The
 * weakest provenance present wins: a single `self-reported` event (the
 * agent's own harness authoring a claim about itself) is enough to mark
 * the whole run self-reported, exactly as `runSourceAdvisory` intends —
 * one untrustworthy claim is enough to warrant extra scrutiny of the
 * entire run, not just that one event. Every other provenance
 * (`wire`, `harness`, `imported`) — and events carrying no provenance at
 * all, e.g. a fixture predating this field — is at least independently
 * attributable and rolls up to `"observed"`, the default that predates
 * per-event provenance entirely (kept for backward compatibility: a run
 * persisted before this field existed, and every event within it, loads
 * exactly as before).
 */
export function deriveRunSource(events: readonly Pick<BaseEventShape, "provenance">[]): RunSource {
  return events.some((e) => e.provenance === "self-reported") ? "self-reported" : "observed";
}

interface BaseEventShape {
  provenance?: EventProvenance;
}

export const AgentRun = z.object({
  id: z.string(),
  task: z.string(),
  agent: AgentIdentity,
  events: z.array(AgentEvent),
  finalOutput: z.string().optional(),
  faults: z.array(InjectedFault),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
  schemaVersion: z.literal(1),
  source: RunSource.optional(),
});
export type AgentRun = z.infer<typeof AgentRun>;

// ---------------------------------------------------------------------------
// §3.2 Evidence
// ---------------------------------------------------------------------------

export const EvidenceType = z.enum([
  "user_request",
  "agent_claim",
  "tool_call",
  "tool_result",
  "browser_state",
  "network",
  "state_change",
  "injected_fault",
  "tool_definition",
  "agent_spawn",
  "agent_result",
  "guard_decision",
]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const Evidence = z.object({
  id: z.string(),
  type: EvidenceType,
  source: z.string(),
  content: z.unknown(),
  // Mandatory and non-empty — evidence that cannot name the observation it
  // came from is not evidence (TRD §3.2, enforcing PRD §4 by construction).
  derivedFrom: z.array(z.string()).min(1),
  timestamp: z.string().datetime(),
  seq: z.number().int(),
  // PRD3 F12 — copied straight from the source event(s) by the evidence
  // compiler (`graph.ts`); see `EventProvenance` for what each value means.
  provenance: EventProvenance.optional(),
});
export type Evidence = z.infer<typeof Evidence>;

// ---------------------------------------------------------------------------
// §3.3 The evidence graph
// ---------------------------------------------------------------------------

export const EvidenceRelation = z.enum([
  "supports",
  "contradicts",
  "precedes",
  "causedBy",
  "refersTo",
  "duplicates",
]);
export type EvidenceRelation = z.infer<typeof EvidenceRelation>;

export const EvidenceLink = z.object({
  from: z.string(),
  to: z.string(),
  relation: EvidenceRelation,
  basis: z.enum(["deterministic", "heuristic"]),
  confidence: z.number().min(0).max(1).optional(),
});
export type EvidenceLink = z.infer<typeof EvidenceLink>;

// ---------------------------------------------------------------------------
// §6.8 Assertion result
// ---------------------------------------------------------------------------

export const AssertionId = z.enum([
  // Goal (PRD §8)
  "goalCompleted",
  "finalStateMatchesIntent",
  "prematureCompletion",
  "requiredStepsCompleted",
  // Grounding
  "noUnsupportedClaims",
  "claimsConsistentWithEvidence",
  "noFabricatedToolUsage",
  "noFabricatedCompletion",
  // Tool usage
  "toolWasAppropriate",
  "toolArgumentsCorrect",
  "toolResultUsedCorrectly",
  "noUnauthorizedToolUse",
  // Safety
  "noPromptInjectionSuccess",
  "noSensitiveDataLeak",
  "noPolicyViolation",
  "noUnauthorizedSideEffect",
  // Behavioral
  "recoveredFromFailure",
  "handledAmbiguityCorrectly",
  "avoidedUnnecessaryActions",
  "stoppedWhenDone",
  // Foundational (PRD §8's "additional foundational assertion")
  "evidenceSufficient",
]);
export type AssertionId = z.infer<typeof AssertionId>;

export const AssertionStatus = z.enum(["pass", "fail", "review", "not_applicable", "error"]);
export type AssertionStatus = z.infer<typeof AssertionStatus>;

// ---------------------------------------------------------------------------
// PRD2 F1 — human adjudication. Every confidence number this product prints
// is advisory until it has been validated against ground truth (§10.3 /
// TRD §6.9), and ground truth for a real run only exists once a human has
// looked at it. An adjudication is a human's verdict on one assertion's
// result for one run, recorded separately from `decisions.json` (append-only
// per assertion — re-adjudicating replaces a prior note, but never touches
// the machine verdict it is judging).
// ---------------------------------------------------------------------------

export const HumanVerdict = z.enum(["pass", "fail", "cannot-tell"]);
export type HumanVerdict = z.infer<typeof HumanVerdict>;

export const Adjudication = z.object({
  assertionId: z.string(),
  humanVerdict: HumanVerdict,
  reason: z.string(),
  adjudicator: z.string(),
  at: z.string().datetime(),
});
export type Adjudication = z.infer<typeof Adjudication>;

export const DegradationRecord = z.object({
  strategy: z.enum(["tighten-selection", "split-batch", "chunk-aggregate", "fanout-cap", "review"]),
  reason: z.string(),
});
export type DegradationRecord = z.infer<typeof DegradationRecord>;

export const AssertionResult = z
  .object({
    id: z.string(),
    status: AssertionStatus,
    // Noul: the raw probability. Choice/Score: Jev's derived `confidence`.
    confidence: z.number().min(0).max(1).optional(),
    signal: z.enum(["noul-probability", "derived-confidence", "deterministic"]).optional(),
    probabilities: z.record(z.string(), z.number()).optional(),
    // "not-applicable" is its own basis, distinct from "deterministic", so
    // §6.9's calibration filter (an allowlist on this field) never mixes a
    // status carrying no measurement with one that does.
    basis: z.enum(["deterministic", "jev", "escalated", "not-applicable"]),
    reviewVia: z.enum(["structural-gap", "uncertainty-band", "capacity"]).optional(),
    missing: z.array(z.string()).optional(),
    coverageGaps: z.array(z.string()).optional(),
    evidence: z.array(z.string()),
    explanation: z.string().optional(),
    degradation: DegradationRecord.optional(),
    durationMs: z.number().nonnegative(),
    // Token-usage transparency (the "black box" complaint this closes):
    // the real `usage` a decision engine reported for the `decide()` call
    // that produced this verdict. Absent for anything decided without an
    // engine call (`basis: "deterministic"` or `"not-applicable"`).
    // Attributed at the batch/call level, same convention as `durationMs`
    // above it — a union-batch call's usage is recorded on every assertion
    // decided in that one call, not divided among them (there is no sound
    // way to split one API call's token cost across N questions).
    usage: z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative() }).optional(),
  })
  .superRefine((result, ctx) => {
    if ((result.status === "pass" || result.status === "fail") && result.evidence.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a decided verdict (pass/fail) must cite at least one evidence id (TRD §6.8)",
        path: ["evidence"],
      });
    }
    if (result.status === "not_applicable" && result.basis !== "not-applicable") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "not_applicable status must carry basis: \"not-applicable\" (TRD §6.8)",
        path: ["basis"],
      });
    }
  });
export type AssertionResult = z.infer<typeof AssertionResult>;
