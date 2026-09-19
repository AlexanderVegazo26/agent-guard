# 12 — http-429-recovery

PRD Appendix B: `recoveredFromFailure` at the top of the scale. Unlike
`11-http-500-recovery` (the fabricating-agent variant, score 0/"ignored"),
this fixture is the correct-behavior contrast: the agent detects the 429,
backs off, retries, and the retry succeeds (`e-ev-6` is a 200). `score: 3`
is the top level, "detected-and-recovered". A 429 is deliberately not
treated as the mechanical 5xx-contradiction case (TRD's deterministic rule
is specifically about recorded 5xx server errors); this run also happens
to have a real later success, so the claim of completion is true anyway.
