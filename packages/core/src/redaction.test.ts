import { describe, expect, it } from "vitest";
import { DefaultRedactor } from "./redaction.js";

describe("DefaultRedactor.redactEvent", () => {
  it("redacts Authorization, Cookie and Set-Cookie headers by name, preserving shape", () => {
    const redactor = new DefaultRedactor({ secrets: [] });
    const event = {
      type: "network",
      requestHeaders: { Authorization: "Bearer abc123", "X-Trace-Id": "trace-1" },
      responseHeaders: { "Set-Cookie": "session=xyz", "Content-Type": "application/json" },
    };

    const redacted = redactor.redactEvent(event) as typeof event;

    expect(redacted.requestHeaders.Authorization).toBe("<redacted:authorization>");
    expect(redacted.requestHeaders["X-Trace-Id"]).toBe("trace-1"); // untouched
    expect(redacted.responseHeaders["Set-Cookie"]).toBe("<redacted:set-cookie>");
    expect(redacted.responseHeaders["Content-Type"]).toBe("application/json"); // untouched
  });

  it("redacts token/secret/password-like keys anywhere in the object, not only at the top level", () => {
    const redactor = new DefaultRedactor({ secrets: [] });
    const event = {
      type: "state_change",
      kind: "storage",
      data: { userId: "u1", api_key: "sk-live-abc", nested: { password: "p4ssw0rd", note: "fine" } },
    };

    const redacted = redactor.redactEvent(event) as typeof event;

    expect(redacted.data.api_key).toBe("<redacted:api_key>");
    expect(redacted.data.nested.password).toBe("<redacted:password>");
    expect(redacted.data.nested.note).toBe("fine");
    expect(redacted.data.userId).toBe("u1");
  });

  it("redacts configured literal secret values wherever they appear as a string", () => {
    const redactor = new DefaultRedactor({ secrets: ["sk-test-12345"] });
    const event = { type: "tool_call", arguments: { note: "using key sk-test-12345 today" } };

    // Exact-match redaction, not substring — a literal secret value used as
    // a whole string field. The field name deliberately avoids the
    // token-like key pattern (tested separately above), to isolate the
    // value-based rule.
    const eventWithSecretField = { type: "tool_call", arguments: { cardNumber: "sk-test-12345" } };
    const redacted = redactor.redactEvent(eventWithSecretField) as typeof eventWithSecretField;
    expect(redacted.arguments.cardNumber).toBe("<redacted:secret>");

    // A secret embedded inside a longer string is NOT caught by exact-value
    // matching — that's what `extraPatterns` is for, documented below.
    const untouched = redactor.redactEvent(event) as typeof event;
    expect(untouched.arguments.note).toBe("using key sk-test-12345 today");
  });

  it("redacts values matching a configured extra pattern anywhere in a string field", () => {
    const redactor = new DefaultRedactor({ secrets: [], extraPatterns: [/sk-test-\w+/] });
    const event = { type: "tool_call", arguments: { note: "using key sk-test-12345 today" } };
    const redacted = redactor.redactEvent(event) as typeof event;
    expect(redacted.arguments.note).toBe("<redacted:secret>");
  });

  it("redacts the whole request body on an auth-endpoint URL, regardless of field names", () => {
    const redactor = new DefaultRedactor({ secrets: [] });
    const event = {
      type: "network",
      method: "POST",
      url: "https://example.com/api/auth/login",
      requestBody: { username: "jane", passcode: "1234" }, // "passcode" isn't caught by the token-like key pattern
    };
    const redacted = redactor.redactEvent(event) as typeof event;
    expect(redacted.requestBody).toBe("<redacted:auth-endpoint-body>");
  });

  it("leaves a non-auth-endpoint request body untouched (besides key-name rules)", () => {
    const redactor = new DefaultRedactor({ secrets: [] });
    const event = {
      type: "network",
      method: "POST",
      url: "https://example.com/api/cart/add",
      requestBody: { item: "milk" },
    };
    const redacted = redactor.redactEvent(event) as typeof event;
    expect(redacted.requestBody).toEqual({ item: "milk" });
  });

  it.each([
    ["api-key", "the key is sk-abcdefghijklmnopqrstuvwxyz1234 for testing"],
    ["aws-access-key-id", "found AKIAIOSFODNN7EXAMPLE in the log"],
    ["github-token", "token: ghp_1234567890abcdefghijklmnopqrstuvwxyz"],
    ["jwt", "Authorization: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"],
    ["bearer-token", "curl -H 'Bearer sk_live_abcdef1234567890'"],
    ["card-number", "charged card 4111-1111-1111-1111 successfully"],
    ["email-address", "contact jane.doe+test@example.co.uk for support"],
  ])("redacts a %s found anywhere in a string field, by shape alone (PRD3 F13)", (_label, text) => {
    const redactor = new DefaultRedactor({ secrets: [] });
    const event = { type: "tool_call", arguments: { note: text } };
    const redacted = redactor.redactEvent(event) as typeof event;
    expect(redacted.arguments.note).not.toBe(text);
    expect(redacted.arguments.note).toMatch(/^<redacted:/);
  });

  it("does not redact an ordinary numeric id or an unformatted 16-digit run as a card number (PRD3 F13)", () => {
    const redactor = new DefaultRedactor({ secrets: [] });
    const event = { type: "tool_call", arguments: { note: "order id 1758332400000, total 4111111111111111 cents" } };
    const redacted = redactor.redactEvent(event) as typeof event;
    expect(redacted.arguments.note).toBe(event.arguments.note);
  });

  it("is fail-closed by contract: it never swallows an internal error", () => {
    const redactor = new DefaultRedactor({ secrets: [] });
    // A circular reference cannot be walked; the function must throw
    // outward rather than silently returning a partially-redacted object.
    const circular: Record<string, unknown> = { type: "network" };
    circular.self = circular;
    expect(() => redactor.redactEvent(circular)).toThrow();
  });
});

