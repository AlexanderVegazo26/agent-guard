import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AgentRun, DefaultEvidenceCompiler, defineConfig, type AssertionId } from "@agent-guard/core";
import { evaluate } from "@agent-guard/assertions";
import { MockDecisionEngine, type DecisionAnswer } from "@agent-guard/decision";

/**
 * TRD §9.2 — the golden suite, run against `MockDecisionEngine`. Only three
 * of the PRD's fifteen MVP-scope fixtures are authored in this build
 * (01, 02, 11) — see the top-level project notes for what's still missing.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = path.join(__dirname, "..", "fixtures", "golden");

interface ExpectedAssertion {
  status: "pass" | "fail" | "review" | "not_applicable" | "error";
  basis?: string;
  level?: string;
  mustCite?: string[];
  reviewVia?: string;
  missing?: string[];
}

interface CoverageNote {
  tests: string;
  namedModeRequires: string;
  closedBy: string;
  acceptedForMvp: string;
}

/** Not an assertion id — PRD §12's branch-(b) coverage declaration. */
const COVERAGE_NOTE_KEY = "coverageNote";

const SCORE_LEVELS = ["ignored", "detected", "detected-and-reported", "detected-and-recovered"];

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

function scoreLevelOf(probabilities: Record<string, number> | undefined): string | undefined {
  if (!probabilities) return undefined;
  let bestIndex = "";
  let bestP = -1;
  for (const [k, p] of Object.entries(probabilities)) {
    if (p > bestP) {
      bestP = p;
      bestIndex = k;
    }
  }
  const idx = Number(bestIndex);
  return Number.isInteger(idx) ? SCORE_LEVELS[idx] : undefined;
}

describe("golden suite (mock engine)", async () => {
  const dirs = (await readdir(FIXTURES_ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => path.join(FIXTURES_ROOT, e.name))
    .sort();

  for (const dir of dirs) {
    describe(path.basename(dir), () => {
      it("produces every expected per-assertion verdict, citing the right evidence", async () => {
        const fixture = await loadFixtureDir(dir);
        const graph = await new DefaultEvidenceCompiler().compile(fixture.run);
        const engine = new MockDecisionEngine(fixture.mock);
        const requested = Object.keys(fixture.expected).filter((k) => k !== COVERAGE_NOTE_KEY) as AssertionId[];

        const results = await evaluate(graph, requested, engine, defineConfig());

        const coverageNote = (fixture.expected as Record<string, unknown>)[COVERAGE_NOTE_KEY] as
          | CoverageNote
          | undefined;
        if (coverageNote) {
          // TRD §9.1 / PRD §12 — a branch-(b) fixture's concession must be
          // machine-readable, not just a README paragraph.
          for (const field of ["tests", "namedModeRequires", "closedBy", "acceptedForMvp"] as const) {
            expect(coverageNote[field], `coverageNote.${field}`).toBeTruthy();
          }
        }

        for (const [id, expected] of Object.entries(fixture.expected)) {
          if (id === COVERAGE_NOTE_KEY) continue;
          const result = results[id];
          expect(result, `assertion "${id}" produced no result`).toBeDefined();
          expect(result!.status, `assertion "${id}" status`).toBe(expected.status);

          if (expected.basis) {
            expect(result!.basis, `assertion "${id}" basis`).toBe(expected.basis);
          }

          if (expected.level) {
            expect(scoreLevelOf(result!.probabilities), `assertion "${id}" score level`).toBe(expected.level);
          }

          if (expected.mustCite) {
            for (const evidenceId of expected.mustCite) {
              expect(result!.evidence, `assertion "${id}" must cite ${evidenceId}`).toContain(evidenceId);
            }
          }

          if (expected.reviewVia) {
            expect(result!.reviewVia, `assertion "${id}" reviewVia`).toBe(expected.reviewVia);
          }

          if (expected.missing) {
            expect(result!.missing, `assertion "${id}" missing`).toEqual(expected.missing);
          }
        }
      });
    });
  }
});
