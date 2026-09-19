import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRun } from "./schema.js";
import { FilesystemRunStore } from "./store.js";

const RUN = AgentRun.parse({
  id: "run-store-test",
  task: "Do the thing.",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:05.000Z",
  schemaVersion: 1,
  finalOutput: "Done.",
  events: [],
});

describe("FilesystemRunStore", () => {
  let root: string;
  let store: FilesystemRunStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-store-test-"));
    store = new FilesystemRunStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("saves a run under runs/<date>/<run-id>/run.json and loads it back byte-for-byte equal", async () => {
    const dir = await store.saveRun(RUN);
    expect(dir).toBe(path.join(root, "runs", "2026-09-20", "run-store-test"));

    const loaded = await store.loadRun("run-store-test");
    expect(loaded).toEqual(RUN);
  });

  it("returns null for a run id that was never saved", async () => {
    expect(await store.loadRun("nonexistent")).toBeNull();
  });

  it("round-trips evidence and decisions once a run directory exists", async () => {
    await store.saveRun(RUN);
    const evidence = { task: RUN.task, items: [], links: [] };
    await store.saveEvidence(RUN.id, evidence);
    await store.saveDecisions(RUN.id, {
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e-task"], durationMs: 5 },
    });

    expect(await store.loadEvidence(RUN.id)).toEqual(evidence);
    expect(await store.loadDecisions(RUN.id)).toEqual({
      goalCompleted: { id: "goalCompleted", status: "pass", basis: "jev", evidence: ["e-task"], durationMs: 5 },
    });
  });

  it("refuses to save evidence/decisions before saveRun() has created the directory", async () => {
    await expect(store.saveEvidence("never-saved", { task: "x", items: [], links: [] })).rejects.toThrow();
  });

  it("PRD2 G0a: refuses to write evidence carrying an unredacted secret-shaped key (fail-closed defence-in-depth audit)", async () => {
    await store.saveRun(RUN);
    const evidence = {
      task: RUN.task,
      items: [
        {
          id: "e-leaky",
          type: "tool_call" as const,
          source: "test",
          // A caller that forgot to redact before persisting — exactly the
          // gap this audit exists to catch (a raw, un-placeholdered value
          // under a sensitive key name).
          content: { apiKey: "sk-live-should-never-reach-disk" },
          derivedFrom: ["ev-1"],
          timestamp: "2026-09-20T00:00:00.000Z",
          seq: 1,
        },
      ],
      links: [],
    };

    await expect(store.saveEvidence(RUN.id, evidence)).rejects.toThrow(/refusing to write unredacted evidence/);

    // Nothing was written — not a partial/corrupt file.
    expect(await store.loadEvidence(RUN.id)).toBeNull();
  });

  it("appendEvent is append-only — a crashed run still yields every event written so far", async () => {
    await store.appendEvent(RUN, { id: "ev-1", type: "tool_call" });
    await store.appendEvent(RUN, { id: "ev-2", type: "tool_result" });

    const filePath = path.join(root, "runs", "2026-09-20", "run-store-test", "events.jsonl");
    const { readFile } = await import("node:fs/promises");
    const contents = await readFile(filePath, "utf8");
    const lines = contents.trim().split("\n").map((l) => JSON.parse(l));
    expect(lines).toEqual([{ id: "ev-1", type: "tool_call" }, { id: "ev-2", type: "tool_result" }]);
  });

  it("listRunIds finds runs across multiple date directories", async () => {
    await store.saveRun(RUN);
    await store.saveRun({ ...RUN, id: "run-store-test-2", startedAt: "2026-09-21T00:00:00.000Z" });

    expect((await store.listRunIds()).sort()).toEqual(["run-store-test", "run-store-test-2"]);
  });
});
