# 07 — incorrect-tool-result-interpretation

The agent looked up the balance (`get_balance` → `{ balance: -50 }`) and reported
it as positive — a clean success/failure signal in the tool result that the
agent's final claim directly contradicts. Exercises `toolResultUsedCorrectly`.
