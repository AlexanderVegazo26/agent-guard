import {
  APIConnectionError,
  APIError,
  TypeSafeClient,
  choice as jevChoice,
  noul as jevNoul,
  score as jevScore,
  type ChoiceResponse,
  type NoulResponse,
  type Questions,
  type ScoreResponse,
} from "@typesafe-ai/sdk";
import type {
  DecisionAnswer,
  DecisionEngine,
  DecisionQuestion,
  DecisionResult,
  DecisionState,
  EngineCapabilities,
  JsonEntry,
  QuestionSet,
} from "./engine.js";

const TOKEN_BUDGET = 32_000;

export interface JevDecisionEngineConfig {
  apiKey?: string;
  model?: string;
}

/**
 * §6.1 — production `DecisionEngine`. A thin adapter: the SDK's own
 * `noul`/`score`/`choice` question builders and response shapes are used
 * directly (verified against `@typesafe-ai/sdk@0.6.0`'s type declarations,
 * TRD §1.1), so there is no independent wire format to keep in sync.
 */
export class JevDecisionEngine implements DecisionEngine {
  private readonly client: TypeSafeClient;

  constructor(config: JevDecisionEngineConfig = {}) {
    this.client = new TypeSafeClient({ apiKey: config.apiKey, defaultModel: config.model });
  }

  capabilities(): EngineCapabilities {
    return { tokenBudget: TOKEN_BUDGET, supportsBatch: true, primitives: ["noul", "score", "choice"] };
  }

  async decide(state: DecisionState, questions: QuestionSet): Promise<DecisionResult> {
    const sdkQuestions: Questions = {};
    for (const [id, question] of Object.entries(questions)) {
      sdkQuestions[id] = toSdkQuestion(question);
    }

    const result = await this.client.systemOne({
      state: state as unknown as Parameters<TypeSafeClient["systemOne"]>[0]["state"],
      questions: sdkQuestions,
    });

    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, answer] of Object.entries(result.answers)) {
      answers[id] = toDecisionAnswer(answer as NoulResponse | ScoreResponse | ChoiceResponse);
    }

    return {
      answers,
      usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
    };
  }
}

function toSdkQuestion(question: DecisionQuestion) {
  switch (question.type) {
    case "noul":
      return jevNoul(question.instructions, question.criteria ?? undefined);
    case "score":
      return jevScore(question.instructions, question.criteria);
    case "choice":
      return jevChoice(question.instructions, question.criteria);
  }
}

function toDecisionAnswer(answer: NoulResponse | ScoreResponse | ChoiceResponse): DecisionAnswer {
  if (answer.type === "noul") {
    return { type: "noul", noul: answer.noul };
  }
  if (answer.type === "score") {
    return {
      type: "score",
      score: answer.score,
      confidence: answer.confidence,
      legend: answer.legend as unknown as Record<string, JsonEntry>,
      probabilities: answer.probabilities as Record<string, number>,
    };
  }
  return {
    type: "choice",
    choice: answer.choice,
    confidence: answer.confidence,
    probabilities: answer.probabilities as Record<string, number>,
  };
}

/**
 * TRD §10.4 — an unavailable or erroring decision engine must never yield
 * `PASS`. Engine failures map to CLI exit code 3 by error *type*, not by
 * message, because the SDK raises typed subclasses for every failure mode.
 */
export function isInfrastructureError(err: unknown): boolean {
  return err instanceof APIError || err instanceof APIConnectionError;
}
