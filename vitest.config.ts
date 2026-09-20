import path from "node:path";
import { defineConfig } from "vitest/config";

// Alias workspace packages to their TS source so tests run against the
// current code without requiring `tsc -b` first (each package's
// package.json points "main"/"exports" at "./dist", which only exists after
// a build — the alias decouples test iteration speed from build order).
export default defineConfig({
  resolve: {
    alias: {
      "@alexvegman/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@alexvegman/reporters": path.resolve(__dirname, "packages/reporters/src/index.ts"),
      "@alexvegman/decision": path.resolve(__dirname, "packages/decision/src/index.ts"),
      "@alexvegman/assertions": path.resolve(__dirname, "packages/assertions/src/index.ts"),
      "@alexvegman/observe": path.resolve(__dirname, "packages/observe/src/index.ts"),
      "@alexvegman/mcp": path.resolve(__dirname, "packages/mcp/src/index.ts"),
      "@alexvegman/cli": path.resolve(__dirname, "packages/cli/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
