import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCalibrateCommand } from "./calibrate.js";

/**
 * `agentguard calibrate` — §6.9. No unit test existed for this command
 * before PRD3 Phase A. These drive it against a real `calibration.jsonl`
 * on disk (the same file `readCalibrationRecords` reads in production),
 * not a mocked reader.
 */
describe("runCalibrateCommand", () => {
  let root: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "agentguard-calibrate-test-"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  it("reports no records and exits 0 when calibration.jsonl does not exist yet", async () => {
    const exitCode = await runCalibrateCommand({ storeRoot: root });

    expect(exitCode).toBe(0);
    expect(logSpy.mock.calls.some(([msg]) => String(msg).includes("no records"))).toBe(true);
  });

  it("prints both curves and marks a small sample unvalidated (insufficient-sample)", async () => {
    await mkdir(root, { recursive: true });
    const record = { assertionId: "goalCompleted", signal: "noul-probability" as const, confidence: 0.9, correct: true };
    const lines = Array.from({ length: 5 }, () => JSON.stringify(record)).join("\n");
    await writeFile(path.join(root, "calibration.jsonl"), `${lines}\n`, "utf8");

    const exitCode = await runCalibrateCommand({ storeRoot: root });

    expect(exitCode).toBe(0);
    const output = logSpy.mock.calls.map(([msg]) => String(msg)).join("\n");
    expect(output).toContain("Noul probability");
    expect(output).toContain("validated: false");
  });
});
