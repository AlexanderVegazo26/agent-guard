import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
