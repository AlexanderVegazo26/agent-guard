import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { JevDecisionEngine } from "@agent-guard/decision";

export interface DoctorCommandOptions {
  cwd: string;
  live: boolean;
}

interface Check {
  name: string;
  status: "ok" | "warn" | "fail" | "skip";
  detail: string;
}

/**
 * `agentguard doctor` — TRD §10.3: verifies the Node version against
 * `.nvmrc`, fails if running under Bun instead of Node (§2.1.1), and
 * surfaces the decision engine's `capabilities()` (the §6.5 input limit)
 * at setup rather than mid-run.
 *
 * Not checked: the exact Playwright version and its installed browsers
 * (no Playwright integration exists in this build), and the proxy CA (no
 * live browser to install it into). Live Jev connectivity is checked only
 * with `--live` — this never spends the API key by default.
 */
export async function runDoctorCommand(options: DoctorCommandOptions): Promise<number> {
  const checks: Check[] = [];

  checks.push(await checkNodeVersion(options.cwd));
  checks.push(checkNotRunningUnderBun());
  checks.push(checkApiKeyPresence());
  checks.push(checkEngineCapabilities());
  checks.push({ name: "Playwright version/browsers", status: "skip", detail: "no Playwright integration in this build" });
  checks.push({ name: "Proxy CA installed in a browser profile", status: "skip", detail: "no live browser in this build" });

  if (options.live) {
    checks.push(await checkLiveJevConnectivity());
  } else {
    checks.push({ name: "Live Jev connectivity", status: "skip", detail: "pass --live to actually call the API" });
  }

  for (const check of checks) {
    console.log(`  ${iconFor(check.status)} ${check.name}: ${check.detail}`);
  }

  const anyFail = checks.some((c) => c.status === "fail");
  return anyFail ? 3 : 0;
}

function iconFor(status: Check["status"]): string {
  return status === "ok" ? "✓" : status === "fail" ? "✗" : status === "warn" ? "!" : "-";
}

async function checkNodeVersion(cwd: string): Promise<Check> {
  const nvmrcPath = path.join(cwd, ".nvmrc");
  if (!existsSync(nvmrcPath)) {
    return { name: "Node version", status: "warn", detail: `no .nvmrc found at ${nvmrcPath}` };
  }
  const wanted = (await readFile(nvmrcPath, "utf8")).trim();
  const actualMajor = process.versions.node.split(".")[0];
  if (actualMajor === wanted) {
    return { name: "Node version", status: "ok", detail: `${process.versions.node} matches .nvmrc (${wanted})` };
  }
  return { name: "Node version", status: "fail", detail: `running ${process.versions.node}, .nvmrc wants ${wanted}` };
}

function checkNotRunningUnderBun(): Check {
  // TRD §2.1.1: Bun installs dependencies and runs tasks; Node executes every
  // line of AgentGuard's own code. `process.versions.bun` is only set when
  // the current process is the Bun runtime itself, not merely present on PATH.
  if (process.versions.bun) {
    return { name: "Runtime", status: "fail", detail: `running under Bun ${process.versions.bun} — this must run on Node (TRD §2.1.1)` };
  }
  return { name: "Runtime", status: "ok", detail: `Node ${process.versions.node}` };
}

function checkApiKeyPresence(): Check {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key || key.trim().length === 0) {
    return { name: "TYPESAFE_API_KEY", status: "fail", detail: "not set" };
  }
  return { name: "TYPESAFE_API_KEY", status: "ok", detail: "set" };
}

function checkEngineCapabilities(): Check {
  // `capabilities()` itself is a static return value, but the SDK client's
  // constructor validates the API key eagerly — this can fail before any
  // network call, independent of `checkApiKeyPresence`'s own check.
  try {
    const capabilities = new JevDecisionEngine().capabilities();
    return {
      name: "Decision engine capabilities",
      status: "ok",
      detail: `tokenBudget=${capabilities.tokenBudget}, primitives=${capabilities.primitives.join(",")}`,
    };
  } catch (err) {
    return {
      name: "Decision engine capabilities",
      status: "fail",
      detail: `could not construct the engine — ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkLiveJevConnectivity(): Promise<Check> {
  try {
    const engine = new JevDecisionEngine();
    await engine.decide(
      { task: "doctor check", injectedFaults: [], claims: [], evidence: [], links: [] },
      { ping: { type: "noul", instructions: "This is a connectivity check. Answer true." } },
    );
    return { name: "Live Jev connectivity", status: "ok", detail: "systemOne() call succeeded" };
  } catch (err) {
    return { name: "Live Jev connectivity", status: "fail", detail: String(err instanceof Error ? err.message : err) };
  }
}
