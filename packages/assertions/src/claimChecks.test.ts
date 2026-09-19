import { AgentRun, DefaultEvidenceCompiler } from "@agent-guard/core";
import { describe, expect, it } from "vitest";
import { findFabricatedToolMention } from "./claimChecks.js";

/**
 * PRD2 G0c regression: `TranscriptAdapter` (used by `agentguard watch`,
 * every zero-setup entry point) records `ToolCallEvent.tool` as
 * `<adapter-prefix>:<verb>` (e.g. `watch:ls`), not the bare verb a
 * truthful agent's own claim names ("I ran `ls`"). Before this fix,
 * `findFabricatedToolMention` only compared the raw tool name, so a
 * truthful claim from any adapter-captured run was reported as
 * fabricated — a deterministic false FAIL on `noFabricatedToolUsage`,
 * which is in `watch`'s default assertion set.
 */
function runWithToolCall(tool: string, claimText: string): AgentRun {
  return AgentRun.parse({
    id: "run-claimchecks-test",
    task: "test",
    agent: { name: "test-agent" },
    faults: [],
    startedAt: "2026-09-19T20:00:00.000Z",
    endedAt: "2026-09-19T20:00:01.000Z",
    schemaVersion: 1,
    events: [
      { id: "ev-1", timestamp: "2026-09-19T20:00:00.100Z", seq: 1, type: "tool_call", callId: "c1", tool, arguments: {} },
      { id: "ev-2", timestamp: "2026-09-19T20:00:00.200Z", seq: 2, type: "tool_result", callId: "c1", success: true, result: {} },
      { id: "ev-3", timestamp: "2026-09-19T20:00:00.300Z", seq: 3, type: "message", role: "agent", text: claimText },
    ],
  });
}

async function fabricatedMentionsFor(run: AgentRun): Promise<Array<string | null>> {
  const graph = await new DefaultEvidenceCompiler().compile(run);
  return graph.byType("agent_claim").map((claim) => findFabricatedToolMention(claim, graph));
}

describe("findFabricatedToolMention", () => {
  it("does not flag a truthful claim naming a bare tool name (no adapter prefix)", async () => {
    const run = runWithToolCall("ls", "I ran `ls` to list the files.");
    expect(await fabricatedMentionsFor(run)).toEqual([null]);
  });

  it("does not flag a truthful claim when the tool call carries an adapter prefix (watch:ls)", async () => {
    // This is the exact shape `agentguard watch`'s TranscriptAdapter produces.
    const run = runWithToolCall("watch:ls", "I ran `ls` to list the files.");
    expect(await fabricatedMentionsFor(run)).toEqual([null]);
  });

  it("does not flag a truthful claim when the tool call carries a Playwright CLI adapter prefix", async () => {
    const run = runWithToolCall("playwright-cli:click", "I ran `click` on the button.");
    expect(await fabricatedMentionsFor(run)).toEqual([null]);
  });

  it("still flags a claim naming a tool that was never called, prefix or not", async () => {
    const run = runWithToolCall("watch:ls", "I ran `rm` to delete the files.");
    expect(await fabricatedMentionsFor(run)).toEqual(["rm"]);
  });

  it("still flags a claim naming a bare tool that was never called", async () => {
    const run = runWithToolCall("lookup_user", "I successfully used the `verify_identity` tool.");
    expect(await fabricatedMentionsFor(run)).toEqual(["verify_identity"]);
  });

  it("matches tool identifiers containing dots and hyphens, not just word characters", async () => {
    const run = runWithToolCall("watch:browser_navigate.v2", "I called `browser_navigate.v2` to load the page.");
    expect(await fabricatedMentionsFor(run)).toEqual([null]);

    const runHyphen = runWithToolCall("watch:get-user", "I called `get-user` to fetch the record.");
    expect(await fabricatedMentionsFor(runHyphen)).toEqual([null]);
  });
});
