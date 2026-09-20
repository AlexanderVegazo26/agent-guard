import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectAssertionHistory, compareToBaseline, passRate, twoProportionZTest } from "./history.js";
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
    expect(comparison!.zScore).toBeNull();
    expect(comparison!.pValue).toBeNull();
    expect(comparison!.significant).toBeNull();
  });

  describe("twoProportionZTest — PRD3 F21's real two-sample test", () => {
    it("matches a hand-computed z and p-value for 18/20 vs 10/20 (a real, discriminating drop)", () => {
      const result = twoProportionZTest(18, 20, 10, 20);
      expect(result).not.toBeNull();
      expect(result!.zScore).toBeCloseTo(-2.7602622373694166, 10);
      expect(result!.pValue).toBeCloseTo(0.005775611260853797, 10);
    });

    it("is null when either sample is empty", () => {
      expect(twoProportionZTest(0, 0, 5, 10)).toBeNull();
      expect(twoProportionZTest(5, 10, 0, 0)).toBeNull();
    });

    it("is null when both samples are 100% identical proportions (zero pooled variance)", () => {
      expect(twoProportionZTest(5, 5, 5, 5)).toBeNull();
    });

    it("is not significant for a small, noisy sample even though the raw delta is large", () => {
      // Same shape as the "flags a regression" test above (2/3 -> 0/2):
      // a real hand-computed p-value shows this drop is not statistically
      // distinguishable from noise at n=2, unlike the crude `regressed`
      // threshold which fires on the raw delta alone.
      const result = twoProportionZTest(2, 3, 0, 2);
      expect(result).not.toBeNull();
      expect(result!.zScore).toBeCloseTo(-1.4907119849998598, 10);
      expect(result!.pValue).toBeCloseTo(0.1360371927924251, 10);
    });
  });

  it("compareToBaseline: significant diverges from the crude regressed threshold on a small sample (real test, not just the heuristic)", async () => {
    // Same fixture as "flags a regression when the recent-window pass
    // rate drops well below the baseline": regressed=true fires on the
    // raw -100% delta, but n=2 in the recent window is too small for the
    // real two-proportion test to call it significant. This is the case
    // PRD3 F21 exists to fix: `regressed` alone cannot tell "5 failures
    // out of 5" from "statistically indistinguishable from noise".
    await seedRun("run-1", "2026-09-20T00:00:00.000Z", PASS);
    await seedRun("run-2", "2026-09-20T01:00:00.000Z", PASS);
    await seedRun("run-3", "2026-09-20T02:00:00.000Z", FAIL); // baseline boundary
    await seedRun("run-4", "2026-09-20T03:00:00.000Z", FAIL);
    await seedRun("run-5", "2026-09-20T04:00:00.000Z", FAIL);

    const history = await collectAssertionHistory(store, "goalCompleted");
    const comparison = compareToBaseline(history, "run-3");
    expect(comparison!.regressed).toBe(true);
    expect(comparison!.significant).toBe(false);
    expect(comparison!.zScore).toBeCloseTo(-1.4907119849998598, 10);
  });

  it("compareToBaseline: significant is true for a large, real drop (18/20 -> 10/20 shape)", async () => {
    for (let i = 0; i < 18; i++) await seedRun(`base-pass-${i}`, `2026-09-20T00:${String(i).padStart(2, "0")}:00.000Z`, PASS);
    for (let i = 0; i < 2; i++) await seedRun(`base-fail-${i}`, `2026-09-20T01:${String(i).padStart(2, "0")}:00.000Z`, FAIL);
    await seedRun("baseline", "2026-09-20T02:00:00.000Z", PASS); // boundary marker, doesn't affect counts materially
    for (let i = 0; i < 10; i++) await seedRun(`recent-pass-${i}`, `2026-09-20T03:${String(i).padStart(2, "0")}:00.000Z`, PASS);
    for (let i = 0; i < 10; i++) await seedRun(`recent-fail-${i}`, `2026-09-20T04:${String(i).padStart(2, "0")}:00.000Z`, FAIL);

    const history = await collectAssertionHistory(store, "goalCompleted");
    const comparison = compareToBaseline(history, "baseline");
    expect(comparison!.baselineWindow.length).toBe(21);
    expect(comparison!.recentWindow.length).toBe(20);
    expect(comparison!.significant).toBe(true);
    expect(comparison!.pValue).toBeLessThan(0.05);
  });

  describe("--agent filter (PRD3 F21 / PRD2 F6 remainder)", () => {
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

    it("restricts the series to runs whose agent.name matches exactly", async () => {
      await seedRunWithAgent("run-a1", "2026-09-20T00:00:00.000Z", "agent-a", PASS);
      await seedRunWithAgent("run-b1", "2026-09-20T01:00:00.000Z", "agent-b", FAIL);
      await seedRunWithAgent("run-a2", "2026-09-20T02:00:00.000Z", "agent-a", PASS);

      const historyA = await collectAssertionHistory(store, "goalCompleted", { agentName: "agent-a" });
      expect(historyA.map((e) => e.runId)).toEqual(["run-a1", "run-a2"]);

      const historyB = await collectAssertionHistory(store, "goalCompleted", { agentName: "agent-b" });
      expect(historyB.map((e) => e.runId)).toEqual(["run-b1"]);
    });

    it("returns every run when no agent filter is given (unchanged default behavior)", async () => {
      await seedRunWithAgent("run-a1", "2026-09-20T00:00:00.000Z", "agent-a", PASS);
      await seedRunWithAgent("run-b1", "2026-09-20T01:00:00.000Z", "agent-b", FAIL);

      const history = await collectAssertionHistory(store, "goalCompleted");
      expect(history.map((e) => e.runId)).toEqual(["run-a1", "run-b1"]);
    });

    it("returns an empty series for an agent name that never ran", async () => {
      await seedRunWithAgent("run-a1", "2026-09-20T00:00:00.000Z", "agent-a", PASS);
      const history = await collectAssertionHistory(store, "goalCompleted", { agentName: "no-such-agent" });
      expect(history).toEqual([]);
    });
  });
});
