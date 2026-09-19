import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FilesystemRunStore } from "@agent-guard/core";
import { formatHtml } from "../reporters/html.js";
import { formatJson } from "../reporters/json.js";
import { formatJunit } from "../reporters/junit.js";

export interface ReportCommandOptions {
  storeRoot?: string;
}

/**
 * `agentguard report` — PRD §9.3. Regenerates `json`/`junit`/`html` reports from
 * every stored run's `decisions.json` (§10.1) — it does not re-run
 * evaluation; `test` or `replay` produce the decisions this command reports
 * on.
 */
export async function runReportCommand(options: ReportCommandOptions): Promise<number> {
  const root = options.storeRoot ?? path.join(process.cwd(), ".agentguard");
  const store = new FilesystemRunStore(root);
  const runIds = await store.listRunIds();

  if (runIds.length === 0) {
    console.error("agentguard report: no stored runs found — run `agentguard test` or `agentguard replay` first.");
    return 3;
  }

  const runs: Record<string, Awaited<ReturnType<typeof store.loadDecisions>>> = {};
  for (const runId of runIds) {
    runs[runId] = await store.loadDecisions(runId);
  }
  const nonNullRuns = Object.fromEntries(
    Object.entries(runs).filter(([, v]) => v !== null),
  ) as Record<string, NonNullable<(typeof runs)[string]>>;

  const reportsDir = path.join(root, "reports");
  await mkdir(reportsDir, { recursive: true });

  const jsonPath = path.join(reportsDir, "report.json");
  await writeFile(jsonPath, formatJson(nonNullRuns), "utf8");
  console.log(`  wrote ${jsonPath}`);

  const junitPath = path.join(reportsDir, "junit.xml");
  await writeFile(junitPath, formatJunit(nonNullRuns), "utf8");
  console.log(`  wrote ${junitPath}`);

  const htmlPath = path.join(reportsDir, "report.html");
  await writeFile(htmlPath, formatHtml(nonNullRuns), "utf8");
  console.log(`  wrote ${htmlPath}`);

  return 0;
}
