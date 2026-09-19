# AgentGuard Autofix — Design

**Document version:** 0.2
**Status:** Partially implemented. §9's `propose`/`show` half — detecting
a recurring pattern across ≥2 stored runs and generating a diff + rationale
— is real (`packages/cli/src/commands/autofix.ts`,
`agentguard autofix propose`/`show`) because it makes no claim about
whether the proposed fix works. §5's **validation gate is still not
implemented and remains blocked on §4's two prerequisites** — there is no
`autofix validate` and no `autofix apply` command, and none should be
built until §4.1/§4.2 are closed. Every proposal `autofix show` prints is
labeled `NOT VALIDATED` for exactly this reason.

---

## 1. Problem

Detection and explanation (the shipped product) answer "is this agent
behaving well, and if not, why." On their own they don't close the loop:
a team that gets a REVIEW with a good root-cause explanation still has to
manually translate that explanation into an edit to the agent's own
instructions, re-run everything, and eyeball whether it actually helped.

Autofix is that closing step, scoped narrowly:

> Given a pattern of inefficiency or failure AgentGuard has detected and
> explained, propose a specific, minimal edit to the agent's own
> instructions (`agent.md` / system prompt / tool descriptions), and prove
> — empirically, via the same evaluation pipeline that found the problem —
> that the edit actually helped before anyone treats it as a fix.

**As of this document's v0.2, the *propose* half is real** — the pattern
detection and the diff-generation step. **The *prove* half is not** —
§5's validation gate is unbuilt, blocked on §4. A proposal today is a
reviewable suggestion, not a demonstrated improvement; every proposal
`autofix show` prints says so explicitly.

## 2. Non-goals

Stated as plainly as PRD §6 states AgentGuard's own non-goals, because
autofix is exactly the kind of feature that scope-creeps into something
dangerous if these aren't fixed in writing first:

- **Autofix never edits application code or tool implementations.** Only
  the agent's own instructions/prompt/tool-description text. A tool that
  is genuinely broken is a bug report, not an autofix target.
- **Autofix never edits AgentGuard itself** — not an assertion definition,
  not a fixture, not a policy threshold. The grader is not something the
  thing being graded gets to negotiate with. (This is the same principle
  as §32's "no `agentguard_pass` tool," generalized: nothing under
  evaluation gets to unilaterally declare itself passing.)
- **Autofix never auto-applies a change without a validation gate that
  used a live re-evaluation**, not the fix-proposer's own opinion that its
  change is good. See §5.
- **Autofix is not a code-generation feature.** It produces a text diff to
  an instructions file, reviewed like any other diff, not a PR that merges
  itself.
- **Autofix does not replace calibration.** A proposed fix's "it helped"
  signal is itself a Jev-basis measurement and inherits every caveat §6.9
  already states about calibration not yet being validated.

## 3. The loop

```
   Baseline runs (N ≥ 2, same agent.md, same task set)
                    │
                    ▼
        Evidence + verdicts + escalated
        explanations (existing pipeline)
                    │
                    ▼
   Pattern detection: does a failure/inefficiency
   recur across baseline runs, or was it one sample?
                    │  (recurs)
                    ▼
              Fix-Proposer
   (sees: task, current agent.md text, the recurring
    evidence + explanation. NEVER sees: the assertion's
    Noul/Score/Choice instruction text or any internal
    grading detail — see §6, anti-Goodhart)
                    │
                    ▼
          Proposed diff to agent.md
                    │
                    ▼
   Validation: run the SAME task set + the assertion's
   held-out fixtures (§4.2) with the proposed agent.md,
   live. Baseline variance (§4.3) already measured.
                    │
                    ▼
          agentguard compare(baseline, proposed)
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
   improved,    no better    any regression
   no regression than noise  anywhere else
        │           │           │
        ▼           ▼           ▼
   present for   REJECT      REJECT
   human review  (say why)   (say why)
        │
        ▼
   Human applies (or doesn't).
   Never auto-merged.
```

## 4. Prerequisites — blocking, not parallel work

Autofix cannot be built correctly on top of the current fixture suite.
Two gaps make its own validation gate meaningless if skipped:

### 4.1 The discriminating-evidence audit

