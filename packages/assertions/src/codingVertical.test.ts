import { describe, expect, it } from "vitest";
import {
  claimedTestsExist,
  dependencyRisk,
  isTestFilePath,
  noSecretsInDiff,
  testsAdded,
  testsPassed,
  type ChangedFile,
} from "./codingVertical.js";

describe("isTestFilePath", () => {
  it("recognizes common test file naming conventions", () => {
    expect(isTestFilePath("src/foo.test.ts")).toBe(true);
    expect(isTestFilePath("src/foo.spec.tsx")).toBe(true);
    expect(isTestFilePath("tests/foo.ts")).toBe(true);
    expect(isTestFilePath("src/__tests__/foo.ts")).toBe(true);
  });

  it("does not flag an ordinary source file", () => {
    expect(isTestFilePath("src/foo.ts")).toBe(false);
    expect(isTestFilePath("src/testUtils.ts")).toBe(false); // "test" substring, not the convention
  });
});

describe("testsAdded", () => {
  it("passes when at least one test file was touched", () => {
    const files: ChangedFile[] = [{ path: "src/foo.ts", additions: 3, deletions: 0 }, { path: "src/foo.test.ts", additions: 10, deletions: 0 }];
    const result = testsAdded(files);
    expect(result.status).toBe("pass");
    expect(result.evidence).toEqual(["src/foo.test.ts"]);
  });

  it("fails when no test file was touched", () => {
    const files: ChangedFile[] = [{ path: "src/foo.ts", additions: 3, deletions: 0 }];
    expect(testsAdded(files).status).toBe("fail");
  });
});

describe("testsPassed", () => {
  it("passes when every test passed", () => {
    expect(testsPassed({ total: 5, passed: 5, failed: 0 }).status).toBe("pass");
  });

  it("fails when any test failed", () => {
    const result = testsPassed({ total: 5, passed: 4, failed: 1 });
    expect(result.status).toBe("fail");
    expect(result.explanation).toContain("1 of 5");
  });

  it("abstains (review) rather than guessing when there is no runner output at all", () => {
    expect(testsPassed(null).status).toBe("review");
  });

  it("abstains (review) when the runner ran zero tests — settles nothing", () => {
    expect(testsPassed({ total: 0, passed: 0, failed: 0 }).status).toBe("review");
  });
});

describe("claimedTestsExist", () => {
  it("passes when the description names no specific test", () => {
    const result = claimedTestsExist("Fixed a bug in the login flow.", []);
    expect(result.status).toBe("pass");
  });

  it("passes when a named test genuinely appears in a touched test file's patch", () => {
    const files: ChangedFile[] = [{ path: "src/login.test.ts", additions: 5, deletions: 0, patch: "+it('rejects an expired token', () => { ... })" }];
    const result = claimedTestsExist("Added a test named `rejects an expired token` to cover this.", files);
    expect(result.status).toBe("pass");
  });

  it("fails when a named test never appears in any touched test file", () => {
    const files: ChangedFile[] = [{ path: "src/login.test.ts", additions: 5, deletions: 0, patch: "+it('something else', () => {})" }];
    const result = claimedTestsExist("Added a test named `rejects an expired token` to cover this.", files);
    expect(result.status).toBe("fail");
    expect(result.explanation).toContain("rejects an expired token");
  });

  it("fails when the description names a test but no test file was touched at all", () => {
    const result = claimedTestsExist("Added a test called `some_test_name` for this.", [{ path: "src/login.ts", additions: 1, deletions: 0 }]);
    expect(result.status).toBe("fail");
  });

  it("PRD2 review fix: does not treat an ordinary backtick-quoted filename/config key as a claimed test, when the sentence never mentions testing", () => {
    // Captured from a real commit message in an unrelated real repository
    // (found via `agentguard review-pr` against it) — this used to
    // produce a false FAIL with no test claim being made at all.
    const description = [
      "fix: redact the review documents, and narrow the allowlist that excused them",
      "",
      "`docs/` was untracked on `main`, so this branch is what publishes it.",
      "`.gitleaks.toml` allowlisted the whole document from every identifier rule.",
      "`CLAUDE.md` explains why it is excluded.",
    ].join("\n");
    const result = claimedTestsExist(description, [{ path: "src/redact.ts", additions: 3, deletions: 1 }]);
    expect(result.status).toBe("pass");
  });

  it("PRD2 review fix (round 2): does not treat a narrative reference to an EXISTING test's prior behavior as a claim about this diff", () => {
    // Captured from the same real repository's commit history: this
    // sentence mentions "test" and backtick-quotes a real test file, but
    // is describing a pre-existing bug in that test's CI wiring, not
    // claiming this diff added or changed it.
    const description =
      "`_wiring.test.js` reported 60/60 green because CI never passed the `--src` flag the test itself provides.";
    const result = claimedTestsExist(description, [{ path: "sdlc-suite/workflows/_brief.test.js", additions: 1, deletions: 0 }]);
    expect(result.status).toBe("pass");
  });

  it("still catches a genuine test claim even when an earlier sentence backtick-quotes something unrelated", () => {
    const files: ChangedFile[] = [{ path: "src/login.test.ts", additions: 2, deletions: 0, patch: "+it('rejects an expired token', () => {})" }];
    // Only the second sentence mentions "test", so only its backtick span
    // is checked — `src/login.ts` in the first sentence is never treated
    // as a claim at all.
    const result = claimedTestsExist("Updated `src/login.ts`. Added a test for `rejects an expired token`.", files);
    expect(result.status).toBe("pass");
  });
});

describe("dependencyRisk", () => {
  it("passes when nothing new was added", () => {
    expect(dependencyRisk([{ manifestPath: "package.json", added: [] }]).status).toBe("pass");
  });

  it("flags for review (never an automatic fail) when a new dependency is introduced", () => {
    const result = dependencyRisk([{ manifestPath: "package.json", added: ["left-pad"] }]);
    expect(result.status).toBe("review");
    expect(result.explanation).toContain("left-pad");
  });
});

describe("noSecretsInDiff", () => {
  it("passes on an ordinary diff with no secret-shaped content", () => {
    const files: ChangedFile[] = [{ path: "src/foo.ts", additions: 2, deletions: 0, patch: "+const x = 1;\n+export default x;" }];
    expect(noSecretsInDiff(files).status).toBe("pass");
  });

  it("fails on an added line containing an API-key-shaped string", () => {
    const files: ChangedFile[] = [{ path: "src/config.ts", additions: 1, deletions: 0, patch: "+const key = 'sk-live-abcdefghijklmnopqrstuvwx';" }];
    const result = noSecretsInDiff(files);
    expect(result.status).toBe("fail");
    expect(result.explanation).toContain("config.ts");
  });

  it("ignores a secret-shaped string on a REMOVED line — only additions matter", () => {
    const files: ChangedFile[] = [{ path: "src/config.ts", additions: 0, deletions: 1, patch: "-const key = 'sk-live-abcdefghijklmnopqrstuvwx';" }];
    expect(noSecretsInDiff(files).status).toBe("pass");
  });

  it("detects an AWS access key id and a PEM private key header", () => {
    const files: ChangedFile[] = [
      { path: "a.ts", additions: 1, deletions: 0, patch: "+const id = 'AKIAABCDEFGHIJKLMNOP';" },
      { path: "b.pem", additions: 1, deletions: 0, patch: "+-----BEGIN RSA PRIVATE KEY-----" },
    ];
    const result = noSecretsInDiff(files);
    expect(result.status).toBe("fail");
    expect(result.explanation).toContain("a.ts");
    expect(result.explanation).toContain("b.pem");
  });
});
