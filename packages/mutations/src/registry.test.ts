import { describe, expect, it } from "vitest";
import type { AssertionResult, FaultSpec } from "@agent-guard/core";
import { MUTATION_CATALOGUE, resolveMutation, summarizeMutationDimensions } from "./registry.js";

describe("MUTATION_CATALOGUE", () => {
  it("has one entry for every PRD Appendix C id plus the PRD2 F3 four", () => {
    const ids = MUTATION_CATALOGUE.map((e) => e.id);
    for (const id of [
      "http-500",
      "http-429",
      "timeout",
      "stale-data",
      "missing-field",
      "empty-response",
      "malformed-response",
      "permission-denied",
      "duplicate-record",
      "incorrect-data",
      "contradictory-response",
      "prompt-injection",
      "tool-hijacking",
      "ambiguous-input",
      "unauthorized-side-effect",
      "tool-description-injection",
      "tool-rug-pull",
      "memory-poisoning",
      "exfil-bait",
    ]) {
      expect(ids, id).toContain(id);
    }
    expect(ids).toHaveLength(19);
  });
});

describe("resolveMutation", () => {
  it("resolves a network-shaped id to a real FaultSpec", () => {
    const result = resolveMutation("http-429", "/api/payment", { retryAfterMs: 500 });
    expect(result.applicable).toBe(true);
    expect((result as { applicable: true; fault: FaultSpec }).fault).toEqual({
      type: "http-429",
      url: "/api/payment",
      retryAfterMs: 500,
      times: undefined,
    });
  });

  it("reports notApplicable for a browser/data-shaped id, per A4's boundary — it never pretends", () => {
    const result = resolveMutation("tool-hijacking", "/api/anything");
    expect(result).toEqual({
      applicable: false,
      reason: expect.stringContaining("tool-hijacking"),
    });
  });

  it("reports notApplicable for an unknown id rather than throwing", () => {
    // @ts-expect-error deliberately an id outside the catalogue
    const result = resolveMutation("not-a-real-id", "/api/x");
    expect(result.applicable).toBe(false);
  });
});

describe("summarizeMutationDimensions", () => {
  function result(status: AssertionResult["status"]): AssertionResult {
    return { status, signal: "noul-probability", evidence: [] } as unknown as AssertionResult;
  }

  it("tallies a resisted mutation as 1/1 for its dimension", () => {
    const faults = [{ spec: { type: "http-429", url: "/x" } as FaultSpec }];
    const summary = summarizeMutationDimensions(faults, { recoveredFromFailure: result("pass") });
    expect(summary).toEqual({ "http-429": { resisted: 1, total: 1 } });
  });

  it("tallies a non-resisted mutation as 0/1 — this must be provably able to fail, not just pass", () => {
    const faults = [{ spec: { type: "http-429", url: "/x" } as FaultSpec }];
    const summary = summarizeMutationDimensions(faults, { recoveredFromFailure: result("fail") });
    expect(summary).toEqual({ "http-429": { resisted: 0, total: 1 } });
  });

  it("excludes a not_applicable grading result from both counts", () => {
    const faults = [{ spec: { type: "http-429", url: "/x" } as FaultSpec }];
    const summary = summarizeMutationDimensions(faults, { recoveredFromFailure: result("not_applicable") });
    expect(summary).toEqual({});
  });

  it("aggregates multiple faults of the same dimension", () => {
    const faults = [
      { spec: { type: "prompt-injection", url: "/a", field: "f", payload: "p" } as FaultSpec },
      { spec: { type: "prompt-injection", url: "/b", field: "f", payload: "p" } as FaultSpec },
    ];
    const summary = summarizeMutationDimensions(faults, { noPromptInjectionSuccess: result("pass") });
    expect(summary).toEqual({ "prompt-injection": { resisted: 2, total: 2 } });
  });
});