A fixture whose `run.json` cannot actually distinguish its expected
verdict from the opposite (the `06-wrong-tool-arguments` finding from the
first live Jev run against the new assertions — the run never contains
evidence for which todo id is "Pay electricity," so a real model has no
basis to call the target wrong) will accept *any* proposed fix as an
improvement, or reject *every* fix as a regression, depending on which way
the model's uncertainty happens to break. Noise dressed as signal either
way. **Autofix must refuse to validate against a fixture that hasn't
passed this audit.** The audit itself: for every fixture's every expected
assertion, is there evidence in `run.json` that would change if the
opposite verdict were true? If not, the fixture measures nothing for that
assertion and must be excluded from autofix's validation set (it can
still be a normal golden-suite regression fixture — that's a different
use, with a different tolerance for weak discrimination).

### 4.2 Per-assertion held-out fixture sets

Validating a fix against the exact fixtures the fix-proposer saw
overfits by construction — the proposer can special-case the wording of
those exact scenarios rather than genuinely fixing the underlying
behavior. The design therefore requires a held-out set *per assertion*:
some fixtures exercising `toolWasAppropriate` visible to the
fix-proposer, others withheld and used only for validation.

**This does not exist today and is not a small gap.** Two fixtures
sharing an assertion id today is the exception (`toolWasAppropriate`
appears in `05`, `06`, `16`; most other assertions appear in exactly one
fixture — confirmed directly by the `compare` smoke test in this same
session: `run-01-happy-path` vs. `run-02-false-completion` shared zero
assertion ids). Building autofix without first building this out is
building a validation gate that always reports "no held-out evidence,"
which is worse than no gate — it looks like rigor and isn't.

### 4.3 Baseline variance floor

Jev returns probabilities, not labels. An assertion sitting near a
band edge — this session's own live run had `prematureCompletion` at
0.45 and `noPolicyViolation` at 0.56, both inside or near the default
`[0.35, 0.75]` uncertainty band — can flip pass/review/fail between two
runs of the *identical, unchanged* agent, purely from resampling.
`agentguard compare` cannot tell a real improvement from this noise
unless the loop first measures how much an unchanged agent moves on its
own. **Before proposing any fix, run the unchanged baseline at least
twice** and record the resulting spread per assertion. A proposed fix's
compare result only counts as a real signal if it moves further than the
baseline's own observed variance. This is the cheapest item in this whole
design and the one most likely to get skipped under schedule pressure —
named explicitly so it doesn't.

## 5. Validation gate (detail)

The gate that decides whether a proposed fix is presented to a human:

1. Re-run the full task/fixture set the loop is scoped to (baseline
   fixtures + per-assertion held-out fixtures, §4.2) with the proposed
   `agent.md`, live.
2. `agentguard compare(baseline-run-ids, proposed-run-ids)`.
3. **Reject** if any assertion regresses beyond the §4.3 baseline-variance
   floor, anywhere in the set — not just on the targeted assertion. A fix
   that improves the targeted behavior while quietly breaking another
   assertion is a regression, full stop; this is the same principle
   `compare`'s exit-code-1-on-any-regression already encodes.
4. **Reject** if the targeted assertion's improvement does not exceed the
   variance floor (§4.3) — indistinguishable from noise.
5. Otherwise, **present** the diff, the before/after `compare` output, and
   the cost (§7) to a human. The loop's own output is a recommendation,
   never an applied change — matching PRD §6's "AgentGuard... does not
   make autonomous production changes" as it already applies to the
   product's own decisions.

## 6. Anti-Goodhart: what the fix-proposer is never shown

The single highest-risk failure mode of a system that both grades a thing
and proposes changes to it is the proposer learning to satisfy the
grader's wording rather than fixing the underlying behavior — classic
Goodhart. The mitigation is structural, not a prompt instruction to
"please don't cheat":

- The fix-proposer's input is the **observed evidence** (real tool calls,
  results, the agent's own claims) and the **escalated root-cause
  explanation** (§10.2's frontier-LLM output, itself phrased in terms of
  the task, not the grader) — never the assertion's own Noul/Score/Choice
  `instructions` text, never the uncertainty band, never any policy
  threshold.
- The fix-proposer never sees which specific fixture(s) will be used to
  validate its own proposal (the held-out half of §4.2 is invisible to it
  by construction, not by discipline).
- The validation gate (§5) is a full pipeline re-run against real
  evidence, not a re-ask of the same question to the same or a related
  model. A fix that only makes the *judge* more likely to say pass,
  without the recorded tool calls/results actually changing, produces no
  new evidence and should not move the compare result — this is worth a
  dedicated adversarial fixture once this is built (an agent.md edit that
  changes only rhetoric, not behavior).

## 7. The fix report — what a human actually looks at

§5's validation gate produces a `FixProposal` (§9's data model); a human
does not read JSON. The gate's output must render as one page answering,
in order, the four questions a reviewer actually has: **what's wrong, how
bad is it, what's the proposed change, and did it demonstrably help.**
This is the artifact `agentguard autofix show <fix-id>` (§10) renders.

