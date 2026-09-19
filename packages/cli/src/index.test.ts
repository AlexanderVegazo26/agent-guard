import { describe, expect, it } from "vitest";
import { flagValue } from "./index.js";

/**
 * PRD2 review finding: `flagValue` used to return `args[i + 1]`
 * unconditionally, so `--task --store x` silently set `task` to the
 * literal string `"--store"` — a flag with no value swallowed the next
 * *flag* as if it were a value. This is the only test file for
 * `index.ts`; importing it does not trigger a real CLI invocation
 * because `main()` now only runs when this file is the actual process
 * entry point (see the `isEntryPoint` guard at the bottom of index.ts).
 */
describe("flagValue", () => {
  it("returns the token immediately after the flag", () => {
    expect(flagValue(["--task", "hello"], "--task")).toBe("hello");
  });

  it("returns undefined for a flag with nothing after it", () => {
    expect(flagValue(["--task"], "--task")).toBeUndefined();
  });

  it("does NOT swallow the next flag as this flag's value", () => {
    // Before the fix: flagValue(["--task", "--store", "x"], "--task")
    // returned "--store" — exactly the bug this test guards against.
    expect(flagValue(["--task", "--store", "x"], "--task")).toBeUndefined();
  });

  it("returns undefined when the flag is not present at all", () => {
    expect(flagValue(["--store", "x"], "--task")).toBeUndefined();
  });

  it("supports the --flag=value form", () => {
    expect(flagValue(["--task=hello world"], "--task")).toBe("hello world");
  });

  it("prefers the space-separated form when both are somehow present", () => {
    expect(flagValue(["--task=first", "--task", "second"], "--task")).toBe("second");
  });

  it("does not confuse a flag name that is a prefix of another (--store vs --store-root)", () => {
    expect(flagValue(["--store-root=x"], "--store")).toBeUndefined();
  });
});
