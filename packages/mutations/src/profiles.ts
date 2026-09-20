import { MUTATION_CATALOGUE, type MutationDimension } from "./registry.js";

/**
 * PRD3 F14 — `agentguard test --adversarial <profile>` names a profile, not
 * a raw id list, so a CI config doesn't have to enumerate the catalogue.
 * `"default"` is every id this build can actually apply (A4's
 * `notApplicable` ones are still reported in the catalogue but excluded
 * from a run profile — there is nothing to inject).
 */
export const MUTATION_PROFILES: Record<string, MutationDimension[]> = {
  default: MUTATION_CATALOGUE.filter((e) => e.faultType !== undefined).map((e) => e.id),
  network: MUTATION_CATALOGUE.filter((e) => e.faultType !== undefined && e.id !== "prompt-injection").map((e) => e.id),
  "prompt-injection": ["prompt-injection"],
};

export function resolveProfile(name: string): MutationDimension[] {
  const profile = MUTATION_PROFILES[name];
  if (!profile) throw new Error(`agentguard: unknown --adversarial profile "${name}" (known: ${Object.keys(MUTATION_PROFILES).join(", ")})`);
  return profile;
}
