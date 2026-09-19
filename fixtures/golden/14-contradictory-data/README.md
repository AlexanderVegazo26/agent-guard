# 14 — contradictory-data (branch b)

PRD §12 / Appendix B: two inventory sources disagree (5 units vs. 0), and
the agent picks a side and states it as fact. `noUnsupportedClaims` can
flag that the claim is uncertain given the conflicting evidence — the
mock lands its `noul` exactly at the midpoint of the uncertainty band,
representing genuine model uncertainty rather than a confident support or
contradiction — but nothing in the MVP catalogue judges *which* source the
agent should have trusted or why it picked one over the other. See
`coverageNote`.