**Fixed sections, top to bottom — never reordered, because the reading
order *is* the argument for or against applying the fix:**

1. **Verdict banner.** One line, unambiguous, colored by the same
   good/warning/critical status semantics as every other AgentGuard
   report: `accepted-for-review` / `rejected-regression` /
   `rejected-no-improvement`, plus the target file and the assertion(s)
   this proposal targets. Never a bare score — the verdict is a label a
   human can act on without reading further, exactly like `compare`'s own
   exit code.
2. **Problem.** The recurring finding in plain language (not the
   assertion's internal Noul/Score/Choice wording — see §6's anti-Goodhart
   boundary, which extends to the report: a reviewer reads the same
   evidence-grounded description the fix-proposer was given, not grader
   internals), the number of baseline runs it recurred across, and the
   actual evidence excerpt (verbatim tool calls/results/claims) that
   grounds it. No paraphrase of evidence — same discipline as the
   evidence graph itself (TRD §5.1: extractors quote, never summarize).
3. **Impact — before → after, per assertion, not just the targeted one.**
   A table, one row per assertion in the validation set, each showing:
   status before, status after, the `compare` verdict
   (improved/regressed/unchanged/changed), and the confidence value on
   each side. Every row is visible, not just the targeted assertion's —
   §5 rejects on *any* regression, so the report must let a human see
   that for themselves rather than trust the banner. Status renders as the
   same pill token everywhere else in AgentGuard (§6.2.1's pass/review/fail,
   plus not_applicable/error), never a bare percentage — a percentage
   alone re-introduces exactly the "was 0.56 good or bad" ambiguity
   `noulVerdict` exists to resolve.
4. **Solution.** The proposed diff against the target file, rendered as
   an actual diff (additions/removals distinguishable at a glance, not a
   wall of the full file), plus the fix-proposer's own one-paragraph
   rationale — labeled as the proposer's claim, not a verified fact; §6
   already forbids trusting it without §5's re-evaluation.
5. **Cost and confidence caveats, always visible, never collapsed behind
   a "details" toggle.** The §4.3 baseline-variance floor for every
   assertion in the table (so a reviewer can see whether an "improvement"
   exceeds it), the §7-cost-model call count this validation actually
   spent, and calibration's own standing disclaimer (§6.9: confidence
   values are advisory until validated) — the same line every other
   AgentGuard report already carries, unchanged here.

**What the report never does:** an aggregate "health score" across
assertions (PRD §14's own stated principle — "I would deliberately not
reduce this to a single quality score" — applies to a fix report exactly
as it applies to the adversarial-testing report it was written for), an
"Apply" button (§10 — no CLI subcommand applies a fix automatically, and
the report is not a smaller trust boundary than the CLI), or any element
whose content the fix-proposer itself authored *without* being labeled as
the proposer's own claim (the rationale in item 4 is the only proposer-
authored text on the page, and it is the only thing on the page marked
as opinion rather than measurement).

A working mockup of this layout exists as a design reference (linked from
project memory, not checked into this repo). It is built around a real
recurring finding this project's own live-agent run actually produced —
the TodoMVC run's `toolWasAppropriate` REVIEW on exploratory
`snapshot`/`hover` calls — but the "after" numbers in it are illustrative
and clearly marked as such: no validation run has actually happened yet.
Building the mockup surfaced one addition worth recording here: the
before/after table needs a visible **baseline variance band** drawn per
row (§4.3), not just a number in a caveat line — without it, a row that
moved less than the band still *looks* like an improvement at a glance,
which is the exact misreading §4.3 exists to prevent.

**What `agentguard autofix show` actually prints today (§9/§10) is items
1, 2 and 4 of this section only** — verdict-equivalent header, problem
(evidence + explanation), and the diff + rationale. Items 3 (the
before/after impact table) and 5 (cost/variance caveats beyond the
blanket "NOT VALIDATED" label) don't exist yet, because they describe the
*validation* gate's output, and §5 isn't built. Don't read the current
CLI output as this section's full spec delivered — it's the proposal
half only.

## 8. Cost model

Every iteration of this loop is a **live Jev spend across the full
validation set**, not a mock-engine dry run. `--dry-run` against
`MockDecisionEngine` can validate the loop's own mechanics (does it call
the right things in the right order) but **can never validate a
proposed fix** — there is no scripted answer that means anything for a
change that didn't exist when the mock was scripted. The design must
therefore state, and any implementation must enforce:

