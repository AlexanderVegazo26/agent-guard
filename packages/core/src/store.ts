import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRun, AssertionResult, Evidence, EvidenceLink } from "./schema.js";

/**
 * §10.1 — filesystem storage. Portable, debuggable, and a native fit for CI
 * artifact upload. A run directory is self-contained and replayable:
 * `agentguard replay <run-id>` re-runs the evaluation pipeline over stored
 * evidence with no browser, agent or network (§10.1).
 *
 * Not implemented here: `snapshots/` and `trace/` (no browser capture
 * exists in this build to produce them), and the capture-time redaction
 * guarantee ("every file in this tree is redacted") — this store persists
 * whatever `AgentRun`/`Evidence`/`AssertionResult` it is given verbatim; the
 * caller is responsible for having redacted it first (`@agent-guard/observe`'s
 * `Redactor`), matching TRD §8's "redaction runs at capture, not at compile
 * time" — this store is downstream of that boundary, not a substitute for it.
 */

export interface StoredEvidence {
  task: string;
  items: Evidence[];
  links: EvidenceLink[];
}

export class FilesystemRunStore {
  constructor(private readonly root: string = path.join(process.cwd(), ".agentguard")) {}

  private runsRoot(): string {
    return path.join(this.root, "runs");
  }

  private dateDirFor(run: AgentRun): string {
    return run.startedAt.slice(0, 10); // YYYY-MM-DD
  }

  private async runDirFor(runId: string): Promise<string | null> {
    const runsRoot = this.runsRoot();
    if (!existsSync(runsRoot)) return null;
    const dateDirs = await readdir(runsRoot, { withFileTypes: true });
    for (const dateDir of dateDirs) {
      if (!dateDir.isDirectory()) continue;
      const candidate = path.join(runsRoot, dateDir.name, runId);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  }

  /** Appends one event line to `events.jsonl`, so a crashed run still yields partial evidence (§10.1). */
  async appendEvent(run: Pick<AgentRun, "id" | "startedAt">, event: unknown): Promise<void> {
    const dir = path.join(this.runsRoot(), run.startedAt.slice(0, 10), run.id);
    await mkdir(dir, { recursive: true });
    const line = `${JSON.stringify(event)}\n`;
    const filePath = path.join(dir, "events.jsonl");
    const existing = existsSync(filePath) ? await readFile(filePath, "utf8") : "";
    await writeFile(filePath, existing + line, "utf8");
  }

  async saveRun(run: AgentRun): Promise<string> {
    const dir = path.join(this.runsRoot(), this.dateDirFor(run), run.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "run.json"), JSON.stringify(run, null, 2), "utf8");
    return dir;
  }

  async saveEvidence(runId: string, evidence: StoredEvidence): Promise<void> {
    const dir = await this.runDirFor(runId);
    if (!dir) throw new Error(`FilesystemRunStore: no run directory found for "${runId}" — call saveRun() first`);
    await writeFile(path.join(dir, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
  }

  async saveDecisions(runId: string, results: Record<string, AssertionResult>): Promise<void> {
    const dir = await this.runDirFor(runId);
    if (!dir) throw new Error(`FilesystemRunStore: no run directory found for "${runId}" — call saveRun() first`);
    await writeFile(path.join(dir, "decisions.json"), JSON.stringify(results, null, 2), "utf8");
  }

  async loadRun(runId: string): Promise<AgentRun | null> {
    const dir = await this.runDirFor(runId);
    if (!dir) return null;
    const raw = await readFile(path.join(dir, "run.json"), "utf8");
    return JSON.parse(raw) as AgentRun;
  }

  async loadEvidence(runId: string): Promise<StoredEvidence | null> {
    const dir = await this.runDirFor(runId);
    if (!dir) return null;
    const filePath = path.join(dir, "evidence.json");
    if (!existsSync(filePath)) return null;
    return JSON.parse(await readFile(filePath, "utf8")) as StoredEvidence;
  }

  async loadDecisions(runId: string): Promise<Record<string, AssertionResult> | null> {
    const dir = await this.runDirFor(runId);
    if (!dir) return null;
    const filePath = path.join(dir, "decisions.json");
    if (!existsSync(filePath)) return null;
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, AssertionResult>;
  }

  async listRunIds(): Promise<string[]> {
    const runsRoot = this.runsRoot();
    if (!existsSync(runsRoot)) return [];
    const ids: string[] = [];
    for (const dateDir of await readdir(runsRoot, { withFileTypes: true })) {
      if (!dateDir.isDirectory()) continue;
      for (const runDir of await readdir(path.join(runsRoot, dateDir.name), { withFileTypes: true })) {
        if (runDir.isDirectory()) ids.push(runDir.name);
      }
    }
    return ids;
  }
}
