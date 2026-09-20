import type { AssertionId, AssertionResult, AssertionStatus, DegradationRecord, Evidence, EvidenceGraph, PolicyConfig } from "@agent-guard/core";
import {
  estimateQuestionsTokens,
  estimateStateTokens,
  type DecisionAnswer,
  type DecisionEngine,
  type QuestionSet,
} from "@agent-guard/decision";
import { findFabricatedToolMention } from "./claimChecks.js";
import { DEFINITIONS, type FanOutDefinition } from "./definitions.js";
import { runDeterministicPrePass } from "./deterministic.js";
import { priorityOrder } from "./priority.js";
import { checkEvidenceSufficiency, REQUIREMENTS, type SufficiencyResult } from "./requirements.js";
import { selectEvidenceForAssertion } from "./selection.js";
import { buildUnionState } from "./state.js";
import { noulConfidence, noulVerdict, scoreVerdict } from "./verdict.js";

/**
 * §6 — the pipeline that turns an evidence graph into `AssertionResult`s.
 *
 * Order per requested assertion:
 *  1. whole-assertion deterministic pre-pass (§6.6)
 *  2. evidence sufficiency (§6.3)
 *  3. per-claim deterministic fabricated-tool check, fan-out assertions only
 *     (§6.6 bullet 1) — an assertion can be *partially* resolved this way,
 *     with the remaining items still needing the decision engine
 *  4. union-first batching (§6.4), degrading to split-batch-per-assertion
 *     when the union doesn't fit, then to fan-out caps with priority
 *     ordering, then to a capacity `REVIEW` (§6.5/§6.7)
 *
 * Not implemented in this build (see repo notes): the "tighten selection"
 * and "chunk with explicit aggregation" rungs of the §6.7 ladder. Every
 * assertion's selector is already a fixed, fairly minimal type-based
 * filter, and chunking is only sound for assertions with a declared
 * aggregation rule this build doesn't specify per-assertion.
 */
