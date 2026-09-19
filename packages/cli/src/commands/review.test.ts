import { readFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRun, FilesystemRunStore } from "@agent-guard/core";
import { runReviewListCommand, runReviewRecordCommand } from "./review.js";

/**
 * PRD2 F1 — `agentguard review`. Drives the commands against a real
 * temp-directory `FilesystemRunStore`, the same way `store.test.ts` does,
 * rather than mocking the store.
 */
describe("agentguard review", () => {
  let root: string;
  let store: FilesystemRunStore;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-review-test-"));
    store = new FilesystemRunStore(root);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  async function seedRunWithReview(runId: string): Promise<void> {
    const run = AgentRun.parse({
      id: runId,
      task: "Do the thing.",
      agent: { name: "test-agent" },
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      endedAt: "2026-09-20T00:00:01.000Z",
      schemaVersion: 1,
      events: [],
    });
    await store.saveRun(run);
    await store.saveEvidence(runId, { task: run.task, items: [], links: [] });
    await store.saveDecisions(runId, {
      noFabricatedCompletion: {
        id: "noFabricatedCompletion",
        status: "review",
        basis: "jev",
        signal: "noul-probability",
        confidence: 0.55,
        reviewVia: "uncertainty-band",
        evidence: ["e-task"],
        durationMs: 5,
      },
      goalCompleted: {
        id: "goalCompleted",
        status: "pass",
        basis: "jev",
        signal: "noul-probability",
        confidence: 0.9,
        evidence: ["e-task"],
        durationMs: 5,
      },
    });
  }

  it("list surfaces an open REVIEW item and ignores an already-adjudicated one", async () => {
    await seedRunWithReview("run-1");

    await runReviewListCommand({ storeRoot: root });
    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("run-1");
    expect(output).toContain("noFabricatedCompletion");
    expect(output).not.toContain("goalCompleted"); // status "pass", never an open review item
    expect(output).toMatch(/1 open REVIEW item\(s\)/);

    logSpy.mockClear();
    await runReviewRecordCommand({
      runId: "run-1",
      assertionId: "noFabricatedCompletion",
      verdict: "pass",
      reason: "Checked the evidence myself.",
      adjudicator: "alex",
      storeRoot: root,
    });

    logSpy.mockClear();
    await runReviewListCommand({ storeRoot: root });
    const afterOutput = logSpy.mock.calls.flat().join("\n");
    expect(afterOutput).toMatch(/0 open REVIEW item\(s\), 1 already adjudicated/);
  });

  it("record persists an adjudication and appends a calibration record when the verdict is decisive", async () => {
    await seedRunWithReview("run-2");

    const exitCode = await runReviewRecordCommand({
      runId: "run-2",
      assertionId: "noFabricatedCompletion",
      verdict: "fail",
      reason: "The claim actually was contradicted; the model missed it.",
      adjudicator: "alex",
      storeRoot: root,
    });
    expect(exitCode).toBe(0);

    const adjudications = await store.loadAdjudications("run-2");
    expect(adjudications?.noFabricatedCompletion).toMatchObject({
      humanVerdict: "fail",
      adjudicator: "alex",
    });

    const calibrationPath = path.join(root, "calibration.jsonl");
    const lines = (await readFile(calibrationPath, "utf8")).trim().split("\n");
    const record = JSON.parse(lines[0]!) as { assertionId: string; correct: boolean; confidence: number };
    expect(record.assertionId).toBe("noFabricatedCompletion");
    // Machine said "review", human says "fail" — never scored "correct"
    // against a status of "review" in the first place, but the important
    // assertion here is that a real record got written from real ground
    // truth, not a fixture's declared expectation.
    expect(record.confidence).toBe(0.55);
  });

  it("record with \"cannot-tell\" saves the adjudication but appends no calibration record", async () => {
    await seedRunWithReview("run-3");

    await runReviewRecordCommand({
      runId: "run-3",
      assertionId: "noFabricatedCompletion",
      verdict: "cannot-tell",
      reason: "The evidence genuinely doesn't settle it either way.",
      adjudicator: "alex",
      storeRoot: root,
    });

    const adjudications = await store.loadAdjudications("run-3");
    expect(adjudications?.noFabricatedCompletion?.humanVerdict).toBe("cannot-tell");

    const { existsSync } = await import("node:fs");
    expect(existsSync(path.join(root, "calibration.jsonl"))).toBe(false);
  });

  it("record fails clearly for an unknown run or an unknown assertion, rather than crashing", async () => {
    expect(
      await runReviewRecordCommand({
        runId: "does-not-exist",
        assertionId: "noFabricatedCompletion",
        verdict: "pass",
        reason: "r",
        adjudicator: "a",
        storeRoot: root,
      }),
    ).toBe(3);

    await seedRunWithReview("run-4");
    expect(
      await runReviewRecordCommand({
        runId: "run-4",
        assertionId: "notARealAssertion",
        verdict: "pass",
        reason: "r",
        adjudicator: "a",
        storeRoot: root,
      }),
    ).toBe(3);
  });

  it("list reports zero runs cleanly when the store is empty", async () => {
    const exitCode = await runReviewListCommand({ storeRoot: root });
    expect(exitCode).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toMatch(/no stored runs found/);
  });
});
