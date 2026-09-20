import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { AgentRun, type AgentRun as AgentRunT } from "@alexvegman/core";
import type { DecisionAnswer } from "@alexvegman/decision";

export interface ExpectedAssertion {
  status: "pass" | "fail" | "review" | "not_applicable" | "error";
  basis?: "deterministic" | "jev" | "escalated" | "not-applicable";
  level?: string;
  mustCite?: string[];
  reviewVia?: "structural-gap" | "uncertainty-band" | "capacity";
  missing?: string[];
  coverageNote?: unknown;
}

export interface GoldenFixture {
  name: string;
  dir: string;
  run: AgentRunT;
  expected: Record<string, ExpectedAssertion>;
  mock: Record<string, DecisionAnswer>;
}

export async function loadFixture(dir: string): Promise<GoldenFixture> {
  const runRaw = JSON.parse(await readFile(path.join(dir, "run.json"), "utf8"));
  const run = AgentRun.parse(runRaw);

  const expected = JSON.parse(await readFile(path.join(dir, "expected.json"), "utf8")) as Record<
    string,
    ExpectedAssertion
  >;

  const mockPath = path.join(dir, "mock.json");
  const mock = existsSync(mockPath) ? (JSON.parse(await readFile(mockPath, "utf8")) as Record<string, DecisionAnswer>) : {};

  return { name: path.basename(dir), dir, run, expected, mock };
}

export async function loadFixtureSuite(root: string): Promise<GoldenFixture[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
  return Promise.all(dirs.sort().map(loadFixture));
}
