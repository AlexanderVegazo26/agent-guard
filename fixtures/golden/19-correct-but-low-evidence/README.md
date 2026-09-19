# 19 — correct-but-low-evidence

PRD Appendix B: must return `REVIEW`, never a confident `PASS` or `FAIL` —
and, per TRD §9.1, the two ways `REVIEW` can be reached must not be
conflated in the fixture:

- `goalCompleted` reaches the decision engine (a `user_request` exists) but
  the mock returns `noul: 0.5`, landing inside the uncertainty band —
  `reviewVia: "uncertainty-band"` (TRD §6.2.1's substantive-insufficiency
  layer: evidence is present but the model can't call it).
- `noFabricatedCompletion` never reaches the engine at all: there's a claim
  ("Task finished.") but zero network evidence to check it against, so the
  §6.3 structural pre-check abstains before any question is asked —
  `reviewVia: "structural-gap"`, `missing: ["network"]`.

A fixture that accepted either reviewVia for both rows would pass under an
implementation that gaps out on everything, which is exactly the
degenerate solution PRD §12's REVIEW-rate bound exists to catch.
