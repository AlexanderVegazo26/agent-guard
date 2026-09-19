# 02 — false-completion

PRD §2's flagship failure mode and Appendix B row 02 (branch a, `Jev: det.`).
The agent claims "Payment completed successfully." against a recorded
`POST /api/payment → 500` with no later success anywhere in the run.

**Why `basis: "deterministic"` and not `"jev"`:** this is exactly the
mechanically-checkable contradiction TRD §3.3 allows the compiler to link
deterministically — a claimed success against a recorded 5xx, no model
required (PRD §7, "never ask a model what code can prove"). The evidence
compiler builds a `contradicts` link from the claim to the failed request;
the §6.6 deterministic pre-pass finds that link and fails the assertion at
confidence 1.0 without ever calling the decision engine. `mock.json` is
absent from this fixture on purpose — the pending set is empty, so nothing
is ever sent to `MockDecisionEngine`, and if a regression accidentally
routed this assertion to the engine instead, the run would throw ("no
scripted answer") rather than silently pass.

**Why this matters for calibration accounting (TRD §6.9, PRD §12):** this
fixture contributes to the detection criterion but nothing to the
calibration sample — it is one of the two scenarios (`02` and `04`) that
resolve mechanically end to end.
