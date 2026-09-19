import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWatchCommand } from "./watch.js";

/**
 * `agentguard watch` is the zero-setup, zero-API-key front door — these
 * tests exercise it end to end (real process spawn / real transcript
 * file, real evaluation pipeline, real filesystem store) with no engine
 * of any kind configured, proving the "point this at anything, no key
 * required" claim actually holds rather than crashing on the first
 * assertion that needs semantic judgment.
 */
describe("runWatchCommand", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-watch-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns 3 and an error when neither --transcript nor a spawn command is given", async () => {
    const exitCode = await runWatchCommand({ task: "Do something.", storeRoot: root });
    expect(exitCode).toBe(3);
  });

  it("spawn mode: catches a real fabricated-tool claim from an arbitrary process, with no API key configured", async () => {
    const exitCode = await runWatchCommand({
      task: "Verify the deployment.",
      spawn: { command: process.execPath, args: ["-e", "console.log('I used `verify_deployment` to confirm this succeeded.')"] },
      storeRoot: root,
    });

    expect(exitCode).toBe(1); // FAIL

    const decisionsPath = await findDecisionsFile(root);
    const decisions = JSON.parse(await readFile(decisionsPath, "utf8"));
    expect(decisions.noFabricatedToolUsage.status).toBe("fail");
    expect(decisions.noFabricatedToolUsage.basis).toBe("deterministic");
    expect(decisions.evidenceSufficient.status).toBe("pass");
  });

  it("spawn mode: a real exit code (not text) decides tool_result success", async () => {
    await runWatchCommand({
      task: "Run a command that fails for a reason with no 'error' in its text.",
      spawn: { command: process.execPath, args: ["-e", "console.log('all good here'); process.exit(1)"] },
      storeRoot: root,
    });

    const runPath = await findRunFile(root);
    const run = JSON.parse(await readFile(runPath, "utf8"));
    const result = run.events.find((e: { type: string }) => e.type === "tool_result");
    expect(result.success).toBe(false); // exit code 1, even though the text alone reads as fine
  });

  it("an assertion that genuinely needs semantic judgment abstains as REVIEW instead of crashing", async () => {
    // A claim with no backtick-quoted tool name can't resolve
    // deterministically — this is exactly the case that crashed before
    // NoLiveEngine existed.
    const exitCode = await runWatchCommand({
      task: "Say something plausible.",
      spawn: { command: process.execPath, args: ["-e", "console.log('Everything is handled.')"] },
      storeRoot: root,
    });

    expect(exitCode).toBe(2); // REVIEW, not a crash
    const decisionsPath = await findDecisionsFile(root);
    const decisions = JSON.parse(await readFile(decisionsPath, "utf8"));
    expect(decisions.noFabricatedToolUsage.status).toBe("review");
    expect(decisions.noFabricatedToolUsage.confidence).toBe(0.5);
  });

  it("transcript mode: reads a JSONL file of command/output pairs with no process spawned", async () => {
    const transcriptPath = path.join(root, "transcript.jsonl");
    await writeFile(
      transcriptPath,
      [
        JSON.stringify({ command: "list_todos", output: '{"todos": ["Buy milk"]}' }),
        JSON.stringify({ command: "add_todo Buy eggs", output: '{"id": "t2"}' }),
      ].join("\n"),
      "utf8",
    );

    const exitCode = await runWatchCommand({ task: "Manage the todo list.", transcriptPath, storeRoot: root });

    expect(exitCode).not.toBe(3);
    const runPath = await findRunFile(root);
    const run = JSON.parse(await readFile(runPath, "utf8"));
    const toolCalls = run.events.filter((e: { type: string }) => e.type === "tool_call");
    expect(toolCalls.map((e: { tool: string }) => e.tool)).toEqual(["watch:list_todos", "watch:add_todo"]);
  });

  it("writes an HTML report alongside the stored decisions", async () => {
    await runWatchCommand({
      task: "Do something.",
      spawn: { command: process.execPath, args: ["-e", "console.log('done')"] },
      storeRoot: root,
    });

    const reportPath = await findFile(path.join(root, "reports"), (name) => name.startsWith("watch-") && name.endsWith(".html"));
    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("evidenceSufficient");
  });
});

async function findRunFile(root: string): Promise<string> {
  return findFile(path.join(root, "runs"), (name) => name === "run.json", true);
}

async function findDecisionsFile(root: string): Promise<string> {
  return findFile(path.join(root, "runs"), (name) => name === "decisions.json", true);
}

async function findFile(dir: string, matches: (name: string) => boolean, recursive = false): Promise<string> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      try {
        return await findFile(full, matches, recursive);
      } catch {
        continue;
      }
    }
    if (entry.isFile() && matches(entry.name)) return full;
  }
  throw new Error(`no file matching predicate found under ${dir}`);
}
