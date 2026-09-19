import type { EscalationEngine, EscalationRequest, EscalationResult } from "./escalation.js";

/**
 * The real `EscalationEngine` (PRD §10.2's "Frontier LLM"). Deliberately
 * NOT built on `@typesafe-ai/sdk` — that SDK exposes only the three typed
 * primitives (Noul/Score/Choice), which return a probability or a category,
 * never free text. An explanation is a different capability than a
 * calibrated judgment, so this calls the Anthropic Messages API directly
 * over `fetch` (Node 26+ ships it globally — no new dependency for a single
 * HTTP call).
 *
 * Reads `ANTHROPIC_API_KEY` at construction, mirroring `JevDecisionEngine`'s
 * `TYPESAFE_API_KEY` pattern: fails fast and by name at construction time,
 * not on the first `explain()` call, so `agentguard doctor` can report the
 * gap before a run ever reaches it.
 */
export interface AnthropicEscalationEngineConfig {
  apiKey?: string;
  model?: string;
}

const DEFAULT_MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class EscalationApiError extends Error {}

export class AnthropicEscalationEngine implements EscalationEngine {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: AnthropicEscalationEngineConfig = {}) {
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "AnthropicEscalationEngine: no API key was provided. Pass `apiKey` or set the ANTHROPIC_API_KEY environment variable.",
      );
    }
    this.apiKey = apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async explain(request: EscalationRequest): Promise<EscalationResult> {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 400,
        messages: [{ role: "user", content: buildPrompt(request) }],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new EscalationApiError(`AnthropicEscalationEngine: request failed (HTTP ${response.status}): ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((block) => block.type === "text")?.text?.trim();
    if (!text) {
      throw new EscalationApiError("AnthropicEscalationEngine: response contained no text content block");
    }
    return { explanation: text };
  }
}

/**
 * PRD §10.2: "invoked on the small uncertain tail, where a human is going
 * to read the output anyway." The prompt is explicit that the job is
 * explaining the ambiguity, not re-answering the question — a frontier
 * model asked the same yes/no question again would just be a second,
 * uncalibrated vote, which is not what this step is for.
 */
function buildPrompt(request: EscalationRequest): string {
  return [
    "An automated AI-agent evaluation system asked a semantic question about a recorded agent run and received an uncertain answer from its decision engine " +
      `(signal ${request.priorConfidence.toFixed(2)}, in the "cannot confidently tell" band).`,
    "",
    `Question asked: ${stringifyInstructions(request.question)}`,
    "",
    "Evidence available (verbatim — the exact evidence the uncertain judgment was based on, nothing summarized or added):",
    JSON.stringify(request.state, null, 2),
    "",
    "In 2-4 sentences, explain the most likely reason this question is genuinely hard to answer from this evidence — what specifically makes the case ambiguous, or what evidence is missing — for a human reviewer who will decide whether to trust the result, override it, or gather more evidence. Do not restate a yes/no verdict; you are explaining the uncertainty, not resolving it.",
  ].join("\n");
}

function stringifyInstructions(question: { instructions: unknown }): string {
  return typeof question.instructions === "string" ? question.instructions : JSON.stringify(question.instructions);
}
