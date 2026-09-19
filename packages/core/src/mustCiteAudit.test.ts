import { describe, expect, it } from "vitest";
import { auditMustCite } from "./mustCiteAudit.js";
import { DefaultEvidenceCompiler } from "./graph.js";
import { AgentRun } from "./schema.js";

const BASE = {
  id: "run-audit-test",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:01.000Z",
  schemaVersion: 1 as const,
};

async function graphWithOneToolCall() {
  const run = AgentRun.parse({
    ...BASE,
    task: "Delete the todo.",
    events: [{ id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "tool_call", callId: "c1", tool: "delete_todo", arguments: {} }],
  });
  return new DefaultEvidenceCompiler().compile(run);
}

describe("auditMustCite — PRD2 F10 / AUTOFIX.md §4.1's mechanical narrow slice", () => {
  it("finds nothing when every mustCite id actually exists in the compiled graph", async () => {
    const graph = await graphWithOneToolCall();
    const findings = auditMustCite(graph, { toolWasAppropriate: { mustCite: ["e-ev-1"] } });
    expect(findings).toEqual([]);
  });

  it("flags a mustCite id that was never produced by the compiler", async () => {
    const graph = await graphWithOneToolCall();
    const findings = auditMustCite(graph, { toolWasAppropriate: { mustCite: ["e-ev-1", "e-does-not-exist"] } });
    expect(findings).toEqual([{ assertionId: "toolWasAppropriate", missingEvidenceIds: ["e-does-not-exist"] }]);
  });

  it("ignores an assertion with no mustCite at all", async () => {
    const graph = await graphWithOneToolCall();
    expect(auditMustCite(graph, { evidenceSufficient: {} })).toEqual([]);
  });

  it("ignores the coverageNote pseudo-entry (it has no mustCite field, same shape as any other exempt entry)", async () => {
    const graph = await graphWithOneToolCall();
    const findings = auditMustCite(graph, { coverageNote: { tests: "x" } as never });
    expect(findings).toEqual([]);
  });

  it("reports one finding per assertion, each listing only its own missing ids", async () => {
    const graph = await graphWithOneToolCall();
    const findings = auditMustCite(graph, {
      toolWasAppropriate: { mustCite: ["e-missing-1"] },
      goalCompleted: { mustCite: ["e-ev-1", "e-missing-2"] },
    });
    expect(findings).toHaveLength(2);
    expect(findings.find((f) => f.assertionId === "toolWasAppropriate")!.missingEvidenceIds).toEqual(["e-missing-1"]);
    expect(findings.find((f) => f.assertionId === "goalCompleted")!.missingEvidenceIds).toEqual(["e-missing-2"]);
  });
});
