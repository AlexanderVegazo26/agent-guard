# Changelog

All notable changes to this project are recorded here. This project has not yet made a versioned release (every package is `0.1.0` and `private: true`); until it does, entries are grouped by the cycle/document that drove them rather than by semver tag.

## [Unreleased] — PRD3 Phase A ("Honest record")

Closes the first gate of `docs/PRD3.md`'s roadmap: making the record the codebase already keeps about itself trustworthy, before extending what it observes.

### Fixed

- `computeExitCode` is unchanged (its CI-routing contract was already correct and documented), but `ci.reviewAsFailure` is now actually applied consistently: a new `applyReviewAsFailurePolicy` helper is used by `agentguard test`, `agentguard replay`, and `agentguard watch`, matching the behavior the Playwright fixture already had. Previously only the fixture consulted this config field.
- `AssertionResult.degradation` (declared in the schema, never populated by any code path) is now set on every result that reaches the split-batch or fan-out-cap rungs of the evaluation pipeline's degradation ladder, and on a capacity abstention. Surfaced in the console and HTML reporters; already present in the JSON reporter, which serializes the full result.
- Twelve places where a code comment described a limitation that had since been fixed elsewhere in the codebase, without the comment being updated (`docs/PRD3.md` §3, items D1-D12): stale headers in `assertions/definitions.ts`, `core/graph.ts`, `core/policy.ts`, `observe/proxy.ts`, `observe/index.ts`, `tests/golden.test.ts`, `cli/index.ts`, and the README's package table (`assertions` and `observe` rows).

### Added

- `docs/PRD3.md` — audits the codebase as built against `docs/PRD2.md`'s promises and the original `docs/dirty-requirement.md` vision, and specifies the next feature set (F12-F22).
- `LICENSE` (MIT), this file, and `CONTRIBUTING.md`.
- `.github/workflows/ci.yml` — runs build, lint, and the unit/integration test suite on every push and pull request.
- Degradation-strategy assertions added to `packages/assertions/src/budget.test.ts` covering `split-batch`, `fanout-cap`, and the capacity `review` outcome.

### Changed

- `docs/` is now tracked in git. It had been deliberately untracked (see the commit this reverses); an untracked directory loses history on every edit, which is a worse property for a set of documents meant to be a sequential record.

### Known gaps carried forward (see `docs/PRD3.md` §5 for the full feature set)

`tighten-selection` and `chunk-aggregate`, two of the five degradation-ladder strategies, remain unimplemented — only `split-batch`, `fanout-cap`, and the terminal capacity `review` exist and are now recorded.

## [Unreleased] — PRD3 F12, per-event provenance

The first slice of Phase B ("One path in"): every `AgentEvent` can now carry a `provenance` (`wire` / `harness` / `self-reported` / `imported`), recording *how AgentGuard learned about it*, independent of what it says happened.

### Added

- `EventProvenance` in `@agent-guard/core`'s schema, on `BaseEvent` and copied onto `Evidence` by the compiler (`graph.ts`).
- Every existing capture path now tags its own events: `HttpFaultProxy`/`ObservingTransport`-derived events via the Playwright fixture → `wire`; an injected fault → `harness`; `TranscriptAdapter` (and therefore `agentguard watch`) → `self-reported`; an `agentguard_start_run` caller-supplied event with no provenance of its own → defaulted to `self-reported`; an `agentguard_mutate`-injected fault → `harness`.
- `EvidenceRequirement.minProvenance` in `@agent-guard/assertions`: a sufficiency requirement can now demand evidence of at least a given provenance, ranked `self-reported < imported < harness < wire`; an item with no provenance at all never satisfies a stated minimum.
- Tests: `packages/core/src/graph.test.ts` (provenance propagation, including the task/final-claim harness-vs-self-reported distinction and sub-agent claims), `packages/assertions/src/requirements.test.ts` (new file — `minProvenance` and the review-wins-over-not_applicable rule), plus one test each in `transcriptAdapter.test.ts`, `fixture.test.ts`, and `mcp/server.test.ts`.

### Deliberately not done

- `AgentRun.source` is unchanged — still explicitly set by the run's producer, not derived from its events' provenance. Deriving it was part of PRD3's original A1 proposal; kept independent here to avoid changing behavior every existing caller of `source` already depends on.
- No shipped assertion's `REQUIREMENTS` entry uses `minProvenance` yet. Every fixture in `fixtures/golden`/`fixtures/correct` predates this field, so retrofitting a minimum onto a shipped requirement would turn real passes into REVIEWs purely because old fixtures carry no provenance — not because the evidence actually got weaker. The mechanism is built and tested; adopting it on a specific assertion is a separate, fixture-updating change.
- No schema-version bump. The field is optional and additive; every run persisted before it existed still loads unchanged.
