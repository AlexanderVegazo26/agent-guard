import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReviewPrCommand } from "./reviewPr.js";

const execFileAsync = promisify(execFile);

/**
 * Drives `agentguard review-pr` against a REAL, throwaway git repository
 * (not a hand-built diff string) — `git init` + real commits + a real
 * `git diff` subprocess call, the same path the compiled CLI takes.
 */
describe("agentguard review-pr", () => {
  let repoDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    repoDir = await mkdtemp(path.join(tmpdir(), "agentguard-review-pr-test-"));
    await execFileAsync("git", ["init", "-q"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    await execFileAsync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    await writeFile(path.join(repoDir, "app.ts"), "export const x = 1;\n", "utf8");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-q", "-m", "base"], { cwd: repoDir });

    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(repoDir, { recursive: true, force: true });
  });

  async function commitChange(fileName: string, content: string): Promise<void> {
    await writeFile(path.join(repoDir, fileName), content, "utf8");
    await execFileAsync("git", ["add", "."], { cwd: repoDir });
    await execFileAsync("git", ["commit", "-q", "-m", "change"], { cwd: repoDir });
  }

  it("PASS: a change that adds a test file, no secrets, no new dependencies, with real passing test results", async () => {
    await commitChange("app.ts", "export const x = 2;\n");
    await commitChange("app.test.ts", "it('works', () => {});\n");
    const resultsPath = path.join(repoDir, "results.json");
    await writeFile(resultsPath, JSON.stringify({ total: 1, passed: 1, failed: 0 }), "utf8");

    const exitCode = await runReviewPrCommand({ base: "HEAD~2", head: "HEAD", cwd: repoDir, testResultsPath: resultsPath });
    expect(exitCode).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("PASS");
  });

  it("REVIEW (not FAIL): an otherwise-clean change with no test-results evidence provided", async () => {
    await commitChange("app.ts", "export const x = 2;\n");
    await commitChange("app.test.ts", "it('works', () => {});\n");

    const exitCode = await runReviewPrCommand({ base: "HEAD~2", head: "HEAD", cwd: repoDir });
    expect(exitCode).toBe(2);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("REVIEW");
  });

  it("FAIL: a change with no test file touched, and a real secret-shaped string committed", async () => {
    await commitChange("app.ts", "export const key = 'sk-live-abcdefghijklmnopqrstuvwx';\n");

    const exitCode = await runReviewPrCommand({ base: "HEAD~1", head: "HEAD", cwd: repoDir });
    expect(exitCode).toBe(1);
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("FAIL");
    expect(output).toContain("noSecretsInDiff");
  });

  it("reports no differences cleanly when base and head are identical", async () => {
    const exitCode = await runReviewPrCommand({ base: "HEAD", head: "HEAD", cwd: repoDir });
    expect(exitCode).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/no differences/);
  });

  it("exits 3 with a clear error for an invalid git ref", async () => {
    const exitCode = await runReviewPrCommand({ base: "not-a-real-ref", head: "HEAD", cwd: repoDir });
    expect(exitCode).toBe(3);
  });

  it("reads real test-results JSON from disk and factors it into testsPassed", async () => {
    await commitChange("app.test.ts", "it('works', () => {});\n");
    const resultsPath = path.join(repoDir, "results.json");
    await writeFile(resultsPath, JSON.stringify({ total: 3, passed: 2, failed: 1 }), "utf8");

    const exitCode = await runReviewPrCommand({ base: "HEAD~1", head: "HEAD", cwd: repoDir, testResultsPath: resultsPath });
    expect(exitCode).toBe(1); // testsPassed fails -> overall FAIL
    expect(logSpy.mock.calls.flat().join("\n")).toContain("1 of 3");
  });
});
