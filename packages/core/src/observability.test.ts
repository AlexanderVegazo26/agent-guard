import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observabilityEnabled, recordEngineSpan } from "./observability.js";

const SPAN = {
  name: "engine.decide" as const,
  durationMs: 120,
  tokenEstimate: 1000,
  actualInputTokens: 1500,
  actualOutputTokens: 50,
  estimateAccuracyRatio: 1.5,
  assertionIds: ["goalCompleted"],
};

describe("self-observability (PRD3 F20)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  it("is off by default, and emits nothing", () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(observabilityEnabled()).toBe(false);
    recordEngineSpan(SPAN);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("emits a structured span to stderr when OTEL_EXPORTER_OTLP_ENDPOINT is set", () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318";
    expect(observabilityEnabled()).toBe(true);

    recordEngineSpan(SPAN);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const emitted = JSON.parse(errorSpy.mock.calls[0]![0] as string);
    expect(emitted.name).toBe("engine.decide");
    expect(emitted.estimateAccuracyRatio).toBe(1.5);
    expect(emitted.tokenEstimate).toBe(1000);
    expect(emitted).toHaveProperty("timestamp");
  });
});
