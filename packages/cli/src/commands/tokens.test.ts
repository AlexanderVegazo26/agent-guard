import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRun, FilesystemRunStore, type AssertionResult } from "@agent-guard/core";
import { runTokensCommand } from "./tokens.js";

describe("agentguard tokens", () => {
  let root: string;
  let store: FilesystemRunStore;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-tokens-cli-test-"));
    store = new FilesystemRunStore(root);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  async function seedRun(id: string, startedAt: string, decisions: Record<string, AssertionResult>): Promise<void> {
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
    await store.saveDecisions(id, decisions);
  }

  it("reports no runs cleanly when the store is empty", async () => {
    const exitCode = await runTokensCommand({ storeRoot: root });
    expect(exitCode).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/no stored runs/);
  });

  it("sums real usage across assertions in one run, and lists free (no-usage) assertions separately", async () => {
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", {
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e1"], durationMs: 5, usage: { inputTokens: 1200, outputTokens: 40 } },
      evidenceSufficient: { id: "evidenceSufficient", status: "pass", basis: "deterministic", evidence: ["e1"], durationMs: 0 },
    });

    const exitCode = await runTokensCommand({ storeRoot: root });
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("run-1");
    expect(output).toContain("input=1,200");
    expect(output).toContain("output=40");
    expect(output).toContain("evidenceSufficient");
  });

  it("aggregates usage across multiple stored runs into a grand total", async () => {
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", {
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e1"], durationMs: 5, usage: { inputTokens: 1000, outputTokens: 100 } },
    });
    await seedRun("run-2", "2026-09-21T00:00:00.000Z", {
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e1"], durationMs: 5, usage: { inputTokens: 2000, outputTokens: 200 } },
    });

    const exitCode = await runTokensCommand({ storeRoot: root });
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("total input=3,000 output=300");
  });

  it("reports on a single named run when given one, ignoring other stored runs", async () => {
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", {
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e1"], durationMs: 5, usage: { inputTokens: 1000, outputTokens: 100 } },
    });
    await seedRun("run-2", "2026-09-21T00:00:00.000Z", {
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e1"], durationMs: 5, usage: { inputTokens: 9000, outputTokens: 900 } },
    });

    const exitCode = await runTokensCommand({ runId: "run-1", storeRoot: root });
    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("run-1");
    expect(output).not.toContain("run-2");
    expect(output).toContain("total input=1,000 output=100");
  });

  it("exits 3 for a named run id that was never evaluated", async () => {
    const exitCode = await runTokensCommand({ runId: "does-not-exist", storeRoot: root });
    expect(exitCode).toBe(3);
    expect(errorSpy.mock.calls.flat().join("\n")).toMatch(/no decisions\.json found/);
  });
});
