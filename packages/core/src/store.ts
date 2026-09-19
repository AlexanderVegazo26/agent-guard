import { existsSync } from "node:fs";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DefaultRedactor, type Redactor } from "./redaction.js";
import type { Adjudication, AgentRun, AssertionResult, Evidence, EvidenceLink } from "./schema.js";

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

export class FilesystemRunStore {
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

    const audit = this.redactor.verify(evidence.items.map((item) => ({ id: item.id, content: item.content })));
    if (!audit.clean) {
      const findings = audit.findings.map((f) => `${f.evidenceId}:${f.rule}`).join(", ");
      throw new Error(
        `FilesystemRunStore: refusing to write unredacted evidence for "${runId}" (${audit.findings.length} finding(s): ${findings}) — redact at capture before persisting (PRD2 G0a, TRD §8's fail-closed contract)`,
      );
    }

    await writeFile(path.join(dir, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
  }

  async saveDecisions(runId: string, results: Record<string, AssertionResult>): Promise<void> {
    const dir = await this.runDirFor(runId);
    if (!dir) throw new Error(`FilesystemRunStore: no run directory found for "${runId}" — call saveRun() first`);
    await writeFile(path.join(dir, "decisions.json"), JSON.stringify(results, null, 2), "utf8");
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
    await writeFile(path.join(dir, "adjudications.json"), JSON.stringify(updated, null, 2), "utf8");
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
