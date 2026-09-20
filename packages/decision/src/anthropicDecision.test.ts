import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicDecisionApiError, AnthropicDecisionEngine } from "./anthropicDecision.js";
import type { QuestionSet } from "./engine.js";

const STATE = { task: "x", injectedFaults: [], claims: [], evidence: [], links: [] };

function mockResponse(input: Record<string, unknown>, usage = { input_tokens: 100, output_tokens: 20 }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "tool_use", input }], usage }),
    }),
  );
}

describe("AnthropicDecisionEngine", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("throws at construction with no API key", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicDecisionEngine()).toThrow(/no API key/);
  });

  it("reports its own capabilities, distinct from Jev's", () => {
    const engine = new AnthropicDecisionEngine();
    const caps = engine.capabilities();
    expect(caps.primitives).toEqual(["noul", "score", "choice"]);
    expect(caps.supportsBatch).toBe(true);
  });

  it("decides a noul question and passes through real usage", async () => {
    mockResponse({ q1: { noul: 0.83 } });
    const questions: QuestionSet = { q1: { type: "noul", instructions: "did it happen?" } };

    const engine = new AnthropicDecisionEngine();
    const result = await engine.decide(STATE, questions);

    expect(result.answers.q1).toEqual({ type: "noul", noul: 0.83 });
    expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("decides a choice question, deriving a probability distribution from the model's own confidence", async () => {
    mockResponse({ q1: { choice: "appropriate", confidence: 0.9 } });
    const questions: QuestionSet = {
      q1: { type: "choice", instructions: "was the tool right?", criteria: { appropriate: "correct tool", inappropriate: "wrong tool" } },
    };

    const engine = new AnthropicDecisionEngine();
    const result = await engine.decide(STATE, questions);

    const answer = result.answers.q1 as { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
    expect(answer.type).toBe("choice");
    expect(answer.choice).toBe("appropriate");
    expect(answer.confidence).toBe(0.9);
    expect(answer.probabilities.appropriate).toBe(0.9);
    expect(answer.probabilities.inappropriate).toBeCloseTo(0.1);
  });

  it("decides a score question, translating scoreIndex back into the ordered criteria as a legend", async () => {
    mockResponse({ q1: { scoreIndex: 1, confidence: 0.7 } });
    const questions: QuestionSet = {
      q1: { type: "score", instructions: "how did it recover?", criteria: ["not-detected", "detected-and-reported", "detected-and-fixed"] },
    };

    const engine = new AnthropicDecisionEngine();
    const result = await engine.decide(STATE, questions);

    expect(result.answers.q1).toMatchObject({ type: "score", score: 1, confidence: 0.7 });
    expect((result.answers.q1 as { legend: Record<string, unknown> }).legend).toEqual({
      "0": "not-detected",
      "1": "detected-and-reported",
      "2": "detected-and-fixed",
    });
  });

  it("throws AnthropicDecisionApiError on a non-ok HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "server error" }));
    const engine = new AnthropicDecisionEngine();

    await expect(engine.decide(STATE, { q1: { type: "noul", instructions: "x" } })).rejects.toThrow(AnthropicDecisionApiError);
  });

  it("throws AnthropicDecisionApiError when the response carries no tool_use block", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ content: [{ type: "text", text: "I refuse to use tools." }] }) }));
    const engine = new AnthropicDecisionEngine();

    await expect(engine.decide(STATE, { q1: { type: "noul", instructions: "x" } })).rejects.toThrow(/no tool_use block/);
  });
});