export async function evaluate(
  graph: EvidenceGraph,
  requested: AssertionId[],
  engine: DecisionEngine,
  policy: PolicyConfig,
): Promise<Record<string, AssertionResult>> {
  const results: Record<string, AssertionResult> = {};
  let pending: AssertionId[] = [];

  // Phase 1 — whole-assertion deterministic pre-pass, then sufficiency.
  for (const id of requested) {
    const deterministic = runDeterministicPrePass(id, graph);
    if (deterministic) {
      results[id] = deterministic;
      continue;
    }

    const sufficiency = checkEvidenceSufficiency(graph, REQUIREMENTS[id]);
    if (!sufficiency.sufficient) {
      results[id] = buildAbstentionResult(id, sufficiency);
      continue;
    }

    pending.push(id);
  }

  if (pending.length === 0) return results;

  // Phase 2 — per-claim deterministic check for fan-out assertions. An
  // assertion whose every item resolves this way needs no engine call at
  // all and is removed from `pending` before any budget question arises.
  const plans: Partial<Record<AssertionId, FanOutPlan>> = {};

  for (const id of pending) {
    const def = DEFINITIONS[id];
    if (def.kind !== "fanout") continue;

    const items = graph.byType(def.fanOutOver);
    const deterministicResults: DeterministicItemResult[] = [];
    const toAsk: Evidence[] = [];

    for (const item of items) {
      if (id === "noUnsupportedClaims" || id === "noFabricatedToolUsage") {
        const fabricatedTool = findFabricatedToolMention(item, graph);
        if (fabricatedTool !== null) {
          deterministicResults.push({
            itemId: item.id,
            note: `${item.id}: claims use of tool \`${fabricatedTool}\`, which was never called (fabricated tool usage)`,
          });
          continue;
        }
      }
      toAsk.push(item);
    }

    plans[id] = { fanOutOver: def.fanOutOver, deterministicResults, toAsk, included: [], dropped: [] };
  }

  for (const id of pending) {
    const plan = plans[id];
    if (plan && plan.toAsk.length === 0) {
      results[id] = aggregateFanOut(
        id,
        DEFINITIONS[id] as FanOutDefinition,
        [],
        {},
        plan.deterministicResults,
        undefined,
        policy,
        0,
        "deterministic",
      );
    }
  }
  pending = pending.filter((id) => !(plans[id] && plans[id]!.toAsk.length === 0));
  if (pending.length === 0) return results;

  // Phase 3 — decide union-batch vs. split-batch (§6.7's question-side
  // ladder, rung 1: "split the batch ... the one step that helps both
  // sides"). Try the full union uncapped first; only degrade if it
  // measurably doesn't fit.
  const budget = engine.capabilities().tokenBudget;
  const reserve = policy.decision.reserveForQuestions;
  const stateBudget = budget - reserve;

  const trial = buildBatch(graph, pending, plans, policy, false);
  const trialStateTokens = estimateStateTokens(trial.state);
  const trialQuestionTokens = estimateQuestionsTokens(trial.questions);
  const fitsAsOneBatch = trialStateTokens <= stateBudget && trialQuestionTokens <= reserve;

  if (fitsAsOneBatch) {
    for (const id of pending) {
      const plan = plans[id];
      if (plan) plan.included = plan.toAsk;
    }
    const startedAt = Date.now();
    const decision = await engine.decide(trial.state, trial.questions);
    const durationMs = Date.now() - startedAt;
    return { ...results, ...interpretAll(pending, graph, plans, decision.answers, policy, durationMs) };
  }

  // Split-batch: one `decide()` call per pending assertion. Each gets its
  // own minimal state; a fan-out assertion whose OWN payload still
  // overflows applies its cap (with priority ordering) before asking, and
  // if that still doesn't fit, abstains at capacity rather than guessing.
  //
  // PRD3 A3/D6-D7: `DegradationRecord` was declared on `AssertionResult`
  // (`schema.ts`) and never populated by any code path — a report could
  // show a REVIEW's `reviewVia` but never say *why* a PASS/FAIL took the
  // split-batch or fan-out-cap route to get there. Every assertion
  // evaluated below the union-batch fast path now records which of the two
  // implemented rungs it took. `tighten-selection` and `chunk-aggregate`
  // (TRD §6.7's remaining rungs) are still not implemented — see this
  // function's own header — so no result is ever tagged with either.
  for (const id of pending) {
    const plan = plans[id];
    let degradation: DegradationRecord = {
      strategy: "split-batch",
      reason: "the union of all pending assertions' evidence exceeded the engine's token budget; this assertion was evaluated in its own call",
    };

    let own = buildBatch(graph, [id], plans, policy, false);
    let ownStateTokens = estimateStateTokens(own.state);
    let ownQuestionTokens = estimateQuestionsTokens(own.questions);

    if (plan && (ownStateTokens > stateBudget || ownQuestionTokens > reserve)) {
      const cap = plan.fanOutOver === "agent_claim" ? policy.questions.maxClaimQuestions : policy.questions.maxToolQuestions;
      const ordered = priorityOrder(id, plan.toAsk, graph, policy.questions.destructiveTools);
      plan.included = ordered.slice(0, cap);
      plan.dropped = ordered.slice(cap);
      own = buildBatch(graph, [id], plans, policy, true);
      ownStateTokens = estimateStateTokens(own.state);
      ownQuestionTokens = estimateQuestionsTokens(own.questions);
      degradation = {
        strategy: "fanout-cap",
        reason: `dropped ${plan.dropped.length} of ${ordered.length} item(s) by priority order to fit this assertion's own call within the engine's budget`,
      };
    } else if (plan) {
      plan.included = plan.toAsk;
    }

    if (ownStateTokens > stateBudget || ownQuestionTokens > reserve) {
      results[id] = {
        id,
        status: "review",
        basis: "jev",
        reviewVia: "capacity",
        evidence: [],
        explanation: "evidence exceeds engine capacity",
        degradation: { strategy: "review", reason: "evidence still exceeds the engine's per-call budget after the fan-out cap; abstaining rather than guessing" },
        durationMs: 0,
      };
      continue;
    }

    const startedAt = Date.now();
    const decision = await engine.decide(own.state, own.questions);
    const durationMs = Date.now() - startedAt;
    Object.assign(results, interpretAll([id], graph, plans, decision.answers, policy, durationMs, degradation));
  }

  return results;
}

// ---------------------------------------------------------------------------
// Types local to the pipeline
// ---------------------------------------------------------------------------

interface DeterministicItemResult {
  itemId: string;
  note: string;
}

interface FanOutPlan {
  fanOutOver: "agent_claim" | "tool_call";
  deterministicResults: DeterministicItemResult[];
  toAsk: Evidence[];
  included: Evidence[];
  dropped: Evidence[];
}

// ---------------------------------------------------------------------------
// Batch construction
// ---------------------------------------------------------------------------

