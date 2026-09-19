import { describe, expect, it } from "vitest";
import { TranscriptAdapter, parseCommand } from "./transcriptAdapter.js";

describe("parseCommand", () => {
  it("splits a verb from its arguments, keeping quoted arguments intact", () => {
    expect(parseCommand("open https://example.com")).toEqual({ verb: "open", args: ["https://example.com"] });
    expect(parseCommand('fill "#name" "Jane Doe"')).toEqual({ verb: "fill", args: ["#name", "Jane Doe"] });
  });
});

describe("TranscriptAdapter — generic, tool-agnostic", () => {
  it("throws if used before start()", () => {
    const adapter = new TranscriptAdapter();
    expect(() => adapter.captureCommand("do-a-thing")).toThrow(/start\(\)/);
  });

  it("turns a plain command/output transcript into tool_call/tool_result pairs, with no tool-specific parsing", async () => {
    const adapter = new TranscriptAdapter("bash");
    await adapter.start({ task: "List files, then print one of them." });

    adapter.captureCommand("ls -la");
    adapter.captureOutput("total 3\ndrwxr-xr-x  a.txt");

    adapter.captureCommand("cat a.txt");
    adapter.captureOutput("hello world");

    const run = await adapter.stop();
    const toolCalls = run.events.filter((e) => e.type === "tool_call");
    const toolResults = run.events.filter((e) => e.type === "tool_result");

    expect(toolCalls.map((e) => (e as { tool: string }).tool)).toEqual(["bash:ls", "bash:cat"]);
    expect(toolResults).toHaveLength(2);
    expect(toolResults.every((e) => (e as { success: boolean }).success)).toBe(true);
    // The generic adapter never infers browser_state or any tool-specific event.
    expect(run.events.some((e) => e.type === "browser_state")).toBe(false);
  });

  it("marks a tool_result as failed via the text heuristic when no explicit success is given", async () => {
    const adapter = new TranscriptAdapter();
    await adapter.start({ task: "Run a command that fails." });

    adapter.captureCommand("deploy --env prod");
    adapter.captureOutput("Error: permission denied");

    const run = await adapter.stop();
    const result = run.events.find((e) => e.type === "tool_result") as { success: boolean };
    expect(result.success).toBe(false);
  });

  it("an explicit success argument overrides the text heuristic — a real exit code is ground truth", async () => {
    const adapter = new TranscriptAdapter();
    await adapter.start({ task: "Run a command whose real exit code we already know." });

    adapter.captureCommand("some-tool");
    // Text alone would read as an error, but the caller knows (e.g. from a
    // real process exit code of 0) that the command actually succeeded.
    adapter.captureOutput("no error handling configured for this feature yet", true);

    const run = await adapter.stop();
    const result = run.events.find((e) => e.type === "tool_result") as { success: boolean };
    expect(result.success).toBe(true);
  });

  it("resolves an unobserved command (captureCommand called twice in a row) rather than dropping it", async () => {
    const adapter = new TranscriptAdapter();
    await adapter.start({ task: "Do two things." });

    adapter.captureCommand("step-one");
    adapter.captureCommand("step-two"); // no captureOutput in between

    const run = await adapter.stop();
    expect(run.events.filter((e) => e.type === "tool_call")).toHaveLength(2);
    expect(run.events.filter((e) => e.type === "tool_result")).toHaveLength(2);
  });
});
