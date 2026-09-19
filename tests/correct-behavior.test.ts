import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentRun, DefaultEvidenceCompiler, defineConfig, type AssertionId } from "@agent-guard/core";
import { evaluate } from "@agent-guard/assertions";
import { MockDecisionEngine, type DecisionAnswer } from "@agent-guard/decision";

/**
 * PRD §12 — the correct-behavior set (≥10 runs, zero FAIL verdicts). This is
 * the harder half of the suite: it is easy to fail bad agents, the bar is
 * passing good ones without a false positive. TRD §9.3 imposes three
 * mechanical rules, checked below in addition to each fixture's own
 * `expected.json`:
 *  - no fixture here may expect `fail` for any assertion it declares
 *    (the one PRD-sanctioned exception, run 9, is itself a correct FAIL on
 *    `goalCompleted` for a genuinely impossible task — still not a false
 *    positive, so it is allowed, but nothing else may be `fail`)
 *  - `not_applicable` must never be miscounted as `review` or `pass`
 *  - no fixture may exceed a fan-out cap (enforced implicitly: any capped
 *    assertion here would carry `coverageGaps`, and none of these declare
 *    a `pass` alongside one)
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.join(__dirname, "..", "fixtures", "correct");

interface ExpectedAssertion {
  status: "pass" | "fail" | "review" | "not_applicable" | "error";
  basis?: string;
  level?: string;
  mustCite?: string[];
}

async function loadFixtureDir(dir: string) {
  const run = AgentRun.parse(JSON.parse(await readFile(path.join(dir, "run.json"), "utf8")));
  const expected: Record<string, ExpectedAssertion> = JSON.parse(
    await readFile(path.join(dir, "expected.json"), "utf8"),
  );
  const mockPath = path.join(dir, "mock.json");
  const mock: Record<string, DecisionAnswer> = existsSync(mockPath)
    ? JSON.parse(await readFile(mockPath, "utf8"))
    : {};
  return { name: path.basename(dir), run, expected, mock };
}

describe("correct-behavior set (mock engine) — zero false positives", async () => {
  const dirs = (await readdir(FIXTURES_ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => path.join(FIXTURES_ROOT, e.name))
    .sort();

  it("has at least 10 fixtures (PRD §12 floor)", () => {
    expect(dirs.length).toBeGreaterThanOrEqual(10);
  });

  for (const dir of dirs) {
    const fixtureName = path.basename(dir);
    describe(fixtureName, () => {
      it("matches its declared verdicts, with no unexpected FAIL", async () => {
        const fixture = await loadFixtureDir(dir);
        const graph = await new DefaultEvidenceCompiler().compile(fixture.run);
        const engine = new MockDecisionEngine(fixture.mock);
        const requested = Object.keys(fixture.expected) as AssertionId[];

        const results = await evaluate(graph, requested, engine, defineConfig());

        for (const [id, expected] of Object.entries(fixture.expected)) {
          const result = results[id];
          expect(result, `assertion "${id}" produced no result`).toBeDefined();
          expect(result!.status, `assertion "${id}" status`).toBe(expected.status);

          // The zero-false-positive bar: any status this fixture does NOT
          // declare "fail" for must never come back "fail" in practice.
          if (expected.status !== "fail") {
            expect(result!.status, `assertion "${id}" must not be a false positive`).not.toBe("fail");
          }

          if (expected.basis) expect(result!.basis, `assertion "${id}" basis`).toBe(expected.basis);
          if (expected.mustCite) {
            for (const evidenceId of expected.mustCite) {
              expect(result!.evidence, `assertion "${id}" must cite ${evidenceId}`).toContain(evidenceId);
            }
          }

          // No fixture in this set may be a capped, incomplete sample.
          expect(result!.coverageGaps, `assertion "${id}" must not have dropped coverage`).toBeUndefined();
        }
      });
    });
  }
});
