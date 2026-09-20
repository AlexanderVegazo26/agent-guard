import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadPolicyConfig } from "./configLoader.js";
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
});
