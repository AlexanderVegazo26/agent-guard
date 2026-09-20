import { resolveAnthropicApiKey } from "@alexvegman/core";
import type { FixProposerEngine, FixProposerRequest, FixProposerResult } from "./fixProposer.js";

/**
 * The real `FixProposerEngine`. Same reasoning as `AnthropicEscalationEngine`:
 * `@typesafe-ai/sdk` has no free-text/diff-generation capability, so this
 * calls the Anthropic Messages API directly over `fetch`. Reads
 * `ANTHROPIC_API_KEY` at construction (fail fast, by name, before any run
 * — same pattern `agentguard doctor` already checks for escalation).
 */
export interface AnthropicFixProposerEngineConfig {
  apiKey?: string;
  model?: string;
}

const DEFAULT_MODEL = "claude-sonnet-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export class FixProposerApiError extends Error {}

export class AnthropicFixProposerEngine implements FixProposerEngine {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: AnthropicFixProposerEngineConfig = {}) {
    const apiKey = resolveAnthropicApiKey(config.apiKey);
    if (!apiKey) {
      throw new Error(
        "AnthropicFixProposerEngine: no API key was provided. Pass `apiKey` or set the ANTHROPIC_API_KEY environment variable.",
      );
    }
    this.apiKey = apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
  }

  async propose(request: FixProposerRequest, signal?: AbortSignal): Promise<FixProposerResult> {
    // API-009 — see AnthropicDecisionEngine.decide's comment: same
    // single-attempt, `fetch`-backed contract.
    signal?.throwIfAborted();
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 900,
        messages: [{ role: "user", content: buildPrompt(request) }],
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new FixProposerApiError(`AnthropicFixProposerEngine: request failed (HTTP ${response.status}): ${body.slice(0, 500)}`);
    }

    const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((block) => block.type === "text")?.text?.trim();
    if (!text) {
      throw new FixProposerApiError("AnthropicFixProposerEngine: response contained no text content block");
    }
    return parseResponse(text);
  }
}

/**
 * docs/AUTOFIX.md §6, anti-Goodhart: the request never carries an
 * assertion's own instruction text, which fixture(s) will validate the
 * result, or any grading internals — only observed evidence and, where
 * one exists, the escalated explanation of *why* the pattern is a
 * problem. That is deliberate; do not "helpfully" pass more context in.
 */
function buildPrompt(request: FixProposerRequest): string {
  const findings = request.recurringEvidence
    .map((f, i) => {
      const lines = [
        `Finding ${i + 1} (recurred in ${f.occurrences} runs):`,
        `Evidence:\n${f.evidenceExcerpts.map((e) => `  - ${e}`).join("\n")}`,
      ];
      if (f.explanation) lines.push(`Root-cause explanation: ${f.explanation}`);
      return lines.join("\n");
    })
    .join("\n\n");

  return [
    "You are proposing a MINIMAL edit to an AI agent's own instructions file, to address recurring",
    "inefficiencies or failures observed in real recorded runs of that agent. You are not fixing code and",
    "you are not fixing test fixtures — only the instructions text below.",
    "",
    `File: ${request.targetPath}`,
    "Current contents:",
    "```",
    request.currentText,
    "```",
    "",
    "Recurring findings from real recorded agent runs:",
    findings,
    "",
    "Propose the smallest edit to the file above that would plausibly address these findings, without",
    "removing any capability the agent currently has. Respond in exactly this format, nothing else:",
    "",
    "RATIONALE:",
    "<one paragraph explaining why this edit should help, referencing the findings above>",
    "",
    "DIFF:",
    "```diff",
    "<a unified diff against the current contents>",
    "```",
  ].join("\n");
}

function parseResponse(text: string): FixProposerResult {
  const rationaleMatch = /RATIONALE:\s*([\s\S]*?)\n\s*DIFF:/i.exec(text);
  const diffMatch = /```diff\s*([\s\S]*?)```/i.exec(text);

  if (!rationaleMatch || !diffMatch) {
    throw new FixProposerApiError(
      "AnthropicFixProposerEngine: response did not match the expected RATIONALE:/DIFF: format — refusing to guess a partial parse",
    );
  }

  return {
    rationale: rationaleMatch[1]!.trim(),
    diff: diffMatch[1]!.trim(),
  };
}
