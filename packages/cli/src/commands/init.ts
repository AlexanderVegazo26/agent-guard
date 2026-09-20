import { existsSync } from "node:fs";
import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * No import here on purpose: `loadPolicyConfig` (packages/core/src/configLoader.ts)
 * re-passes this file's default export through `defineConfig()` itself, so a
 * plain object works with zero dependencies installed in the target project —
 * required for `npx @alexvegman/cli test` to run with nothing but the CLI
 * package resolved. A project that *has* installed `@alexvegman/core` can
 * still author `export default defineConfig({...})` by hand; both forms load.
 */
const DEFAULT_CONFIG = `export default {
  // See TRD §10.2 for every field this accepts.
};
`;

/**
 * Bundled under `packages/cli/examples/` (published via `files` in
 * `package.json`, alongside `dist/`) — resolved relative to this compiled
 * file so it also works when the CLI runs from an installed
 * `node_modules/@alexvegman/cli`, not just inside this monorepo.
 */
const BUNDLED_EXAMPLES_DIR = fileURLToPath(new URL("../../examples", import.meta.url));

/**
 * PRD3 F22 — copy the bundled example fixture(s) into `agentguard/examples/`
 * in the target project so `agentguard test --fixtures agentguard/examples`
 * has something runnable immediately after `init`, with no API key or
 * network access (it runs against the mock decision engine). Never
 * overwrites a directory the project already created for itself.
 */
async function scaffoldExamples(cwd: string): Promise<void> {
  const destRoot = path.join(cwd, "agentguard", "examples");
  if (!existsSync(BUNDLED_EXAMPLES_DIR)) {
    console.log(`  no bundled examples found at ${BUNDLED_EXAMPLES_DIR}, skipping`);
    return;
  }

  const entries = await readdir(BUNDLED_EXAMPLES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dest = path.join(destRoot, entry.name);
    if (existsSync(dest)) {
      console.log(`  ${dest} already exists, leaving it alone`);
      continue;
    }
    await cp(path.join(BUNDLED_EXAMPLES_DIR, entry.name), dest, { recursive: true });
    console.log(`  created ${dest}`);
  }
}

/** `agentguard init` — PRD §9.3: scaffold config + directories. */
export async function runInitCommand(cwd: string): Promise<number> {
  const dirs = [
    path.join(cwd, ".agentguard", "runs"),
    path.join(cwd, ".agentguard", "reports"),
    path.join(cwd, "fixtures", "golden"),
    path.join(cwd, "fixtures", "correct"),
  ];
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
    console.log(`  created ${dir}`);
  }

  await scaffoldExamples(cwd);

  const configPath = path.join(cwd, "agentguard.config.ts");
  if (existsSync(configPath)) {
    console.log(`  ${configPath} already exists, leaving it alone`);
  } else {
    await writeFile(configPath, DEFAULT_CONFIG, "utf8");
    console.log(`  created ${configPath}`);
  }

  console.log("\nSet TYPESAFE_API_KEY in your environment, then run `agentguard doctor`.");
  console.log("Or, with no setup at all: `agentguard test --fixtures agentguard/examples` runs the bundled example against the mock engine.");
  return 0;
}
