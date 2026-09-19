import { describe, expect, it } from "vitest";
import { MockFixProposerEngine, type FixProposerRequest } from "./fixProposer.js";

describe("MockFixProposerEngine", () => {
  it("returns the scripted result and records the request", async () => {
    const engine = new MockFixProposerEngine({ diff: "- old\n+ new", rationale: "because" });
    const request: FixProposerRequest = {
      targetPath: "agent.md",
      currentText: "old",
      recurringEvidence: [{ assertionId: "avoidedUnnecessaryActions", occurrences: 3, evidenceExcerpts: ["tool_call: snapshot"] }],
    };

    const result = await engine.propose(request);

    expect(result).toEqual({ diff: "- old\n+ new", rationale: "because" });
    expect(engine.calls).toEqual([request]);
  });

  it("supports a function script for request-dependent responses", async () => {
    const engine = new MockFixProposerEngine((req) => ({
      diff: `diff for ${req.recurringEvidence[0]!.assertionId}`,
      rationale: "r",
    }));

    const result = await engine.propose({
      targetPath: "agent.md",
      currentText: "",
      recurringEvidence: [{ assertionId: "toolWasAppropriate", occurrences: 2, evidenceExcerpts: [] }],
    });

    expect(result.diff).toBe("diff for toolWasAppropriate");
  });
});
