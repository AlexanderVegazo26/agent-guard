import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * PRD3 F15 / A9 — documentation integrity as a mechanical check.
 *
 * `docs/PRD3.md` §3 catalogued twelve places (D1-D12) where a prose comment
 * claims something is unimplemented, deferred, or "see repo notes" and the
 * claim had gone stale. The fix isn't editing those twelve comments once —
 * it's a standing gate so the next stale comment is caught mechanically
 * instead of by the next person who happens to read PRD3 §3 closely.
 *
 * Any line under `packages/*\/src` containing one of the flagged phrases
 * must carry a `[PRD3:Fxx]` (the feature that will close it) or
 * `[issue:#n]` (a tracked issue) tag on that same line. A line without one
 * is either stale prose (fix or remove it) or a real, untracked limitation
 * (tag it).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..");

const FLAGGED_PHRASES = [/not implemented/i, /not yet/i, /deferred/i, /see repo notes/i];

const TAG_PATTERN = /\[PRD3:F\d+\]|\[issue:#\d+\]/;

interface Violation {
  file: string;
  line: number;
  text: string;
}

async function findViolations(): Promise<Violation[]> {
  const violations: Violation[] = [];
  for await (const entry of glob("packages/*/src/**/*.{ts,tsx}", { cwd: REPO_ROOT })) {
    const absPath = path.join(REPO_ROOT, entry);
    const content = await readFile(absPath, "utf-8");
    const lines = content.split("\n");
    lines.forEach((lineText, idx) => {
      const isFlagged = FLAGGED_PHRASES.some((phrase) => phrase.test(lineText));
      if (isFlagged && !TAG_PATTERN.test(lineText)) {
        violations.push({ file: entry, line: idx + 1, text: lineText.trim() });
      }
    });
  }
  return violations;
}

describe("documentation integrity (PRD3 F15 / A9)", () => {
  it("tags every 'not implemented'/'not yet'/'deferred'/'see repo notes' line with [PRD3:Fxx] or [issue:#n]", async () => {
    const violations = await findViolations();
    if (violations.length > 0) {
      const report = violations
        .map((v) => `  ${v.file}:${v.line}: ${v.text}`)
        .join("\n");
      throw new Error(
        `Found ${violations.length} untagged limitation comment(s) under packages/*/src.\n` +
          `Each must carry a [PRD3:Fxx] (feature that closes it) or [issue:#n] tag on the same line:\n${report}`,
      );
    }
    expect(violations).toEqual([]);
  });
});
