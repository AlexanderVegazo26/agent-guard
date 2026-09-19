import { describe, expect, it } from "vitest";
import { runSourceAdvisory } from "./runSourceAdvisory.js";
import { AgentRun } from "./schema.js";

const BASE = {
  id: "run-source-test",
  task: "Do the thing.",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:01.000Z",
  schemaVersion: 1 as const,
  events: [],
};

describe("runSourceAdvisory — PRD2 F5", () => {
  it("returns null when source is omitted (the default: observed)", () => {
    const run = AgentRun.parse({ ...BASE });
    expect(runSourceAdvisory(run)).toBeNull();
  });

  it("returns null when source is explicitly 'observed'", () => {
    const run = AgentRun.parse({ ...BASE, source: "observed" });
    expect(runSourceAdvisory(run)).toBeNull();
  });

  it("returns a one-line advisory when source is 'self-reported'", () => {
    const run = AgentRun.parse({ ...BASE, source: "self-reported" });
    const advisory = runSourceAdvisory(run);
    expect(advisory).not.toBeNull();
    expect(advisory).toContain("self-reported");
    expect(advisory).toContain("§9.2");
  });
});
