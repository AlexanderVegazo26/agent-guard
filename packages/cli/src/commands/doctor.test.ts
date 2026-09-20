import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runDoctorCommand } from "./doctor.js";

/**
 * `agentguard doctor` — TRD §10.3. No unit test existed for this command
 * before PRD3 Phase A. `--live` is never exercised here (it spends real
 * API budget); these cover the checks that run by default.
 */
describe("runDoctorCommand", () => {
  let cwd: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalApiKey: string | undefined;
  let originalAnthropicKey: string | undefined;

  beforeEach(async () => {
    cwd = await mkdtemp(path.join(tmpdir(), "agentguard-doctor-test-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    originalApiKey = process.env.TYPESAFE_API_KEY;
    originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(async () => {
    logSpy.mockRestore();
    if (originalApiKey === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = originalApiKey;
    if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
    await rm(cwd, { recursive: true, force: true });
  });

  it("fails (exit 3) when TYPESAFE_API_KEY is unset, and never calls the live API without --live", async () => {
    delete process.env.TYPESAFE_API_KEY;
    await writeFile(path.join(cwd, ".nvmrc"), `${process.versions.node.split(".")[0]}\n`, "utf8");

    const exitCode = await runDoctorCommand({ cwd, live: false });

    expect(exitCode).toBe(3);
    const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
    expect(output).toContain("TYPESAFE_API_KEY");
    expect(output).toContain("Live Jev connectivity");
    expect(output).toContain("pass --live");
  });

  it("passes the Node-version check when .nvmrc matches the running major version", async () => {
    await writeFile(path.join(cwd, ".nvmrc"), `${process.versions.node.split(".")[0]}\n`, "utf8");
    process.env.TYPESAFE_API_KEY = "test-key";

    await runDoctorCommand({ cwd, live: false });

    const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
    expect(output).toMatch(/Node version:.*matches \.nvmrc/);
  });

  it("warns (does not fail) rather than failing when .nvmrc is missing", async () => {
    process.env.TYPESAFE_API_KEY = "test-key";

    const exitCode = await runDoctorCommand({ cwd, live: false });

    // A missing .nvmrc is a "warn", not a "fail" — it alone must not flip the exit code.
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
    expect(output).toContain("no .nvmrc found");
  });

  it("warns rather than fails when ANTHROPIC_API_KEY is unset (escalation is optional)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.TYPESAFE_API_KEY = "test-key";
    await writeFile(path.join(cwd, ".nvmrc"), `${process.versions.node.split(".")[0]}\n`, "utf8");

    const exitCode = await runDoctorCommand({ cwd, live: false });

    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
    expect(output).toContain("ANTHROPIC_API_KEY (escalation)");
  });
});
