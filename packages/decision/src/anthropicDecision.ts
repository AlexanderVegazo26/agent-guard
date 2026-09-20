import type { DecisionAnswer, DecisionEngine, DecisionQuestion, DecisionResult, DecisionState, EngineCapabilities, JsonEntry, QuestionSet } from "./engine.js";

/**
 * PRD3 F18 — a second real `DecisionEngine`, so a Jev outage or SDK break
 * doesn't stop every verdict. Same reasoning as `AnthropicEscalationEngine`
 * and `AnthropicFixProposerEngine`: no SDK dependency, a single `fetch` call
 * to the Messages API, `ANTHROPIC_API_KEY` read and validated at
 * construction.
 *
 * Structured output via a forced tool call (`tool_choice: {type: "tool"}`)
 * rather than asking for free-text JSON and hoping it parses — the model
 * cannot answer with prose, only with arguments matching the schema this
 * class builds from `questions`.
 *
 * Honest limitation, matching F18's own scope ("only probability/option/
 * level survive"): Jev's `legend`/`probabilities` come from an internal,
 * calibrated algorithm this engine has no access to. This engine instead
 * derives a legend from `criteria` order and a one-hot-ish probability
 * distribution from the model's own reported confidence — real numbers,
 * not fabricated ones, but a coarser signal than Jev's. `noul` has no such
 * gap: it is a single probability in both engines.
 */
export interface AnthropicDecisionEngineConfig {
  apiKey?: string;
  model?: string;
}

const DEFAULT_MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
// Claude Sonnet 5's real context window is far larger than Jev's ~32K, but
// `capabilities().tokenBudget` is what the pipeline's degradation ladder
// sizes batches against — reporting the model's own limit here, not Jev's,
// is the entire point of a second engine with different capacity.
const TOKEN_BUDGET = 180_000;
const TOOL_NAME = "submit_answers";

export class AnthropicDecisionApiError extends Error {}

export class AnthropicDecisionEngine implements DecisionEngine {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: AnthropicDecisionEngineConfig = {}) {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("AnthropicDecisionEngine: no API key was provided. Pass `apiKey` or set the ANTHROPIC_API_KEY environment variable.");
    }
    this.apiKey = apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  capabilities(): EngineCapabilities {
    return { tokenBudget: TOKEN_BUDGET, supportsBatch: true, primitives: ["noul", "score", "choice"] };
  }

  async decide(state: DecisionState, questions: QuestionSet): Promise<DecisionResult> {
    const tool = buildTool(questions);

    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        tools: [tool],
        tool_choice: { type: "tool", name: TOOL_NAME },
        messages: [{ role: "user", content: buildPrompt(state, questions) }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AnthropicDecisionApiError(`AnthropicDecisionEngine: request failed (HTTP ${response.status}): ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; input?: Record<string, unknown> }>;
      usage?: { input_tokens: number; output_tokens: number };
    };
    const toolUse = data.content?.find((block) => block.type === "tool_use");
    if (!toolUse?.input) {
      throw new AnthropicDecisionApiError("AnthropicDecisionEngine: response contained no tool_use block");
    }

    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, question] of Object.entries(questions)) {
      const raw = toolUse.input[id];
      if (raw === undefined) {
        throw new AnthropicDecisionApiError(`AnthropicDecisionEngine: model did not answer question "${id}"`);
      }
      answers[id] = toDecisionAnswer(question, raw as Record<string, unknown>);
    }

    return {
      answers,
      usage: { inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 },
    };
  }
}

function buildPrompt(state: DecisionState, questions: QuestionSet): string {
  return [
    "You are evaluating a recorded AI agent run against a set of semantic questions, from the exact evidence below — never guess or assume anything not present here.",
    "",
    `Task the agent was given: ${state.task}`,
    "",
    "Recorded state (claims, evidence, links, injected faults — verbatim):",
    JSON.stringify(state, null, 2),
    "",
    "Questions to answer:",
    JSON.stringify(questions, null, 2),
    "",
    `Call the "${TOOL_NAME}" tool with one answer per question id. Do not answer in prose.`,
  ].join("\n");
}

function buildTool(questions: QuestionSet): { name: string; description: string; input_schema: Record<string, unknown> } {
  const properties: Record<string, unknown> = {};
  for (const [id, question] of Object.entries(questions)) {
    properties[id] = questionSchema(question);
  }
  return {
    name: TOOL_NAME,
    description: "Submit one structured answer per question id.",
    input_schema: { type: "object", properties, required: Object.keys(questions) },
  };
}

function questionSchema(question: DecisionQuestion): Record<string, unknown> {
  if (question.type === "noul") {
    return {
      type: "object",
      properties: { noul: { type: "number", minimum: 0, maximum: 1, description: "Probability the criterion holds, 0.0-1.0." } },
      required: ["noul"],
    };
  }
  if (question.type === "score") {
    return {
      type: "object",
      properties: {
        scoreIndex: { type: "integer", minimum: 0, maximum: question.criteria.length - 1, description: "Index into the ordered criteria list that best matches." },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["scoreIndex", "confidence"],
    };
  }
  return {
    type: "object",
    properties: {
      choice: { type: "string", enum: Object.keys(question.criteria) },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["choice", "confidence"],
  };
}

function toDecisionAnswer(question: DecisionQuestion, raw: Record<string, unknown>): DecisionAnswer {
  if (question.type === "noul") {
    return { type: "noul", noul: raw.noul as number };
  }
  if (question.type === "score") {
    const scoreIndex = raw.scoreIndex as number;
    const confidence = raw.confidence as number;
    const legend: Record<string, JsonEntry> = {};
    question.criteria.forEach((entry, i) => {
      legend[String(i)] = entry;
    });
    return {
      type: "score",
      score: scoreIndex,
      confidence,
      legend,
      probabilities: oneHotish(String(scoreIndex), question.criteria.map((_, i) => String(i)), confidence),
    };
  }
  const choice = raw.choice as string;
  const confidence = raw.confidence as number;
  return {
    type: "choice",
    choice,
    confidence,
    probabilities: oneHotish(choice, Object.keys(question.criteria), confidence),
  };
}

/**
 * Not Jev's real posterior — see this file's header. The chosen option gets
 * `confidence`; whatever probability mass remains is split evenly across
 * every other option, so the numbers still sum to 1 and a caller comparing
 * "was there a runner-up" gets a real (if coarse) answer rather than a
 * fabricated precise one.
 */
function oneHotish(chosen: string, options: string[], confidence: number): Record<string, number> {
  const rest = options.filter((o) => o !== chosen);
  const remainder = rest.length > 0 ? (1 - confidence) / rest.length : 0;
  const out: Record<string, number> = { [chosen]: confidence };
  for (const o of rest) out[o] = remainder;
  return out;
}
