import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DefaultRedactor, type Redactor } from "./redaction.js";
import type { Adjudication, AgentRun, AssertionResult, Evidence, EvidenceLink } from "./schema.js";

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * §10.1 — filesystem storage. Portable, debuggable, and a native fit for CI
 * artifact upload. A run directory is self-contained and replayable:
 * `agentguard replay <run-id>` re-runs the evaluation pipeline over stored
 * evidence with no browser, agent or network (§10.1).
 *
 * Not implemented here: `snapshots/` and `trace/` (no browser capture
 * exists in this build to produce them).
 *
 * Redaction is still primarily the caller's job — it runs at capture, not
 * at compile time (TRD §8; `TranscriptAdapter` and `AgentGuardFixture` both
 * redact before an event ever reaches here). But PRD2 G0a found that
 * contract silently unenforced everywhere, so `saveEvidence` now runs the
 * §5.1 defence-in-depth audit (`Redactor.verify`) before writing and
 * refuses to write — fail-closed, per `DefaultRedactor`'s own documented
 * contract — if it finds anything. This is a second check, not a
 * replacement for redacting at capture: it only sees the mechanical
 * key-name/pattern rules `verify()` implements, not everything
 * `redactEvent()` catches (e.g. the login-endpoint whole-body rule).
 */

export interface StoredEvidence {
  task: string;
  items: Evidence[];
  links: EvidenceLink[];
}

/** Per-file SHA-256, written incrementally by every store write (F16) rather than computed once at export time. */
export interface RunManifest {
  schemaVersion: 1;
  /** Relative path (POSIX-style, forward slashes) within the run directory → SHA-256 hex digest. */
  files: Record<string, string>;
}

/**
 * PRD3 F16 — the port `FilesystemRunStore` implements. `FilesystemRunStore`
 * is the only implementation this cycle (a Postgres/object-storage backend
 * is P2, per PRD3 §2 V8); this interface exists so the CLI, the Playwright
 * fixture and anything else that only needs to read/write runs depends on
 * the port, not the concrete filesystem class.
 */
export interface RunStore {
  runDirectory(runId: string): Promise<string | null>;
  appendEvent(run: Pick<AgentRun, "id" | "startedAt">, event: unknown): Promise<void>;
  saveRun(run: AgentRun): Promise<string>;
  saveEvidence(runId: string, evidence: StoredEvidence): Promise<void>;
  saveDecisions(runId: string, results: Record<string, AssertionResult>): Promise<void>;
  saveAdjudication(runId: string, adjudication: Adjudication): Promise<void>;
  loadAdjudications(runId: string): Promise<Record<string, Adjudication> | null>;
  loadRun(runId: string): Promise<AgentRun | null>;
  loadEvidence(runId: string): Promise<StoredEvidence | null>;
  loadDecisions(runId: string): Promise<Record<string, AssertionResult> | null>;
  loadManifest(runId: string): Promise<RunManifest | null>;
  listRunIds(): Promise<string[]>;
}

export class FilesystemRunStore implements RunStore {
  constructor(
    private readonly root: string = path.join(process.cwd(), ".agentguard"),
    private readonly redactor: Redactor = new DefaultRedactor(),
  ) {}

  private runsRoot(): string {
    return path.join(this.root, "runs");
  }

  private dateDirFor(run: AgentRun): string {
    return run.startedAt.slice(0, 10); // YYYY-MM-DD
  }

