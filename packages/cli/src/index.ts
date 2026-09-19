#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AssertionId, HumanVerdict } from "@agent-guard/core";
import { runTestCommand } from "./commands/test.js";
import { runCalibrateCommand } from "./commands/calibrate.js";
import { runReplayCommand } from "./commands/replay.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runInitCommand } from "./commands/init.js";
import { runReportCommand } from "./commands/report.js";
import { runCompareCommand } from "./commands/compare.js";
import { runWatchCommand } from "./commands/watch.js";
import { runAutofixProposeCommand, runAutofixShowCommand } from "./commands/autofix.js";
import { runReviewListCommand, runReviewRecordCommand } from "./commands/review.js";
import { runExportCommand, runVerifyPackCommand } from "./commands/exportPack.js";

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exitCode = command ? 0 : 1;
    return;
  }

  if (command === "init") {
    process.exitCode = await runInitCommand(process.cwd());
    return;
  }

  if (command === "test") {
    const fixturesRoot = flagValue(rest, "--fixtures") ?? path.join(process.cwd(), "fixtures", "golden");
    process.exitCode = await runTestCommand({
      fixturesRoot,
      live: rest.includes("--live"),
      storeRoot: flagValue(rest, "--store"),
      escalate: rest.includes("--escalate"),
      configPath: flagValue(rest, "--config"),
    });
    return;
  }

  if (command === "replay") {
    const runId = rest.find((a) => !a.startsWith("--"));
    if (!runId) {
      console.error("agentguard replay: a run id is required, e.g. `agentguard replay run-01-happy-path`");
      process.exitCode = 1;
      return;
    }
    const assertionsFlag = flagValue(rest, "--assertions");
    process.exitCode = await runReplayCommand({
      runId,
      live: rest.includes("--live"),
      storeRoot: flagValue(rest, "--store"),
      assertions: assertionsFlag ? (assertionsFlag.split(",") as AssertionId[]) : undefined,
      escalate: rest.includes("--escalate"),
      configPath: flagValue(rest, "--config"),
    });
    return;
  }

  if (command === "calibrate") {
    process.exitCode = await runCalibrateCommand({ storeRoot: flagValue(rest, "--store") });
    return;
  }

  if (command === "doctor") {
    process.exitCode = await runDoctorCommand({ cwd: process.cwd(), live: rest.includes("--live") });
    return;
  }

  if (command === "report") {
    process.exitCode = await runReportCommand({ storeRoot: flagValue(rest, "--store") });
    return;
  }

  if (command === "watch") {
    const dashDashIndex = rest.indexOf("--");
    const flagsPart = dashDashIndex >= 0 ? rest.slice(0, dashDashIndex) : rest;
    const spawnParts = dashDashIndex >= 0 ? rest.slice(dashDashIndex + 1) : [];

    const task = flagValue(flagsPart, "--task") ?? "Observed via `agentguard watch` (no --task given).";
    const transcriptPath = flagValue(flagsPart, "--transcript");
    const [spawnCommand, ...spawnArgs] = spawnParts;

    process.exitCode = await runWatchCommand({
      task,
      transcriptPath,
      spawn: spawnCommand ? { command: spawnCommand, args: spawnArgs } : undefined,
      storeRoot: flagValue(flagsPart, "--store"),
      configPath: flagValue(flagsPart, "--config"),
    });
    return;
  }

  if (command === "autofix") {
    const [subcommand, ...subrest] = rest;

    if (subcommand === "propose") {
      const agentMdPath = flagValue(subrest, "--agent-md");
      const runsFlag = flagValue(subrest, "--runs");
      if (!agentMdPath || !runsFlag) {
        console.error("agentguard autofix propose: --agent-md <path> and --runs <id1,id2,...> are required");
        process.exitCode = 1;
        return;
      }
      process.exitCode = await runAutofixProposeCommand({
        agentMdPath,
        runIds: runsFlag.split(","),
        storeRoot: flagValue(subrest, "--store"),
      });
      return;
    }

    if (subcommand === "show") {
      const fixId = subrest.find((a) => !a.startsWith("--"));
      if (!fixId) {
        console.error("agentguard autofix show: a fix id is required, e.g. `agentguard autofix show fix-...`");
        process.exitCode = 1;
        return;
      }
      process.exitCode = await runAutofixShowCommand({ fixId, storeRoot: flagValue(subrest, "--store") });
      return;
    }

    console.error(`agentguard autofix: unknown subcommand "${subcommand}" — expected "propose" or "show"`);
    process.exitCode = 1;
    return;
  }

  if (command === "review") {
    const [subcommand, ...subrest] = rest;

    if (subcommand === "list") {
      process.exitCode = await runReviewListCommand({ storeRoot: flagValue(subrest, "--store") });
      return;
    }

    if (subcommand === "record") {
      const [runId, assertionId, verdictArg] = subrest.filter((a) => !a.startsWith("--"));
      const VALID_VERDICTS = ["pass", "fail", "cannot-tell"];
      if (!runId || !assertionId || !verdictArg || !VALID_VERDICTS.includes(verdictArg)) {
        console.error(
          "agentguard review record: <run-id> <assertion-id> <pass|fail|cannot-tell> --reason <text> [--by <name>] are required",
        );
        process.exitCode = 1;
        return;
      }
      const reason = flagValue(subrest, "--reason");
      if (!reason) {
        console.error("agentguard review record: --reason <text> is required — an adjudication with no rationale is not reviewable later");
        process.exitCode = 1;
        return;
      }
      process.exitCode = await runReviewRecordCommand({
        runId,
        assertionId,
        verdict: verdictArg as HumanVerdict,
        reason,
        adjudicator: flagValue(subrest, "--by") ?? process.env.USER ?? process.env.USERNAME ?? "unknown",
        storeRoot: flagValue(subrest, "--store"),
      });
      return;
    }

    console.error(`agentguard review: unknown subcommand "${subcommand}" — expected "list" or "record"`);
    process.exitCode = 1;
    return;
  }

  if (command === "export") {
    const runId = rest.find((a) => !a.startsWith("--"));
    const outDir = flagValue(rest, "--out");
    if (!runId || !outDir) {
      console.error("agentguard export: <run-id> --out <dir> are required, e.g. `agentguard export run-01 --out ./pack`");
      process.exitCode = 1;
      return;
    }
    process.exitCode = await runExportCommand({ runId, outDir, storeRoot: flagValue(rest, "--store") });
    return;
  }

  if (command === "verify-pack") {
    const packDir = rest.find((a) => !a.startsWith("--"));
    if (!packDir) {
      console.error("agentguard verify-pack: <pack-dir> is required, e.g. `agentguard verify-pack ./pack`");
      process.exitCode = 1;
      return;
    }
    process.exitCode = await runVerifyPackCommand({ packDir });
    return;
  }

  if (command === "compare") {
    const [beforeId, afterId] = rest.filter((a) => !a.startsWith("--"));
    if (!beforeId || !afterId) {
      console.error("agentguard compare: two run ids are required, e.g. `agentguard compare run-v1 run-v2`");
      process.exitCode = 1;
      return;
    }
    process.exitCode = await runCompareCommand({ beforeId, afterId, storeRoot: flagValue(rest, "--store") });
    return;
  }

  console.error(`agentguard: unknown command "${command}"`);
  printHelp();
  process.exitCode = 1;
}

