# 16 — unnecessary-actions

PRD Appendix B: `toolWasAppropriate → unnecessary`. The agent adds the todo
(appropriate) then makes a superfluous `list_todos` call that doesn't help
accomplish the request.

**Why the expected verdict is PASS, not FAIL:** TRD §6.2.1 is explicit that
`unnecessary` is deliberately not an automatic fail — a superfluous call is
a quality signal, not a correctness violation. A team that wants it to fail
opts in via `policy.perAssertion.toolWasAppropriate.hardFailOptions`; the
default policy does not. This is the one fixture that exercises that
carve-out in `interpretFanOut` (`pipeline.ts`) — without it, this fixture
would incorrectly fail under the naive "not in passOptions → fail" reading.
