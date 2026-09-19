import { DefaultEvidenceCompiler, defineConfig, type AssertionId, type AssertionResult, type PolicyConfig } from "@agent-guard/core";
import { evaluate } from "@agent-guard/assertions";
import type { DecisionEngine } from "@agent-guard/decision";
import type { GoldenFixture } from "./fixtures.js";

export async function runFixture(
  fixture: GoldenFixture,
  engine: DecisionEngine,
  policy: PolicyConfig = defineConfig(),
): Promise<Record<string, AssertionResult>> {
  const graph = await new DefaultEvidenceCompiler().compile(fixture.run);
  // "coverageNote" is PRD §12's branch-(b) declaration, not an assertion id.
  const requested = Object.keys(fixture.expected).filter((k) => k !== "coverageNote") as AssertionId[];
  return evaluate(graph, requested, engine, policy);
}
