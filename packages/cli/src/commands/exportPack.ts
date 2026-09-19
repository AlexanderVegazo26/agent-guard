import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FilesystemRunStore, buildEvidencePack, verifyEvidencePack } from "@agent-guard/core";

export interface ExportCommandOptions {
  runId: string;
  outDir: string;
  storeRoot?: string;
}

export interface VerifyPackCommandOptions {
  packDir: string;
}

/**
 * PRD2 F4 — `agentguard export <run-id> --out <dir>`. Builds a
 * tamper-evident copy of a stored run: every file's SHA-256 hash recorded
 * in `manifest.json`, alongside the redaction audit result, the schema
 * version, and this build's own version (so a verdict stays interpretable
 * against the engine/version that produced it, even after this project
 * changes). `agentguard verify-pack` recomputes and checks that manifest.
 */
export async function runExportCommand(options: ExportCommandOptions): Promise<number> {
  const store = new FilesystemRunStore(options.storeRoot);
  const runDir = await store.runDirectory(options.runId);
  if (!runDir) {
    console.error(`agentguard export: no stored run found for "${options.runId}"`);
    return 3;
  }

  try {
    const manifest = await buildEvidencePack(runDir, options.outDir, {
      runId: options.runId,
      agentguardVersion: await cliVersion(),
    });
    console.log(`agentguard export: wrote ${options.outDir} (${Object.keys(manifest.files).length} file(s))`);
    if (!manifest.redactionAudit.clean) {
      console.warn(
        `  WARNING: the redaction audit found ${manifest.redactionAudit.findingCount} finding(s) in evidence.json — do not share this pack until that's resolved.`,
      );
    }
    return 0;
  } catch (err) {
    console.error(`agentguard export: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }
}

export async function runVerifyPackCommand(options: VerifyPackCommandOptions): Promise<number> {
  try {
    const result = await verifyEvidencePack(options.packDir);
    if (result.clean) {
      console.log(`agentguard verify-pack: ${options.packDir} is intact — every file matches its recorded hash.`);
      return 0;
    }
    console.error(`agentguard verify-pack: ${options.packDir} FAILED verification`);
    if (result.missing.length > 0) console.error(`  missing: ${result.missing.join(", ")}`);
    if (result.changed.length > 0) console.error(`  changed: ${result.changed.join(", ")}`);
    if (result.extra.length > 0) console.error(`  extra (not part of the original export): ${result.extra.join(", ")}`);
    return 1;
  } catch (err) {
    console.error(`agentguard verify-pack: ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }
}

async function cliVersion(): Promise<string> {
  try {
    const packageJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
