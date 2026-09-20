import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemRunStore, type AssertionResult } from "@alexvegman/core";
import { MockFixProposerEngine } from "@alexvegman/decision";
import { runAutofixProposeCommand, runAutofixShowCommand } from "./autofix.js";

function result(status: AssertionResult["status"], overrides: Partial<AssertionResult> = {}): AssertionResult {
  return { id: "x", status, basis: "jev", evidence: status === "pass" || status === "fail" ? ["e1"] : [], durationMs: 0, ...overrides };
}

/**
 * docs/AUTOFIX.md §9/§10 — `autofix propose`/`show` are the part of the
 * design that doesn't need the §4 prerequisites (held-out fixture sets,
 * a discriminating-evidence audit): proposing a diff makes no claim about
 * whether it works. These tests prove the plumbing (recurring-pattern
 * detection, one proposal per finding, never touching --agent-md, always
 * labeled unvalidated) without needing a real Anthropic call.
 */
describe("agentguard autofix", () => {
  let root: string;
  let store: FilesystemRunStore;
  let agentMdPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-autofix-test-"));
    store = new FilesystemRunStore(root);
    agentMdPath = path.join(root, "agent.md");
    await writeFile(agentMdPath, "# Agent instructions\n\nDo the task.\n", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function seedRun(runId: string, decisions: Record<string, AssertionResult>): Promise<void> {
    await store.saveRun({
      id: runId,
      task: "Add a todo.",
      agent: { name: "test-agent" },
      events: [],
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      schemaVersion: 1,
    });
    await store.saveEvidence(runId, {
      task: "Add a todo.",
      items: [{ id: "e1", type: "tool_call", source: "ev-1", content: { tool: "snapshot", arguments: {} }, derivedFrom: ["ev-1"], timestamp: "2026-09-20T00:00:00.000Z", seq: 1 }],
      links: [],
    });
    await store.saveDecisions(runId, decisions);
  }

  it("refuses to propose from a single run — a pattern needs at least 2 (PRD §12)", async () => {
    await seedRun("run-1", { avoidedUnnecessaryActions: result("fail") });
    const exitCode = await runAutofixProposeCommand({ agentMdPath, runIds: ["run-1"], storeRoot: root });
    expect(exitCode).toBe(3);
  });

  it("finds nothing to propose when nothing recurs across the given runs", async () => {
    await seedRun("run-1", { avoidedUnnecessaryActions: result("pass") });
    await seedRun("run-2", { avoidedUnnecessaryActions: result("pass") });
    const exitCode = await runAutofixProposeCommand({ agentMdPath, runIds: ["run-1", "run-2"], storeRoot: root });
    expect(exitCode).toBe(0);

    const fixesDir = path.join(root, "fixes");
    const exists = await readdir(fixesDir).catch(() => []);
    expect(exists).toHaveLength(0);
  });

  it("proposes a fix for an assertion that fails/reviews in 2+ runs, never touching agent.md", async () => {
    await seedRun("run-1", { avoidedUnnecessaryActions: result("fail", { explanation: "snapshot called twice unnecessarily" }) });
    await seedRun("run-2", { avoidedUnnecessaryActions: result("review") });

    const proposer = new MockFixProposerEngine({ diff: "- Do the task.\n+ Do the task efficiently.", rationale: "Reduces redundant calls." });
    const exitCode = await runAutofixProposeCommand({ agentMdPath, runIds: ["run-1", "run-2"], storeRoot: root, proposer });

    expect(exitCode).toBe(0);
    expect(proposer.calls).toHaveLength(1);
    expect(proposer.calls[0]!.recurringEvidence).toHaveLength(1);
    expect(proposer.calls[0]!.recurringEvidence[0]!.assertionId).toBe("avoidedUnnecessaryActions");
    expect(proposer.calls[0]!.recurringEvidence[0]!.occurrences).toBe(2);
    expect(proposer.calls[0]!.recurringEvidence[0]!.explanation).toBe("snapshot called twice unnecessarily");

    // agent.md itself must be untouched — propose never applies anything.
    expect(await readFile(agentMdPath, "utf8")).toBe("# Agent instructions\n\nDo the task.\n");

    const fixesDir = path.join(root, "fixes");
    const files = await readdir(fixesDir);
    expect(files).toHaveLength(1);
    const proposal = JSON.parse(await readFile(path.join(fixesDir, files[0]!), "utf8"));
    expect(proposal.targetAssertionIds).toEqual(["avoidedUnnecessaryActions"]);
    expect(proposal.diff).toBe("- Do the task.\n+ Do the task efficiently.");
    expect(proposal.rationale).toBe("Reduces redundant calls.");
    expect(proposal.validation).toBeUndefined(); // never claims to be validated
  });

  it("autofix show prints the proposal and always labels it not validated", async () => {
    await seedRun("run-1", { avoidedUnnecessaryActions: result("fail") });
    await seedRun("run-2", { avoidedUnnecessaryActions: result("fail") });
    const proposer = new MockFixProposerEngine({ diff: "diff-text", rationale: "rationale-text" });
    await runAutofixProposeCommand({ agentMdPath, runIds: ["run-1", "run-2"], storeRoot: root, proposer });

    const [fixId] = (await readdir(path.join(root, "fixes"))).map((f) => f.replace(".json", ""));

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      const exitCode = await runAutofixShowCommand({ fixId: fixId!, storeRoot: root });
      expect(exitCode).toBe(0);
    } finally {
      console.log = originalLog;
    }

    const output = logs.join("\n");
    expect(output).toContain("diff-text");
    expect(output).toContain("rationale-text");
    expect(output).toContain("NOT VALIDATED");
  });

  it("returns 3 for a fix id that doesn't exist", async () => {
    const exitCode = await runAutofixShowCommand({ fixId: "fix-does-not-exist", storeRoot: root });
    expect(exitCode).toBe(3);
  });
});