describe("DefaultRedactor.verify — §5.1 defence-in-depth audit", () => {
  it("reports clean:true when every sensitive field is already redacted", () => {
    const redactor = new DefaultRedactor({ secrets: [] });
    const evidence = [
      { id: "e-1", content: { headers: { authorization: "<redacted:authorization>" } } },
    ];
    expect(redactor.verify(evidence)).toEqual({ clean: true, findings: [] });
  });

  it("flags an unredacted sensitive key as a finding, naming the evidence id and the key", () => {
    const redactor = new DefaultRedactor({ secrets: [] });
    const evidence = [{ id: "e-17", content: { headers: { authorization: "Bearer leaked" } } }];
    const audit = redactor.verify(evidence);
    expect(audit.clean).toBe(false);
    expect(audit.findings).toContainEqual({ evidenceId: "e-17", rule: "unredacted-key:authorization" });
  });

  it("flags a configured literal secret value found anywhere, even outside a sensitive-named key", () => {
    const redactor = new DefaultRedactor({ secrets: ["sk-test-leak"] });
    const evidence = [{ id: "e-9", content: { note: "sk-test-leak" } }];
    const audit = redactor.verify(evidence);
    expect(audit.clean).toBe(false);
    expect(audit.findings).toContainEqual({ evidenceId: "e-9", rule: "configured-secret" });
  });

  it("flags a secret shape found by pattern alone, not just a sensitive key name (PRD3 F13)", () => {
    const redactor = new DefaultRedactor({ secrets: [] });
    const evidence = [{ id: "e-5", content: { note: "leaked AKIAIOSFODNN7EXAMPLE here" } }];
    const audit = redactor.verify(evidence);
    expect(audit.clean).toBe(false);
    expect(audit.findings).toContainEqual({ evidenceId: "e-5", rule: "secret-shape:aws-access-key-id" });
  });

  it("never mutates the evidence it audits", () => {
    const redactor = new DefaultRedactor({ secrets: [] });
    const content = { headers: { authorization: "Bearer leaked" } };
    const evidence = [{ id: "e-1", content }];
    redactor.verify(evidence);
    expect(content.headers.authorization).toBe("Bearer leaked");
  });
});
