import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRun, FilesystemRunStore } from "@alexvegman/core";
import { runReplayCommand } from "./replay.js";

/**
 * `agentguard replay` — TRD §10.1. No unit test existed for this CLI
 * command before PRD3 Phase A. Without `--live`, replay's own mock engine
 * is `MockDecisionEngine({})` with nothing scripted, so only assertions
 * resolving deterministically, not_applicable, or review-by-structural-gap
 * can succeed — this exercises exactly that documented behavior against a
 * real stored run.
 */
describe("runReplayCommand", () => {
  let storeRoot: string;
  let store: FilesystemRunStore;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    storeRoot = await mkdtemp(path.join(tmpdir(), "agentguard-replay-test-"));
    store = new FilesystemRunStore(storeRoot);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(storeRoot, { recursive: true, force: true });
  });

  it("errors (exit 3) when the run id is not in the store", async () => {
    const exitCode = await runReplayCommand({ runId: "does-not-exist", storeRoot, live: false });

    expect(exitCode).toBe(3);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("does-not-exist"));
  });

  it("re-evaluates a stored run without --live, resolving evidenceSufficient deterministically", async () => {
    const run = AgentRun.parse({
      id: "run-replay-test",
      task: "Add a todo called Buy milk.",
      agent: { name: "test-agent" },
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      endedAt: "2026-09-20T00:00:01.000Z",
      schemaVersion: 1,
      events: [
        { id: "ev-1", timestamp: "2026-09-20T00:00:00.300Z", seq: 1, type: "tool_call", callId: "c1", tool: "add_todo", arguments: { text: "Buy milk" } },
      ],
    });
    await store.saveRun(run);

    const exitCode = await runReplayCommand({ runId: "run-replay-test", storeRoot, live: false, assertions: ["evidenceSufficient"] });

    expect(exitCode).toBe(0);
    const decisions = await store.loadDecisions("run-replay-test");
    expect(decisions?.evidenceSufficient.status).toBe("pass");
    expect(decisions?.evidenceSufficient.basis).toBe("deterministic");
  });

  it("warns and continues, without a live-scripted verdict, that no --live means nothing is scripted", async () => {
    const run = AgentRun.parse({
      id: "run-replay-test-2",
      task: "Add a todo called Buy milk.",
      agent: { name: "test-agent" },
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      endedAt: "2026-09-20T00:00:01.000Z",
      schemaVersion: 1,
      events: [],
    });
    await store.saveRun(run);

    await runReplayCommand({ runId: "run-replay-test-2", storeRoot, live: false, assertions: ["evidenceSufficient"] });

    expect(logSpy.mock.calls.some(([msg]) => String(msg).includes("no --live"))).toBe(true);
  });
});
