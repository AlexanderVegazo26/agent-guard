/**
 * PRD3 F20 — self-observability. Real OTel spans for `engine.decide`,
 * exported over OTLP/HTTP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set (the
 * standard OTel env var — `OTLPTraceExporter` reads it itself, so this
 * module never constructs an endpoint URL). Off by default: nothing is
 * imported or initialized until the first call after the env var is set.
 *
 * Scope, honestly: F20's requirement text also asks for spans on
 * `evaluate`, each escalation, and each guard decision. Only
 * `engine.decide` is wired here (the pipeline's two `recordEngineSpan`
 * call sites) — the other three span types don't exist yet in the
 * pipeline and are not part of this change.
 *
 * Provider lifecycle: this module is a library, not an application, so it
 * never touches the OTel *global* tracer provider (`trace.setGlobalTracerProvider`)
 * — doing that would hijack a host app's own OTel setup and leak across
 * test files. A single module-local `BasicTracerProvider` is lazily
 * created on first use and reused. `SimpleSpanProcessor` (not
 * `BatchSpanProcessor`) is used deliberately: this is a short-lived CLI
 * emitting a handful of spans per run, and a batching processor would
 * routinely drop everything still buffered when the process exits.
 * `shutdownObservability()` is exported for a CLI exit path to call so the
 * last span's export isn't racing process exit; wiring that call into the
 * CLI's exit path is left to the CLI, not this module.
 */
import type { Span } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { resolveOtlpEndpoint } from "./configLoader.js";

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
  return Boolean(resolveOtlpEndpoint());
}

let provider: BasicTracerProvider | undefined;

function getProvider(): BasicTracerProvider {
  if (!provider) {
    provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: "agentguard",
        [ATTR_SERVICE_VERSION]: "0.1.0",
      }),
      // `OTLPTraceExporter` with no `url` reads OTEL_EXPORTER_OTLP_ENDPOINT
      // (and OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) itself, and appends the
      // `/v1/traces` path per the OTLP/HTTP spec — this module must not
      // build that URL itself.
      spanProcessors: [new SimpleSpanProcessor(new OTLPTraceExporter({}))],
    });
  }
  return provider;
}

function setSpanAttributes(span: Span, attrs: EngineSpan): void {
  span.setAttribute("agentguard.token_estimate", attrs.tokenEstimate);
  span.setAttribute("agentguard.actual_input_tokens", attrs.actualInputTokens);
  span.setAttribute("agentguard.actual_output_tokens", attrs.actualOutputTokens);
  // OTel attributes have no null; omit rather than encode a sentinel when
  // there was nothing to divide by (tokenEstimate === 0).
  if (attrs.estimateAccuracyRatio !== null) {
    span.setAttribute("agentguard.estimate_accuracy_ratio", attrs.estimateAccuracyRatio);
  }
  if (attrs.degradationStrategy) span.setAttribute("agentguard.degradation_strategy", attrs.degradationStrategy);
  span.setAttribute("agentguard.assertion_ids", attrs.assertionIds);
}

export function recordEngineSpan(span: EngineSpan): void {
  if (!observabilityEnabled()) return;
  const tracer = getProvider().getTracer("agentguard", "0.1.0");
  const startTime = Date.now() - span.durationMs;
  const otelSpan = tracer.startSpan(span.name, { startTime });
  setSpanAttributes(otelSpan, span);
  otelSpan.end(Date.now());
}

/** Flush any buffered spans and release the exporter. Intended to be called from a CLI's exit path so the process doesn't terminate mid-export. */
export async function shutdownObservability(): Promise<void> {
  if (!provider) return;
  await provider.forceFlush();
  await provider.shutdown();
  provider = undefined;
}
