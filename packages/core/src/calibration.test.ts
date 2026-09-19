import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendCalibrationRecords,
  computeCalibrationCurve,
  readCalibrationRecords,
  splitCalibrationCurves,
  toAdjudicatedCalibrationRecord,
  toCalibrationRecord,
  type CalibrationRecord,
} from "./calibration.js";
import type { Adjudication, AssertionResult } from "./schema.js";

describe("toCalibrationRecord — §6.9's basis allowlist", () => {
  it("excludes a deterministic result (correct by construction)", () => {
    const result: AssertionResult = { id: "x", status: "fail", basis: "deterministic", evidence: ["e-1"], durationMs: 0 };
    expect(toCalibrationRecord(result, "fail")).toBeNull();
  });

  it("excludes a not_applicable result (no measurement of any kind)", () => {
    const result: AssertionResult = { id: "x", status: "not_applicable", basis: "not-applicable", evidence: [], durationMs: 0 };
    expect(toCalibrationRecord(result, "not_applicable")).toBeNull();
  });

  it("includes a jev-basis Noul result, marking correctness against the expected status", () => {
    const result: AssertionResult = {
      id: "goalCompleted",
      status: "pass",
      basis: "jev",
      signal: "noul-probability",
      confidence: 0.92,
      evidence: ["e-task"],
      durationMs: 5,
    };
    expect(toCalibrationRecord(result, "pass")).toEqual({
      assertionId: "goalCompleted",
      signal: "noul-probability",
      confidence: 0.92,
      correct: true,
    });
    expect(toCalibrationRecord(result, "fail")!.correct).toBe(false);
  });
});

describe("toAdjudicatedCalibrationRecord — PRD2 F1, human ground truth on a real run", () => {
  const jevResult: AssertionResult = {
    id: "noFabricatedCompletion",
    status: "pass",
    basis: "jev",
    signal: "noul-probability",
    confidence: 0.92,
    evidence: ["e-task"],
    durationMs: 5,
  };

  function adjudication(humanVerdict: Adjudication["humanVerdict"]): Adjudication {
    return { assertionId: "noFabricatedCompletion", humanVerdict, reason: "r", adjudicator: "a", at: "2026-09-20T00:00:00.000Z" };
  }

  it("produces a record marking correctness against the human's verdict", () => {
    expect(toAdjudicatedCalibrationRecord(jevResult, adjudication("pass"))).toEqual({
      assertionId: "noFabricatedCompletion",
      signal: "noul-probability",
      confidence: 0.92,
      correct: true,
    });
    expect(toAdjudicatedCalibrationRecord(jevResult, adjudication("fail"))!.correct).toBe(false);
  });

  it("produces no record for \"cannot-tell\" — no ground truth signal either way", () => {
    expect(toAdjudicatedCalibrationRecord(jevResult, adjudication("cannot-tell"))).toBeNull();
  });

  it("excludes a deterministic result, same allowlist as toCalibrationRecord", () => {
    const deterministic: AssertionResult = { ...jevResult, basis: "deterministic" };
    expect(toAdjudicatedCalibrationRecord(deterministic, adjudication("pass"))).toBeNull();
  });

  it("excludes a result with no confidence", () => {
    const noConfidence: AssertionResult = { ...jevResult, confidence: undefined };
    expect(toAdjudicatedCalibrationRecord(noConfidence, adjudication("pass"))).toBeNull();
  });
});

