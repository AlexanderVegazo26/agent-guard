import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Adjudication } from "./schema.js";
import { AgentRun } from "./schema.js";
import { FilesystemRunStore } from "./store.js";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

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

  it("rejects a run.json that doesn't match the AgentRun schema instead of returning it uncast (API-010)", async () => {
    const dir = await store.saveRun(RUN);
    await writeFile(path.join(dir, "run.json"), JSON.stringify({ id: "run-store-test", task: 42 }), "utf8");
    await expect(store.loadRun("run-store-test")).rejects.toThrow();
  });

  it("rejects a manifest.json with an unexpected shape instead of returning it uncast (API-010)", async () => {
    const dir = await store.saveRun(RUN);
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ schemaVersion: 2, files: "not-an-object" }), "utf8");
    await expect(store.loadManifest("run-store-test")).rejects.toThrow();
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

  it("PRD2 review fix: many concurrent appendEvent calls lose no lines (was read-modify-write, now a true append)", async () => {
    const n = 50;
    await Promise.all(
      Array.from({ length: n }, (_, i) => store.appendEvent(RUN, { id: `ev-${i}` })),
    );

    const filePath = path.join(root, "runs", "2026-09-20", "run-store-test", "events.jsonl");
    const { readFile } = await import("node:fs/promises");
    const contents = await readFile(filePath, "utf8");
    const lines = contents.trim().split("\n").filter((l) => l.length > 0);

    // Every call's line survived — the old read-then-rewrite implementation
    // could lose writes when two calls raced on the same "existing content".
    expect(lines).toHaveLength(n);
    const ids = new Set(lines.map((l) => (JSON.parse(l) as { id: string }).id));
    expect(ids.size).toBe(n);
  });

  it("PRD2 F1: saveAdjudication/loadAdjudications round-trip, and re-adjudicating the same assertion replaces its prior entry", async () => {
    await store.saveRun(RUN);
    expect(await store.loadAdjudications(RUN.id)).toBeNull();

    const first: Adjudication = {
      assertionId: "noFabricatedCompletion",
      humanVerdict: "pass",
      reason: "Checked the network log myself — no contradicting request.",
      adjudicator: "alex",
      at: "2026-09-20T00:00:00.000Z",
    };
    await store.saveAdjudication(RUN.id, first);
    expect(await store.loadAdjudications(RUN.id)).toEqual({ noFabricatedCompletion: first });

    // A second assertion's adjudication is added, not overwriting the first.
    const second: Adjudication = {
      assertionId: "goalCompleted",
      humanVerdict: "fail",
      reason: "The todo was never actually created.",
      adjudicator: "alex",
      at: "2026-09-20T00:01:00.000Z",
    };
    await store.saveAdjudication(RUN.id, second);
    expect(await store.loadAdjudications(RUN.id)).toEqual({
      noFabricatedCompletion: first,
      goalCompleted: second,
    });

    // Re-adjudicating "noFabricatedCompletion" replaces its own prior entry.
    const revised: Adjudication = { ...first, humanVerdict: "fail", reason: "Missed it the first time.", at: "2026-09-20T00:02:00.000Z" };
    await store.saveAdjudication(RUN.id, revised);
    expect(await store.loadAdjudications(RUN.id)).toEqual({
      noFabricatedCompletion: revised,
      goalCompleted: second,
    });

    // decisions.json is never touched by adjudication.
    expect(await store.loadDecisions(RUN.id)).toBeNull();
  });

  it("PRD2 F1: refuses to save an adjudication before saveRun() has created the directory", async () => {
    await expect(
      store.saveAdjudication("never-saved", {
        assertionId: "x",
        humanVerdict: "pass",
        reason: "r",
        adjudicator: "a",
        at: "2026-09-20T00:00:00.000Z",
      }),
    ).rejects.toThrow();
  });

  it("listRunIds finds runs across multiple date directories", async () => {
    await store.saveRun(RUN);
    await store.saveRun({ ...RUN, id: "run-store-test-2", startedAt: "2026-09-21T00:00:00.000Z" });

    expect((await store.listRunIds()).sort()).toEqual(["run-store-test", "run-store-test-2"]);
  });

  it("PRD3 F16: writes manifest.json with a correct SHA-256 for every file, at write time — not just at export", async () => {
    const dir = await store.saveRun(RUN);
    await store.saveEvidence("run-store-test", { task: RUN.task, items: [], links: [] });
    await store.saveDecisions("run-store-test", {});

    const manifest = await store.loadManifest("run-store-test");
    expect(manifest).not.toBeNull();

    const runJson = await readFile(path.join(dir, "run.json"), "utf8");
    const evidenceJson = await readFile(path.join(dir, "evidence.json"), "utf8");
    const decisionsJson = await readFile(path.join(dir, "decisions.json"), "utf8");
    expect(manifest!.files["run.json"]).toBe(sha256(runJson));
    expect(manifest!.files["evidence.json"]).toBe(sha256(evidenceJson));
    expect(manifest!.files["decisions.json"]).toBe(sha256(decisionsJson));
  });

  it("PRD3 F16: a byte tampered with after saveRun() no longer matches the manifest recorded at write time", async () => {
    const dir = await store.saveRun(RUN);
    const manifestBefore = await store.loadManifest("run-store-test");

    await writeFile(path.join(dir, "run.json"), `${await readFile(path.join(dir, "run.json"), "utf8")} `, "utf8");
    const tamperedContent = await readFile(path.join(dir, "run.json"), "utf8");

    expect(sha256(tamperedContent)).not.toBe(manifestBefore!.files["run.json"]);
  });
});
