import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRun, FilesystemRunStore } from "@agent-guard/core";
import { runCompareCommand } from "./compare.js";

function makeRun(id: string) {
  return AgentRun.parse({
    id,
    task: "Do the thing.",
    agent: { name: "test-agent" },
    faults: [],
    startedAt: "2026-09-20T00:00:00.000Z",
    endedAt: "2026-09-20T00:00:01.000Z",
    schemaVersion: 1,
    events: [],
  });
}

/**
 * `agentguard compare` — the lab mechanism ("did agent.md v2 beat v1").
 * No unit test existed for this CLI command before PRD3 Phase A (only the
 * underlying `compareRuns`/`formatComparison` in `core/compare.test.ts`
 * were covered) — this exercises the command's own store-loading and
 * exit-code behavior against a real `FilesystemRunStore`.
 */
describe("runCompareCommand", () => {
  let root: string;
  let store: FilesystemRunStore;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-compare-test-"));
    store = new FilesystemRunStore(root);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it("errors (exit 3) when the 'before' run has no stored decisions", async () => {
    const exitCode = await runCompareCommand({ beforeId: "missing-before", afterId: "missing-after", storeRoot: root });

    expect(exitCode).toBe(3);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("missing-before"));
  });

  it("errors (exit 3) when the 'after' run has no stored decisions", async () => {
    await store.saveRun(makeRun("before-only"));
    await store.saveDecisions("before-only", {
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", signal: "noul-probability", confidence: 0.9, evidence: ["e-1"], durationMs: 1 },
    });

    const exitCode = await runCompareCommand({ beforeId: "before-only", afterId: "missing-after", storeRoot: root });

    expect(exitCode).toBe(3);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("missing-after"));
  });

  it("exits 1 when a real regression is present between two stored runs", async () => {
    await store.saveRun(makeRun("run-before"));
    await store.saveRun(makeRun("run-after"));
    await store.saveDecisions("run-before", {
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", signal: "noul-probability", confidence: 0.9, evidence: ["e-1"], durationMs: 1 },
    });
    await store.saveDecisions("run-after", {
      goalCompleted: { id: "goalCompleted", status: "fail", basis: "jev", signal: "noul-probability", confidence: 0.9, evidence: ["e-1"], durationMs: 1 },
    });

    const exitCode = await runCompareCommand({ beforeId: "run-before", afterId: "run-after", storeRoot: root });

    expect(exitCode).toBe(1);
    expect(logSpy.mock.calls.map(([m]) => String(m)).join("\n")).toContain("goalCompleted");
  });

  it("exits 0 when nothing regressed", async () => {
    await store.saveRun(makeRun("run-before-2"));
    await store.saveRun(makeRun("run-after-2"));
    await store.saveDecisions("run-before-2", {
      goalCompleted: { id: "goalCompleted", status: "fail", basis: "jev", signal: "noul-probability", confidence: 0.9, evidence: ["e-1"], durationMs: 1 },
    });
    await store.saveDecisions("run-after-2", {
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", signal: "noul-probability", confidence: 0.9, evidence: ["e-1"], durationMs: 1 },
    });

    const exitCode = await runCompareCommand({ beforeId: "run-before-2", afterId: "run-after-2", storeRoot: root });

    expect(exitCode).toBe(0);
  });
});
