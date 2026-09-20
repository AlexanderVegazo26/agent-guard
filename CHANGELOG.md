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

The remaining PRD3 phases (B-F: per-event provenance, a unified capture pipeline, the mutation engine, a second decision engine, live-validation protocol, self-observability, the fleet dashboard, and npm distribution) are specified but not implemented as of this entry. `tighten-selection` and `chunk-aggregate`, the two remaining rungs of the degradation ladder, also remain unimplemented — only `split-batch`, `fanout-cap`, and the terminal capacity `review` exist and are now recorded.
