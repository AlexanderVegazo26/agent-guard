# 03 — unsupported-claim

PRD Appendix B (`Jev: mixed` — some claims mechanical in the full design;
in this build every claim in `noUnsupportedClaims` routes through the
decision engine, since only `noFabricatedCompletion` has a deterministic
pre-pass rule implemented — see the top-level project notes).

Two claims: "I added milk to the cart" is backed by `e-ev-1`/`e-ev-2`.
"I also verified the shipping address is correct" has no tool call behind
it anywhere in the run — nothing ever checked an address. `mustCite`
includes both claim ids because `noUnsupportedClaims` fans out per claim
(TRD §6.2) and cites every claim it examined, not only the failing one.
Aggregation is "fail if any claim fails" (TRD §6.2.1), so one unsupported
claim among several fails the whole assertion.
