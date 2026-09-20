import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PKG-010 — incident response needs to be able to ask "what version of
 * AgentGuard, at what commit, is actually running" without guessing from
 * install date. `version` comes from this package's own `package.json`
 * (single source of truth — never hand-duplicated); `commit` comes from
 * `AGENTGUARD_BUILD_COMMIT` when set.
 *
 * Deliberately the simple, honest option rather than a build-time
 * injection step: this package ships as plain compiled JS with no bundler
 * and no code-generation step in `bun run build` (`tsc -b` only), so
 * baking a commit SHA into the emitted `.js` would mean adding a
 * pre-build step burrowing into `dist/` after `tsc` runs, which is more
 * moving parts than a value this cheap to read at runtime justifies.
 * A CI/release workflow that publishes a package is expected to set
 * `AGENTGUARD_BUILD_COMMIT` (e.g. from `GITHUB_SHA`, or `git rev-parse
 * HEAD` locally) in the environment the process runs in — not at build
 * time, at run time — so a published package's `commit` reflects what a
 * human sets when they run it, not something frozen into the tarball.
 * Local dev with no env var set gets `"unknown"`, not a fabricated value.
 */
export interface BuildInfo {
  /** The reporting package's own version, read from its `package.json` — never hand-duplicated. */
  version: string;
  /** Git commit SHA the running process was built/deployed from, or `"unknown"` when `AGENTGUARD_BUILD_COMMIT` is unset (e.g. local dev). */
  commit: string;
}

function readPackageVersion(packageJsonPath: string): string {
  const raw = readFileSync(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  if (!parsed.version) {
    throw new Error(`buildInfo: "${packageJsonPath}" has no "version" field`);
  }
  return parsed.version;
}

/**
 * `moduleUrl` must be the caller's own `import.meta.url` — this reads
 * *that* module's package, not `@alexvegman/core`'s. Every package
 * reporting its own build info (the CLI's `--version`, for instance) needs
 * its own version, not core's, so this deliberately doesn't default to a
 * fixed relative path.
 */
export function getBuildInfo(moduleUrl: string): BuildInfo {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  // Resolves correctly both from source (packages/<pkg>/src/) and from the
  // compiled output (packages/<pkg>/dist/), since package.json sits one
  // level up from either.
  const packageJsonPath = path.join(moduleDir, "..", "package.json");
  return {
    version: readPackageVersion(packageJsonPath),
    commit: process.env.AGENTGUARD_BUILD_COMMIT ?? "unknown",
  };
}
