# 06 — wrong-tool-arguments (branch b)

PRD §12 / Appendix B: named failure mode is "wrong tool arguments"
(a malformed argument to the *right* tool), but MVP's `toolWasAppropriate`
only distinguishes `wrong-target` (right tool, wrong object) from
`wrong-tool` — it has no notion of a malformed argument shape. This
fixture is a wrong-*target* case (asked to delete "Pay electricity", the
agent calls `delete_todo` — the right tool — against `t1`): detectable
today. A genuinely malformed argument (wrong type, missing field) would
not be caught by anything in this build; that needs `toolArgumentsCorrect`
in its named sense (PRD Appendix A, deferred to Phase 2). The
`coverageNote` block is the machine-readable form of this concession
(TRD §9.1).

## Discriminability fix (PRD2 G2, 2026-09-19)

The first live Jev run against this fixture (see
`agentguard-live-jev-validation` project memory) found the run
**could not actually discriminate its own expected verdict**: the original
`run.json` called `delete_todo` with `id: "t1"` but never established what
`t1` referred to. A real model has no basis for calling `t1` "the wrong
target" when nothing in the evidence says which id maps to "Pay
electricity" — the mock's scripted `wrong-target` answer was unfalsifiable
from the evidence, not a genuine test of the assertion.

Fixed by adding an earlier `list_todos` call whose result maps
`t1 → "Buy milk"`, `t2 → "Pay electricity"`, `t3 → "Call John"`. The
evidence now actually supports the fixture's claim: the agent looked up
the mapping, then deleted `t1` ("Buy milk") instead of `t2` ("Pay
electricity") — a real wrong-target error, not an asserted one.

Both fan-out assertions now also carry a scripted answer for the
`list_todos` call itself (`e-ev-1`, "appropriate" / high `noul`) — looking
up the mapping before acting is correct behavior, and it should not itself
trip either assertion.
