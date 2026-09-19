import { describe, expect, it } from "vitest";
import { DefaultEvidenceCompiler } from "./graph.js";
import { languageAdvisory, nonAsciiRatio } from "./languageAdvisory.js";
import { AgentRun } from "./schema.js";

describe("nonAsciiRatio", () => {
  it("is 0 for plain ASCII text", () => {
    expect(nonAsciiRatio("Add a todo called Buy milk.")).toBe(0);
  });

  it("is 1 for entirely non-ASCII text", () => {
    expect(nonAsciiRatio("买牛奶")).toBe(1);
  });

  it("is 0 for an empty string", () => {
    expect(nonAsciiRatio("")).toBe(0);
  });

  it("is between 0 and 1 for mixed content", () => {
    const ratio = nonAsciiRatio("Add 买 milk");
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });
});

describe("languageAdvisory", () => {
  async function graphFor(task: string, finalOutput: string, events: AgentRun["events"] = []) {
    const run = AgentRun.parse({
      id: "run-lang-test",
      task,
      agent: { name: "test-agent" },
      faults: [],
      startedAt: "2026-09-20T00:00:00.000Z",
      endedAt: "2026-09-20T00:00:01.000Z",
      schemaVersion: 1,
      finalOutput,
      events,
    });
    return new DefaultEvidenceCompiler().compile(run);
  }

  it("returns null for an ordinary English-language run", async () => {
    const graph = await graphFor("Add a todo called Buy milk.", "Added Buy milk to the list.");
    expect(languageAdvisory(graph)).toBeNull();
  });

  it("returns a one-line advisory when the evidence is dominated by non-ASCII content", async () => {
    const graph = await graphFor("买牛奶并支付账单", "已成功将买牛奶添加到待办事项列表");
    const advisory = languageAdvisory(graph);
    expect(advisory).not.toBeNull();
    expect(advisory).toContain("non-ASCII");
    expect(advisory).toContain("§14");
  });

  it("still fires with tool_call/tool_result events present — JSON structure (keys, braces, quotes) must not dilute the ratio", async () => {
    // Regression case: a naive JSON.stringify(content) sample counts the
    // structural ASCII in every event's field names and punctuation
    // against the ratio, which silently suppressed the advisory on any
    // real run with tool calls (confirmed against `agentguard watch` by
    // hand before this fix).
    const graph = await graphFor("买牛奶", "已成功将牛奶添加到待办事项列表", [
      { id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "tool_call", callId: "c1", tool: "add_todo", arguments: { text: "买牛奶" } },
      { id: "ev-2", timestamp: "2026-09-20T00:00:00.200Z", seq: 2, type: "tool_result", callId: "c1", success: true, result: { id: "t1" } },
    ]);
    expect(languageAdvisory(graph)).not.toBeNull();
  });
});
