import type { DecisionAnswer, DecisionEngine, DecisionResult, DecisionState, EngineCapabilities, QuestionSet } from "./engine.js";

export type MockScript =
  | Record<string, DecisionAnswer>
  | ((questionId: string, state: DecisionState) => DecisionAnswer);

export interface MockDecisionEngineOptions {
  /** Overrides the reported token budget — used to force the §6.5/§6.7 degradation ladder in tests without huge payloads. */
  tokenBudget?: number;
}

/**
 * §6.1, §9.2 — scripted verdicts. Makes assertion logic unit-testable with no
 * network, no model, no browser. The golden suite runs against this engine
 * on every commit (TRD §9.2); it is the same code path `JevDecisionEngine`
 * exercises, with the network call replaced by a lookup.
 */
export class MockDecisionEngine implements DecisionEngine {
  /** Every `decide()` call, in order — inspect in tests to confirm split-batch vs. single-batch behavior. */
  readonly calls: Array<{ state: DecisionState; questions: QuestionSet }> = [];

  constructor(
    private readonly script: MockScript,
    private readonly options: MockDecisionEngineOptions = {},
  ) {}

  capabilities(): EngineCapabilities {
    return { tokenBudget: this.options.tokenBudget ?? 32_000, supportsBatch: true, primitives: ["noul", "score", "choice"] };
  }

  async decide(state: DecisionState, questions: QuestionSet): Promise<DecisionResult> {
    this.calls.push({ state, questions });
    const answers: Record<string, DecisionAnswer> = {};
    for (const questionId of Object.keys(questions)) {
      answers[questionId] = this.resolve(questionId, state);
    }
    return { answers, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  private resolve(questionId: string, state: DecisionState): DecisionAnswer {
    if (typeof this.script === "function") return this.script(questionId, state);
    const answer = this.script[questionId];
    if (!answer) {
      throw new Error(`MockDecisionEngine: no scripted answer for question "${questionId}"`);
    }
    return answer;
  }
}
