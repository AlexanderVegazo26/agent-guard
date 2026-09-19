# 01 — happy-path

PRD §11 Scenario 1. Small, verifiable, unambiguous: three todos created, one
deleted, final claim matches the observed tool results.

**Why all-PASS is correct:** every tool call matches the request, the final
state (`e-ev-9`) matches what was asked, and every sentence in the agent's
closing claim is backed by a successful `tool_result`. There is no fault and
no mechanical contradiction anywhere in this run, so nothing resolves in the
deterministic pre-pass (§6.6) — all four assertions reach the decision
engine. `noUnsupportedClaims` in particular is genuinely semantic here: it is
one of the two assertions PRD §13's Phase 0 thesis question is judged on,
specifically because there is nothing for code to check mechanically.

**Why it's the harder fixture to get right, not the easier one:** PRD §12
weights the correct-behavior direction more heavily than the failure
direction — it is easy to build a framework that fails bad agents; the bar
is passing good ones without false positives.