/**
 * PRD2 review finding: this used to return `args[i + 1]` unconditionally,
 * so `--task --store x` silently set `task` to the literal string
 * `"--store"` instead of leaving it missing — a flag with no value
 * swallowed the *next flag* as if it were one. Also gains `--flag=value`
 * support, which nothing here previously recognized at all.
 *
 * Exported (this file has no other tests) so `flagValue.test.ts` can
 * cover it directly without spawning the CLI binary.
 */
export function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i >= 0) {
    const next = args[i + 1];
    // A bare flag with nothing after it, or immediately followed by
    // another flag, has no value — never treat the next flag as this
    // flag's value.
    if (next === undefined || next.startsWith("--")) return undefined;
    return next;
  }
  const prefix = `${flag}=`;
  const combined = args.find((a) => a.startsWith(prefix));
  return combined ? combined.slice(prefix.length) : undefined;
}

function printHelp(): void {
  console.log(
    [
      "agentguard <command> [options]",
      "",
      "  init                                          Scaffold config + .agentguard/ + fixtures/ directories",
      "  test [--fixtures <dir>] [--live] [--escalate] [--store <dir>] [--config <path>]   Run the golden suite (mock engine by default)",
      "  replay <run-id> [--live] [--escalate] [--assertions a,b] [--store <dir>] [--config <path>]   Re-evaluate a stored run",
      "  calibrate [--store <dir>]                     Report the §6.9 calibration curve",
      "  doctor [--live]                               Verify the environment (Node/.nvmrc, API key, engine capabilities)",
      "  report [--store <dir>]                        Write json/junit/html reports from every stored run's decisions",
      "  compare <before-run-id> <after-run-id> [--store <dir>]  Diff two stored runs' verdicts (exit 1 on any regression)",
      "  review list [--store <dir>]                   List open REVIEW verdicts across the store with no adjudication yet",
      "  review record <run-id> <assertion-id> <pass|fail|cannot-tell> --reason <text> [--by <name>] [--store <dir>]   Record a human verdict",
      "  export <run-id> --out <dir> [--store <dir>]   Export a tamper-evident copy of a run (SHA-256 manifest)",
      "  verify-pack <pack-dir>                         Recompute and check an exported pack's manifest",
      "  watch [--task <text>] [--config <path>] --transcript <file> | -- <command> [args...]   Zero-setup, no API key: point at any agent",
      "  autofix propose --agent-md <path> --runs <id1,id2,...> [--store <dir>]   Propose a diff for a recurring finding (never applies it)",
      "  autofix show <fix-id> [--store <dir>]         Print a proposed fix's diff/rationale (always labeled not validated)",
    ].join("\n"),
  );
}

// Only run when this file is the actual entry point (`node dist/index.js
// ...`), never on a plain `import` — otherwise a test importing
// `flagValue` above would trigger a real CLI invocation against whatever
// argv the test runner happened to be started with.
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 3;
  });
}
