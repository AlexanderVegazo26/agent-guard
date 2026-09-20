import { z } from "zod";
import {
  AgentIdentity,
  Adjudication,
  AssertionResult,
  GuardDecisionKind,
  RunSource,
  type AgentRun,
} from "@agent-guard/core";

/**
 * PRD3 F17 / A7 — "the JSON report is the contract." Every other reporter
 * (console, JUnit, HTML) and every other consumer (`compare`, `history`,
 * `agentguard_get_report`, the F21 dashboard) renders from or reads this
 * shape rather than a raw `decisions.json`. Versioned the same way
 * `AgentRun.schemaVersion` is (TRD §3.1's convention): a literal, so a
 * report from a future incompatible shape fails `safeParse` instead of
 * silently being misread.
 *
 * One `ReportV1` = one run. A multi-run report (what `agentguard report`
 * writes today) is just `ReportV1[]`; nothing here needs a plural wrapper
 * type of its own.
 */
export const GuardDecisionSummary = z.object({
  tool: z.string(),
  decision: GuardDecisionKind,
  reason: z.string(),
  timestamp: z.string().datetime(),
});
export type GuardDecisionSummary = z.infer<typeof GuardDecisionSummary>;

/**
 * PRD3 F14's `--adversarial` per-dimension mutation report ("Prompt
 * injection 18/20 resisted"). `@agent-guard/mutations` doesn't exist yet
 * (F14 is unimplemented at F17 time) — this field is optional so F14 can
 * populate it later without a schema break; nothing in this package writes
 * it today.
 */
export const MutationDimensionSummary = z.object({
  resisted: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type MutationDimensionSummary = z.infer<typeof MutationDimensionSummary>;

export const ReportV1 = z.object({
  schemaVersion: z.literal(1),
  runId: z.string(),
  generatedAt: z.string().datetime(),
  task: z.string().optional(),
  agent: AgentIdentity.optional(),
  /** PRD3 F12's `RunSource` — a self-reported run's report means something different from an observed one; carried through so a reader doesn't have to re-derive it. */
  source: RunSource.optional(),
  startedAt: z.string().datetime().optional(),
  // Per-assertion results, including `degradation` (already on `AssertionResult`).
  decisions: z.record(z.string(), AssertionResult),
  // PRD2 F1: rides alongside `decisions`, never merged into it — omitted
  // entirely (not an empty object) for a run nothing has been adjudicated
  // on, matching the pre-F17 JSON reporter's contract.
  adjudications: z.record(z.string(), Adjudication).optional(),
  guardDecisions: z.array(GuardDecisionSummary).optional(),
  mutationDimensions: z.record(z.string(), MutationDimensionSummary).optional(),
});
export type ReportV1 = z.infer<typeof ReportV1>;

export interface BuildReportV1Options {
  runId: string;
  decisions: Record<string, AssertionResult>;
  task?: string;
  agent?: z.infer<typeof AgentIdentity>;
  source?: z.infer<typeof RunSource>;
  startedAt?: string;
  adjudications?: Record<string, Adjudication>;
  guardDecisions?: GuardDecisionSummary[];
  mutationDimensions?: Record<string, MutationDimensionSummary>;
  generatedAt?: string;
}

/**
 * The one place a `ReportV1` gets constructed — every caller (CLI commands,
 * the MCP server, the Playwright fixture) goes through this rather than
 * building the object literal itself, so a field added to the schema only
 * needs a default decided once.
 */
export function buildReportV1(options: BuildReportV1Options): ReportV1 {
  return ReportV1.parse({
    schemaVersion: 1,
    runId: options.runId,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    decisions: options.decisions,
    ...(options.task !== undefined ? { task: options.task } : {}),
    ...(options.agent !== undefined ? { agent: options.agent } : {}),
    ...(options.source !== undefined ? { source: options.source } : {}),
    ...(options.startedAt !== undefined ? { startedAt: options.startedAt } : {}),
    ...(options.adjudications !== undefined ? { adjudications: options.adjudications } : {}),
    ...(options.guardDecisions !== undefined ? { guardDecisions: options.guardDecisions } : {}),
    ...(options.mutationDimensions !== undefined ? { mutationDimensions: options.mutationDimensions } : {}),
  });
}

/**
 * Convenience for a caller holding a full `AgentRun` (the CLI's `report`
 * command, which loads it from `RunStore`) — derives `task`/`agent`/
 * `source`/`startedAt`/`guardDecisions` from the run rather than making
 * every call site re-extract them by hand.
 */
export function buildReportV1FromRun(
  run: AgentRun,
  decisions: Record<string, AssertionResult>,
  adjudications?: Record<string, Adjudication>,
): ReportV1 {
  const guardDecisions = run.events
    .filter((e): e is Extract<AgentRun["events"][number], { type: "guard_decision" }> => e.type === "guard_decision")
    .map((e) => ({ tool: e.tool, decision: e.decision, reason: e.reason, timestamp: e.timestamp }));

  return buildReportV1({
    runId: run.id,
    decisions,
    task: run.task,
    agent: run.agent,
    source: run.source,
    startedAt: run.startedAt,
    adjudications,
    guardDecisions: guardDecisions.length > 0 ? guardDecisions : undefined,
  });
}
