import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DefaultRedactor, type Redactor } from "./redaction.js";

/**
 * PRD2 F4 — a run directory becomes a tamper-evident, exportable record.
 * PRD v0.6's run store is already close to what EU AI Act Article 12
 * ("automatic recording of events... sufficient to ensure traceability")
 * needs; what it lacked was integrity (nothing proves a run file wasn't
 * edited after the fact) and a documented export shape.
 *
 * Scoped down from PRD2's "single archive" language: this produces a
 * self-contained *directory* (a copy of the run's files plus a manifest),
 * not a compressed single-file archive — building a tar/zip writer is a
 * real dependency decision this pass doesn't make unilaterally. The
 * integrity guarantee (a manifest of SHA-256 hashes, checked by
 * `verifyEvidencePack`) is what actually matters here and is complete;
 * packaging it into one compressed file is a thin wrapper over this that
 * a follow-up can add without touching the manifest format.
 */

export interface EvidencePackManifest {
  runId: string;
  schemaVersion: 1;
  agentguardVersion: string;
  generatedAt: string;
  /** Relative path (POSIX-style, forward slashes) → SHA-256 hex digest. */
  files: Record<string, string>;
  /**
   * The §5.1 defence-in-depth redaction audit, re-run against
   * `evidence.json` at export time — a second, independent check that
   * nothing unredacted is leaving the machine, not a replacement for
   * redacting at capture (TRD §8).
   */
  redactionAudit: { clean: boolean; findingCount: number };
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

async function listFilesRecursive(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(full, base)));
    } else if (entry.isFile()) {
      files.push(path.relative(base, full).split(path.sep).join("/"));
    }
  }
  return files.sort();
}

async function computeFileHashes(dir: string): Promise<Record<string, string>> {
  const relativePaths = await listFilesRecursive(dir);
  const hashes: Record<string, string> = {};
  for (const relativePath of relativePaths) {
    const content = await readFile(path.join(dir, relativePath));
    hashes[relativePath] = sha256(content);
  }
  return hashes;
}

/**
 * Copies a run directory's files into `outDir` and writes `manifest.json`
 * alongside them. `outDir` is created if it doesn't exist; it must not
 * already contain a `manifest.json` (never silently overwrite a prior
 * export).
 */
export async function buildEvidencePack(
  runDir: string,
  outDir: string,
  options: { runId: string; agentguardVersion: string; redactor?: Redactor },
): Promise<EvidencePackManifest> {
  if (!existsSync(runDir)) {
    throw new Error(`buildEvidencePack: run directory not found: "${runDir}"`);
  }
  const manifestPath = path.join(outDir, "manifest.json");
  if (existsSync(manifestPath)) {
    throw new Error(`buildEvidencePack: "${manifestPath}" already exists — refusing to overwrite a prior export`);
  }

  await mkdir(outDir, { recursive: true });
  await cp(runDir, outDir, { recursive: true });

  const redactor = options.redactor ?? new DefaultRedactor();
  const evidencePath = path.join(outDir, "evidence.json");
  let redactionAudit = { clean: true, findingCount: 0 };
  if (existsSync(evidencePath)) {
    const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as { items?: Array<{ id: string; content: unknown }> };
    if (evidence.items) {
      const audit = redactor.verify(evidence.items.map((item) => ({ id: item.id, content: item.content })));
      redactionAudit = { clean: audit.clean, findingCount: audit.findings.length };
    }
  }

  const files = await computeFileHashes(outDir);

  const manifest: EvidencePackManifest = {
    runId: options.runId,
    schemaVersion: 1,
    agentguardVersion: options.agentguardVersion,
    generatedAt: new Date().toISOString(),
    files,
    redactionAudit,
  };

  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  return manifest;
}

export interface EvidencePackVerification {
  clean: boolean;
  missing: string[];
  changed: string[];
  extra: string[];
}

/**
 * Recomputes every file's hash in `packDir` and compares it against
 * `manifest.json`'s recorded values — modifying one byte of any exported
 * file fails this. `extra` (a file present on disk but not in the
 * manifest) is reported too: an evidence pack is meant to be exactly what
 * was exported, nothing quietly added since.
 */
export async function verifyEvidencePack(packDir: string): Promise<EvidencePackVerification> {
  const manifestPath = path.join(packDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`verifyEvidencePack: no manifest.json found in "${packDir}"`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as EvidencePackManifest;

  const onDisk = await computeFileHashes(packDir);
  delete onDisk["manifest.json"]; // the manifest doesn't hash itself

  const missing: string[] = [];
  const changed: string[] = [];
  for (const [relativePath, expectedHash] of Object.entries(manifest.files)) {
    const actualHash = onDisk[relativePath];
    if (actualHash === undefined) {
      missing.push(relativePath);
    } else if (actualHash !== expectedHash) {
      changed.push(relativePath);
    }
  }

  const extra = Object.keys(onDisk).filter((p) => !(p in manifest.files));

  return { clean: missing.length === 0 && changed.length === 0 && extra.length === 0, missing, changed, extra };
}
