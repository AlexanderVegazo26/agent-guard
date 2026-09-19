import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Adjudication, AssertionResult, AssertionStatus } from "./schema.js";

/**
 * §6.9 — calibration harness. Only results the decision engine actually
 * produced can validate the decision engine: `basis !== "jev"` (or a
 * result carrying no `confidence`) is excluded, load-bearing per §6.9 —
 * deterministic results are correct by construction and would pack the top
 * decile with certainties the model never produced.
 */

export interface CalibrationRecord {
  assertionId: string;
  signal: "noul-probability" | "derived-confidence";
  confidence: number;
  correct: boolean;
}

/** Returns null when the result is not Jev-basis (excluded per §6.9), never a record with a fabricated confidence. */
export function toCalibrationRecord(result: AssertionResult, expectedStatus: AssertionStatus): CalibrationRecord | null {
  if (result.basis !== "jev") return null;
  if (result.confidence === undefined) return null;
  if (result.signal !== "noul-probability" && result.signal !== "derived-confidence") return null;
  return {
    assertionId: result.id,
    signal: result.signal,
    confidence: result.confidence,
    correct: result.status === expectedStatus,
  };
}

/**
 * PRD2 F1 — the same conversion as `toCalibrationRecord`, but against a
 * human's verdict on a REAL run instead of a synthetic fixture's declared
 * `expected.json`. This is what closes PRD v0.6 §14's "held-out set of
 * real agent runs with human-adjudicated verdicts" — every prior
 * calibration record in this codebase came from the golden/correct-
 * behavior fixtures, which are hand-authored and therefore, per §12's own
 * circularity caveat, measure "does the evaluator behave as specified,"
 * not "does it catch how real agents fail." An adjudicated record is the
 * first kind of evidence that measures the second claim.
 *
 * `"cannot-tell"` produces no record — a human who couldn't determine
 * ground truth from the evidence gives no signal about whether the
 * verdict was correct, and forcing one in either direction would corrupt
 * the curve with a fabricated data point.
 */
export function toAdjudicatedCalibrationRecord(
  result: AssertionResult,
  adjudication: Adjudication,
): CalibrationRecord | null {
  if (result.basis !== "jev") return null;
  if (result.confidence === undefined) return null;
  if (result.signal !== "noul-probability" && result.signal !== "derived-confidence") return null;
  if (adjudication.humanVerdict === "cannot-tell") return null;
  return {
    assertionId: result.id,
    signal: result.signal,
    confidence: result.confidence,
    correct: result.status === adjudication.humanVerdict,
  };
}

export async function appendCalibrationRecords(filePath: string, records: CalibrationRecord[]): Promise<void> {
  if (records.length === 0) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  const lines = records.map((r) => `${JSON.stringify(r)}\n`).join("");
  await appendFile(filePath, lines, "utf8");
}

export async function readCalibrationRecords(filePath: string): Promise<CalibrationRecord[]> {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CalibrationRecord);
}

// ---------------------------------------------------------------------------
// Binning and the sample floor
// ---------------------------------------------------------------------------

export interface CalibrationBin {
  decile: number; // 0..9, confidence in [decile/10, (decile+1)/10)
  count: number;
  correctCount: number;
  observedAccuracy: number | null; // null when count === 0
}

export interface CalibrationCurve {
  signal: "noul-probability" | "derived-confidence";
  bins: CalibrationBin[];
  sampleSize: number;
  expectedCalibrationError: number;
  /**
   * §6.9's floor: ≥100 Jev-basis results per curve, no decile below 5.
   * `false` is the designed MVP steady state (PRD §12) — confidence gates
   * nothing in CI until this is `true`.
   */
  validated: boolean;
}

const MIN_SAMPLES_PER_CURVE = 100;
const MIN_SAMPLES_PER_DECILE = 5;

export function computeCalibrationCurve(records: CalibrationRecord[]): CalibrationCurve {
  if (records.length === 0) {
    throw new Error("computeCalibrationCurve: at least one record is required");
  }
  const signal = records[0]!.signal;

  const bins: CalibrationBin[] = Array.from({ length: 10 }, (_, decile) => ({
    decile,
    count: 0,
    correctCount: 0,
    observedAccuracy: null,
  }));

  for (const record of records) {
    const decile = Math.min(9, Math.floor(record.confidence * 10));
    const bin = bins[decile]!;
    bin.count += 1;
    if (record.correct) bin.correctCount += 1;
  }

  let weightedAbsError = 0;
  for (const bin of bins) {
    if (bin.count === 0) continue;
    bin.observedAccuracy = bin.correctCount / bin.count;
    const midpoint = (bin.decile + 0.5) / 10;
    weightedAbsError += (bin.count / records.length) * Math.abs(bin.observedAccuracy - midpoint);
  }

  const validated =
    records.length >= MIN_SAMPLES_PER_CURVE && bins.every((b) => b.count === 0 || b.count >= MIN_SAMPLES_PER_DECILE);

  return {
    signal,
    bins,
    sampleSize: records.length,
    expectedCalibrationError: weightedAbsError,
    validated,
  };
}

/** §6.9: Noul probabilities and Choice/Score confidence are binned separately — they are different signals. */
export function splitCalibrationCurves(records: CalibrationRecord[]): {
  noul: CalibrationCurve | null;
  derivedConfidence: CalibrationCurve | null;
} {
  const noulRecords = records.filter((r) => r.signal === "noul-probability");
  const derivedRecords = records.filter((r) => r.signal === "derived-confidence");
  return {
    noul: noulRecords.length > 0 ? computeCalibrationCurve(noulRecords) : null,
    derivedConfidence: derivedRecords.length > 0 ? computeCalibrationCurve(derivedRecords) : null,
  };
}
