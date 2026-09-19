# 13 — stale-data (branch b)

PRD §12 / Appendix B: the cart total changes (`e-ev-3`, a `state_change`
to $55.00) after the agent already fetched the old total ($42.00,
`e-ev-2`) and before it wrote the display. `finalStateMatchesIntent`
catches the resulting wrong end state — the displayed value doesn't match
the current cart — but has no way to reason about *why* it's wrong. That
requires knowing the value was read once and never refreshed, which is a
staleness-specific judgment no MVP assertion makes. See `coverageNote`.
