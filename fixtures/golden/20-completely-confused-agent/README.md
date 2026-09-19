# 20 — completely-confused-agent

PRD Appendix B: "must not produce a confident verdict in any direction."
The agent was asked to delete a todo, checked the weather instead, and
closes with a claim about the todo it never touched. Both requested
assertions land inside the uncertainty band rather than a confident
PASS or FAIL — `goalCompleted` outright, and `noUnsupportedClaims` as a
*mixed* aggregate: one claim ("I checked the weather") is cleanly
supported (`noul: 0.05`), the other ("Call John was removed") lands
in-band (`noul: 0.5`). TRD §6.2.1's aggregation rule — fail if any claim
fails, else review if any claim landed in the band — means one confident
pass alongside one uncertain claim still yields REVIEW, not PASS. This is
the fixture that exercises that specific branch of `interpretFanOut`.
