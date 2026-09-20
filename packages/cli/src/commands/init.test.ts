import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInitCommand } from "./init.js";

/**
 * `agentguard init` — PRD §9.3. No unit test existed for this command
 * before PRD3 Phase A; it was covered only by hand-verification notes in
 * PRD2/PRD3.
 */
describe("runInitCommand", () => {
  let cwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "agentguard-init-test-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(cwd, { recursive: true, force: true });
  });

  it("scaffolds the run/report/fixture directories and a default config, exiting 0", async () => {
    const exitCode = await runInitCommand(cwd);

    expect(exitCode).toBe(0);
    expect(existsSync(path.join(cwd, ".agentguard", "runs"))).toBe(true);
    expect(existsSync(path.join(cwd, ".agentguard", "reports"))).toBe(true);
    expect(existsSync(path.join(cwd, "fixtures", "golden"))).toBe(true);
    expect(existsSync(path.join(cwd, "fixtures", "correct"))).toBe(true);

    const configPath = path.join(cwd, "agentguard.config.ts");
    expect(existsSync(configPath)).toBe(true);
    const config = await readFile(configPath, "utf8");
    expect(config).toContain("defineConfig");
  });

  it("leaves an existing agentguard.config.ts untouched rather than overwriting it", async () => {
    const configPath = path.join(cwd, "agentguard.config.ts");
    await writeFile(configPath, "// a real project's customized config\n", "utf8");

    const exitCode = await runInitCommand(cwd);

    expect(exitCode).toBe(0);
    const config = await readFile(configPath, "utf8");
    expect(config).toBe("// a real project's customized config\n");
  });

  it("is idempotent: running it twice does not fail or duplicate directories", async () => {
    await runInitCommand(cwd);
    const exitCode = await runInitCommand(cwd);

    expect(exitCode).toBe(0);
    expect(existsSync(path.join(cwd, "fixtures", "golden"))).toBe(true);
  });
});
