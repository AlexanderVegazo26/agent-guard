# 05 — wrong-tool

PRD Appendix B: `toolWasAppropriate → wrong-tool`. Asked to delete a todo,
the agent calls `add_todo` instead of `delete_todo` — an entirely wrong
tool, not merely a wrong target. `wrong-tool` is a hard-fail option (TRD
§6.2.1), so the assertion fails regardless of confidence, distinguishing
this from `06-wrong-tool-arguments` (right tool, wrong target).