function buildBatch(
  graph: EvidenceGraph,
  ids: AssertionId[],
  plans: Partial<Record<AssertionId, FanOutPlan>>,
  _policy: PolicyConfig,
  useIncluded: boolean,
): { state: ReturnType<typeof buildUnionState>; questions: QuestionSet } {
  const questions: QuestionSet = {};
  const selectedUnion = new Map<string, Evidence>();

  for (const id of ids) {
    const def = DEFINITIONS[id];

    if (def.kind === "single") {
      for (const item of selectEvidenceForAssertion(graph, id, def.selectorTypes)) {
        selectedUnion.set(item.id, item);
      }
      questions[id] = def.buildQuestion(graph);
      continue;
    }

    const plan = plans[id];
    const items = plan ? (useIncluded ? plan.included : plan.toAsk) : [];
    for (const item of items) {
      questions[`${id}::${item.id}`] = def.buildQuestion(item, graph);
      selectedUnion.set(item.id, item);
      for (const neighbor of selectEvidenceForAssertion(graph, id, def.selectorTypes, item)) {
        selectedUnion.set(neighbor.id, neighbor);
      }
    }
  }

  const selectedEvidence = [...selectedUnion.values()];
  return { state: buildUnionState(graph, selectedEvidence), questions };
}

// ---------------------------------------------------------------------------
// Interpretation
// ---------------------------------------------------------------------------

function interpretAll(
  ids: AssertionId[],
  graph: EvidenceGraph,
  plans: Partial<Record<AssertionId, FanOutPlan>>,
  answers: Record<string, DecisionAnswer>,
  policy: PolicyConfig,
  durationMs: number,
  degradation?: DegradationRecord,
): Record<string, AssertionResult> {
  const out: Record<string, AssertionResult> = {};

  for (const id of ids) {
    const def = DEFINITIONS[id];

    if (def.kind === "single") {
      const evidenceIds = selectEvidenceForAssertion(graph, id, def.selectorTypes).map((e) => e.id);
      out[id] = interpretSingle(id, def.primitive, def.polarity, answers[id], evidenceIds, policy, durationMs, degradation);
      continue;
    }

    const plan = plans[id];
    out[id] = aggregateFanOut(
      id,
      def,
      plan?.included ?? [],
      answers,
      plan?.deterministicResults ?? [],
      plan && plan.dropped.length > 0 ? plan.dropped.map((d) => d.id) : undefined,
      policy,
      durationMs,
      "jev",
      degradation,
    );
  }

  return out;
}

function buildAbstentionResult(id: AssertionId, sufficiency: SufficiencyResult): AssertionResult {
  if (sufficiency.outcome === "not_applicable") {
    return { id, status: "not_applicable", basis: "not-applicable", evidence: [], durationMs: 0 };
  }
  return {
    id,
    status: "review",
    basis: "jev",
    reviewVia: "structural-gap",
    missing: sufficiency.missing,
    evidence: [],
    durationMs: 0,
  };
}

function perAssertionBand(id: AssertionId, policy: PolicyConfig): [number, number] {
  if (id === "noPromptInjectionSuccess" && policy.perAssertion.noPromptInjectionSuccess) {
    return policy.perAssertion.noPromptInjectionSuccess.uncertaintyBand;
  }
  return policy.uncertaintyBand;
}

function interpretSingle(
  id: AssertionId,
  primitive: "noul" | "score",
  polarity: "positive" | "negative" | undefined,
  answer: DecisionAnswer | undefined,
  evidenceIds: string[],
  policy: PolicyConfig,
  durationMs: number,
  degradation?: DegradationRecord,
): AssertionResult {
  if (!answer) throw new Error(`evaluate: no answer received for assertion "${id}"`);

  if (answer.type === "noul") {
    const band = perAssertionBand(id, policy);
    const status = noulVerdict(answer.noul, polarity ?? "positive", band);
    return withReviewVia(
      {
        id,
        status,
        basis: "jev",
        signal: "noul-probability",
        // PRD2 G9: the raw probability, not confidence-in-verdict — see
        // `noulConfidence`'s doc comment for why those are different
        // numbers and why calibration needs the latter.
        confidence: noulConfidence(answer.noul),
        evidence: evidenceIds,
        degradation,
        durationMs,
      },
      status,
    );
  }

  if (answer.type === "score") {
    const scorePolicy = policy.perAssertion.recoveredFromFailure;
    const status = scoreVerdict(answer.score, answer.confidence, scorePolicy);
    return withReviewVia(
      {
        id,
        status,
        basis: "jev",
        signal: "derived-confidence",
        confidence: answer.confidence,
        probabilities: answer.probabilities,
        evidence: evidenceIds,
        degradation,
        durationMs,
      },
      status,
    );
  }

  throw new Error(`evaluate: assertion "${id}" is not defined as a single-question choice assertion`);
}

function withReviewVia(result: AssertionResult, status: AssertionStatus): AssertionResult {
  if (status === "review" && !result.reviewVia) {
    return { ...result, reviewVia: "uncertainty-band" };
  }
  return result;
}

const HARD_FAIL_CHOICE_OPTIONS: readonly string[] = ["wrong-tool", "wrong-target"];

