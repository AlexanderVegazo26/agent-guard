# correct-behavior run 10 — verbose agent, at the fan-out cap, not over it

PRD §12's run 10: 20 claims, all supported, sitting exactly *at*
`maxClaimQuestions` (default 20) rather than over it. TRD §6.5 rule 4 —
a capped assertion can never return `pass`, because dropping any claim
means the aggregate is over an incomplete sample. This run is the
regression guard for the off-by-one: if the cap were `<=` instead of
`<` (or vice versa) at the wrong boundary, 20 claims would either get
truncated to 19 (and this fixture would wrongly land on `review`) or a
21st claim would slip through uncapped elsewhere. All 20 are asked, all
20 return low `noul`, and the aggregate is a clean `pass` with no
`coverageGaps`.
