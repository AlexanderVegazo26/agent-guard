import { describe, expect, it } from "vitest";
import { DefaultEvidenceCompiler, defineConfig } from "@agent-guard/core";
import { evaluate } from "@agent-guard/assertions";
import { MockDecisionEngine } from "@agent-guard/decision";
import { PlaywrightCliAdapter, parseCliCommand } from "./cliAdapter.js";

describe("parseCliCommand", () => {
  it("splits a verb from its arguments", () => {
    expect(parseCliCommand("open https://example.com/todos")).toEqual({
      verb: "open",
      args: ["https://example.com/todos"],
    });
  });

  it("keeps quoted arguments intact", () => {
    expect(parseCliCommand('fill "#todo-input" "Buy milk"')).toEqual({
      verb: "fill",
      args: ["#todo-input", "Buy milk"],
    });
  });
});

describe("PlaywrightCliAdapter", () => {
  it("throws if used before start()", () => {
    const adapter = new PlaywrightCliAdapter();
    expect(() => adapter.captureCommand("open https://example.com")).toThrow(/start\(\)/);
  });

  it("turns a command/output transcript into tool_call/tool_result and a browser_state snapshot", async () => {
    const adapter = new PlaywrightCliAdapter();
    await adapter.start({ task: "Add a todo called Buy milk." });

    adapter.captureCommand("open https://example.com/todos");
    adapter.captureOutput("- Navigated to https://example.com/todos");

    adapter.captureCommand('click "#add-button"');
    adapter.captureOutput("- Clicked #add-button");

    adapter.captureCommand("snapshot");
    adapter.captureOutput("Page URL: https://example.com/todos\nPage Title: My Todos\n- list \"todos\"");

    const run = await adapter.stop();

    expect(run.task).toBe("Add a todo called Buy milk.");
    const toolCalls = run.events.filter((e) => e.type === "tool_call");
    const toolResults = run.events.filter((e) => e.type === "tool_result");
    const browserStates = run.events.filter((e) => e.type === "browser_state");

    expect(toolCalls.map((e) => (e as { tool: string }).tool)).toEqual([
      "playwright-cli:open",
      "playwright-cli:click",
      "playwright-cli:snapshot",
    ]);
    expect(toolResults).toHaveLength(3);
    expect(toolResults.every((e) => (e as { success: boolean }).success)).toBe(true);

    expect(browserStates).toHaveLength(1);
    const snapshot = browserStates[0] as { url?: string; title?: string };
    expect(snapshot.url).toBe("https://example.com/todos");
    expect(snapshot.title).toBe("My Todos");
  });

  it("marks a tool_result as failed when the CLI output reports an error", async () => {
    const adapter = new PlaywrightCliAdapter();
    await adapter.start({ task: "Click a button that doesn't exist." });

    adapter.captureCommand('click "#missing"');
    adapter.captureOutput("Error: no element matches selector #missing");

    const run = await adapter.stop();
    const result = run.events.find((e) => e.type === "tool_result") as { success: boolean } | undefined;
    expect(result?.success).toBe(false);
  });

  it("resolves an unobserved command (captureCommand called twice in a row) rather than dropping it", async () => {
    const adapter = new PlaywrightCliAdapter();
    await adapter.start({ task: "Do two things." });

    adapter.captureCommand("open https://example.com");
    adapter.captureCommand("click \"#next\""); // no captureOutput in between

    const run = await adapter.stop();
    expect(run.events.filter((e) => e.type === "tool_call")).toHaveLength(2);
    expect(run.events.filter((e) => e.type === "tool_result")).toHaveLength(2);
  });

  it("produces a run the rest of the pipeline (compiler + assertions) can evaluate", async () => {
    const adapter = new PlaywrightCliAdapter();
    await adapter.start({ task: "Add a todo called Buy milk." });
    adapter.captureCommand('fill "#todo-input" "Buy milk"');
    adapter.captureOutput("- Filled #todo-input");
    adapter.captureCommand('click "#add-button"');
    adapter.captureOutput("- Clicked #add-button");
    const run = await adapter.stop();
    run.finalOutput = "Added Buy milk to the list.";

    const graph = await new DefaultEvidenceCompiler().compile(run);
    const engine = new MockDecisionEngine({ goalCompleted: { type: "noul", noul: 0.95 } });
    const results = await evaluate(graph, ["goalCompleted"], engine, defineConfig());

    expect(results.goalCompleted!.status).toBe("pass");
  });
});
