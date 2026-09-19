import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAuditFixturesCommand } from "./auditFixtures.js";

const RUN_JSON = {
  id: "run-synthetic",
  task: "Do the thing.",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:01.000Z",
  schemaVersion: 1,
  events: [{ id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "tool_call", callId: "c1", tool: "x", arguments: {} }],
};

describe("agentguard audit-fixtures", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-audit-test-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  async function writeFixture(name: string, expected: unknown): Promise<void> {
    const dir = path.join(root, name);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "run.json"), JSON.stringify(RUN_JSON), "utf8");
    await writeFile(path.join(dir, "expected.json"), JSON.stringify(expected), "utf8");
  }

  it("exits 0 when every fixture's mustCite ids resolve to real evidence", async () => {
    await writeFixture("01-ok", { toolWasAppropriate: { status: "pass", mustCite: ["e-ev-1"] } });
    const exitCode = await runAuditFixturesCommand({ fixturesRoot: root });
    expect(exitCode).toBe(0);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("1 fixture(s) checked");
  });

  it("exits 1 and names the fixture and the missing id when mustCite references nonexistent evidence", async () => {
    await writeFixture("02-broken", { toolWasAppropriate: { status: "fail", mustCite: ["e-does-not-exist"] } });
    const exitCode = await runAuditFixturesCommand({ fixturesRoot: root });
    expect(exitCode).toBe(1);
    const output = errorSpy.mock.calls.flat().join("\n");
    expect(output).toContain("02-broken");
    expect(output).toContain("e-does-not-exist");
  });

  it("checks every fixture in the directory, not just the first", async () => {
    await writeFixture("01-ok", { toolWasAppropriate: { status: "pass", mustCite: ["e-ev-1"] } });
    await writeFixture("02-broken", { toolWasAppropriate: { status: "fail", mustCite: ["e-nope"] } });
    const exitCode = await runAuditFixturesCommand({ fixturesRoot: root });
    expect(exitCode).toBe(1);
    expect(errorSpy.mock.calls.flat().join("\n")).toContain("02-broken");
  });
});
