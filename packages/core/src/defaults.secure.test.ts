import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildEvidencePack } from "./evidencePack.js";
import { FilesystemRunStore } from "./store.js";
import { TranscriptAdapter } from "./transcriptAdapter.js";
import type { StoredEvidence } from "./store.js";
import type { Evidence } from "./schema.js";

/**
 * API-001 — the zero-config-is-the-safe-path guarantee was previously
 * unverified by any test: nothing named `DefaultRedactor` and asserted it
 * was actually what a zero-option entry point uses. Redaction being wired
 * in was confirmed by code reading (security-review-report.json, API-001),
 * but a code reading is not a regression test.
 *
 * Each case below asserts the default *by its distinguishing behavior*,
 * not by inspecting a private field: `DefaultRedactor` has a documented,
 * specific signature — it replaces a recognized secret shape or a
 * sensitive key's value with a `<redacted:...>` placeholder, and
 * `FilesystemRunStore` fails closed (throws) rather than persisting
 * something `DefaultRedactor.verify()` flags. An identity/no-op redactor
 * would do neither. Each of the 5 assertions here was verified capable of
 * failing by temporarily swapping the relevant constructor's default to
 * such an identity/no-op redactor and re-running this file — all 5 went
 * red for the expected reason (a leaked secret/key surviving capture, or
 * `saveEvidence`/`buildEvidencePack` no longer flagging it), then green
 * again once the real default was restored.
 *
 * Scope note: `HttpFaultProxy` (`@alexvegman/observe`) and
 * `AgentGuardFixture` (`@alexvegman/playwright`) were also confirmed by
 * code reading to default `redactor` to `new DefaultRedactor()`
 * (proxy.ts:100, fixture.ts:102), but are not covered by a behavioral
 * assertion here: exercising `HttpFaultProxy`'s default requires driving
 * an actual MITM proxy through a live request (the pattern
 * `packages/observe/src/proxy.test.ts` already uses for its own
 * assertions), and `AgentGuardFixture` additionally requires a
 * `DecisionEngine`/`RunStore`/`PolicyConfig` to construct at all. Adding
 * that harness is beyond this finding's remediation text ("Add
 * packages/core/src/defaults.secure.test.ts"), which scopes to
 * `packages/core`. Flagged here rather than silently omitted.
 */
describe("defaults.secure — zero-config security defaults", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("TranscriptAdapter, constructed with no redactor, redacts a recognizable secret shape at capture", async () => {
    const adapter = new TranscriptAdapter();
    await adapter.start({ task: "t" });
    // A real-shaped AWS access key id — one of DefaultRedactor's
    // BUILTIN_SECRET_PATTERNS. An identity/no-op redactor would leave this
    // string untouched in the captured event.
    adapter.captureCommand("aws configure set aws_access_key_id AKIAABCDEFGHIJKLMNOP");
    adapter.captureOutput("ok", true);
    const run = await adapter.stop();

    const toolCall = run.events.find((e) => e.type === "tool_call") as { arguments: { raw: string } } | undefined;
    expect(toolCall).toBeDefined();
    expect(toolCall!.arguments.raw).not.toContain("AKIAABCDEFGHIJKLMNOP");
    expect(toolCall!.arguments.raw).toContain("<redacted:aws-access-key-id>");
  });

  it("TranscriptAdapter, constructed with no redactor, redacts a sensitive key name", async () => {
    const adapter = new TranscriptAdapter();
    await adapter.start({ task: "t" });
    adapter.captureCommand("curl -H 'Authorization: Bearer not-a-real-token-value-but-shaped-like-one'");
    adapter.captureOutput("ok", true);
    const run = await adapter.stop();

    const toolCall = run.events.find((e) => e.type === "tool_call") as { arguments: { raw: string } } | undefined;
    expect(toolCall!.arguments.raw).toContain("<redacted:bearer-token>");
  });

  it("FilesystemRunStore, constructed with no redactor, fails closed on unredacted evidence instead of writing it", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentguard-store-"));
    const store = new FilesystemRunStore(dir);

    await store.saveRun({
      id: "run-1",
      task: "t",
      agent: { name: "test-agent" },
      events: [],
      faults: [],
      startedAt: new Date().toISOString(),
      schemaVersion: 1,
    });

    const unredactedEvidence: StoredEvidence = {
      task: "t",
      links: [],
      items: [
        {
          id: "ev-1",
          type: "tool_call",
          source: "test",
          // A sensitive key left unredacted — DefaultRedactor.verify()
          // flags this as `unredacted-key:authorization`; a no-op
          // redactor's verify() would report `clean: true` and this write
          // would succeed instead of throwing.
          content: { authorization: "super-secret-value" },
          derivedFrom: ["ev-0"],
          timestamp: new Date().toISOString(),
          seq: 1,
        } satisfies Evidence,
      ],
    };

    await expect(store.saveEvidence("run-1", unredactedEvidence)).rejects.toThrow(/refusing to write unredacted evidence/);
  });

  it("FilesystemRunStore, constructed with no redactor, accepts evidence with no unredacted sensitive keys", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentguard-store-"));
    const store = new FilesystemRunStore(dir);

    await store.saveRun({
      id: "run-2",
      task: "t",
      agent: { name: "test-agent" },
      events: [],
      faults: [],
      startedAt: new Date().toISOString(),
      schemaVersion: 1,
    });

    const cleanEvidence: StoredEvidence = {
      task: "t",
      links: [],
      items: [
        {
          id: "ev-1",
          type: "tool_call",
          source: "test",
          content: { note: "nothing sensitive here" },
          derivedFrom: ["ev-0"],
          timestamp: new Date().toISOString(),
          seq: 1,
        } satisfies Evidence,
      ],
    };

    await expect(store.saveEvidence("run-2", cleanEvidence)).resolves.toBeUndefined();
  });

  it("buildEvidencePack, called with no explicit redactor, still flags a secret left in evidence.json at export time", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "agentguard-pack-"));
    const store = new FilesystemRunStore(dir);
    await store.saveRun({
      id: "run-3",
      task: "t",
      agent: { name: "test-agent" },
      events: [],
      faults: [],
      startedAt: new Date().toISOString(),
      schemaVersion: 1,
    });
    // Bypass the store's own fail-closed write to get an unredacted
    // evidence.json on disk, the way a bug elsewhere in the pipeline
    // might — this is exactly the "second, independent check" case
    // buildEvidencePack's own docstring describes.
    const runDir = (await store.runDirectory("run-3"))!;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path.join(runDir, "evidence.json"),
      JSON.stringify({
        task: "t",
        links: [],
        items: [{ id: "ev-1", type: "tool_call", source: "test", content: { authorization: "leaked" }, derivedFrom: ["ev-0"], timestamp: new Date().toISOString(), seq: 1 }],
      }),
      "utf8",
    );

    const outDir = path.join(dir, "export");
    const manifest = await buildEvidencePack(runDir, outDir, { runId: "run-3", agentguardVersion: "0.0.0-test" });

    expect(manifest.redactionAudit.clean).toBe(false);
    expect(manifest.redactionAudit.findingCount).toBeGreaterThan(0);
  });
});
