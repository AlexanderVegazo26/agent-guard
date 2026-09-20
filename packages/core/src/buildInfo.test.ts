import { afterEach, describe, expect, it } from "vitest";
import { getBuildInfo } from "./buildInfo.js";

describe("getBuildInfo — PKG-010", () => {
  afterEach(() => {
    delete process.env.AGENTGUARD_BUILD_COMMIT;
  });

  it("reads the caller's own package.json version, not a hardcoded value", () => {
    const info = getBuildInfo(import.meta.url);
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("reports commit as \"unknown\" when AGENTGUARD_BUILD_COMMIT is unset", () => {
    delete process.env.AGENTGUARD_BUILD_COMMIT;
    expect(getBuildInfo(import.meta.url).commit).toBe("unknown");
  });

  it("reports the real commit when AGENTGUARD_BUILD_COMMIT is set", () => {
    process.env.AGENTGUARD_BUILD_COMMIT = "abc1234";
    expect(getBuildInfo(import.meta.url).commit).toBe("abc1234");
  });
});
