import { test as base } from "@playwright/test";
import { FilesystemRunStore, defineConfig } from "@agent-guard/core";
import { JevDecisionEngine, type DecisionEngine } from "@agent-guard/decision";
import { AgentGuardFixture } from "./fixture.js";

export interface AgentGuardOptions {
  /** Overrides the decision engine; defaults to the real `JevDecisionEngine`. Tests of AgentGuard itself pass a `MockDecisionEngine` here. */
  agentGuardEngine?: DecisionEngine;
  agentGuardStoreRoot?: string;
}

/**
 * PRD §9.1's harness: `test("...", async ({ agentguard }) => { ... })`.
 * Extends Playwright Test's own `test` with one fixture. Using it does not
 * require launching a browser — nothing here touches `page`/`browser`;
 * an agent under test that itself drives a browser would pull in
 * Playwright's `page` fixture separately, unmodified.
 *
 * The options are test-scoped, not worker-scoped: `AgentGuardFixture` is
 * already a fresh instance per test, and Playwright refuses to override a
 * worker-scoped option inside a nested `describe` (it would force a new
 * worker) — test scope keeps `test.use({ agentGuardEngine: ... })` usable
 * anywhere, including nested describes, which golden-suite-style e2e
 * coverage needs.
 */
export const test = base.extend<AgentGuardOptions & { agentguard: AgentGuardFixture }>({
  agentGuardEngine: [undefined, { option: true }],
  agentGuardStoreRoot: [undefined, { option: true }],

  agentguard: async ({ agentGuardEngine, agentGuardStoreRoot }, use, testInfo) => {
    const engine = agentGuardEngine ?? new JevDecisionEngine();
    const store = new FilesystemRunStore(agentGuardStoreRoot);
    const runId = testInfo.testId;
    const fixture = new AgentGuardFixture(runId, engine, store, defineConfig());
    await use(fixture);
    await fixture.dispose();
  },
});

export { expect } from "@playwright/test";
