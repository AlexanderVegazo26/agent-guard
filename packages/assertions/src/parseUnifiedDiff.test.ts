import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./codingVertical.js";

describe("parseUnifiedDiff — PRD2 F8", () => {
  it("parses a real single-file git diff (captured from this repo's own history)", () => {
    // Captured verbatim via `git diff 41a56e0 a1f2188 -- packages/core/src/index.ts`.
    const diff = [
      "diff --git a/packages/core/src/index.ts b/packages/core/src/index.ts",
      "index 30d373f..4ad952f 100644",
      "--- a/packages/core/src/index.ts",
      "+++ b/packages/core/src/index.ts",
      '@@ -5,6 +5,7 @@ export * from "./configLoader.js";',
      ' export * from "./redaction.js";',
      ' export * from "./languageAdvisory.js";',
      ' export * from "./evidencePack.js";',
      '+export * from "./history.js";',
      ' export * from "./store.js";',
      ' export * from "./calibration.js";',
      ' export * from "./exitCode.js";',
      "",
    ].join("\n");

    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe("packages/core/src/index.ts");
    expect(files[0]!.additions).toBe(1);
    expect(files[0]!.deletions).toBe(0);
    expect(files[0]!.patch).toContain('+export * from "./history.js";');
    // The @@ hunk header itself and unchanged context lines are not
    // miscounted as additions/deletions.
    expect(files[0]!.patch).not.toMatch(/^\+@@/m);
  });

  it("parses a real multi-file git diff into one ChangedFile per file", () => {
    // Captured verbatim via `git diff 41a56e0 a1f2188 -- packages/core/src/history.ts packages/core/src/index.ts`.
    const diff = [
      "diff --git a/packages/core/src/history.ts b/packages/core/src/history.ts",
      "new file mode 100644",
      "index 0000000..1234567",
      "--- /dev/null",
      "+++ b/packages/core/src/history.ts",
      "@@ -0,0 +1,3 @@",
      "+export function foo() {",
      "+  return 1;",
      "+}",
      "diff --git a/packages/core/src/index.ts b/packages/core/src/index.ts",
      "index 30d373f..4ad952f 100644",
      "--- a/packages/core/src/index.ts",
      "+++ b/packages/core/src/index.ts",
      '@@ -5,6 +5,7 @@ export * from "./configLoader.js";',
      ' export * from "./redaction.js";',
      '+export * from "./history.js";',
      ' export * from "./store.js";',
      "",
    ].join("\n");

    const files = parseUnifiedDiff(diff);
    expect(files.map((f) => f.path)).toEqual(["packages/core/src/history.ts", "packages/core/src/index.ts"]);
    expect(files[0]!.additions).toBe(3);
    expect(files[0]!.deletions).toBe(0);
    expect(files[1]!.additions).toBe(1);
  });

  it("counts deletions correctly and records a file with only removed lines", () => {
    const diff = [
      "diff --git a/old.ts b/old.ts",
      "index abc..def 100644",
      "--- a/old.ts",
      "+++ b/old.ts",
      "@@ -1,3 +1,1 @@",
      " kept line",
      "-removed line one",
      "-removed line two",
      "",
    ].join("\n");

    const files = parseUnifiedDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0]!.additions).toBe(0);
    expect(files[0]!.deletions).toBe(2);
  });

  it("returns an empty array for an empty diff (no changes)", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });
});
