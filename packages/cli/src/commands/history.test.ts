import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRun, FilesystemRunStore, type AssertionResult } from "@agent-guard/core";
import { runHistoryCommand } from "./history.js";

describe("agentguard history", () => {
  let root: string;
  let store: FilesystemRunStore;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-history-cli-test-"));
    store = new FilesystemRunStore(root);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  async function seedRun(id: string, startedAt: string, result: AssertionResult): Promise<void> {
    const run = AgentRun.parse({
      id,
      task: "x",
      agent: { name: "test-agent" },
      faults: [],
      startedAt,
      endedAt: startedAt,
      schemaVersion: 1,
      events: [],
    });
    await store.saveRun(run);
    await store.saveDecisions(id, { goalCompleted: result });
  }

  const PASS: AssertionResult = { id: "goalCompleted", status: "pass", basis: "jev", confidence: 0.9, evidence: ["e-task"], durationMs: 5 };
  const FAIL: AssertionResult = { id: "goalCompleted", status: "fail", basis: "jev", confidence: 0.9, evidence: ["e-task"], durationMs: 5 };

  it("reports no history cleanly when nothing has evaluated the assertion", async () => {
    const exitCode = await runHistoryCommand({ assertionId: "goalCompleted", storeRoot: root });
    expect(exitCode).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/no stored run has evaluated/);
  });

  it("prints the series without a baseline and exits 0", async () => {
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", PASS);
    await seedRun("run-2", "2026-09-21T00:00:00.000Z", FAIL);

    const exitCode = await runHistoryCommand({ assertionId: "goalCompleted", storeRoot: root });
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("run-1");
    expect(output).toContain("run-2");
  });

  it("exits 1 and reports a regression when the baseline comparison flags one", async () => {
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", PASS);
    await seedRun("run-2", "2026-09-20T01:00:00.000Z", PASS); // baseline
    await seedRun("run-3", "2026-09-20T02:00:00.000Z", FAIL);
    await seedRun("run-4", "2026-09-20T03:00:00.000Z", FAIL);

    const exitCode = await runHistoryCommand({ assertionId: "goalCompleted", baselineRunId: "run-2", storeRoot: root });
    expect(exitCode).toBe(1);
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/possible regression/);
  });

  it("exits 3 for an unknown baseline run id", async () => {
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", PASS);
    const exitCode = await runHistoryCommand({ assertionId: "goalCompleted", baselineRunId: "does-not-exist", storeRoot: root });
    expect(exitCode).toBe(3);
  });

  it("prints the two-proportion z-test result alongside the heuristic regression line (PRD3 F21)", async () => {
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", PASS);
    await seedRun("run-2", "2026-09-20T01:00:00.000Z", PASS); // baseline
    await seedRun("run-3", "2026-09-20T02:00:00.000Z", FAIL);
    await seedRun("run-4", "2026-09-20T03:00:00.000Z", FAIL);

    const exitCode = await runHistoryCommand({ assertionId: "goalCompleted", baselineRunId: "run-2", storeRoot: root });
    expect(exitCode).toBe(1);
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toMatch(/two-proportion z-test/);
    expect(output).toMatch(/significant change/);
  });

  async function seedRunWithAgent(id: string, startedAt: string, agentName: string, result: AssertionResult): Promise<void> {
    const run = AgentRun.parse({
      id,
      task: "x",
      agent: { name: agentName },
      faults: [],
      startedAt,
      endedAt: startedAt,
      schemaVersion: 1,
      events: [],
    });
    await store.saveRun(run);
    await store.saveDecisions(id, { goalCompleted: result });
  }

  it("--agent restricts the printed series to that agent's runs (PRD3 F21)", async () => {
    await seedRunWithAgent("run-a1", "2026-09-20T00:00:00.000Z", "agent-a", PASS);
    await seedRunWithAgent("run-b1", "2026-09-20T01:00:00.000Z", "agent-b", FAIL);

    const exitCode = await runHistoryCommand({ assertionId: "goalCompleted", agentName: "agent-a", storeRoot: root });
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("run-a1");
    expect(output).not.toContain("run-b1");
  });
});
