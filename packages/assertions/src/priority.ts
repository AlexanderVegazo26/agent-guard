import type { AssertionId, Evidence, EvidenceGraph } from "@alexvegman/core";

/**
 * §6.5 rule 4 — declared selection order for each fan-out cap, applied only
 * when the cap actually engages (measured overflow, `budget.ts`). A claim
 * or tool call earlier in the returned array is more likely to be kept.
 */
export function priorityOrder(
  id: AssertionId,
  items: Evidence[],
  graph: EvidenceGraph,
  destructiveTools: readonly string[],
): Evidence[] {
  if (id === "noUnsupportedClaims" || id === "claimsConsistentWithEvidence" || id === "noFabricatedToolUsage") {
    return orderClaims(items, graph);
  }
  if (
    id === "toolWasAppropriate" ||
    id === "toolArgumentsCorrect" ||
    id === "toolResultUsedCorrectly" ||
    id === "noUnauthorizedToolUse" ||
    id === "noUnauthorizedSideEffect"
  ) {
    return orderToolCalls(items, graph, destructiveTools);
  }
  return items;
}

/**
 * Claims carrying a deterministic `contradicts`/`supports` link first (most
 * likely adjudicable), then claims from the run's final message, then by
 * descending `seq` — a claim no evidence touches is the least likely to be
 * adjudicable and the most likely to be rhetorical framing (TRD §6.5).
 */
function orderClaims(claims: Evidence[], graph: EvidenceGraph): Evidence[] {
  const linked = new Set(
    graph.links
      .filter((l) => l.basis === "deterministic" && (l.relation === "contradicts" || l.relation === "supports"))
      .flatMap((l) => [l.from, l.to]),
  );

  return [...claims].sort((a, b) => {
    const aLinked = linked.has(a.id) ? 1 : 0;
    const bLinked = linked.has(b.id) ? 1 : 0;
    if (aLinked !== bLinked) return bLinked - aLinked;

    const aFinal = a.source === "run.finalOutput" ? 1 : 0;
    const bFinal = b.source === "run.finalOutput" ? 1 : 0;
    if (aFinal !== bFinal) return bFinal - aFinal;

    return b.seq - a.seq;
  });
}

/**
 * Tool calls whose arguments reference the user request first, then calls
 * to `destructiveTools`, then by descending `seq` — an unexamined destructive
 * call is the single most expensive thing this assertion can miss (TRD §6.5).
 */
function orderToolCalls(calls: Evidence[], graph: EvidenceGraph, destructiveTools: readonly string[]): Evidence[] {
  const task = graph.task.toLowerCase();

  return [...calls].sort((a, b) => {
    const aReferences = referencesTask(a, task) ? 1 : 0;
    const bReferences = referencesTask(b, task) ? 1 : 0;
    if (aReferences !== bReferences) return bReferences - aReferences;

    const aDestructive = destructiveTools.includes(toolNameOf(a)) ? 1 : 0;
    const bDestructive = destructiveTools.includes(toolNameOf(b)) ? 1 : 0;
    if (aDestructive !== bDestructive) return bDestructive - aDestructive;

    return b.seq - a.seq;
  });
}

function toolNameOf(call: Evidence): string {
  return (call.content as { tool: string }).tool;
}

function referencesTask(call: Evidence, taskLower: string): boolean {
  const args = (call.content as { arguments: unknown }).arguments;
  const values = extractStringValues(args);
  return values.some((v) => v.length > 2 && taskLower.includes(v.toLowerCase()));
}

function extractStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(extractStringValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(extractStringValues);
  return [];
}
