import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** API-009 — see anthropicEscalation.test.ts for the rationale. */
describe("AnthropicFixProposerEngine — AbortSignal (API-009)", () => {
  it("never calls fetch when the signal is already aborted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const engine = new AnthropicFixProposerEngine({ apiKey: "k" });
    const controller = new AbortController();
    controller.abort();

    await expect(
      engine.propose({ targetPath: "AGENTS.md", currentText: "x", recurringEvidence: [] }, controller.signal),
    ).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
