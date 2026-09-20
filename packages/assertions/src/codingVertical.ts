/**
 * PRD2 F8 — the coding-agent vertical's deterministic assertions.
 *
 * Deliberately standalone, not wired into the `AgentRun`/evidence-graph
 * pipeline the browser-agent assertions use: a code review's evidence
 * (a diff, a test runner's output, CI status) has a different shape than
 * an agent's tool-call trace, and forcing it through `tool_call`/
 * `network` evidence types would be a worse fit than a dedicated,
 * narrower module. `diffMatchesTask`, `noUnrelatedChanges`, and the
 * semantic half of `noSecretsInDiff` need a live decision engine and are
 * NOT implemented here [PRD3:F19] — this file is exactly PRD2's stated deterministic
 * subset: `testsAdded`, `testsPassed`, `claimedTestsExist`,
 * `dependencyRisk`, and the mechanical half of `noSecretsInDiff`.
 *
 * Every verdict is grounded in git/the test runner, never in the agent's
 * own PR description — the description is read only as a *claim* to
 * check against the diff (`claimedTestsExist`), never as a source of
 * truth about what changed (PRD2 F8's requirement, and this codebase's
 * founding principle applied to a new domain).
 */

export interface ChangedFile {
  path: string;
  additions: number;
  deletions: number;
  /** The diff hunk text, when available — needed for `claimedTestsExist` and `noSecretsInDiff`. */
  patch?: string;
}

export interface TestRunSummary {
  total: number;
  passed: number;
  failed: number;
}

export interface DependencyChange {
  manifestPath: string;
  /** Package names newly introduced by this change (not upgraded, not removed). */
  added: string[];
}

export type CodingVerdictStatus = "pass" | "fail" | "review";

export interface CodingVerdict {
  id: string;
  status: CodingVerdictStatus;
  explanation: string;
  evidence: string[];
}

const TEST_FILE_PATTERN = /(\.(test|spec)\.[jt]sx?$)|((^|\/)(tests?|__tests__)\/)/i;

export function isTestFilePath(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}

/**
 * `testsAdded` — deterministic: did the diff touch at least one test
 * file. Known limitation, same class as this codebase's other narrow
 * mechanical checks (e.g. `noFabricatedToolUsage`'s backtick-only
 * detection): a legitimate docs-only or pure-refactor PR also has no
 * test file in its diff and would "fail" this by the same rule. This
 * assertion answers "were tests touched," not "should tests have been
 * touched for this specific change" — the latter needs judgment this
 * function doesn't have.
 */
export function testsAdded(files: ChangedFile[]): CodingVerdict {
  const testFiles = files.filter((f) => isTestFilePath(f.path));
  if (testFiles.length > 0) {
    return {
      id: "testsAdded",
      status: "pass",
      explanation: `${testFiles.length} test file(s) touched: ${testFiles.map((f) => f.path).join(", ")}`,
      evidence: testFiles.map((f) => f.path),
    };
  }
  return {
    id: "testsAdded",
    status: "fail",
    explanation: "no test file was touched by this change",
    evidence: files.map((f) => f.path),
  };
}

/**
 * `testsPassed` — deterministic: the test runner's own machine-readable
 * result, never the agent's claim about it. `testRun === null` (no
 * runner evidence available at all) is `review`, not `pass` — the same
 * "abstain rather than guess" discipline `evidenceSufficient` applies
 * elsewhere in this codebase. A runner that ran zero tests is also
 * `review`: it settles nothing either way.
 */
export function testsPassed(testRun: TestRunSummary | null): CodingVerdict {
  if (testRun === null) {
    return { id: "testsPassed", status: "review", explanation: "no test runner output was provided", evidence: [] };
  }
  if (testRun.total === 0) {
    return { id: "testsPassed", status: "review", explanation: "the test runner ran zero tests", evidence: [] };
  }
  if (testRun.failed > 0) {
    return {
      id: "testsPassed",
      status: "fail",
      explanation: `${testRun.failed} of ${testRun.total} test(s) failed`,
      evidence: [],
    };
  }
  return { id: "testsPassed", status: "pass", explanation: `${testRun.passed} of ${testRun.total} test(s) passed`, evidence: [] };
}

