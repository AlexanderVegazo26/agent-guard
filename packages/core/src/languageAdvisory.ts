import type { EvidenceGraph } from "./graph.js";

/**
 * PRD2 F11 / PRD v0.6 §14 open risk: "Jev's primary training language is
 * English, and TypeSafe states other languages — CJK scripts especially —
 * currently have lower accuracy... Teams testing non-English applications
 * should expect degraded verdict quality in a way this document cannot
 * currently size." That risk was stated but never surfaced to a user at
 * run time. This gives every entry point a one-line advisory instead of
 * a silent, unexplained accuracy drop.
 *
 * Deliberately crude: a simple non-ASCII character ratio over the
 * evidence graph's own content, not a real language detector. "Crude but
 * surfaced" beats "accurate but silent" for a risk this document already
 * admits it cannot size precisely.
 */
export const NON_ASCII_ADVISORY_THRESHOLD = 0.3;

export function nonAsciiRatio(text: string): number {
  if (text.length === 0) return 0;
  let nonAscii = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code !== undefined && code > 127) nonAscii += 1;
  }
  return nonAscii / text.length;
}

/**
 * Only actual string leaf values, never object keys or JSON punctuation —
 * `JSON.stringify`-ing whole content objects dilutes the ratio with
 * structural ASCII (field names, braces, quotes) that has nothing to do
 * with what language the *content* is in.
 */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
}

function evidenceTextSample(graph: EvidenceGraph): string {
  const strings: string[] = [graph.task];
  for (const item of graph.items) collectStrings(item.content, strings);
  return strings.join(" ");
}

/**
 * Returns a one-line advisory when the run's evidence is dominated by
 * non-ASCII content, or `null` when it isn't — never a percentage nobody
 * asked for on an ordinary English-language run.
 */
export function languageAdvisory(graph: EvidenceGraph): string | null {
  const ratio = nonAsciiRatio(evidenceTextSample(graph));
  if (ratio < NON_ASCII_ADVISORY_THRESHOLD) return null;
  return (
    `agentguard: ${(ratio * 100).toFixed(0)}% of this run's evidence content is non-ASCII. ` +
    "Jev's primary training language is English and non-English content (CJK scripts especially) " +
    "currently has lower accuracy, unsized by this project (PRD v0.6 §14) — treat these verdicts with extra scrutiny."
  );
}
