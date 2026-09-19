import type { AgentRun } from "./schema.js";

/**
 * PRD2 F5 — a one-line advisory for a self-reported run, the same pattern
 * as `languageAdvisory`: a real risk this project already knows about
 * (PRD v0.6 §9.2's "agent emits" mode is explicitly the least-trusted
 * attachment path) surfaced at run time instead of stated once in a
 * document and then silently forgotten.
 */
export function runSourceAdvisory(run: AgentRun): string | null {
  if (run.source !== "self-reported") return null;
  return (
    "agentguard: this run's evidence is self-reported (the agent's own harness authored every event), " +
    "not independently observed. A self-reported \"nothing happened\" is not evidence that nothing happened — " +
    "treat completion and absence claims here with extra scrutiny (PRD v0.6 §9.2)."
  );
}
