import { describe, expect, it } from "vitest";
import { AgentRun, DefaultEvidenceCompiler } from "@agent-guard/core";
import { checkEvidenceSufficiency, REQUIREMENTS, type AssertionRequirements } from "./requirements.js";

/**
 * §6.3's sufficiency table had no dedicated unit test before PRD3 Phase A/B
 * (only exercised indirectly through the pipeline and golden fixtures).
 * This covers the "review wins over not_applicable" rule directly, and
 * PRD3 F12's `minProvenance` filter — a capability the requirements table
 * exposes but no shipped assertion opts into yet (see `requirements.ts`'s
 * own doc comment on why not).
 */

const BASE = {
  id: "run-requirements-test",
  agent: { name: "test-agent" },
  faults: [],
  startedAt: "2026-09-20T00:00:00.000Z",
  endedAt: "2026-09-20T00:00:01.000Z",
  schemaVersion: 1 as const,
};

describe("checkEvidenceSufficiency", () => {
  it("is sufficient when every requirement is met", async () => {
    const run = AgentRun.parse({
      ...BASE,
      task: "Add a todo.",
      events: [{ id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "tool_call", callId: "c1", tool: "add_todo", arguments: {} }],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const req: AssertionRequirements = { requires: [{ type: "tool_call", min: 1, unmet: "not_applicable" }], reason: "test" };

    expect(checkEvidenceSufficiency(graph, req)).toEqual({ sufficient: true });
  });

  it("review wins over not_applicable when both are unmet at once (TRD §6.3)", async () => {
    const run = AgentRun.parse({ ...BASE, task: "Add a todo.", events: [] });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const req: AssertionRequirements = {
      requires: [
        { type: "network", min: 1, unmet: "review" },
        { type: "tool_call", min: 1, unmet: "not_applicable" },
      ],
      reason: "test",
    };

    const result = checkEvidenceSufficiency(graph, req);
    expect(result.sufficient).toBe(false);
    expect(result.outcome).toBe("review");
    expect(result.missing).toEqual(["network", "tool_call"]);
  });

  it("minProvenance (PRD3 F12): an item below the required provenance does not count toward min", async () => {
    const run = AgentRun.parse({
      ...BASE,
      task: "Check the payment.",
      events: [{ id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "network", method: "POST", url: "/api/payment", status: 200, provenance: "self-reported" }],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const req: AssertionRequirements = {
      requires: [{ type: "network", min: 1, minProvenance: "wire", unmet: "review" }],
      reason: "test",
    };

    expect(checkEvidenceSufficiency(graph, req)).toMatchObject({ sufficient: false, outcome: "review" });
  });

  it("minProvenance (PRD3 F12): an item at or above the required provenance does count", async () => {
    const run = AgentRun.parse({
      ...BASE,
      task: "Check the payment.",
      events: [{ id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "network", method: "POST", url: "/api/payment", status: 200, provenance: "wire" }],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);
    const req: AssertionRequirements = {
      requires: [{ type: "network", min: 1, minProvenance: "wire", unmet: "review" }],
      reason: "test",
    };

    expect(checkEvidenceSufficiency(graph, req)).toEqual({ sufficient: true });
  });

  // Every event `DefaultEvidenceCompiler` extracts is backfilled from
  // `run.source` when it carries no provenance of its own (PRD3 F12
  // acceptance — see `graph.test.ts`), so an item with genuinely
  // undefined provenance can no longer come out of the compiler. It can
  // still reach `checkEvidenceSufficiency` from anywhere that builds an
  // `EvidenceGraph` without going through the compiler (a hand-built
  // graph in a test, or a future non-compiler evidence source) — this
  // proves the fail-safe in `meetsMinProvenance` directly against that
  // interface, independent of the compiler's own backfill.
  it("minProvenance (PRD3 F12): an item with no provenance at all never satisfies a stated minimum", () => {
    const item = {
      id: "e-1",
      type: "network" as const,
      source: "ev-1",
      content: { status: 200 },
      derivedFrom: ["ev-1"],
      timestamp: "2026-09-20T00:00:00.100Z",
      seq: 1,
    };
    const graph = {
      task: "Check the payment.",
      items: [item],
      links: [],
      byType: (type: string) => graph.items.filter((e) => e.type === type),
      related: () => [],
      window: () => graph.items,
      linksAmong: () => [],
    };
    const req: AssertionRequirements = {
      requires: [{ type: "network", min: 1, minProvenance: "harness", unmet: "review" }],
      reason: "test",
    };

    expect(checkEvidenceSufficiency(graph as unknown as Parameters<typeof checkEvidenceSufficiency>[0], req)).toMatchObject({ sufficient: false });
  });

  // PRD3 F12's own acceptance text, against the real, shipped
  // `noFabricatedCompletion` requirement (not a synthetic one): "a
  // self-reported network event with status 200 does not satisfy
  // noFabricatedCompletion's requirement; the same event captured by the
  // proxy does."
  it("noFabricatedCompletion (PRD3 F12 acceptance): a self-reported network event does not satisfy the requirement", async () => {
    const run = AgentRun.parse({
      ...BASE,
      task: "Purchase the item.",
      finalOutput: "Payment completed successfully.",
      source: "self-reported",
      events: [{ id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "network", method: "POST", url: "/api/payment", status: 200, provenance: "self-reported" }],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);

    const result = checkEvidenceSufficiency(graph, REQUIREMENTS.noFabricatedCompletion);
    expect(result).toMatchObject({ sufficient: false, outcome: "review" });
  });

  it("noFabricatedCompletion (PRD3 F12 acceptance): the same event captured by the proxy (wire) does satisfy the requirement", async () => {
    const run = AgentRun.parse({
      ...BASE,
      task: "Purchase the item.",
      finalOutput: "Payment completed successfully.",
      events: [{ id: "ev-1", timestamp: "2026-09-20T00:00:00.100Z", seq: 1, type: "network", method: "POST", url: "/api/payment", status: 200, provenance: "wire" }],
    });
    const graph = await new DefaultEvidenceCompiler().compile(run);

    const result = checkEvidenceSufficiency(graph, REQUIREMENTS.noFabricatedCompletion);
    expect(result).toEqual({ sufficient: true });
  });
});
