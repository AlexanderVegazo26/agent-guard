import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SPAN = {
  name: "engine.decide" as const,
  durationMs: 120,
  tokenEstimate: 1000,
  actualInputTokens: 1500,
  actualOutputTokens: 50,
  estimateAccuracyRatio: 1.5,
  assertionIds: ["goalCompleted"],
};

/**
 * A minimal OTLP/HTTP collector stand-in. It only records the requests it
 * receives (path, content-type, decoded JSON body) so the test can assert
 * on what a real collector would be handed, without requiring a real
 * collector in CI. Serves `/v1/traces` because that's the path
 * `OTLPTraceExporter` actually POSTs to (it appends it to the configured
 * base endpoint itself) — a mock listening on `/` would silently 404 the
 * real exporter and this test would never see a request.
 */
interface ReceivedRequest {
  path: string;
  contentType: string | undefined;
  body: any;
}

function startMockCollector(): Promise<{ url: string; nextRequest: () => Promise<ReceivedRequest>; close: () => Promise<void> }> {
  const pending: ReceivedRequest[] = [];
  const waiters: Array<(r: ReceivedRequest) => void> = [];

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body: any;
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
      const received: ReceivedRequest = { path: req.url ?? "", contentType: req.headers["content-type"], body };
      const waiter = waiters.shift();
      if (waiter) waiter(received);
      else pending.push(received);
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        nextRequest: () =>
          pending.length > 0
            ? Promise.resolve(pending.shift()!)
            : new Promise<ReceivedRequest>((res) => waiters.push(res)),
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

describe("self-observability (PRD3 F20)", () => {
  let collector: Awaited<ReturnType<typeof startMockCollector>>;

  beforeEach(async () => {
    collector = await startMockCollector();
  });

  afterEach(async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    // Each test that enables observability creates a module-local provider;
    // shut it down so its exporter doesn't keep an open handle (or a stale
    // endpoint) across tests. Import lazily so tests that never enable
    // observability never pay for it.
    const { shutdownObservability } = await import("./observability.js");
    await shutdownObservability();
    await collector.close();
  });

  it("is off by default, and sends nothing to a collector", async () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const { observabilityEnabled, recordEngineSpan } = await import("./observability.js");
    expect(observabilityEnabled()).toBe(false);

    recordEngineSpan(SPAN);

    // Nothing to await receiving — assert by racing a short timeout instead
    // of a fixed sleep, since a bug here would mean a request eventually
    // arrives, not never.
    const raced = await Promise.race([
      collector.nextRequest().then(() => "request"),
      new Promise((res) => setTimeout(() => res("timeout"), 300)),
    ]);
    expect(raced).toBe("timeout");
  });

  it("exports a real OTLP/HTTP span to /v1/traces when OTEL_EXPORTER_OTLP_ENDPOINT is set", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = collector.url;
    const { observabilityEnabled, recordEngineSpan } = await import("./observability.js");
    expect(observabilityEnabled()).toBe(true);

    recordEngineSpan(SPAN);

    const received = await collector.nextRequest();

    expect(received.path).toBe("/v1/traces");
    expect(received.contentType).toContain("application/json");

    const spans = received.body.resourceSpans[0].scopeSpans[0].spans;
    expect(spans).toHaveLength(1);
    const span = spans[0];
    expect(span.name).toBe("engine.decide");

    const attrs = Object.fromEntries(
      span.attributes.map((a: any) => [a.key, a.value.intValue ?? a.value.doubleValue ?? a.value.stringValue]),
    );
    expect(Number(attrs["agentguard.token_estimate"])).toBe(1000);
    expect(Number(attrs["agentguard.actual_input_tokens"])).toBe(1500);
    expect(Number(attrs["agentguard.estimate_accuracy_ratio"])).toBeCloseTo(1.5);

    const resourceAttrs = Object.fromEntries(
      received.body.resourceSpans[0].resource.attributes.map((a: any) => [a.key, a.value.stringValue]),
    );
    expect(resourceAttrs["service.name"]).toBe("agentguard");
  });

  it("omits the estimate-accuracy attribute when the estimate was 0 (nothing to divide by)", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = collector.url;
    const { recordEngineSpan } = await import("./observability.js");

    recordEngineSpan({ ...SPAN, tokenEstimate: 0, estimateAccuracyRatio: null });

    const received = await collector.nextRequest();
    const span = received.body.resourceSpans[0].scopeSpans[0].spans[0];
    const keys = span.attributes.map((a: any) => a.key);
    expect(keys).not.toContain("agentguard.estimate_accuracy_ratio");
  });

  it("carries the degradation strategy attribute when present", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = collector.url;
    const { recordEngineSpan } = await import("./observability.js");

    recordEngineSpan({ ...SPAN, degradationStrategy: "fanout-cap" });

    const received = await collector.nextRequest();
    const span = received.body.resourceSpans[0].scopeSpans[0].spans[0];
    const attrs = Object.fromEntries(span.attributes.map((a: any) => [a.key, a.value.stringValue]));
    expect(attrs["agentguard.degradation_strategy"]).toBe("fanout-cap");
  });
});
