import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_CONFIG = `import { defineConfig } from "@agent-guard/core";

export default defineConfig({
  // See TRD §10.2 for every field this accepts.
});
`;

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

  const configPath = path.join(cwd, "agentguard.config.ts");
  if (existsSync(configPath)) {
    console.log(`  ${configPath} already exists, leaving it alone`);
  } else {
    await writeFile(configPath, DEFAULT_CONFIG, "utf8");
    console.log(`  created ${configPath}`);
  }

  console.log("\nSet TYPESAFE_API_KEY in your environment, then run `agentguard doctor`.");
  return 0;
}
