import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildEvidencePack, verifyEvidencePack } from "./evidencePack.js";

describe("buildEvidencePack / verifyEvidencePack — PRD2 F4", () => {
  let runDir: string;
  let outDir: string;

  beforeEach(async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentguard-pack-test-"));
    runDir = path.join(root, "run");
    outDir = path.join(root, "pack");
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "run.json"), JSON.stringify({ id: "run-1", task: "x" }), "utf8");
    await writeFile(
      path.join(runDir, "evidence.json"),
      JSON.stringify({ task: "x", items: [{ id: "e-task", content: { text: "hello" } }], links: [] }),
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(path.dirname(runDir), { recursive: true, force: true });
  });

  it("exports every file with a SHA-256 hash, and a clean manifest verifies with no findings", async () => {
    const manifest = await buildEvidencePack(runDir, outDir, { runId: "run-1", agentguardVersion: "0.1.0" });

    expect(manifest.runId).toBe("run-1");
    expect(manifest.agentguardVersion).toBe("0.1.0");
    expect(Object.keys(manifest.files).sort()).toEqual(["evidence.json", "run.json"]);
    expect(manifest.redactionAudit.clean).toBe(true);

    const verification = await verifyEvidencePack(outDir);
    expect(verification).toEqual({ clean: true, missing: [], changed: [], extra: [] });
  });

  it("detects a modified file — flipping one byte fails verification", async () => {
    await buildEvidencePack(runDir, outDir, { runId: "run-1", agentguardVersion: "0.1.0" });

    await writeFile(path.join(outDir, "run.json"), JSON.stringify({ id: "run-1", task: "TAMPERED" }), "utf8");

    const verification = await verifyEvidencePack(outDir);
    expect(verification.clean).toBe(false);
    expect(verification.changed).toEqual(["run.json"]);
  });

  it("detects a missing file", async () => {
    await buildEvidencePack(runDir, outDir, { runId: "run-1", agentguardVersion: "0.1.0" });
    await rm(path.join(outDir, "run.json"));

    const verification = await verifyEvidencePack(outDir);
    expect(verification.clean).toBe(false);
    expect(verification.missing).toEqual(["run.json"]);
  });

  it("detects an extra file added after export", async () => {
    await buildEvidencePack(runDir, outDir, { runId: "run-1", agentguardVersion: "0.1.0" });
    await writeFile(path.join(outDir, "sneaky.txt"), "not part of the original export", "utf8");

    const verification = await verifyEvidencePack(outDir);
    expect(verification.clean).toBe(false);
    expect(verification.extra).toEqual(["sneaky.txt"]);
  });

  it("flags a redaction audit finding — an unredacted secret-shaped key in evidence.json", async () => {
    await writeFile(
      path.join(runDir, "evidence.json"),
      JSON.stringify({ task: "x", items: [{ id: "e-leak", content: { apiKey: "sk-live-leaked" } }], links: [] }),
      "utf8",
    );

    const manifest = await buildEvidencePack(runDir, outDir, { runId: "run-1", agentguardVersion: "0.1.0" });
    expect(manifest.redactionAudit.clean).toBe(false);
    expect(manifest.redactionAudit.findingCount).toBeGreaterThan(0);
  });

  it("refuses to build a pack that would overwrite a prior export", async () => {
    await buildEvidencePack(runDir, outDir, { runId: "run-1", agentguardVersion: "0.1.0" });
    await expect(buildEvidencePack(runDir, outDir, { runId: "run-1", agentguardVersion: "0.1.0" })).rejects.toThrow(
      /already exists/,
    );
  });

  it("throws clearly for a run directory that does not exist", async () => {
    await expect(
      buildEvidencePack(path.join(runDir, "..", "does-not-exist"), outDir, { runId: "run-1", agentguardVersion: "0.1.0" }),
    ).rejects.toThrow(/not found/);
  });

  it("throws clearly when verifying a directory with no manifest", async () => {
    await mkdir(outDir, { recursive: true });
    await expect(verifyEvidencePack(outDir)).rejects.toThrow(/no manifest/);
  });

  it("the manifest.json written to disk matches what buildEvidencePack returned", async () => {
    const manifest = await buildEvidencePack(runDir, outDir, { runId: "run-1", agentguardVersion: "0.1.0" });
    const onDisk = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"));
    expect(onDisk).toEqual(manifest);
  });
});
