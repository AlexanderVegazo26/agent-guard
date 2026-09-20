import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig, type PolicyConfig } from "./policy.js";

/**
 * PRD2 G0b — `agentguard.config.ts` was scaffolded by `init` but never
 * loaded by anything: `runner.ts`, `replay.ts`, `watch.ts` and the MCP
 * server all called `defineConfig()` bare, so every documented policy
 * field (uncertainty bands, fan-out caps, `ci.reviewAsFailure`, the
 * Score/Choice cut points) was unreachable by a real project's config
 * file. This is the loader every one of those call sites now goes
 * through instead.
 */

const CONFIG_FILENAMES = [
  "agentguard.config.ts",
  "agentguard.config.mts",
  "agentguard.config.mjs",
  "agentguard.config.js",
  "agentguard.config.cjs",
];

export interface LoadPolicyConfigOptions {
  cwd?: string;
  /** Explicit config file path (e.g. a `--config` flag), overriding the search below. */
  path?: string;
}

export interface LoadedPolicyConfig {
  policy: PolicyConfig;
  /** Absolute path of the config file that was loaded, or `null` when none was found and the built-in default applies. */
  configPath: string | null;
}

/**
 * Loads `agentguard.config.{ts,mts,mjs,js,cjs}` from `cwd` (default
 * `process.cwd()`), or an explicit `path`. Node 26 strips TypeScript types
 * natively, so a plain `export default defineConfig({...})` file loads
 * with no build step and no bundler.
 *
 * Falls back to `defineConfig()`'s built-in defaults when no config file
 * exists — `init` never requires a config file to exist for the CLI to
 * run, it only makes one available to edit.
 *
 * The loaded module's default export is re-passed through `defineConfig`
 * so TRD §10.2's Score/Choice required-field validation applies even to a
 * config authored without calling `defineConfig` directly, and so a
 * config missing those fields fails loudly here rather than silently
 * running with mismatched thresholds.
 */
export async function loadPolicyConfig(options: LoadPolicyConfigOptions = {}): Promise<LoadedPolicyConfig> {
  const cwd = options.cwd ?? process.cwd();
  const configPath = options.path ? path.resolve(cwd, options.path) : findConfigFile(cwd);

  if (!configPath) {
    return { policy: deepFreeze(defineConfig()), configPath: null };
  }
  if (!existsSync(configPath)) {
    throw new Error(`agentguard: config file not found at "${configPath}"`);
  }

  let mod: { default?: unknown };
  try {
    mod = (await import(pathToFileURL(configPath).href)) as { default?: unknown };
  } catch (err) {
    throw new Error(`agentguard: failed to load config "${configPath}" — ${err instanceof Error ? err.message : String(err)}`);
  }

  if (mod.default === undefined) {
    throw new Error(
      `agentguard: config file "${configPath}" has no default export (expected \`export default defineConfig({...})\`)`,
    );
  }

  return { policy: deepFreeze(defineConfig(mod.default as Partial<PolicyConfig>)), configPath };
}

/**
 * API-003 — the single documented opt-in default for `ANTHROPIC_API_KEY`.
 * `anthropicDecision.ts`, `anthropicEscalation.ts` and `anthropicFixProposer.ts`
 * each used to read `process.env.ANTHROPIC_API_KEY` directly at construction,
 * meaning the ambient-env fallback was duplicated across three execution-path
 * modules instead of living in one place. Those three modules now call this
 * function instead of touching `process.env` themselves, so there is exactly
 * one place in the codebase where that fallback is resolved.
 *
 * `explicit` (the caller-supplied `config.apiKey`) always wins; the env var
 * is consulted only when no explicit key was given, matching the previous
 * per-module behavior exactly.
 */
export function resolveAnthropicApiKey(explicit?: string): string | undefined {
  return explicit ?? process.env.ANTHROPIC_API_KEY;
}

function findConfigFile(cwd: string): string | null {
  for (const name of CONFIG_FILENAMES) {
    const candidate = path.join(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * API-005 — nothing stopped a caller from mutating the loaded policy after
 * the fact (e.g. `policy.uncertaintyBand[0] = 0`), silently invalidating
 * the Score/Choice thresholds `defineConfig` just validated. Freezes every
 * plain object and array reachable from `value`, recursively, so a mutation
 * attempt either throws (strict mode) or is a silent no-op — either way the
 * value itself never changes after this returns.
 *
 * Deliberately does not freeze non-plain objects (e.g. `RegExp`, class
 * instances) since `PolicyConfig` doesn't currently hold any and freezing
 * an arbitrary instance can break its own methods; if a future field adds
 * one, this walks past it unfrozen rather than corrupting it.
 */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item, seen);
  } else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key], seen);
    }
  }

  return Object.freeze(value);
}
