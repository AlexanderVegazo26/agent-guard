import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FilesystemRunStore } from "@agent-guard/core";
import { runTestCommand } from "./test.js";

/**
 * `agentguard test` — no unit test existed for this CLI command before
 * PRD3 Phase A (only the standalone `tests/golden.test.ts` exercised the
 * pipeline directly). This drives the command itself against a small,
 * self-contained fixture directory — real files on disk, the mock engine,
 * a real `FilesystemRunStore` — rather than the full golden suite, so it
 * stays fast and isolated from changes to `fixtures/golden`.
 */
describe("runTestCommand", () => {
  let fixturesRoot: string;
  let storeRoot: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    fixturesRoot = await mkdtemp(path.join(tmpdir(), "agentguard-test-cmd-fixtures-"));
    storeRoot = await mkdtemp(path.join(tmpdir(), "agentguard-test-cmd-store-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const fixtureDir = path.join(fixturesRoot, "01-happy-path");
    await mkdir(fixtureDir, { recursive: true });
    await writeFile(
      path.join(fixtureDir, "run.json"),
      JSON.stringify({
        id: "run-cmd-test-1",
        task: "Add a todo called Buy milk.",
        agent: { name: "test-agent" },
        faults: [],
        startedAt: "2026-09-20T00:00:00.000Z",
        endedAt: "2026-09-20T00:00:01.000Z",
        schemaVersion: 1,
        finalOutput: "Added Buy milk to the list.",
        events: [
          { id: "ev-1", timestamp: "2026-09-20T00:00:00.300Z", seq: 1, type: "tool_call", callId: "c1", tool: "add_todo", arguments: { text: "Buy milk" } },
          { id: "ev-2", timestamp: "2026-09-20T00:00:00.600Z", seq: 2, type: "tool_result", callId: "c1", success: true, result: { id: "t1" } },
        ],
      }),
      "utf8",
    );
    await writeFile(
      path.join(fixtureDir, "expected.json"),
      JSON.stringify({ goalCompleted: { status: "pass", mustCite: ["e-1"] } }),
      "utf8",
    );
    await writeFile(path.join(fixtureDir, "mock.json"), JSON.stringify({ goalCompleted: { type: "noul", noul: 0.95 } }), "utf8");
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(fixturesRoot, { recursive: true, force: true });
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("runs the mock engine against a fixture directory, exits 0, and persists the run", async () => {
    const exitCode = await runTestCommand({ fixturesRoot, live: false, storeRoot });

    expect(exitCode).toBe(0);
    const store = new FilesystemRunStore(storeRoot);
    const decisions = await store.loadDecisions("run-cmd-test-1");
    expect(decisions?.goalCompleted.status).toBe("pass");
  });

  it("appends a Jev-basis calibration record for the fixture's scripted answer", async () => {
    await runTestCommand({ fixturesRoot, live: false, storeRoot });

    const calibrationPath = path.join(storeRoot, "calibration.jsonl");
    const raw = await readFile(calibrationPath, "utf8");
    const records = raw.trim().split("\n").map((l) => JSON.parse(l));
    expect(records).toContainEqual(expect.objectContaining({ assertionId: "goalCompleted", correct: true }));
  });
});