describe("computeCalibrationCurve", () => {
  it("bins by confidence decile and computes observed accuracy per bin", () => {
    const records: CalibrationRecord[] = [
      { assertionId: "a", signal: "noul-probability", confidence: 0.95, correct: true },
      { assertionId: "a", signal: "noul-probability", confidence: 0.91, correct: true },
      { assertionId: "a", signal: "noul-probability", confidence: 0.92, correct: false },
      { assertionId: "a", signal: "noul-probability", confidence: 0.15, correct: false },
    ];
    const curve = computeCalibrationCurve(records);
    expect(curve.sampleSize).toBe(4);
    expect(curve.bins[9]).toMatchObject({ decile: 9, count: 3, correctCount: 2, observedAccuracy: 2 / 3 });
    expect(curve.bins[1]).toMatchObject({ decile: 1, count: 1, correctCount: 0, observedAccuracy: 0 });
  });

  it("is not validated below the 100-sample floor (PRD §12's designed MVP steady state)", () => {
    const records: CalibrationRecord[] = Array.from({ length: 10 }, () => ({
      assertionId: "a",
      signal: "noul-probability" as const,
      confidence: 0.9,
      correct: true,
    }));
    expect(computeCalibrationCurve(records).validated).toBe(false);
  });

  it("is not validated when any populated decile has fewer than 5 samples, even above 100 total", () => {
    const records: CalibrationRecord[] = [
      // 99 samples densely packed in one decile...
      ...Array.from({ length: 99 }, () => ({ assertionId: "a", signal: "noul-probability" as const, confidence: 0.95, correct: true })),
      // ...and one lonely sample in a different decile.
      { assertionId: "a", signal: "noul-probability" as const, confidence: 0.15, correct: true },
    ];
    expect(records.length).toBe(100);
    const curve = computeCalibrationCurve(records);
    expect(curve.bins[1]!.count).toBe(1);
    expect(curve.validated).toBe(false);
  });

  it("validates once every populated decile has ≥5 samples and the total is ≥100", () => {
    const records: CalibrationRecord[] = [
      ...Array.from({ length: 50 }, () => ({ assertionId: "a", signal: "noul-probability" as const, confidence: 0.95, correct: true })),
      ...Array.from({ length: 50 }, () => ({ assertionId: "a", signal: "noul-probability" as const, confidence: 0.05, correct: true })),
    ];
    expect(computeCalibrationCurve(records).validated).toBe(true);
  });
});

describe("splitCalibrationCurves — Noul and derived-confidence are never pooled (§6.9)", () => {
  it("computes two independent curves, one per signal", () => {
    const records: CalibrationRecord[] = [
      { assertionId: "noUnsupportedClaims", signal: "noul-probability", confidence: 0.9, correct: true },
      { assertionId: "toolWasAppropriate", signal: "derived-confidence", confidence: 0.8, correct: false },
    ];
    const { noul, derivedConfidence } = splitCalibrationCurves(records);
    expect(noul?.sampleSize).toBe(1);
    expect(derivedConfidence?.sampleSize).toBe(1);
  });

  it("returns null for a signal with no records at all, rather than an empty curve", () => {
    const records: CalibrationRecord[] = [
      { assertionId: "noUnsupportedClaims", signal: "noul-probability", confidence: 0.9, correct: true },
    ];
    expect(splitCalibrationCurves(records).derivedConfidence).toBeNull();
  });
});

describe("calibration.jsonl persistence", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-calibration-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("appends and reads back records, and is a no-op append for an empty list", async () => {
    const filePath = path.join(root, "calibration.jsonl");
    await appendCalibrationRecords(filePath, []);
    expect(await readCalibrationRecords(filePath)).toEqual([]);

    await appendCalibrationRecords(filePath, [
      { assertionId: "a", signal: "noul-probability", confidence: 0.9, correct: true },
    ]);
    await appendCalibrationRecords(filePath, [
      { assertionId: "b", signal: "derived-confidence", confidence: 0.7, correct: false },
    ]);

    const records = await readCalibrationRecords(filePath);
    expect(records).toEqual([
      { assertionId: "a", signal: "noul-probability", confidence: 0.9, correct: true },
      { assertionId: "b", signal: "derived-confidence", confidence: 0.7, correct: false },
    ]);
  });

  it("returns an empty array when the file doesn't exist yet, rather than throwing", async () => {
    expect(await readCalibrationRecords(path.join(root, "missing.jsonl"))).toEqual([]);
  });
});