  /** PRD2 F4 — the on-disk directory for a run, for callers (e.g. `agentguard export`) that need the real path rather than going through a `load*` method. */
  async runDirectory(runId: string): Promise<string | null> {
    return this.runDirFor(runId);
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

  /**
   * PRD3 F16 — `manifest.json`'s per-file SHA-256, updated on every write
   * this store makes rather than computed once at export time
   * (`evidencePack.ts` previously did this hashing alone, at export). A
   * tampered run file now fails `verify-pack` without ever needing an
   * export step first.
   *
   * Same class of race `appendEvent` fixes for `events.jsonl` below:
   * concurrent callers writing different files (e.g. `appendEvent` and
   * `saveDecisions`) each do a read-modify-write of this same
   * `manifest.json`, and an interleaving loses whichever write finishes
   * its read first. Chaining every manifest update onto this promise
   * serializes them without callers needing to coordinate.
   */
  private manifestQueue: Promise<void> = Promise.resolve();

  private recordInManifest(dir: string, relativeName: string, content: string): Promise<void> {
    const run = async (): Promise<void> => {
      const manifestPath = path.join(dir, "manifest.json");
      let manifest: RunManifest = { schemaVersion: 1, files: {} };
      if (existsSync(manifestPath)) {
        manifest = JSON.parse(await readFile(manifestPath, "utf8")) as RunManifest;
      }
      manifest.files[relativeName] = sha256(Buffer.from(content, "utf8"));
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    };
    this.manifestQueue = this.manifestQueue.then(run, run);
    return this.manifestQueue;
  }

  /**
   * Appends one event line to `events.jsonl`, so a crashed run still yields
   * partial evidence (§10.1). PRD2 review finding: this used to read the
   * whole file and rewrite it on every call — quadratic in the number of
   * events, and two concurrent `appendEvent` calls could race (both read
   * the same "existing" contents, one write clobbers the other). A true
   * `appendFile` is O(1) per call and atomic at the OS level for a single
   * write — Node still doesn't serialize multiple in-flight `appendFile`
   * calls to the same path against each other, so concurrent *callers*
   * still need their own sequencing if that matters to them, but this at
   * least stops the store itself from being the source of the race.
   */
  async appendEvent(run: Pick<AgentRun, "id" | "startedAt">, event: unknown): Promise<void> {
    const dir = path.join(this.runsRoot(), run.startedAt.slice(0, 10), run.id);
    await mkdir(dir, { recursive: true });
    const line = `${JSON.stringify(event)}\n`;
    const filePath = path.join(dir, "events.jsonl");
    await appendFile(filePath, line, "utf8");
    // Rehash the whole file rather than the appended line — the manifest
    // records what's actually on disk, and appendFile's durability isn't
    // this method's concern.
    const wholeFile = await readFile(filePath, "utf8");
    await this.recordInManifest(dir, "events.jsonl", wholeFile);
  }

  async saveRun(run: AgentRun): Promise<string> {
    const dir = path.join(this.runsRoot(), this.dateDirFor(run), run.id);
    await mkdir(dir, { recursive: true });
    const content = JSON.stringify(run, null, 2);
    await writeFile(path.join(dir, "run.json"), content, "utf8");
    await this.recordInManifest(dir, "run.json", content);
    return dir;
  }

  async saveEvidence(runId: string, evidence: StoredEvidence): Promise<void> {
    const dir = await this.runDirFor(runId);
    if (!dir) throw new Error(`FilesystemRunStore: no run directory found for "${runId}" — call saveRun() first`);

    const audit = this.redactor.verify(evidence.items.map((item) => ({ id: item.id, content: item.content })));
    if (!audit.clean) {
      const findings = audit.findings.map((f) => `${f.evidenceId}:${f.rule}`).join(", ");
      throw new Error(
        `FilesystemRunStore: refusing to write unredacted evidence for "${runId}" (${audit.findings.length} finding(s): ${findings}) — redact at capture before persisting (PRD2 G0a, TRD §8's fail-closed contract)`,
      );
    }

    const content = JSON.stringify(evidence, null, 2);
    await writeFile(path.join(dir, "evidence.json"), content, "utf8");
    await this.recordInManifest(dir, "evidence.json", content);
  }

  async saveDecisions(runId: string, results: Record<string, AssertionResult>): Promise<void> {
    const dir = await this.runDirFor(runId);
    if (!dir) throw new Error(`FilesystemRunStore: no run directory found for "${runId}" — call saveRun() first`);
    const content = JSON.stringify(results, null, 2);
    await writeFile(path.join(dir, "decisions.json"), content, "utf8");
    await this.recordInManifest(dir, "decisions.json", content);
  }

  /**
   * PRD2 F1 — records one assertion's human verdict for this run, in
   * `adjudications.json`, separate from `decisions.json`. Re-adjudicating
   * the same assertion replaces its own prior entry (a human correcting
   * their own note); it never touches `decisions.json`, which stays the
   * machine's own record regardless of what a human later decides.
   */
  async saveAdjudication(runId: string, adjudication: Adjudication): Promise<void> {
    const dir = await this.runDirFor(runId);
    if (!dir) throw new Error(`FilesystemRunStore: no run directory found for "${runId}" — call saveRun() first`);
    const existing = (await this.loadAdjudications(runId)) ?? {};
    const updated = { ...existing, [adjudication.assertionId]: adjudication };
    const content = JSON.stringify(updated, null, 2);
    await writeFile(path.join(dir, "adjudications.json"), content, "utf8");
    await this.recordInManifest(dir, "adjudications.json", content);
  }

  async loadAdjudications(runId: string): Promise<Record<string, Adjudication> | null> {
    const dir = await this.runDirFor(runId);
    if (!dir) return null;
    const filePath = path.join(dir, "adjudications.json");
    if (!existsSync(filePath)) return null;
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, Adjudication>;
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

  async loadManifest(runId: string): Promise<RunManifest | null> {
    const dir = await this.runDirFor(runId);
    if (!dir) return null;
    const filePath = path.join(dir, "manifest.json");
    if (!existsSync(filePath)) return null;
    return JSON.parse(await readFile(filePath, "utf8")) as RunManifest;
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
