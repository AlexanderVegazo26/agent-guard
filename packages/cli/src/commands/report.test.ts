import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRun, FilesystemRunStore } from "@agent-guard/core";
import { runReportCommand } from "./report.js";

/**
 * `agentguard report` — PRD §9.3. No unit test existed for this command
 * before PRD3 Phase A. Drives it against a real `FilesystemRunStore`
 * (the same pattern `review.test.ts` uses) so the json/junit/html files it
 * writes are real reads of real stored decisions, not mocked formatting.
 */
describe("runReportCommand", () => {
  let root: string;
  let store: FilesystemRunStore;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-report-test-"));
    store = new FilesystemRunStore(root);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it("errors (exit 3) when the store has no runs at all", async () => {
    const exitCode = await runReportCommand({ storeRoot: root });

    expect(exitCode).toBe(3);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("writes json, junit and html reports from a real stored run's decisions", async () => {
    const run = AgentRun.parse({
      id: "run-report-test",
      task: "Do the thing.",
      agent: { name: "test-agent" },
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      endedAt: "2026-09-20T00:00:01.000Z",
      schemaVersion: 1,
      events: [],
    });
    await store.saveRun(run);
    await store.saveEvidence(run.id, { task: run.task, items: [], links: [] });
    await store.saveDecisions(run.id, {
      goalCompleted: {
        id: "goalCompleted",
        status: "pass",
        basis: "jev",
        signal: "noul-probability",
        confidence: 0.9,
        evidence: ["e-task"],
        durationMs: 10,
      },
    });

    const exitCode = await runReportCommand({ storeRoot: root });

    expect(exitCode).toBe(0);
    const jsonReport = JSON.parse(await readFile(path.join(root, "reports", "report.json"), "utf8")) as { reports: { runId: string; decisions: Record<string, { status: string }> }[] };
    const runReport = jsonReport.reports.find((r) => r.runId === "run-report-test");
    expect(runReport?.decisions.goalCompleted?.status).toBe("pass");

    const junit = await readFile(path.join(root, "reports", "junit.xml"), "utf8");
    expect(junit).toContain("goalCompleted");

    const html = await readFile(path.join(root, "reports", "report.html"), "utf8");
    expect(html).toContain("run-report-test");
    expect(html).toContain("goalCompleted");
  });
});
