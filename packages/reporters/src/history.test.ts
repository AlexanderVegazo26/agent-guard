import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectAssertionHistory, compareToBaseline, passRate } from "./history.js";
import { AgentRun, FilesystemRunStore, type AssertionResult } from "@agent-guard/core";

describe("collectAssertionHistory / passRate / compareToBaseline — PRD2 F6", () => {
  let root: string;
  let store: FilesystemRunStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-history-test-"));
    store = new FilesystemRunStore(root);
  });

  afterEach(async () => {
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

  it("returns an empty series when nothing has evaluated that assertion", async () => {
    expect(await collectAssertionHistory(store, "goalCompleted")).toEqual([]);
  });

  it("collects and chronologically sorts entries across runs, regardless of insertion order", async () => {
    await seedRun("run-c", "2026-09-22T00:00:00.000Z", PASS);
    await seedRun("run-a", "2026-09-20T00:00:00.000Z", FAIL);
    await seedRun("run-b", "2026-09-21T00:00:00.000Z", PASS);

    const history = await collectAssertionHistory(store, "goalCompleted");
    expect(history.map((e) => e.runId)).toEqual(["run-a", "run-b", "run-c"]);
    expect(history[0]!.status).toBe("fail");
  });

  it("excludes a run that never evaluated the requested assertion", async () => {
    await seedRun("run-a", "2026-09-20T00:00:00.000Z", PASS);
    const history = await collectAssertionHistory(store, "noFabricatedCompletion");
    expect(history).toEqual([]);
  });

  it("passRate: null for an empty series, otherwise the fraction that passed", () => {
    expect(passRate([])).toBeNull();
    expect(
      passRate([
        { runId: "a", startedAt: "t", status: "pass" },
        { runId: "b", startedAt: "t", status: "fail" },
        { runId: "c", startedAt: "t", status: "pass" },
      ]),
    ).toBeCloseTo(2 / 3, 10);
  });

  it("compareToBaseline: null when the named baseline run isn't in the series", async () => {
    await seedRun("run-a", "2026-09-20T00:00:00.000Z", PASS);
    const history = await collectAssertionHistory(store, "goalCompleted");
    expect(compareToBaseline(history, "does-not-exist")).toBeNull();
  });

  it("compareToBaseline: flags a regression when the recent-window pass rate drops well below the baseline", async () => {
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", PASS);
    await seedRun("run-2", "2026-09-20T01:00:00.000Z", PASS);
    await seedRun("run-3", "2026-09-20T02:00:00.000Z", FAIL); // baseline boundary
    await seedRun("run-4", "2026-09-20T03:00:00.000Z", FAIL);
    await seedRun("run-5", "2026-09-20T04:00:00.000Z", FAIL);

    const history = await collectAssertionHistory(store, "goalCompleted");
    const comparison = compareToBaseline(history, "run-3");
    expect(comparison).not.toBeNull();
    expect(comparison!.baselineWindow.map((e) => e.runId)).toEqual(["run-1", "run-2", "run-3"]);
    expect(comparison!.recentWindow.map((e) => e.runId)).toEqual(["run-4", "run-5"]);
    expect(comparison!.baselinePassRate).toBeCloseTo(2 / 3, 10);
    expect(comparison!.recentPassRate).toBe(0);
    expect(comparison!.regressed).toBe(true);
  });

  it("compareToBaseline: does not flag a regression for a small delta under the threshold", async () => {
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", PASS);
    await seedRun("run-2", "2026-09-20T01:00:00.000Z", PASS);
    await seedRun("run-3", "2026-09-20T02:00:00.000Z", FAIL); // baseline boundary: 2/3 = 0.667
    await seedRun("run-4", "2026-09-20T03:00:00.000Z", PASS);
    await seedRun("run-5", "2026-09-20T04:00:00.000Z", FAIL); // recent: 1/2 = 0.5, delta ≈ -0.167

    const history = await collectAssertionHistory(store, "goalCompleted");
    const comparison = compareToBaseline(history, "run-3");
    expect(comparison!.baselinePassRate).toBeCloseTo(2 / 3, 10);
    expect(comparison!.recentPassRate).toBe(0.5);
    expect(comparison!.delta).toBeCloseTo(0.5 - 2 / 3, 10);
    expect(comparison!.regressed).toBe(false);
  });

  it("compareToBaseline: returns a null recentPassRate when there are no runs after the baseline yet", async () => {
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", PASS);
    const history = await collectAssertionHistory(store, "goalCompleted");
    const comparison = compareToBaseline(history, "run-1");
    expect(comparison!.recentWindow).toEqual([]);
    expect(comparison!.recentPassRate).toBeNull();
    expect(comparison!.delta).toBeNull();
    expect(comparison!.regressed).toBe(false);
  });
});
