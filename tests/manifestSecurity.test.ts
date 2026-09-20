import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression coverage for two security-review findings against the
 * manifests themselves (SUP-004, SUP-006). Reads the real package.json
 * files from disk rather than re-deriving expectations, so a future
 * regression (an unused dep creeping back in, a range replacing a pin) is
 * caught here rather than only on the next manual `depcheck`/grep pass.
 */

const root = path.resolve(__dirname, "..");

function readJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, relPath), "utf8")) as Record<string, unknown>;
}

describe("SUP-004 — unused dependencies removed from the root manifest", () => {
  const pkg = readJson("package.json");
  const deps = (pkg.dependencies as Record<string, string> | undefined) ?? {};
  const devDeps = (pkg.devDependencies as Record<string, string> | undefined) ?? {};

  it("no longer declares @typesafe-ai/sdk at the root (depcheck: unused; only packages/decision uses it)", () => {
    expect(deps["@typesafe-ai/sdk"]).toBeUndefined();
  });

  it("no longer declares @alexvegman/reporters as a root devDependency (depcheck: unused)", () => {
    expect(devDeps["@alexvegman/reporters"]).toBeUndefined();
  });

  it("no longer declares @alexvegman/mutations as a root devDependency (depcheck: unused)", () => {
    expect(devDeps["@alexvegman/mutations"]).toBeUndefined();
  });
});

describe("SUP-006 — security-path dependencies are pinned to exact versions", () => {
  /** No `^`, `~`, `*`, `x`/`X` range markers, and no workspace/tag protocol — an exact semver string. */
  const EXACT_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

  const zodConsumers = ["packages/core/package.json", "packages/mcp/package.json", "packages/mutations/package.json", "packages/reporters/package.json"];

  it.each(zodConsumers)("%s pins zod to an exact version", (relPath) => {
    const pkg = readJson(relPath);
    const version = (pkg.dependencies as Record<string, string>).zod;
    expect(version).toBeDefined();
    expect(version).toMatch(EXACT_VERSION);
  });

  it("packages/core pins every @opentelemetry/* dependency to an exact version", () => {
    const pkg = readJson("packages/core/package.json");
    const deps = pkg.dependencies as Record<string, string>;
    const otelDeps = Object.entries(deps).filter(([name]) => name.startsWith("@opentelemetry/"));
    expect(otelDeps.length).toBeGreaterThan(0);
    for (const [name, version] of otelDeps) {
      expect(version, `${name} should be pinned exact, got "${version}"`).toMatch(EXACT_VERSION);
    }
  });

  it("packages/decision pins @typesafe-ai/sdk to an exact version (no more 0.6.x range)", () => {
    const pkg = readJson("packages/decision/package.json");
    const version = (pkg.dependencies as Record<string, string>)["@typesafe-ai/sdk"];
    expect(version).toBeDefined();
    expect(version).toMatch(EXACT_VERSION);
  });
});
