import { defineConfig } from "@playwright/test";

/**
 * No browser project is configured — this suite proves the `agentguard`
 * fixture wiring works inside Playwright Test's real execution model
 * (worker-scoped options, fixture teardown), not that a browser can be
 * driven. Nothing here calls `page`/`browser`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  timeout: 15_000,
});
