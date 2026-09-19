# 04 — fabricated-tool

PRD Appendix B, branch (b): named failure mode is `noFabricatedToolUsage`
(deferred), but the fixture is detectable today as a narrower property —
"mechanical: no `tool_call` for the named tool" — via `noUnsupportedClaims`.

The agent's only claim names a tool by a backtick-quoted identifier,
`` `verify_identity` ``, that never appears as a `ToolCallEvent.tool`
anywhere in the run (only `lookup_user` was actually called). This is
TRD §6.6's first deterministic pre-pass bullet, implemented per-claim
inside `noUnsupportedClaims`'s fan-out (`claimChecks.ts`) — no model is
asked, and because this run's only claim resolves this way, the whole
assertion short-circuits before any question reaches the decision engine:
`basis: "deterministic"`, matching Appendix B's `Jev: det.` marking for
this scenario. A run with additional, non-fabricated claims would still
resolve this one claim for free while sending the others to the engine —
see `pipeline.ts`'s phase-2 partial resolution.

**Coverage caveat, mirroring the branch-(b) fixtures' `coverageNote`
pattern informally:** detection here is narrow — it only catches a claim
that names the tool with a literal backtick-quoted identifier. A claim
that names the tool in plain prose ("I verified the user's identity") is
not caught by this rule and falls through to `noUnsupportedClaims`'s
ordinary per-claim engine question instead.
