import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FilesystemRunStore } from "@alexvegman/core";
import { buildReportV1FromRun, formatHtml, formatJson, formatJunit, formatSite, type ReportV1 } from "@alexvegman/reporters";

export interface ReportCommandOptions {
  storeRoot?: string;
  /** PRD3 F21 — also write `reports/site.html`, the fleet-level dashboard (run list, evidence graph, assertion history, mutation dimensions, adjudication queue). */
  site?: boolean;
}

/**
 * `agentguard report` — PRD §9.3. Regenerates `json`/`junit`/`html` reports from
 * every stored run's `decisions.json` (§10.1) — it does not re-run
 * evaluation; `test` or `replay` produce the decisions this command reports
 * on.
 *
 * PRD3 F17: each stored run is wrapped into a `ReportV1` (via
 * `buildReportV1FromRun`) before being handed to any reporter — the
 * versioned contract is what every reporter renders from, not raw
 * `decisions.json`.
 */
export async function runReportCommand(options: ReportCommandOptions): Promise<number> {
  const root = options.storeRoot ?? path.join(process.cwd(), ".agentguard");
  const store = new FilesystemRunStore(root);
  const runIds = await store.listRunIds();

  if (runIds.length === 0) {
    console.error("agentguard report: no stored runs found — run `agentguard test` or `agentguard replay` first.");
    return 3;
  }

  const reports: ReportV1[] = [];
  for (const runId of runIds) {
    const run = await store.loadRun(runId);
    const decisions = await store.loadDecisions(runId);
    if (!run || !decisions) continue;
    // PRD2 F1: an adjudication rides alongside its run's decisions in the
    // report, never merged into decisions.json itself.
    const adjudications = await store.loadAdjudications(runId);
    reports.push(buildReportV1FromRun(run, decisions, adjudications ?? undefined));
  }

  const reportsDir = path.join(root, "reports");
  await mkdir(reportsDir, { recursive: true });

  const jsonPath = path.join(reportsDir, "report.json");
  await writeFile(jsonPath, formatJson(reports), "utf8");
  console.log(`  wrote ${jsonPath}`);

  const junitPath = path.join(reportsDir, "junit.xml");
  await writeFile(junitPath, formatJunit(reports), "utf8");
  console.log(`  wrote ${junitPath}`);

  const htmlPath = path.join(reportsDir, "report.html");
  await writeFile(htmlPath, formatHtml(reports), "utf8");
  console.log(`  wrote ${htmlPath}`);

  if (options.site) {
    const sitePath = path.join(reportsDir, "site.html");
    await writeFile(sitePath, formatSite(reports), "utf8");
    console.log(`  wrote ${sitePath}`);
  }

  return 0;
}
