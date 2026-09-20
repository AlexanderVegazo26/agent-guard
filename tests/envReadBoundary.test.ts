import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * API-003 — before this fix, `anthropicDecision.ts`, `anthropicEscalation.ts`
 * and `anthropicFixProposer.ts` each read `process.env.ANTHROPIC_API_KEY`
 * directly at construction. They now call `resolveAnthropicApiKey` from
 * `@alexvegman/core`'s `configLoader.ts` — the one place that fallback is
 * resolved — instead. The construction-level tests in
 * `anthropicEscalation.test.ts` / `anthropicFixProposer.test.ts` /
 * `anthropicDecision.test.ts` assert the *behavior* (explicit apiKey wins,
 * env var is a fallback, neither throws by name), but that behavior is
 * identical whether the module reads `process.env` itself or delegates to
 * `resolveAnthropicApiKey` — so on its own it cannot fail for the actual
 * defect this finding describes (ambient env access duplicated across
 * execution-path modules). This is the check that can: it greps the
 * source directly, the same mechanism `docIntegrity.test.ts` already uses
 * in this repo for a source-level regression gate.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const EXECUTION_PATH_MODULES = [
  "packages/decision/src/anthropicDecision.ts",
  "packages/decision/src/anthropicEscalation.ts",
  "packages/decision/src/anthropicFixProposer.ts",
  "packages/core/src/observability.ts",
];

describe("API-003 — execution-path modules do not read process.env directly", () => {
  it.each(EXECUTION_PATH_MODULES)("%s has no direct process.env reference", async (relPath) => {
    const content = await readFile(path.join(REPO_ROOT, relPath), "utf8");
    expect(content).not.toMatch(/process\.env/);
  });

  it("resolveAnthropicApiKey is the one place ANTHROPIC_API_KEY's ambient fallback is read", async () => {
    const content = await readFile(path.join(REPO_ROOT, "packages/core/src/configLoader.ts"), "utf8");
    expect(content).toMatch(/process\.env\.ANTHROPIC_API_KEY/);
  });

  it("resolveOtlpEndpoint is the one place OTEL_EXPORTER_OTLP_ENDPOINT's ambient fallback is read", async () => {
    const content = await readFile(path.join(REPO_ROOT, "packages/core/src/configLoader.ts"), "utf8");
    expect(content).toMatch(/process\.env\.OTEL_EXPORTER_OTLP_ENDPOINT/);
  });
});
