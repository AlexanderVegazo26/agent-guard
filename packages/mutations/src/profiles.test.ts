import { describe, expect, it } from "vitest";
import { resolveProfile } from "./profiles.js";

describe("resolveProfile", () => {
  it("resolves the default profile to every network-applicable id", () => {
    const ids = resolveProfile("default");
    expect(ids).toContain("http-429");
    expect(ids).toContain("prompt-injection");
    expect(ids).not.toContain("tool-hijacking"); // notApplicable in this build
  });

  it("throws on an unknown profile name, naming the known profiles", () => {
    expect(() => resolveProfile("not-a-profile")).toThrow(/unknown --adversarial profile/);
  });

  it("the prompt-injection profile is exactly that one id", () => {
    expect(resolveProfile("prompt-injection")).toEqual(["prompt-injection"]);
  });
});