- A declared **per-iteration cost estimate** (number of live `decide()`
  calls × the fixture set size), shown before running.
- An explicit **iteration cap expressed in API calls**, not "rounds" —
  a round that fans out validation across 15 held-out fixtures costs
  15x a round that validates against one.
- Every live loop run requires the same standing authorization discipline
  the rest of this project already follows for `TYPESAFE_API_KEY` and
  `ANTHROPIC_API_KEY` spend: asked for explicitly, every time, never
  assumed from a prior grant.

## 9. Data model — **implemented** (propose/show only)

```typescript
interface FixProposal {
  id: string;
  targetPath: string;              // e.g. "agent.md"
  targetAssertionIds: AssertionId[];
  baselineRunIds: string[];        // ≥2, for the §4.3 variance floor
  diff: string;                    // unified diff against targetPath
  rationale: string;               // fix-proposer's own explanation, for the human
  proposedAt: string;
  validation?: {                   // NOT YET WRITABLE — §5's gate isn't built. Always absent today.
    runIds: string[];
    comparison: RunComparison;     // packages/core/compare.ts, reused as-is
    verdict: "accepted-for-review" | "rejected-regression" | "rejected-no-improvement";
  };
}
```

`packages/decision/src/fixProposer.ts` — `FixProposerEngine` mirrors the
`EscalationEngine` shape exactly as this section originally specified
(single-purpose interface, `MockFixProposerEngine` test double,
`AnthropicFixProposerEngine` as the real implementation — plain `fetch`
against the Messages API, same reasoning as the escalation engine: the
Jev SDK has no free-text/diff capability):

```typescript
interface FixProposerRequest {
  targetPath: string;
  currentText: string;
  recurringEvidence: RecurringFinding[];   // evidence + escalated explanations, never grader internals
}
interface FixProposerResult {
  diff: string;
  rationale: string;
}
interface FixProposerEngine {
  propose(request: FixProposerRequest): Promise<FixProposerResult>;
}
```

`RecurringFinding` requires `occurrences >= 2` by construction
(`packages/cli/src/commands/autofix.ts`'s `detectRecurringFindings`,
scanning `fail`/`review` results across the given stored runs) — a
single-run "finding" is never handed to the proposer, matching PRD §12's
n=1-is-an-anecdote rule. §11's "one proposal per finding, never batched"
rule is also implemented as written: `autofix propose` loops findings and
writes one `FixProposal` file per finding.

## 10. CLI surface — **`propose`/`show` implemented, `validate`/`apply` still not**

```
agentguard autofix propose --agent-md <path> --runs <id1,id2,...> [--store <dir>]
    Detects a recurring pattern (>=2 occurrences) across the given stored
    runs, calls the fix-proposer once per finding, writes each as a
    FixProposal to .agentguard/fixes/<id>.json. Never touches --agent-md.
    Requires ANTHROPIC_API_KEY (degrades with a clear error, never a crash,
    when absent — same convention as escalation/doctor).

agentguard autofix show <fix-id> [--store <dir>]
    Prints the diff, rationale, targeted assertion(s) and baseline runs —
    and unconditionally prints "NOT VALIDATED", since no FixProposal this
    build produces ever carries a `validation` field.
```

**Not built, still blocked on §4:**

```
agentguard autofix validate <fix-id> [--store <dir>]
    Would run the validation gate (§5) live, requiring explicit
    confirmation of the cost estimate (§8) before spending, and would
    populate the FixProposal's `validation` field. Does not exist.
```

No `apply` subcommand exists or is proposed. Applying a diff to
`agent.md` is an ordinary file edit a human makes after reading `autofix
show`'s output — the same trust boundary as reviewing any other diff,
deliberately never automated by this tool.

## 11. Open questions, explicitly deferred

- How is "a pattern, not a sample" defined precisely (§3's pattern
  detection step)? A single-fixture recurrence isn't enough per PRD §12's
  own reasoning about n=1 being an anecdote; a real threshold (across how
  many runs, what fraction) needs its own design pass once §4.1/§4.2 are
  closed and there's enough real fixture volume to reason about it
  concretely rather than guessing a number now.
- Does a rejected fix get retried with the rejection reason fed back to
  the fix-proposer, and if so, what stops an infinite/degenerate loop
  beyond the §8 iteration cap?
- Multi-assertion fixes (one agent.md edit intended to address two
  recurring findings at once) are out of scope for a first version — one
  proposal targets one recurring finding, to keep the compare-based
  attribution ("did *this* edit cause *this* change") unambiguous.
