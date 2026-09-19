#!/usr/bin/env node
import path from "node:path";
import type { AssertionId } from "@agent-guard/core";
import { runTestCommand } from "./commands/test.js";
import { runCalibrateCommand } from "./commands/calibrate.js";
import { runReplayCommand } from "./commands/replay.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runInitCommand } from "./commands/init.js";
import { runReportCommand } from "./commands/report.js";

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

  console.error(`agentguard: unknown command "${command}"`);
  printHelp();
  process.exitCode = 1;
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function printHelp(): void {
  console.log(
    [
      "agentguard <command> [options]",
      "",
      "  init                                          Scaffold config + .agentguard/ + fixtures/ directories",
      "  test [--fixtures <dir>] [--live] [--escalate] [--store <dir>]   Run the golden suite (mock engine by default)",
      "  replay <run-id> [--live] [--escalate] [--assertions a,b] [--store <dir>]   Re-evaluate a stored run",
      "  calibrate [--store <dir>]                     Report the §6.9 calibration curve",
      "  doctor [--live]                               Verify the environment (Node/.nvmrc, API key, engine capabilities)",
      "  report [--store <dir>]                        Write json/junit/html reports from every stored run's decisions",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 3;
});