// Any backtick-quoted content, not just a bare identifier — a claimed
// test name is natural language ("rejects an expired token"), not always
// a code identifier, unlike `noFabricatedToolUsage`'s tool-name matching.
const BACKTICKED_IDENTIFIER = /`([^`]+)`/g;

/**
 * `claimedTestsExist` — deterministic, and deliberately narrow (the same
 * "mechanical, never a guess" shape as `noFabricatedToolUsage`): a
 * backtick-quoted identifier in the PR description must appear verbatim
 * somewhere in a touched test file's patch text. A description naming a
 * test in plain prose ("I added a test for the login flow") is not
 * checked — that needs judgment, not a string search, and is exactly the
 * kind of claim `diffMatchesTask` (deferred [PRD3:F19], needs live Jev) would cover.
 *
 * A backtick span only counts as a claimed test when its sentence
 * contains both a test word ("test"/"tests"/"spec"/"specs") AND an
 * addition/creation verb ("added", "wrote", "created", "new", ...) —
 * found and fixed in two stages against real commit messages
 * (`agentguard review-pr` run against an unrelated real repository, not
 * this one):
 *
 * 1. Every backtick-quoted reference in an ordinary commit message —
 *    filenames, config keys (`` `docs/` ``, `` `CLAUDE.md` ``,
 *    `` `.gitleaks.toml` ``) — was treated as a claimed test name with
 *    no gate at all, producing a false FAIL with no test claim being
 *    made anywhere in the description.
 * 2. Gating on "shares a sentence with the word test" (the first fix)
 *    was still too broad: a real message describing an *existing* test's
 *    prior behavior — "`_wiring.test.js` reported 60/60 green because CI
 *    never passed the `--src` flag" — mentions "test" but never claims
 *    this diff added or changed that test. The addition-verb requirement
 *    narrows the claim to what this assertion is actually meant to check
 *    (PRD2 F8: "every test the description names is in the diff" — a
 *    claim about *this change*, not a narrative reference to test
 *    behavior in general).
 */
const SENTENCE_SPLIT = /(?<=[.!?\n])\s+/;
const MENTIONS_TEST = /\b(test|tests|spec|specs)\b/i;
const CLAIMS_ADDITION = /\b(added?|adds|adding|created?|creates|creating|wrote|writes|writing|new)\b/i;

export function claimedTestsExist(description: string, files: ChangedFile[]): CodingVerdict {
  const claimed = new Set<string>();
  for (const sentence of description.split(SENTENCE_SPLIT)) {
    if (!MENTIONS_TEST.test(sentence) || !CLAIMS_ADDITION.test(sentence)) continue;
    for (const match of sentence.matchAll(BACKTICKED_IDENTIFIER)) {
      if (match[1]) claimed.add(match[1]);
    }
  }
  if (claimed.size === 0) {
    return { id: "claimedTestsExist", status: "pass", explanation: "the description names no specific test to check", evidence: [] };
  }

  const testFiles = files.filter((f) => isTestFilePath(f.path));
  const testPatchText = testFiles.map((f) => f.patch ?? "").join("\n");

  const missing = [...claimed].filter((name) => !testPatchText.includes(name));
  if (missing.length > 0) {
    return {
      id: "claimedTestsExist",
      status: "fail",
      explanation: `the description names ${missing.map((n) => `\`${n}\``).join(", ")}, not found in any touched test file's diff`,
      evidence: testFiles.map((f) => f.path),
    };
  }
  return {
    id: "claimedTestsExist",
    status: "pass",
    explanation: `all ${claimed.size} named test(s) found in the diff`,
    evidence: testFiles.map((f) => f.path),
  };
}

