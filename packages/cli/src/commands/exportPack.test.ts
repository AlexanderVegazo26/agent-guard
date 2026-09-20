import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRun, FilesystemRunStore } from "@alexvegman/core";
import { runExportCommand, runVerifyPackCommand } from "./exportPack.js";

describe("agentguard export / verify-pack", () => {
  let root: string;
  let store: FilesystemRunStore;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-export-test-"));
    store = new FilesystemRunStore(root);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const run = AgentRun.parse({
      id: "run-export-test",
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
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it("exports a real stored run and the pack verifies clean", async () => {
    const outDir = path.join(root, "pack");
    const exitCode = await runExportCommand({ runId: "run-export-test", outDir, storeRoot: root });
    expect(exitCode).toBe(0);

    const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"));
    expect(manifest.runId).toBe("run-export-test");
    expect(Object.keys(manifest.files)).toContain("run.json");
    expect(Object.keys(manifest.files)).toContain("evidence.json");

    const verifyExit = await runVerifyPackCommand({ packDir: outDir });
    expect(verifyExit).toBe(0);
  });

  it("verify-pack fails (exit 1) after a file is tampered with post-export", async () => {
    const outDir = path.join(root, "pack");
    await runExportCommand({ runId: "run-export-test", outDir, storeRoot: root });

    await writeFile(path.join(outDir, "run.json"), JSON.stringify({ tampered: true }), "utf8");

    const exitCode = await runVerifyPackCommand({ packDir: outDir });
    expect(exitCode).toBe(1);
  });

  it("export fails (exit 3) for a run id that was never stored", async () => {
    const exitCode = await runExportCommand({ runId: "does-not-exist", outDir: path.join(root, "pack"), storeRoot: root });
    expect(exitCode).toBe(3);
  });
});
