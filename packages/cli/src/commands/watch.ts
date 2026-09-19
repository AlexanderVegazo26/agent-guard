import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DefaultEvidenceCompiler,
  FilesystemRunStore,
  TranscriptAdapter,
  computeExitCode,
  formatConsole,
  languageAdvisory,
  loadPolicyConfig,
  type AssertionId,
} from "@agent-guard/core";
import { evaluate } from "@agent-guard/assertions";
import type { DecisionAnswer, DecisionEngine, DecisionResult, DecisionState, EngineCapabilities, QuestionSet } from "@agent-guard/decision";
import { formatHtml } from "../reporters/html.js";

export interface WatchCommandOptions {
  task: string;
  /** JSONL file of `{"command": "...", "output": "..."}` lines — the zero-setup path for any agent that already logs its tool calls. */
  transcriptPath?: string;
  /** Spawn an arbitrary command directly — the true zero-config path: works with any CLI-driven agent, no logging changes required. */
  spawn?: { command: string; args: string[] };
  storeRoot?: string;
  assertions?: AssertionId[];
  /** Explicit `--config <path>`, overriding the default search for `agentguard.config.{ts,js,...}` in cwd (PRD2 G0b). */
  configPath?: string;
}

/**
 * `agentguard watch` — the "point this at any agent, right now" command.
 * Deliberately needs no `TYPESAFE_API_KEY`: it evaluates only the
 * assertions that resolve deterministically (§6.6's pre-pass) — real
 * agent-behavior checks (fabricated completion, fabricated tool usage,
 * evidence sufficiency) with zero live spend and zero setup beyond having
 * something to point it at. Deeper, semantic assertions still need
 * `agentguard test --live` against a properly captured run; this command
 * is the five-minute front door, not a replacement for it.
 */
export async function runWatchCommand(options: WatchCommandOptions): Promise<number> {
  if (!options.transcriptPath && !options.spawn) {
    console.error("agentguard watch: pass --transcript <file> or `-- <command> [args...]`");
    return 3;
  }

  const adapter = new TranscriptAdapter("watch");
  await adapter.start({ task: options.task });

  let lastOutput = "";

  if (options.transcriptPath) {
    const lines = (await readFile(options.transcriptPath, "utf8")).split("\n").filter((l) => l.trim().length > 0);
    for (const line of lines) {
      const { command, output } = JSON.parse(line) as { command: string; output: string };
      adapter.captureCommand(command);
      adapter.captureOutput(output);
      lastOutput = output;
    }
  } else if (options.spawn) {
    const { command, args } = options.spawn;
    adapter.captureCommand([command, ...args].join(" "));
    const { output, exitCode } = await runProcess(command, args);
    // A real exit code is ground truth — never guessed from output text (TranscriptAdapter's own heuristic fallback).
    adapter.captureOutput(output, exitCode === 0);
    lastOutput = output;
  }

  const run = await adapter.stop();
  // No generic notion of "the agent's final claim" exists for a raw
  // command transcript, so the last output stands in for it — enough for
  // claim extraction (graph.ts) to have something to check evidence
  // against, at the cost of occasionally extracting a "claim" that's
  // really just log output. Truncated so one runaway process can't blow
  // the evidence graph up.
  run.finalOutput = lastOutput.length > 4000 ? `${lastOutput.slice(0, 4000)}…` : lastOutput || undefined;
  const graph = await new DefaultEvidenceCompiler().compile(run);

  const { policy, configPath } = await loadPolicyConfig({ path: options.configPath });
  if (configPath) console.log(`agentguard: using config ${configPath}`);

  const assertions = options.assertions ?? DEFAULT_WATCH_ASSERTIONS;
  const results = await evaluate(graph, assertions, new NoLiveEngine(), policy);

  console.log(formatConsole(run.id, results));
  const advisory = languageAdvisory(graph);
  if (advisory) console.log(`\n  ${advisory}`);
  console.log(
    "\n  agentguard watch checks only what code can prove without a decision engine (PRD §7). For semantic checks\n  (did the agent choose the right tool, recover from a failure honestly, ...) run `agentguard test --live`\n  against a properly captured run.\n",
  );

  const store = new FilesystemRunStore(options.storeRoot);
  await store.saveRun(run);
  await store.saveEvidence(run.id, { task: graph.task, items: graph.items, links: graph.links });
  await store.saveDecisions(run.id, results);

  const reportsDir = path.join(options.storeRoot ?? path.join(process.cwd(), ".agentguard"), "reports");
  await mkdir(reportsDir, { recursive: true });
  const htmlPath = path.join(reportsDir, `watch-${run.id}.html`);
  await writeFile(htmlPath, formatHtml({ [run.id]: results }), "utf8");
  console.log(`  wrote ${htmlPath}`);

  return computeExitCode(results);
}

/**
 * No API key required for any of these: `evidenceSufficient` always
 * resolves in the §6.6 deterministic pre-pass, and the other two resolve
 * there or via the §6.3 requirements table for most raw transcripts (no
 * network evidence to check a completion claim against, most claims
 * naming no specific tool). When one of them genuinely can't be settled
 * without a live decision engine, `NoLiveEngine` below abstains honestly
 * (REVIEW) instead of crashing or guessing.
 */
const DEFAULT_WATCH_ASSERTIONS: AssertionId[] = ["evidenceSufficient", "noFabricatedCompletion", "noFabricatedToolUsage"];

/**
 * `agentguard watch` never spends `TYPESAFE_API_KEY` — that's the whole
 * point. But an assertion whose deterministic/requirements fast paths
 * don't resolve it still needs *some* answer from the pipeline. Rather
 * than `MockDecisionEngine({})`'s "throw — you forgot to script this"
 * behavior (correct for tests, wrong for a real CLI command) or silently
 * guessing pass/fail (TRD §10.4: an unavailable engine must never yield
 * PASS), this returns a genuinely uncertain answer for every primitive —
 * mid-band Noul, zero-confidence Choice/Score — so the existing verdict
 * machinery lands on REVIEW by construction, never a fabricated verdict.
 */
class NoLiveEngine implements DecisionEngine {
  capabilities(): EngineCapabilities {
    return { tokenBudget: 32_000, supportsBatch: true, primitives: ["noul", "score", "choice"] };
  }

  async decide(_state: DecisionState, questions: QuestionSet): Promise<DecisionResult> {
    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, question] of Object.entries(questions)) {
      answers[id] = this.abstain(question.type, question.type === "choice" ? question.criteria : undefined);
    }
    return { answers, usage: { inputTokens: 0, outputTokens: 0 } };
  }

  private abstain(type: "noul" | "score" | "choice", choiceCriteria?: Record<string, unknown>): DecisionAnswer {
    if (type === "noul") return { type: "noul", noul: 0.5 };
    if (type === "score") return { type: "score", score: 0, confidence: 0, legend: {}, probabilities: {} };
    const firstOption = choiceCriteria ? Object.keys(choiceCriteria)[0] : undefined;
    return { type: "choice", choice: firstOption ?? "unknown", confidence: 0, probabilities: {} };
  }
}

function runProcess(command: string, args: string[]): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => resolve({ output, exitCode: code ?? 1 }));
  });
}
