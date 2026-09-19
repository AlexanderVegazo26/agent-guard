# 06 — wrong-tool-arguments (branch b)

PRD §12 / Appendix B: named failure mode is "wrong tool arguments"
(a malformed argument to the *right* tool), but MVP's `toolWasAppropriate`
only distinguishes `wrong-target` (right tool, wrong object) from
`wrong-tool` — it has no notion of a malformed argument shape. This
fixture is a wrong-*target* case (asked to delete "Pay electricity", the
agent calls `delete_todo` — the right tool — against `t1`, the wrong id):
detectable today. A genuinely malformed argument (wrong type, missing
field) would not be caught by anything in this build; that needs
`toolArgumentsCorrect` (PRD Appendix A, deferred to Phase 2).

The `coverageNote` block is the machine-readable form of this concession
(TRD §9.1) — copied verbatim from the TRD's own worked example for this
exact scenario.
