/**
 * PRD3 F20 — self-observability. What's actually built here: a single,
 * dependency-free hook the pipeline calls around every `engine.decide()`,
 * carrying exactly the attributes F20's acceptance criteria names
 * (token estimate vs. `usage.input_tokens`, latency, degradation strategy).
 *
 * What's NOT built here, honestly: real OTel spans exported over OTLP.
 * Wiring `@opentelemetry/sdk-trace-node` and an OTLP exporter is a real new
 * dependency and a real design decision (which exporter, which resource
 * attributes, sampling) that this pass does not make unilaterally. This
 * hook's shape is deliberately span-like — `name`/`attributes`/`durationMs`
 * — so a real OTel exporter can be dropped in behind `recordEngineSpan`
 * later without the pipeline call sites changing again.
 *
 * Enabled by `OTEL_EXPORTER_OTLP_ENDPOINT` (the same env var real OTLP
 * export would key off — F20's own acceptance criteria: "a run with
 * OTEL_EXPORTER_OTLP_ENDPOINT set produces spans"), off by default so a
 * normal run's stderr stays clean.
 */
export interface EngineSpan {
  name: "engine.decide";
  durationMs: number;
  tokenEstimate: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  /** `actualInputTokens / tokenEstimate` — 1.0 is a perfect estimate; >1 means the estimator undershot (the dangerous direction, per §6.5). `null` when the estimate was 0 (nothing to divide by). */
  estimateAccuracyRatio: number | null;
  degradationStrategy?: string;
  assertionIds: string[];
}

export function observabilityEnabled(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

export function recordEngineSpan(span: EngineSpan): void {
  if (!observabilityEnabled()) return;
  // stderr, not stdout — this must never interleave with a report a script
  // might be parsing from stdout (the same discipline `console.error` gets
  // elsewhere in this codebase for anything that isn't the report itself).
  console.error(JSON.stringify({ ...span, timestamp: new Date().toISOString() }));
}