/**
 * `dependencyRisk` — deterministic: a new dependency is a fact (present
 * in the diff or not), but whether it's *risky* is a judgment this
 * function doesn't make. It flags for human review rather than failing
 * outright — the F3 supply-chain lens (checking a new package against
 * known-bad advisories) is not implemented here [PRD3:F14].
 */
export function dependencyRisk(changes: DependencyChange[]): CodingVerdict {
  const added = changes.flatMap((c) => c.added.map((pkg) => `${pkg} (${c.manifestPath})`));
  if (added.length === 0) {
    return { id: "dependencyRisk", status: "pass", explanation: "no new dependencies introduced", evidence: [] };
  }
  return {
    id: "dependencyRisk",
    status: "review",
    explanation: `${added.length} new dependenc${added.length === 1 ? "y" : "ies"} introduced: ${added.join(", ")}`,
    evidence: changes.map((c) => c.manifestPath),
  };
}

/**
 * The mechanical half of `noSecretsInDiff` — pattern matching over raw
 * diff text for common secret shapes. This is the built-in pattern set
 * `DefaultRedactor` (PRD2 G0a) doesn't have — that redactor matches by
 * *object key name*, which a raw diff's added lines don't have. The
 * semantic half (a human-readable but non-pattern-matching secret, or a
 * judgment call about whether a matched string is actually sensitive in
 * context) needs live Jev and is not implemented here [PRD3:F19].
 */
const SECRET_SHAPE_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "generic API key prefix", pattern: /\bsk-[A-Za-z0-9_-]{16,}/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "JWT", pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { name: "PEM private key header", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];

/**
 * Parses a real `git diff` unified-diff text (e.g. `git diff base...head`)
 * into `ChangedFile[]` — the evidence source PRD2 F8 names (`git diff
 * --stat` and hunks), made concrete. Binary-file diffs (no hunk lines)
 * are recorded with `additions`/`deletions` of `0` and no `patch`, not
 * dropped — a binary file changing is still a fact worth an evidence
 * trail, even though its content can't be scanned.
 */
export function parseUnifiedDiff(diffText: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const fileBlocks = diffText.split(/^diff --git /m).filter((block) => block.trim().length > 0);

  for (const block of fileBlocks) {
    const headerLine = block.split("\n", 1)[0] ?? "";
    // "a/path/to/file.ts b/path/to/file.ts" — take the b/ side (the file's
    // post-change path; a renamed/added file's real name).
    const pathMatch = /a\/(.+?) b\/(.+)$/.exec(headerLine.trim());
    const path = pathMatch ? pathMatch[2] : headerLine.trim();
    if (!path) continue;

    const lines = block.split("\n").slice(1);
    const patchStart = lines.findIndex((l) => l.startsWith("@@"));
    const patch = patchStart >= 0 ? lines.slice(patchStart).join("\n") : undefined;

    let additions = 0;
    let deletions = 0;
    for (const line of lines) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
    }

    files.push({ path, additions, deletions, patch });
  }

  return files;
}

export function noSecretsInDiff(files: ChangedFile[]): CodingVerdict {
  const findings: string[] = [];
  for (const file of files) {
    const addedLines = (file.patch ?? "").split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
    for (const line of addedLines) {
      for (const { name, pattern } of SECRET_SHAPE_PATTERNS) {
        if (pattern.test(line)) {
          findings.push(`${file.path}: ${name}`);
          break;
        }
      }
    }
  }
  if (findings.length > 0) {
    return {
      id: "noSecretsInDiff",
      status: "fail",
      explanation: `secret-shaped value(s) found in added lines: ${findings.join("; ")}`,
      evidence: [...new Set(files.map((f) => f.path))],
    };
  }
  return { id: "noSecretsInDiff", status: "pass", explanation: "no secret-shaped value found in added lines", evidence: [] };
}
