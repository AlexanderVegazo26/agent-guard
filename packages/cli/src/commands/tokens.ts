import { FilesystemRunStore, type AssertionResult } from "@agent-guard/core";

export interface TokensCommandOptions {
  /** A specific run id to report on. Omitted: every stored run. */
  runId?: string;
  storeRoot?: string;
}

interface RunUsage {
  runId: string;
  startedAt: string;
  inputTokens: number;
  outputTokens: number;
  /** How many `decide()` calls this run made — a run with 10 assertions can still be 1 call (union-batch) or 10 (split-batch/fan-out-cap). */
  calls: number;
  /** Assertion ids this run evaluated with no `usage` recorded (deterministic/not-applicable — never billed). */
  free: string[];
}

/**
 * The headache this closes: an LLM-backed pipeline's token spend is
 * invisible until a provider's own dashboard reports it, hours later and
 * mixed in with every other workload sharing that key. AgentGuard already
 * gets `usage.input_tokens`/`usage.output_tokens` back on every real
 * `decide()` call (`DecisionEngine.decide`); this command is just the
 * first place that surfaces it back to whoever is running `agentguard`,
 * per run and per assertion, instead of discarding it after the verdict
 * is computed.
 *
 * Deliberately built on `decisions.json`, already written by every `test`/
 * `watch`/`replay` run — no new ledger, no new failure mode, no run this
 * command can see that `agentguard history` couldn't already load.
 */
export async function runTokensCommand(options: TokensCommandOptions): Promise<number> {
  const store = new FilesystemRunStore(options.storeRoot);
  const runIds = options.runId ? [options.runId] : await store.listRunIds();

  if (runIds.length === 0) {
    console.log("agentguard tokens: no stored runs yet.");
    return 0;
  }

  const perRun: RunUsage[] = [];
  for (const runId of runIds) {
    const decisions = await store.loadDecisions(runId);
    if (!decisions) {
      if (options.runId) {
        console.error(`agentguard tokens: no decisions.json found for run "${runId}" — has \`test\`/\`watch\`/\`replay\` evaluated it yet?`);
        return 3;
      }
      continue;
    }
    const run = await store.loadRun(runId);
    perRun.push(summarizeRun(runId, run?.startedAt ?? "", decisions));
  }

  if (perRun.length === 0) {
    console.log(`agentguard tokens: no run recorded usage yet.`);
    return 0;
  }

  perRun.sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  let totalInput = 0;
  let totalOutput = 0;
  for (const r of perRun) {
    console.log(`${r.startedAt}  ${r.runId}`);
    console.log(`  input=${r.inputTokens.toLocaleString()}  output=${r.outputTokens.toLocaleString()}  calls=${r.calls}`);
    if (r.free.length > 0) {
      console.log(`  no engine call (deterministic/not-applicable): ${r.free.join(", ")}`);
    }
    totalInput += r.inputTokens;
    totalOutput += r.outputTokens;
  }

  console.log("");
  console.log(`${perRun.length} run(s) — total input=${totalInput.toLocaleString()} output=${totalOutput.toLocaleString()} (${(totalInput + totalOutput).toLocaleString()} total tokens)`);
  if (perRun.length > 1) {
    console.log(`average per run: input=${Math.round(totalInput / perRun.length).toLocaleString()} output=${Math.round(totalOutput / perRun.length).toLocaleString()}`);
  }

  return 0;
}

function summarizeRun(runId: string, startedAt: string, decisions: Record<string, AssertionResult>): RunUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  const seenCalls = new Set<string>();
  const free: string[] = [];

  for (const [assertionId, result] of Object.entries(decisions)) {
    if (!result.usage) {
      free.push(assertionId);
      continue;
    }
    // A union-batch or split-batch call stamps the SAME usage object onto
    // every assertion it decided (pipeline.ts's `withUsage`) — dedupe by
    // the usage values themselves plus assertion id so this only counts
    // a shared batch's cost once per assertion, never once per call *and*
    // once per assertion double-counted.
    const key = `${assertionId}:${result.usage.inputTokens}:${result.usage.outputTokens}`;
    if (seenCalls.has(key)) continue;
    seenCalls.add(key);
    inputTokens += result.usage.inputTokens;
    outputTokens += result.usage.outputTokens;
  }

  // Distinct (inputTokens, outputTokens) pairs approximate distinct
  // `decide()` calls — exact only when no two calls in the same run
  // coincidentally reported identical usage, a real but rare limitation
  // worth documenting rather than hiding.
  const distinctUsages = new Set([...seenCalls].map((k) => k.split(":").slice(1).join(":")));

  return { runId, startedAt, inputTokens, outputTokens, calls: distinctUsages.size, free };
}
