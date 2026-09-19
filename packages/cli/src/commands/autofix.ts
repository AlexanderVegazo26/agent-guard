import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FilesystemRunStore, type AssertionId, type AssertionResult } from "@agent-guard/core";
import { AnthropicFixProposerEngine, type FixProposerEngine, type RecurringFinding } from "@agent-guard/decision";

/**
 * docs/AUTOFIX.md §9/§10 — the part of the autofix design that is NOT
 * blocked by §4's prerequisites: *proposing* a fix needs no held-out
 * fixture set and no baseline-variance floor, because it makes no claim
 * about whether the fix works. Only *validating* one does, which is why
 * there is deliberately no `autofix validate` or `autofix apply` command
 * here — those stay blocked until §4.1/§4.2 are closed. This closes the
 * "detect and explain, but never fix" gap honestly: it produces a
 * reviewable, unvalidated proposal, not a proven improvement.
 */
export interface FixProposal {
  id: string;
  targetPath: string;
  targetAssertionIds: AssertionId[];
  baselineRunIds: string[];
  diff: string;
  rationale: string;
  proposedAt: string;
}

export interface AutofixProposeOptions {
  agentMdPath: string;
  runIds: string[];
  storeRoot?: string;
  proposer?: FixProposerEngine;
}

const MIN_OCCURRENCES = 2; // PRD §12: n=1 is an anecdote, never a pattern.
const RECURRING_STATUSES: AssertionResult["status"][] = ["fail", "review"];

export async function runAutofixProposeCommand(options: AutofixProposeOptions): Promise<number> {
  if (options.runIds.length < MIN_OCCURRENCES) {
    console.error(`agentguard autofix propose: at least ${MIN_OCCURRENCES} run ids are required — a single run is an anecdote, not a pattern (PRD §12).`);
    return 3;
  }

  const store = new FilesystemRunStore(options.storeRoot);
  const findings = await detectRecurringFindings(store, options.runIds);

  if (findings.length === 0) {
    console.log(`agentguard autofix propose: no assertion failed/reviewed in ${MIN_OCCURRENCES}+ of the given runs — nothing recurring to propose a fix for.`);
    return 0;
  }

  let currentText: string;
  try {
    currentText = await readFile(options.agentMdPath, "utf8");
  } catch (err) {
    console.error(`agentguard autofix propose: could not read "${options.agentMdPath}" — ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }

  let proposer: FixProposerEngine;
  try {
    proposer = options.proposer ?? new AnthropicFixProposerEngine();
  } catch (err) {
    console.error(`agentguard autofix propose: no fix-proposer engine available — ${err instanceof Error ? err.message : String(err)}`);
    return 3;
  }

  const fixesDir = path.join(options.storeRoot ?? path.join(process.cwd(), ".agentguard"), "fixes");
  await mkdir(fixesDir, { recursive: true });

  // §11: one proposal per recurring finding, never batched — a proposal's
  // attribution ("did *this* edit cause *this* change") only stays
  // unambiguous when it targets exactly one thing.
  for (const finding of findings) {
    const result = await proposer.propose({
      targetPath: options.agentMdPath,
      currentText,
      recurringEvidence: [finding],
    });

    const proposal: FixProposal = {
      id: `fix-${Date.now()}-${randomUUID().slice(0, 8)}`,
      targetPath: options.agentMdPath,
      targetAssertionIds: [finding.assertionId],
      baselineRunIds: options.runIds,
      diff: result.diff,
      rationale: result.rationale,
      proposedAt: new Date().toISOString(),
    };

    await writeFile(path.join(fixesDir, `${proposal.id}.json`), JSON.stringify(proposal, null, 2), "utf8");

    console.log(`\n${"─".repeat(60)}`);
    console.log(`Fix proposal ${proposal.id} — targets "${finding.assertionId}" (recurred in ${finding.occurrences}/${options.runIds.length} runs)`);
    console.log(`${"─".repeat(60)}`);
    console.log(`\nRationale:\n${proposal.rationale}`);
    console.log(`\nDiff against ${options.agentMdPath}:\n${proposal.diff}`);
    console.log(
      `\nNOT VALIDATED — this diff has not been re-evaluated against any run. Run \`agentguard test --live\` with the` +
        ` edit applied and \`agentguard compare\` before treating this as anything more than a suggestion (docs/AUTOFIX.md §4/§5).`,
    );
  }

  return 0;
}

export interface AutofixShowOptions {
  fixId: string;
  storeRoot?: string;
}

export async function runAutofixShowCommand(options: AutofixShowOptions): Promise<number> {
  const fixesDir = path.join(options.storeRoot ?? path.join(process.cwd(), ".agentguard"), "fixes");
  const filePath = path.join(fixesDir, `${options.fixId}.json`);

  let proposal: FixProposal;
  try {
    proposal = JSON.parse(await readFile(filePath, "utf8")) as FixProposal;
  } catch {
    console.error(`agentguard autofix show: no fix proposal found at "${filePath}"`);
    return 3;
  }

  console.log(`Fix proposal ${proposal.id}`);
  console.log(`  Target:      ${proposal.targetPath}`);
  console.log(`  Assertions:  ${proposal.targetAssertionIds.join(", ")}`);
  console.log(`  Baseline:    ${proposal.baselineRunIds.join(", ")}`);
  console.log(`  Proposed:    ${proposal.proposedAt}`);
  console.log(`\nRationale (the proposer's own claim, not a verified fact):\n${proposal.rationale}`);
  console.log(`\nDiff:\n${proposal.diff}`);
  console.log(
    "\nNOT VALIDATED — no live re-evaluation has been run against this proposal. Applying it is an ordinary" +
      " file edit you make yourself; nothing in AgentGuard applies a diff automatically (docs/AUTOFIX.md §10).",
  );

  return 0;
}

async function detectRecurringFindings(store: FilesystemRunStore, runIds: string[]): Promise<RecurringFinding[]> {
  const byAssertion = new Map<AssertionId, { occurrences: number; excerpts: string[]; explanation?: string }>();

  for (const runId of runIds) {
    const decisions = await store.loadDecisions(runId);
    if (!decisions) continue;
    const evidence = await store.loadEvidence(runId);

    for (const [id, result] of Object.entries(decisions)) {
      if (!RECURRING_STATUSES.includes(result.status)) continue;
      const assertionId = id as AssertionId;
      const entry = byAssertion.get(assertionId) ?? { occurrences: 0, excerpts: [] };
      entry.occurrences += 1;

      for (const evidenceId of result.evidence) {
        const item = evidence?.items.find((e) => e.id === evidenceId);
        if (item) entry.excerpts.push(`[${runId}] ${item.type}: ${JSON.stringify(item.content)}`);
      }
      if (!entry.explanation && result.explanation) entry.explanation = result.explanation;

      byAssertion.set(assertionId, entry);
    }
  }

  const findings: RecurringFinding[] = [];
  for (const [assertionId, entry] of byAssertion) {
    if (entry.occurrences < MIN_OCCURRENCES) continue;
    findings.push({
      assertionId,
      occurrences: entry.occurrences,
      evidenceExcerpts: entry.excerpts.slice(0, 20), // a bound, same discipline as the fan-out caps — don't hand an unbounded transcript to the proposer
      explanation: entry.explanation,
    });
  }
  return findings;
}

/** Exported for tests only — not part of the CLI's own public surface. */
export const __testables = { detectRecurringFindings };
