import type { AssertionResult } from "./schema.js";

/** PRD §9.1 — console reporter. Each assertion renders in the terms of its own primitive. */
export function formatConsole(label: string, results: Record<string, AssertionResult>): string {
  const lines: string[] = ["AgentGuard", "", `  ${label}`, ""];

  for (const [id, r] of Object.entries(results)) {
    lines.push(`  ${icon(r.status)} ${id.padEnd(28)} ${detail(r)}`);
    if (r.explanation) lines.push(`      ${r.explanation}`);
    if (r.missing && r.missing.length > 0) lines.push(`      missing: ${r.missing.join(", ")}`);
    if (r.coverageGaps && r.coverageGaps.length > 0) {
      lines.push(`      unexamined (fan-out cap): ${r.coverageGaps.length} item(s)`);
    }
    if (r.degradation) {
      lines.push(`      degraded (${r.degradation.strategy}): ${r.degradation.reason}`);
    }
  }

  lines.push("", `  ${overallLabel(results)}`, "");
  lines.push("  Confidence values are advisory — calibration is not yet validated (PRD §10.3) [PRD3:F19].");
  return lines.join("\n");
}

function icon(status: AssertionResult["status"]): string {
  switch (status) {
    case "pass":
      return "✓"; // ✓
    case "fail":
      return "✗"; // ✗
    case "review":
      return "?";
    case "not_applicable":
      return "–"; // –
    case "error":
      return "!";
  }
}

function detail(r: AssertionResult): string {
  if (r.status === "not_applicable") return "not applicable";
  if (r.basis === "deterministic") return "deterministic";
  if (r.signal === "noul-probability" && r.confidence !== undefined) return `p=${r.confidence.toFixed(2)}`;
  if (r.signal === "derived-confidence" && r.confidence !== undefined) {
    const level = r.probabilities ? ` level=${topLevel(r.probabilities)}` : "";
    return `conf=${r.confidence.toFixed(2)}${level}`;
  }
  if (r.reviewVia) return `review (${r.reviewVia})`;
  return "";
}

function topLevel(probabilities: Record<string, number>): string {
  let best = "";
  let bestP = -1;
  for (const [k, p] of Object.entries(probabilities)) {
    if (p > bestP) {
      best = k;
      bestP = p;
    }
  }
  return best;
}

function overallLabel(results: Record<string, AssertionResult>): string {
  const statuses = Object.values(results).map((r) => r.status);
  if (statuses.some((s) => s === "error")) return "ERROR";
  if (statuses.every((s) => s === "not_applicable")) return "ERROR";
  if (statuses.some((s) => s === "fail")) return "FAIL";
  if (statuses.some((s) => s === "review")) return "REVIEW";
  return "PASS";
}
