import path from "node:path";
import {
  FilesystemRunStore,
  appendCalibrationRecords,
  toAdjudicatedCalibrationRecord,
  type Adjudication,
  type AssertionResult,
  type HumanVerdict,
} from "@agent-guard/core";

export interface ReviewListOptions {
  storeRoot?: string;
}

export interface ReviewRecordOptions {
  runId: string;
  assertionId: string;
  verdict: HumanVerdict;
  reason: string;
  adjudicator: string;
  storeRoot?: string;
}

/**
 * PRD2 F1 — `agentguard review`. REVIEW verdicts had no owner, no
 * destination and no record (PRD v0.6 §14: "a verdict category with no
 * workflow attached becomes 'ignore' in practice"). This is that
 * workflow: `list` surfaces every open REVIEW across the store that
 * nobody has adjudicated yet, and `record` writes a human's verdict —
 * separately from `decisions.json`, which stays the machine's own record
 * regardless of what a human later decides — and, when the verdict is
 * decisive, appends a real calibration record derived from ground truth
 * a human actually looked at, not a synthetic fixture's declared
 * expectation.
 */
export async function runReviewListCommand(options: ReviewListOptions): Promise<number> {
  const store = new FilesystemRunStore(options.storeRoot);
  const runIds = await store.listRunIds();

  if (runIds.length === 0) {
    console.log("agentguard review: no stored runs found — run `agentguard test`, `replay` or `watch` first.");
    return 0;
  }

  let openCount = 0;
  let adjudicatedCount = 0;

  for (const runId of runIds.sort()) {
    const decisions = await store.loadDecisions(runId);
    if (!decisions) continue;
    const adjudications = (await store.loadAdjudications(runId)) ?? {};

    const reviewEntries = Object.entries(decisions).filter(([, r]) => r.status === "review");
    for (const [assertionId, result] of reviewEntries) {
      const adjudication = adjudications[assertionId];
      if (adjudication) {
        adjudicatedCount += 1;
        continue;
      }
      openCount += 1;
      console.log(`\n  ${runId}  ${assertionId}`);
      if (result.reviewVia) console.log(`    reviewVia: ${result.reviewVia}`);
      if (result.explanation) console.log(`    ${result.explanation}`);
      if (result.missing && result.missing.length > 0) console.log(`    missing: ${result.missing.join(", ")}`);
    }
  }

  console.log(
    `\n${openCount} open REVIEW item(s), ${adjudicatedCount} already adjudicated, across ${runIds.length} stored run(s).`,
  );
  if (openCount > 0) {
    console.log(
      "Record a verdict with:\n  agentguard review record <run-id> <assertion-id> <pass|fail|cannot-tell> --reason <text> [--by <name>]",
    );
  }

  return 0;
}

export async function runReviewRecordCommand(options: ReviewRecordOptions): Promise<number> {
  const store = new FilesystemRunStore(options.storeRoot);
  const decisions = await store.loadDecisions(options.runId);
  if (!decisions) {
    console.error(`agentguard review: no stored decisions found for run "${options.runId}"`);
    return 3;
  }

  const result: AssertionResult | undefined = decisions[options.assertionId];
  if (!result) {
    console.error(
      `agentguard review: run "${options.runId}" has no assertion "${options.assertionId}" (has: ${Object.keys(decisions).join(", ")})`,
    );
    return 3;
  }

  const adjudication: Adjudication = {
    assertionId: options.assertionId,
    humanVerdict: options.verdict,
    reason: options.reason,
    adjudicator: options.adjudicator,
    at: new Date().toISOString(),
  };
  await store.saveAdjudication(options.runId, adjudication);

  console.log(`agentguard review: recorded "${options.verdict}" for ${options.runId}::${options.assertionId}`);

  const record = toAdjudicatedCalibrationRecord(result, adjudication);
  if (record) {
    const calibrationPath = path.join(options.storeRoot ?? path.join(process.cwd(), ".agentguard"), "calibration.jsonl");
    await appendCalibrationRecords(calibrationPath, [record]);
    console.log(
      `  machine verdict "${result.status}" was ${record.correct ? "CORRECT" : "WRONG"} against this adjudication — appended to ${calibrationPath}`,
    );
  } else if (options.verdict === "cannot-tell") {
    console.log("  \"cannot-tell\" recorded — no calibration record added (no ground truth signal either way).");
  } else {
    console.log("  no calibration record added — this result carries no Jev-basis confidence to calibrate.");
  }

  return 0;
}
