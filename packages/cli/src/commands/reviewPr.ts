import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import {
  claimedTestsExist,
  dependencyRisk,
  noSecretsInDiff,
  parseUnifiedDiff,
  testsAdded,
  testsPassed,
  type CodingVerdict,
  type TestRunSummary,
} from "@agent-guard/assertions";

const execFileAsync = promisify(execFile);

export interface ReviewPrCommandOptions {
  base: string;
  head: string;
  /** The agent's PR description/commit message — read as a claim to check, never as a source of truth (PRD2 F8). */
  description?: string;
  /** Path to a JSON file shaped like `TestRunSummary` ({ total, passed, failed }) — the test runner's own machine-readable output. */
  testResultsPath?: string;
  cwd?: string;
}

/**
 * PRD2 F8 — `agentguard review-pr`: the coding-agent vertical's
 * deterministic assertions, run against a REAL `git diff`. Grounded in
 * git and the test runner, never in the agent's own PR description
 * (F8's stated requirement) — the description is read only by
 * `claimedTestsExist`, and only as a claim to verify against the diff.
 *
 * `diffMatchesTask`, `noUnrelatedChanges`, and the semantic half of
 * `noSecretsInDiff` need a live decision engine and are not implemented
 * here — see `packages/assertions/src/codingVertical.ts`'s own doc
 * comment for the exact boundary.
 */
export async function runReviewPrCommand(options: ReviewPrCommandOptions): Promise<number> {
  let diffText: string;
  try {
    const { stdout } = await execFileAsync("git", ["diff", `${options.base}...${options.head}`], {
      cwd: options.cwd ?? process.cwd(),
      maxBuffer: 64 * 1024 * 1024,
    });
    diffText = stdout;
  } catch (err) {
    console.error(`agentguard review-pr: \`git diff\` failed — ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }

  const files = parseUnifiedDiff(diffText);
  if (files.length === 0) {
    console.log(`agentguard review-pr: no differences between "${options.base}" and "${options.head}".`);
    return 0;
  }

  let testRun: TestRunSummary | null = null;
  if (options.testResultsPath) {
    try {
      testRun = JSON.parse(await readFile(options.testResultsPath, "utf8")) as TestRunSummary;
    } catch (err) {
      console.error(
        `agentguard review-pr: could not read --test-results "${options.testResultsPath}" — ${err instanceof Error ? err.message : String(err)}`,
      );
      return 3;
    }
  }

  const verdicts: CodingVerdict[] = [
    testsAdded(files),
    testsPassed(testRun),
    claimedTestsExist(options.description ?? "", files),
    dependencyRisk(dependencyChangesFrom(files)),
    noSecretsInDiff(files),
  ];

  console.log(`agentguard review-pr — ${options.base}...${options.head} (${files.length} file(s) changed)\n`);
  for (const verdict of verdicts) {
    const icon = verdict.status === "pass" ? "✓" : verdict.status === "fail" ? "✗" : "?";
    console.log(`  ${icon} ${verdict.id.padEnd(20)} ${verdict.status}`);
    console.log(`      ${verdict.explanation}`);
  }

  const anyFail = verdicts.some((v) => v.status === "fail");
  const anyReview = verdicts.some((v) => v.status === "review");
  console.log(`\n  ${anyFail ? "FAIL" : anyReview ? "REVIEW" : "PASS"}`);

  return anyFail ? 1 : anyReview ? 2 : 0;
}

/**
 * A deliberately simple heuristic, not a real lockfile diff: a line added
 * to a `package.json`'s patch matching `"name": "version"` is treated as
 * a new dependency. Misses monorepo-nested manifests beyond the obvious
 * path, and can't distinguish "added" from "version bumped" perfectly —
 * stated here rather than silently accepted as exact.
 */
function dependencyChangesFrom(files: ReturnType<typeof parseUnifiedDiff>): Array<{ manifestPath: string; added: string[] }> {
  const manifestFiles = files.filter((f) => f.path.endsWith("package.json"));
  return manifestFiles.map((f) => {
    const added: string[] = [];
    for (const line of (f.patch ?? "").split("\n")) {
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const match = /^\+\s*"([^"]+)":\s*"[\^~]?[\d]/.exec(line);
      if (match?.[1] && match[1] !== "name" && match[1] !== "version") added.push(match[1]);
    }
    return { manifestPath: f.path, added };
  });
}
