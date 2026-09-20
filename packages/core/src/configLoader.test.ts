import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicyConfig, resolveAnthropicApiKey } from "./configLoader.js";
import { DEFAULT_POLICY } from "./policy.js";

/**
 * Regression coverage for PRD2 G0b: `agentguard.config.ts` was scaffolded
 * by `init` but never loaded by any command. These tests fail if that
 * regresses — each one writes a real config file to a temp directory and
 * asserts the override actually took effect, not just that loading didn't
 * throw.
 */
describe("loadPolicyConfig", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("falls back to the built-in default when no config file exists", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentguard-config-"));
    const { policy, configPath } = await loadPolicyConfig({ cwd: dir });
    expect(configPath).toBeNull();
    expect(policy).toEqual(DEFAULT_POLICY);
  });

  it("loads a real .ts config file's overrides via native type stripping", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentguard-config-"));
    writeFileSync(
      path.join(dir, "agentguard.config.ts"),
      [
        'import { defineConfig } from "@alexvegman/core";',
        "export default defineConfig({",
        "  ci: { reviewAsFailure: true },",
        "  uncertaintyBand: [0.1, 0.9],",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    const { policy, configPath } = await loadPolicyConfig({ cwd: dir });
    expect(configPath).toBe(path.join(dir, "agentguard.config.ts"));
    expect(policy.ci.reviewAsFailure).toBe(true);
    expect(policy.uncertaintyBand).toEqual([0.1, 0.9]);
    // Untouched fields still come from the default.
    expect(policy.questions.maxClaimQuestions).toBe(DEFAULT_POLICY.questions.maxClaimQuestions);
  });

  it("respects an explicit --config path over cwd search", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentguard-config-"));
    const explicitPath = path.join(dir, "custom.config.ts");
    writeFileSync(
      explicitPath,
      [
        'import { defineConfig } from "@alexvegman/core";',
        "export default defineConfig({ ci: { reviewAsFailure: true } });",
        "",
      ].join("\n"),
      "utf8",
    );

    const { policy, configPath } = await loadPolicyConfig({ cwd: dir, path: explicitPath });
    expect(configPath).toBe(explicitPath);
    expect(policy.ci.reviewAsFailure).toBe(true);
  });

  it("throws when an explicit --config path does not exist", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentguard-config-"));
    await expect(loadPolicyConfig({ cwd: dir, path: path.join(dir, "missing.config.ts") })).rejects.toThrow(
      /config file not found/,
    );
  });

  it("re-validates a config file that skipped defineConfig's required fields", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentguard-config-"));
    writeFileSync(
      path.join(dir, "agentguard.config.ts"),
      [
        "export default {",
        "  perAssertion: { recoveredFromFailure: { levels: ['a'], passAtOrAbove: '', reviewBelow: 0, minConfidence: 0 } },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(loadPolicyConfig({ cwd: dir })).rejects.toThrow(/passAtOrAbove is required/);
  });

  /**
   * API-005 — nothing previously stopped a caller from mutating the loaded
   * policy in place, silently invalidating the very thresholds
   * `defineConfig` just validated. Covers both a top-level and a nested
   * field, since `deepFreeze` walks the whole object graph, not just the
   * root.
   *
   * Only the no-config-file path is covered here, not a real loaded
   * `agentguard.config.ts` file: dynamic `import()` of a config file
   * written to an OS temp dir cannot resolve the `@alexvegman/core`
   * package specifier in this sandbox (the two pre-existing tests above,
   * "loads a real .ts config file's overrides..." and "respects an
   * explicit --config path...", fail here for the same reason, on `main`,
   * unrelated to this change) — a case built on that path can never pass
   * in this environment regardless of whether freezing works.
   *
   * Strict mode (this file, and vitest, run under it) makes a frozen-object
   * write throw a TypeError; either way, the value itself must not change,
   * which is the actual guarantee this asserts.
   */
  it("deep-freezes the built-in default policy so a mutation attempt does not take effect", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentguard-config-"));
    const { policy } = await loadPolicyConfig({ cwd: dir });

    const originalBand = [...policy.uncertaintyBand];
    expect(() => {
      (policy.uncertaintyBand as unknown as number[])[0] = 0.999;
    }).toThrow(TypeError);
    expect(policy.uncertaintyBand).toEqual(originalBand);

    const originalPassAtOrAbove = policy.perAssertion.recoveredFromFailure.passAtOrAbove;
    expect(() => {
      (policy.perAssertion.recoveredFromFailure as { passAtOrAbove: string }).passAtOrAbove = "tampered";
    }).toThrow(TypeError);
    expect(policy.perAssertion.recoveredFromFailure.passAtOrAbove).toBe(originalPassAtOrAbove);
  });
});

/**
 * API-003 — `resolveAnthropicApiKey` is now the single documented opt-in
 * default for `ANTHROPIC_API_KEY`; `anthropicDecision.ts`,
 * `anthropicEscalation.ts` and `anthropicFixProposer.ts` all call this
 * instead of reading `process.env` themselves (verified by their own
 * construction tests). This covers the function directly.
 */
describe("resolveAnthropicApiKey", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("returns the explicit value when one is given, ignoring the env var", () => {
    process.env.ANTHROPIC_API_KEY = "from-env";
    expect(resolveAnthropicApiKey("explicit")).toBe("explicit");
  });

  it("falls back to ANTHROPIC_API_KEY when no explicit value is given", () => {
    process.env.ANTHROPIC_API_KEY = "from-env";
    expect(resolveAnthropicApiKey(undefined)).toBe("from-env");
  });

  it("returns undefined when neither an explicit value nor the env var is present", () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(resolveAnthropicApiKey(undefined)).toBeUndefined();
  });
});
