# todomvc-happy-path

Scaffolded by `agentguard init` (PRD3 F22) so a brand-new project has a
runnable fixture before anyone writes their own. It is the same
`run.json` / `expected.json` / `mock.json` triple as
`fixtures/golden/01-happy-path` in the AgentGuard repo itself: three
todos created, one deleted, and a closing claim that matches the observed
tool results — every assertion resolves to `pass` against the mock
decision engine, so it runs with no API key and no network access.

Run it with:

```
agentguard test --fixtures agentguard/examples
```

Once you have real transcripts, add your own fixtures under
`fixtures/golden/` (created by `init` alongside this file) and drop this
example, or keep it around as a smoke test that the toolchain itself is
wired up correctly.
