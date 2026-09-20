import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicEscalationEngine } from "./anthropicEscalation.js";

/**
 * API-003 — this module used to read `process.env.ANTHROPIC_API_KEY`
 * directly; it now delegates to `resolveAnthropicApiKey` from
 * `@alexvegman/core`'s `configLoader.ts`, the single place that reads this
 * env var. This is a construction-only test (no `explain()` call, no
 * network) covering exactly the behavior that moved: an explicit
 * `apiKey` still wins over the env var, the env var still works as a
 * fallback, and no key from either source still throws by name.
 */
describe("AnthropicEscalationEngine construction — API key resolution", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("throws when no apiKey is passed and ANTHROPIC_API_KEY is unset", () => {
    expect(() => new AnthropicEscalationEngine()).toThrow(/no API key/);
  });

  it("falls back to ANTHROPIC_API_KEY when no explicit apiKey is passed", () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    expect(() => new AnthropicEscalationEngine()).not.toThrow();
  });

  it("prefers an explicit apiKey over ANTHROPIC_API_KEY", () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    expect(() => new AnthropicEscalationEngine({ apiKey: "explicit-key" })).not.toThrow();
  });
});

/**
 * API-009 — `explain()` accepts an optional `AbortSignal`. This is the
 * provable half of cancellation without a live abort-mid-flight scenario:
 * an already-aborted signal must stop the call before it ever reaches the
 * network, not just get passed along and ignored.
 */
describe("AnthropicEscalationEngine — AbortSignal (API-009)", () => {
  it("never calls fetch when the signal is already aborted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const engine = new AnthropicEscalationEngine({ apiKey: "k" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      engine.explain(
        { assertionId: "a1", question: { type: "noul", instructions: "x" }, state: { task: "", injectedFaults: [], claims: [], evidence: [], links: [] }, priorConfidence: 0.5 },
        controller.signal,
      ),
    ).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
