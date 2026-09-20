import path from "node:path";
import { readCalibrationRecords, splitCalibrationCurves, type CalibrationCurve } from "@alexvegman/core";

export interface CalibrateCommandOptions {
  storeRoot?: string;
}

/**
 * `agentguard calibrate` — §6.9. Bins by confidence decile, reports
 * observed accuracy per bin plus expected calibration error, and refuses
 * to declare `validated` below the sample floor (≥100 per curve, no
 * decile under 5) — reporting the curve either way, marked
 * `insufficient-sample` rather than silently omitted (PRD §12).
 */
export async function runCalibrateCommand(options: CalibrateCommandOptions): Promise<number> {
  const filePath = path.join(options.storeRoot ?? path.join(process.cwd(), ".agentguard"), "calibration.jsonl");
  const records = await readCalibrationRecords(filePath);

  if (records.length === 0) {
    console.log(`agentguard calibrate: no records at ${filePath} yet — run \`agentguard test\` first.`);
    return 0;
  }

  const { noul, derivedConfidence } = splitCalibrationCurves(records);
  console.log(`Calibration report (${filePath})\n`);
  printCurve("Noul probability", noul);
  console.log("");
  printCurve("Choice/Score derived confidence", derivedConfidence);

  return 0;
}

function printCurve(label: string, curve: CalibrationCurve | null): void {
  console.log(`  ${label}`);
  if (!curve) {
    console.log("    no samples yet");
    return;
  }
  console.log(`    sample size: ${curve.sampleSize}  ECE: ${curve.expectedCalibrationError.toFixed(3)}`);
  console.log(`    validated: ${curve.validated ? "true" : "false (insufficient-sample)"}`);
  for (const bin of curve.bins) {
    if (bin.count === 0) continue;
    const lo = (bin.decile / 10).toFixed(1);
    const hi = ((bin.decile + 1) / 10).toFixed(1);
    const acc = bin.observedAccuracy !== null ? bin.observedAccuracy.toFixed(2) : "n/a";
    console.log(`    [${lo}, ${hi}): n=${bin.count.toString().padStart(3)}  observed accuracy=${acc}`);
  }
}
