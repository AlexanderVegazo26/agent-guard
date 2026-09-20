import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnthropicFixProposerEngine } from "./anthropicFixProposer.js";

/**
 * API-003 — same rationale as anthropicEscalation.test.ts: this module now
 * resolves its API key through `resolveAnthropicApiKey` (from
 * `@alexvegman/core`'s `configLoader.ts`) instead of reading
 * `process.env.ANTHROPIC_API_KEY` itself.
 */
describe("AnthropicFixProposerEngine construction — API key resolution", () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("throws when no apiKey is passed and ANTHROPIC_API_KEY is unset", () => {
    expect(() => new AnthropicFixProposerEngine()).toThrow(/no API key/);
  });

  it("falls back to ANTHROPIC_API_KEY when no explicit apiKey is passed", () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    expect(() => new AnthropicFixProposerEngine()).not.toThrow();
  });

  it("prefers an explicit apiKey over ANTHROPIC_API_KEY", () => {
    process.env.ANTHROPIC_API_KEY = "env-key";
    expect(() => new AnthropicFixProposerEngine({ apiKey: "explicit-key" })).not.toThrow();
  });
});
