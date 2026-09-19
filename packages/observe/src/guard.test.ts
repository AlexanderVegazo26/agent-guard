import { describe, expect, it } from "vitest";
import { evaluateGuard } from "./guard.js";

describe("evaluateGuard — PRD2 F2, deterministic pre-action policy", () => {
  it("allows a call that matches no policy rule", () => {
    expect(evaluateGuard("list_todos", {}, {})).toEqual({ decision: "allow", reason: "no policy rule matched" });
  });

  it("blocks a tool on the blocked-tools list, regardless of its arguments", () => {
    const result = evaluateGuard("delete_all_data", { confirm: true }, { blockedTools: ["delete_all_data"] });
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("delete_all_data");
  });

  it("flags a tool on the review list as review, not block", () => {
    const result = evaluateGuard("submit_payment", {}, { reviewTools: ["submit_payment"] });
    expect(result.decision).toBe("review");
  });

  it("blocks when outbound arguments match a blocked pattern", () => {
    const result = evaluateGuard("send_email", { body: "here is sk-live-abcdefghijklmnopqrstuvwx" }, {
      blockedArgumentPatterns: [/sk-[A-Za-z0-9_-]{16,}/],
    });
    expect(result.decision).toBe("block");
    expect(result.reason).toContain("send_email");
  });

  it("allows when arguments don't match any blocked pattern", () => {
    const result = evaluateGuard("send_email", { body: "hello" }, { blockedArgumentPatterns: [/sk-[A-Za-z0-9_-]{16,}/] });
    expect(result.decision).toBe("allow");
  });

  it("blockedTools takes precedence over reviewTools when a tool is (misconfigured to be) on both", () => {
    const result = evaluateGuard("x", {}, { blockedTools: ["x"], reviewTools: ["x"] });
    expect(result.decision).toBe("block");
  });

  it("does not throw on circular/unserializable arguments — degrades to an empty string, never a crash", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => evaluateGuard("x", circular, { blockedArgumentPatterns: [/anything/] })).not.toThrow();
  });
});