/**
 * Merges deterministic per-item results (§6.6 bullet 1, fabricated tool
 * mentions) with engine-answered items into one aggregate verdict.
 * `basis` is "deterministic" only when the caller already knows every item
 * resolved without an engine call (see the `evaluate` phase-2 short-circuit);
 * otherwise it is "jev", because at least one item needed the engine even
 * if others were free.
 */
function aggregateFanOut(
  id: AssertionId,
  def: FanOutDefinition,
  included: Evidence[],
  answers: Record<string, DecisionAnswer>,
  deterministicResults: DeterministicItemResult[],
  droppedIds: string[] | undefined,
  policy: PolicyConfig,
  durationMs: number,
  basis: "deterministic" | "jev",
  degradation?: DegradationRecord,
): AssertionResult {
  const cited = new Set<string>();
  const notes: string[] = [];
  let anyFail = deterministicResults.length > 0;

  for (const det of deterministicResults) {
    cited.add(det.itemId);
    notes.push(det.note);
  }

  let anyReview = false;
  // §6.9 calibration gap fix: an aggregate over N items has no single
  // engine-reported confidence, but calibration needs one scalar per
  // result (same as a single-question assertion). Rather than inventing a
  // number, this picks the actual engine answer that was the weakest link
  // in the aggregate's own verdict — the one a human would look at first
  // to decide whether to trust it.
  //
  // PRD2 G10 fix: this used to push the *raw* probability and take its
  // MAX, on the documented assumption that every Noul fan-out is
  // negative-polarity. That assumption was wrong — `toolArgumentsCorrect`
  // and `toolResultUsedCorrectly` are positive-polarity fan-outs — and the
  // raw-probability MAX is also just the wrong statistic even where the
  // assumption held (see `noulConfidence`'s doc comment: a low raw
  // probability can be a highly *confident* verdict). Each item's
  // confidence-in-its-own-verdict is `noulConfidence(p)`
  // (polarity-invariant), and the aggregate's confidence is the MIN across
  // items — the least confident individual judgment in the batch. For
  // Choice, MIN confidence is the batch's weakest-confidence item, as before.
  const noulConfidences: number[] = [];
  const choiceConfidences: number[] = [];

  for (const item of included) {
    const key = `${id}::${item.id}`;
    const answer = answers[key];
    if (!answer) throw new Error(`evaluate: no answer received for fan-out question "${key}"`);
    cited.add(item.id);

    if (def.primitive === "noul" && answer.type === "noul") {
      noulConfidences.push(noulConfidence(answer.noul));
      const band = perAssertionBand(id, policy);
      const status = noulVerdict(answer.noul, def.polarity ?? "negative", band);
      if (status === "fail") {
        anyFail = true;
        notes.push(`${item.id}: unsupported (p=${answer.noul.toFixed(2)})`);
      } else if (status === "review") {
        anyReview = true;
      }
      continue;
    }

    if (def.primitive === "choice" && answer.type === "choice") {
      choiceConfidences.push(answer.confidence);
      const choicePolicy = policy.perAssertion.toolWasAppropriate;
      if (answer.confidence < choicePolicy.minConfidence) {
        anyReview = true;
        notes.push(`${item.id}: low confidence (${answer.choice}, conf=${answer.confidence.toFixed(2)})`);
        continue;
      }
      const hardFail = choicePolicy.hardFailOptions ?? HARD_FAIL_CHOICE_OPTIONS;
      if (hardFail.includes(answer.choice)) {
        anyFail = true;
        notes.push(`${item.id}: ${answer.choice}`);
      } else if (!choicePolicy.passOptions.includes(answer.choice)) {
        // e.g. "unnecessary" — a quality signal, not a failure, per §6.2.1.
        notes.push(`${item.id}: ${answer.choice} (quality signal, not counted as a failure)`);
      }
      continue;
    }

    throw new Error(`evaluate: fan-out question "${key}" returned an unexpected answer shape`);
  }

  const coverageGaps = droppedIds && droppedIds.length > 0 ? droppedIds : undefined;
  // A capped assertion cannot return "pass" (TRD §6.5 rule 4) — an aggregate
  // over an incomplete sample is never a clean pass.
  const status: AssertionStatus = anyFail ? "fail" : coverageGaps ? "review" : anyReview ? "review" : "pass";

  const confidence =
    noulConfidences.length > 0
      ? Math.min(...noulConfidences)
      : choiceConfidences.length > 0
        ? Math.min(...choiceConfidences)
        : undefined;

  return {
    id,
    status,
    basis,
    signal: def.primitive === "noul" ? "noul-probability" : "derived-confidence",
    confidence,
    evidence: [...cited],
    coverageGaps,
    explanation: notes.length > 0 ? notes.join("; ") : `${cited.size} item(s) checked`,
    reviewVia: status === "review" ? (coverageGaps ? "capacity" : "uncertainty-band") : undefined,
    degradation,
    durationMs,
  };
}
