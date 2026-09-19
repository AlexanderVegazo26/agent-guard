# Playwright Capability Reference for Coding Agents

**Target version: Playwright 1.63 (latest).** Every item below is current API as of 1.63.
Deprecated and removed API is quarantined in the last section — never emit it.

Each capability is tagged with `[≥1.xx]` = the minimum Playwright version that supports it.
Untagged items are long-stable core API. Before using a `[≥1.5x]` or `[≥1.6x]` feature, check
the installed version (`npx playwright --version`) and fall back if the project pins older.

---

## 0. Ground rules for generated code

1. **Package**: import everything from `@playwright/test` — test API *and* browser automation
   (`chromium`, `firefox`, `webkit`, `devices`, `expect`, `defineConfig`). Do not install both
   `playwright` and `@playwright/test` in the same project.
2. **Browsers are never auto-downloaded.** CI must run `npx playwright install --with-deps`.
3. **Node.js**: 16 is unsupported, 18 is deprecated. Target Node 20+ (Docker images ship Node 24 LTS `[≥1.57]`).
4. **Locators over selectors.** Prefer role/label/test-id locators. Never generate `page.$`,
   `page.$$`, `waitForSelector`, or `ElementHandle` unless there is no alternative.
5. **Web-first assertions over manual waits.** `await expect(locator).toBeVisible()` — never
   `waitForTimeout`, never `expect(await locator.isVisible()).toBe(true)`.
6. **Config**: always `export default defineConfig({...})`.

---

## 1. Locating elements

### Primary locators (available on `Page`, `Frame`, `Locator`, `FrameLocator`)
| API | Use for |
|---|---|
| `getByRole(role, { name, exact, checked, disabled, expanded, level, pressed, selected, description })` | First choice. `description` matches the accessible description `[≥1.60]` |
| `getByText(text, { exact })` | Non-interactive text content |
| `getByLabel(text)` | Form controls via their label |
| `getByPlaceholder(text)` | Inputs by placeholder |
| `getByTestId(id)` | Stable hooks; attribute configurable via `testIdAttribute` in config |
| `getByAltText(text)` | Images |
| `getByTitle(text)` | `title` attribute |
| `locator(css \| xpath)` | Escape hatch only |

### Composition & refinement
- `locator.visible()` — new locator matching only visible elements; recommended replacement for the
  `:visible` CSS pseudo-class `[≥1.63]`
- `locator.filter({ hasText, hasNotText, has, hasNot, visible })` — `visible: true` keeps only visible matches `[≥1.51]`
- `locator.or(other)` — matches either `[≥1.33]`
- `locator.and(other)` — matches both `[≥1.34]`
- Chain locators to scope: `page.getByRole('row').getByRole('button')`
- `locator.first()` / `.last()` / `.nth(i)` / `.all()` (array of locators for iteration)
- `locator.contentFrame()` → `FrameLocator`; `frameLocator.owner()` → `Locator` `[≥1.43]`
- `page.frameLocator(selector)` for iframes
- `page.frameLocator()` / `frame.frameLocator()` called with **no selector** searches every frame
  in the subtree — no need to locate the iframe first. Throws if the rest of the locator matches
  elements in more than one frame `[≥1.63]`

### Locator metadata & authoring aids
- `locator.describe('Subscribe button')` sets a human label used in traces/reports `[≥1.53]`;
  read it back with `locator.description()` and `locator.toString()` `[≥1.57]`
- `locator.normalize()` — rewrites a locator toward best practice (test ids, aria roles) `[≥1.59]`
- `page.pickLocator()` — interactive element picking that returns a `Locator`; cancel with
  `page.cancelPickLocator()` `[≥1.59]`
- `locator.highlight({ style })` and `page.hideHighlight()` `[≥1.60]`
- `locator.waitForFunction(fn)` — waits until `fn(element)` is truthy `[≥1.62]`
- `locator.ariaSnapshotJSON({ mode, depth, boxes })` / `page.ariaSnapshotJSON(...)` — aria snapshot
  as a JSON value instead of YAML markup `[≥1.63]`

---

## 2. Actions

`click`, `dblclick`, `fill`, `press`, `pressSequentially`, `check`, `uncheck`, `setChecked`,
`selectOption` (matches by value **or** label), `hover`, `focus`, `blur`, `clear`, `tap`,
`dragTo`, `setInputFiles`, `scrollIntoViewIfNeeded`, `selectText`, `dispatchEvent`.

Notable options and additions:
- `signal: AbortSignal` on most actions, navigations, waits, and assertions — cancel long-running
  operations. Does **not** replace the timeout; pass `timeout: 0` to disable that separately `[≥1.62]`
- `scroll: 'auto' | 'none'` — opt out of automatic scroll-into-view `[≥1.62]`
- `steps: n` on `click` / `dragTo` — number of intermediate `mousemove` events `[≥1.57]`
- `locator.drop({ files, data })` — simulates an *external* drag-and-drop with a synthetic
  `DataTransfer` (`dragenter`/`dragover`/`drop`). Cross-browser; the correct tool for upload
  dropzones `[≥1.60]`
- `setInputFiles` supports directory upload for `<input type=file webkitdirectory>` `[≥1.45]`
- `ControlOrMeta` modifier key maps to Meta on macOS / Control elsewhere `[≥1.45]`
- `page.addLocatorHandler(locator, handler, { times, noWaitAfter })` — auto-dismiss interstitials
  (cookie banners, overlays); `page.removeLocatorHandler(locator)` to remove `[≥1.44]`
- `page.requestGC()` — force garbage collection, useful for leak detection `[≥1.48]`

---

## 3. Assertions (`expect`)

### Locator assertions (auto-retrying — always `await`)
`toBeVisible`, `toBeHidden`, `toBeAttached`, `toBeEnabled`, `toBeDisabled`, `toBeEditable`,
`toBeChecked`, `toBeEmpty`, `toBeFocused`, `toBeInViewport({ ratio })`, `toHaveText`,
`toContainText`, `toHaveValue`, `toHaveValues`, `toHaveAttribute`, `toHaveClass`,
`toContainClass` `[≥1.52]`, `toHaveCSS(name, value, { pseudo: 'before' | 'after' })` `[≥1.60]`,
`toHaveId`, `toHaveCount`, `toHaveJSProperty`, `toHaveRole` `[≥1.44]`,
`toHaveAccessibleName` `[≥1.44]`, `toHaveAccessibleDescription` `[≥1.44]`,
`toHaveAccessibleErrorMessage` `[≥1.50]`, `toHaveScreenshot`, `toMatchAriaSnapshot`.

### Page assertions
`toHaveTitle`, `toHaveURL` (accepts a **predicate** `[≥1.51]` and `ignoreCase` `[≥1.44]`),
`toHaveScreenshot`, `toMatchAriaSnapshot` (works on `Page` directly, equivalent to `body` `[≥1.60]`).

### API response assertions
`await expect(apiResponse).toBeOK()`

### expect utilities
- `expect.soft(...)` — accumulate failures without aborting; `expect.soft.poll(...)` `[≥1.61]`
- `expect.poll(fn).toBe(...)` — retry a non-Playwright value
- `expect(async () => { ... }).toPass({ timeout, intervals })` — retry a whole block;
  configurable globally via `expect.toPass` in config `[≥1.44]`
- `expect.configure({ timeout, soft })` — pre-configured expect instance `[≥1.34]`
- `expect.extend({...})` for custom matchers (`this.timeout` respects config) `[≥1.45]`;
  `mergeExpects(...)` to combine matcher sets `[≥1.39]`

---

## 4. Aria snapshots (accessibility-tree testing)

The preferred structural assertion for agent workflows — cheaper and more stable than pixels.

- `await expect(locator).toMatchAriaSnapshot(yaml)` — inline YAML expectation `[≥1.49]`
- `await expect(page).toMatchAriaSnapshot(...)` `[≥1.60]`
- Store snapshots in external YAML files instead of inline `[≥1.50]`
- Snapshot properties: `/children: equal` for strict matching, `/url` for links `[≥1.52]`;
  `input` `placeholder` is rendered and compared `[≥1.56]`
- Capture: `locator.ariaSnapshot({ depth, mode, boxes })` `[≥1.59]`, `page.ariaSnapshot()` `[≥1.59]`.
  `boxes: true` appends `[box=x,y,width,height]` per element — designed for AI consumption `[≥1.60]`
- Regenerate with `--update-snapshots`; Codegen has an aria-snapshot picker

---

## 5. Network

### Routing / mocking
- `page.route(url, handler)` / `context.route(...)`; handler gets a `Route`
- `route.fulfill({ status, body, json, path, headers })`, `route.continue({ url, method, postData, headers })`,
  `route.fallback()`, `route.abort()`, `route.fetch({ timeout, maxRedirects })`
- `page.unroute(url)` and `page.unrouteAll({ behavior })` / `context.unrouteAll(...)` `[≥1.41]`
- **Glob patterns no longer support `?` and `[]`** — use RegExp for anything non-trivial `[≥1.52]`
- **`route.continue()` cannot override the `Cookie` header** — use `context.addCookies()` `[≥1.52]`
- Service Worker requests are reported and routable through the `BrowserContext` (Chromium only);
  disable with `PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK` `[≥1.57]`

### WebSockets
- `page.routeWebSocket(url, ws => ...)` / `context.routeWebSocket(...)` — intercept, mock, modify `[≥1.48]`
- `ws.onMessage(cb)`, `ws.send(data)`; `webSocketRoute.protocols()` returns requested subprotocols `[≥1.60]`
- WebSocket traffic is captured in HAR and traces `[≥1.61]`

### HAR
- Record via `recordHar` context option, or as a first-class tracing API:
  `context.tracing.startHar(path, { content, mode, urlFilter })` / `stopHar()`; returns a
  disposable usable with `await using` `[≥1.60]`
- Replay with `page.routeFromHAR(har, { update, updateMode, updateContent, notFound })`

### API testing (`APIRequestContext`)
- `request` fixture, `page.request`, `context.request`, or `apiRequest.newContext({...})`
- `get/post/put/patch/delete/head/fetch` with `params` (object, string, or `URLSearchParams` `[≥1.47]`),
  `data`, `form`/`multipart` (accepts `FormData` `[≥1.44]`), `headers`, `maxRedirects` `[≥1.52]`,
  `failOnStatusCode` `[≥1.51]`, `maxRetries` (retries on `ECONNRESET`) `[≥1.46]`,
  `httpCredentials.send` `[≥1.45]`
- `apiResponse.timing()` `[≥1.62]`, `.securityDetails()` and `.serverAddr()` `[≥1.61]`
- `request.dispose({ reason })` `[≥1.45]`
- Request methods accept a type argument to type the JSON response:
  `const response = await request.get<User>('/api/users/42'); const user = await response.json();`
  — `user` is typed as `User` `[≥1.63]`

### Request/response introspection
- `page.requests({ filter })` — recent network requests, no event wiring needed `[≥1.56]`
- `request.existingResponse()` — response without waiting `[≥1.59]`
- `response.httpVersion()` `[≥1.59]`, `response.securityDetails()`, `response.serverAddr()`
- TLS client certificates via `clientCertificates` on config `use`, `browser.newContext()`, or
  `apiRequest.newContext()` `[≥1.46]`; `cert`/`key` may be in-memory buffers `[≥1.47]`

---

## 6. State, storage, and authentication

- `context.storageState({ path, indexedDB: true `[≥1.51]`, credentials: true `[≥1.62]`, opfs: true `[≥1.63]` })` —
  persist cookies, localStorage, IndexedDB, the Origin Private File System, and virtual WebAuthn passkeys
- `context.setStorageState(state)` — clear and re-seed state on an existing context, no new
  context required `[≥1.59]`
- `page.localStorage` / `page.sessionStorage` → `WebStorage` with `getItem`, `setItem`, `items()` `[≥1.61]`
- Cookies: `context.addCookies()`, `context.cookies()`, `context.clearCookies({ name, domain, path })` `[≥1.43]`;
  `partitionKey` supported for CHIPS partitioned cookies `[≥1.54]`
- **WebAuthn / passkeys** `[≥1.61]`: `context.credentials` virtual authenticator —
  `credentials.create(origin, {...})`, `credentials.install()`, `credentials.get()`.
  Answers `navigator.credentials.create/get()` in-page, all browsers, no hardware key.
- `--user-data-dir` on CLI commands to reuse browsing state across sessions `[≥1.54]`

---

## 7. Emulation

- Context options: `viewport`, `deviceScaleFactor`, `locale`, `timezoneId`, `geolocation`,
  `permissions`, `colorScheme`, `reducedMotion`, `forcedColors`, `contrast` `[≥1.51]`,
  `offline`, `httpCredentials`, `userAgent`, `extraHTTPHeaders`, `baseURL`, `devices[...]`
- `httpCredentials` also accepts an **array** of credential sets — the first entry matching the
  request origin is used, entries without an `origin` match any request `[≥1.63]`
- New standalone test-runner options `testOptions.reducedMotion`, `testOptions.forcedColors`,
  `testOptions.contrast` — set independently of `use.colorScheme` emulation `[≥1.63]`
- `page.emulateMedia({ media, colorScheme, reducedMotion, forcedColors, contrast })`
- **Clock API** `[≥1.45]`: `page.clock.install({ time })`, `setFixedTime`, `setSystemTime`,
  `fastForward`, `pauseAt`, `runFor`, `resume` — deterministic time-dependent testing
- Clipboard is isolated from the host OS in headless mode, so `navigator.clipboard` tests no
  longer clobber the developer's real clipboard `[≥1.62]`

---

## 8. Screenshots & visual comparison

- `page.screenshot({ path, fullPage, clip, mask, maskColor, style, type, quality, animations, scale })`
  and `locator.screenshot({...})`
- `await expect(page).toHaveScreenshot('name.png', { mask, maskColor, stylePath, pathTemplate, maxDiffPixels, threshold })`
- **WebP support** `[≥1.62]`: name the snapshot `.webp` (lossless golden), or pass `type: 'webp'`
  with `quality` (100 = lossless) for standalone screenshots
- `style` / `stylePath` inject CSS before capture `[≥1.41]`
- `snapshotPathTemplate` in config controls snapshot location; `{testFileBaseName}` token `[≥1.60]`
- Update modes: `--update-snapshots=changed|all|missing|none` and
  `--update-source-method=patch|overwrite|3way` `[≥1.50]`
- `screenshot: { mode: 'only-on-failure' | 'on-first-failure' `[≥1.49]`, fullPage: true }` in config
- `ignoreSnapshots` per project `[≥1.44]`; `--ignore-snapshots` CLI flag

---

## 9. Screencast & video `[≥1.59]`

`page.screencast` is the modern, precisely controllable alternative to the `recordVideo` context option.

- `page.screencast.start({ path, size, onFrame })` / `.stop()` — `onFrame` streams JPEG frames
  (each with a presentation `timestamp` `[≥1.61]`) for thumbnails, live preview, or vision models
- `page.screencast.showActions({ position, duration, fontSize, cursor `[≥1.61]` })` / `.hideActions()` —
  on-video annotation of each interacted element
- `page.screencast.showChapter(title, { description, duration })`,
  `.showOverlay(html)`, `.showOverlays()` / `.hideOverlays()`
- Enable annotations declaratively in config: `use: { video: { mode: 'on', show: { actions: {...}, test: {...} } } }`
- Video modes now mirror trace modes: `'on-all-retries'`, `'retain-on-first-failure'`,
  `'retain-on-failure-and-retries'` `[≥1.61]`

**Agent pattern — video receipts:** record a walkthrough with chapters and action annotations after
completing a task, so a human can review the work visually instead of reading logs.

---

## 10. Tracing, debugging, observability

- `context.tracing.start({ screenshots, snapshots, sources, live `[≥1.59]` })`, `.stop({ path })`,
  `.startChunk({ name })`, `.stopChunk()`, `.group(name)` `[≥1.49]`
- `snapshots` (on `tracing.start()` and the `trace` test option) now also accepts an object
  selecting exactly what to capture per action — `snapshots: { dom: true, aria: true, screen: true }`.
  With `aria` and `screen` snapshots recorded, the trace viewer's **Display Aria** mode shows the
  action screenshot beside the aria snapshot, and hovering an aria node highlights it on the
  screenshot `[≥1.63]`
- Trace modes: `on`, `off`, `retain-on-failure`, `on-first-retry`, `retain-on-first-failure` `[≥1.43]`,
  `retain-on-failure-and-retries` `[≥1.59]`
- `npx playwright show-trace trace.zip` (accepts `.zip` directly, `--port 0` for a browser tab)
- **`context.debugger`** — programmatic control of the Playwright debugger `[≥1.59]`
- `browser.bind(name, { workspaceDir, host, port })` / `browser.unbind()` — expose a running
  browser so `playwright-cli`, `@playwright/mcp`, and other clients can attach; multiple
  simultaneous clients supported `[≥1.59]`
- `playwright-cli show` opens a dashboard of all bound browsers for live observation and manual
  intervention; `PLAYWRIGHT_DASHBOARD=1` surfaces `@playwright/test` browsers there `[≥1.59]`

### Console & errors
- `page.consoleMessages({ filter })` and `page.pageErrors({ filter })` — pull recent messages
  without wiring up event listeners `[≥1.56]`, filter option `[≥1.59]`
- `page.clearConsoleMessages()` / `page.clearPageErrors()` `[≥1.59]`
- `consoleMessage.timestamp()` `[≥1.59]`; `consoleMessage.location()` exposes `line`/`column` `[≥1.60]`
- `context.on('weberror')`, `webError.location()` `[≥1.60]`
- `worker.on('console')` and `worker.waitForEvent('console')`, including Service Workers `[≥1.57]`

---

## 11. Test runner

### Structure
`test`, `test.describe`, `test.beforeAll/afterAll/beforeEach/afterEach`, `test.skip`, `test.fixme`,
`test.fail`, `test.fail.only` `[≥1.49]`, `test.slow`, `test.only`,
`test.describe.configure({ mode: 'parallel' | 'serial', retries, timeout })` `[≥1.28]`.

- **`test.abort(message)`** — terminate the running test immediately from a fixture, hook, or route
  handler when unrecoverable misuse is detected `[≥1.60]`
- **Test locks** `test('...', { lock: 'name' }, async ({ page }) => {...})` — tests sharing a lock
  name never run concurrently, across files, workers, and projects, while everything else keeps
  running in parallel. A test may hold multiple locks (`lock: ['a', 'b']`); `test.describe(...,
  { lock: 'name' })` applies a lock to the whole group. Use for tests hitting a shared resource —
  an external service, a global account setting `[≥1.63]`

### Steps
- `test.step(title, body, { box, timeout `[≥1.50]`, location, params `[≥1.63]` })` — `params` attaches
  structured data (shown as `testStep.params` to reporters, and in the trace viewer/HTML report)
- `test.step.skip(title, body)` `[≥1.50]`
- Step callback receives `TestStepInfo` `[≥1.51]`: `step.skip(condition, reason)`, `step.attach(...)`,
  `step.titlePath` `[≥1.55]`
- Playwright API steps (locator actions) now report the target locator and call arguments, and
  every step's `testStep.subtitle` complements the title with the locator or navigation URL —
  e.g. "Click" with subtitle `getByRole('button')`. Both `params` and `subtitle` render in the
  trace viewer and HTML report `[≥1.63]`

### Fixtures
- `test.extend<{...}>({ fixture: [fn, { scope, auto, option, box, title }] })`
- `mergeTests(a, b)` to combine fixture sets `[≥1.39]`
- `box: true` hides fixture internals from reports; custom `title` for readability `[≥1.46]`
- Config now errors if it tries to override a non-option fixture `[≥1.60]`

### Tags & annotations
```js
test('checkout', { tag: ['@fast', '@smoke'],
  annotation: [{ type: 'issue', description: 'https://...' }] },
  async ({ page }) => { /* ... */ });
```
`[≥1.42]`. Filter with `--grep @fast` / `--grep-invert` (`-G` shorthand `[≥1.61]`).
`testInfo.tags` `[≥1.43]`; annotations carry a `location` `[≥1.54]`.

### Config essentials
`testDir`, `testMatch`, `fullyParallel`, `forbidOnly`, `retries`, `workers` (number or `'50%'`),
`timeout`, `expect`, `use`, `projects`, `reporter`, `outputDir`, `snapshotPathTemplate`,
`globalSetup`/`globalTeardown` (multiple supported `[≥1.49]`), `tsconfig` `[≥1.49]`.

Newer, high-value options:
- `retryStrategy: 'immediate' | 'isolated'` — `'isolated'` defers all retries to the end and runs
  them one at a time in a single worker to reduce cross-test interference `[≥1.62]`
- `failOnFlakyTests` `[≥1.52]` (CLI: `--fail-on-flaky-tests` `[≥1.45]`)
- `captureGitInfo: { commit, diff }` — feeds git metadata into the HTML report `[≥1.51]`
- `respectGitIgnore` `[≥1.45]`
- `tag` — applies a tag to every test in the run, useful with merged shard reports `[≥1.57]`
- `updateSnapshots` / `updateSourceMethod` `[≥1.50]`
- `expect.pathTemplate` for `toHaveScreenshot` / `toMatchAriaSnapshot` `[≥1.50]`

### Projects
- `dependencies` `[≥1.31]` and `teardown` `[≥1.34]` for setup/cleanup ordering
- Per-project `workers` (still bounded by the global limit) `[≥1.52]`
- Per-project `expect`, `ignoreSnapshots`, `respectGitIgnore`, `snapshotPathTemplate`

### Web server
```js
webServer: {
  command: 'npm run start',
  wait: { stdout: /Listening on port (?<my_server_port>\d+)/ },  // [≥1.57]
  gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },        // [≥1.50]
  stdout: 'pipe', stderr: 'pipe',                                 // [≥1.34]
  reuseExistingServer: !process.env.CI,
}
```
Named capture groups from `wait.stdout` are exported as environment variables (e.g. `MY_SERVER_PORT`) —
the correct way to handle dynamic dev-server ports and non-HTTP readiness signals.

---

## 12. Reporters

Built-in: `list`, `line`, `dot`, `html`, `json`, `junit`, `blob`, `github`, `null`, `perfetto` `[≥1.63]`.

- **HTML options**: `title` `[≥1.53]`, `noSnippets` `[≥1.54]`, `mergeFiles` `[≥1.62]`,
  disable "Copy prompt" `[≥1.56]`, `host`/`port`; the report now renders a duration waterfall next
  to test steps `[≥1.63]`
- **`perfetto` reporter** `[≥1.63]` — writes a Trace Event Format file for the Perfetto UI or
  `chrome://tracing`, rendering the run as a timeline with one lane per worker
- `omitTags` option on `list`, `line`, `dot`, `github`, and `junit` reporters — suppresses the tags
  automatically appended to test titles `[≥1.63]`
- **Sharding**: `--shard=1/4` plus `blob` reporter and `npx playwright merge-reports`;
  blob `outputFile` / `PLAYWRIGHT_BLOB_OUTPUT_FILE` `[≥1.44]`
- **Speedboard** tab ranks tests by slowness `[≥1.57]`; Timeline view for merged reports `[≥1.58]`
- **Reporter API**: `onBegin`, `onTestBegin`, `onTestEnd`, `onStepBegin/End`, `onError`
  (now receives `workerInfo` `[≥1.60]`), `onEnd`, `onExit` `[≥1.33]`
- **`Reporter.preprocess({ config, suite, testRun })`** `[≥1.62]` — runs after config resolution
  and before `onBegin`; mark tests as skipped, excluded, fixed, or failing. This is the supported
  hook for custom test-selection logic (quarantine lists, flake databases, risk-based selection).
- `suite.entries()` `[≥1.44]`, `testStep.attachments` `[≥1.50]`, `testResult.annotations` `[≥1.52]`,
  `testInfoError.cause` `[≥1.49]`, `testInfoError.errorContext` (includes the aria snapshot at the
  moment an `expect` failed) `[≥1.60]`, `fullConfig.argv` `[≥1.61]`, `fullConfig.failOnFlakyTests` `[≥1.61]`
- `AggregateError` sub-errors are listed individually in `testInfo.errors` `[≥1.61]`
- JUnit distinguishes `<failure>` from `<error>` `[≥1.59]`; `includeProjectInTestName` `[≥1.44]`
- `PLAYWRIGHT_FORCE_TTY=0|<width>` controls ANSI behavior of terminal reporters `[≥1.45]`

---

## 13. Command line

```bash
npx playwright test [--project='*mobile*'] [--grep @tag] [--grep-invert|-G]
npx playwright test --ui                      # UI mode, --ui-port 0 for a browser tab
npx playwright test --headed --debug
npx playwright test --last-failed             # [≥1.44]
npx playwright test --only-changed[=main]     # [≥1.46]
npx playwright test --test-list file.txt      # and --test-list-invert  [≥1.56]
npx playwright test --tsconfig tsconfig.test.json    # [≥1.47]
npx playwright test --update-snapshots=changed --update-source-method=3way
npx playwright test --fail-on-flaky-tests --pass-with-no-tests --ignore-snapshots
npx playwright test --shard=1/4

npx playwright codegen [--user-data-dir=./ud]  # NOT `playwright open`
npx playwright show-report [report.zip]
npx playwright show-trace trace.zip
npx playwright install [--with-deps] [--list] [--no-remove]    # --no-remove [≥1.63]
npx playwright uninstall [--all]
npx playwright merge-reports ./blob-reports

# reporters
npx playwright test --reporter=list    # replaces configured reporters
npx playwright test --add-reporter=perfetto    # appends on top of config-defined reporters [≥1.63]

npx playwright codegen --http-credentials=user:pass    # records against pages behind HTTP auth [≥1.63]
```

---

## 14. Agentic / AI-native capabilities

This is the part most relevant to a coding agent driving Playwright.

- **Playwright Test Agents** `[≥1.56]` — `npx playwright init-agents --loop=claude|vscode|opencode`
  generates three agent definitions: **planner** (explore app → Markdown test plan),
  **generator** (plan → Playwright test files), **healer** (run suite → repair failures).
- **Bundled MCP server and CLI** `[≥1.62]`: `npx playwright mcp` and `npx playwright cli` ship with
  Playwright itself — no separate install needed.
- **CLI debugger** `[≥1.59]`: `npx playwright test --debug=cli` prints a session id; attach with
  `playwright-cli attach <session>` and drive it with `playwright-cli --session <id> step-over`,
  `snapshot`, etc. Text-based, so an agent can debug a paused test without a GUI.
- **CLI trace analysis** `[≥1.59]`: `npx playwright trace open <trace.zip>`, `trace actions --grep=...`,
  `trace action <n>`, `trace snapshot <n> --name before|after`, `trace close`. Read failures from a
  terminal instead of the trace viewer UI.
- **Browser sharing** `[≥1.59]`: `browser.bind()` + `playwright-cli attach` + `@playwright/mcp --endpoint=`
  lets an agent and a human share one live browser.
- **Aria snapshots with `boxes`** `[≥1.60]` — accessibility tree plus bounding boxes, explicitly
  intended as model input.
- **Screencast receipts** `[≥1.59]` — see §9.
- **"Copy prompt"** buttons in HTML report, trace viewer, and UI mode produce an LLM-ready
  failure prompt with surrounding context `[≥1.51]`.
- **`PLAYWRIGHT_TEST` env var** is set in worker processes so code can detect it is under test `[≥1.56]`.

---

## 15. Resource lifetime: `await using` `[≥1.59]`

Many APIs return async disposables, so cleanup is scoped rather than manual:

```js
await using page = await context.newPage();
{
  await using route = await page.route('**/*', r => r.continue());
  await using script = await page.addInitScript(() => { /* ... */ });
  await using har = await context.tracing.startHar('trace.har');  // [≥1.60]
  await page.goto('https://example.com');
}   // route, init script, and HAR are torn down here
```
Requires a TypeScript/runtime target supporting explicit resource management.

---

## 16. Evaluation & scripting

- `page.evaluate`, `evaluateHandle`, `locator.evaluate`, `locator.evaluateAll` — **functions may now
  be passed as evaluate arguments** `[≥1.62]`
- `page.addInitScript` / `context.addInitScript` — also accept functions as arguments `[≥1.62]`
- `page.exposeFunction`, `page.exposeBinding` (without the removed `handle` option)
- `page.addScriptTag`, `page.addStyleTag`
- `page.pdf({ tagged, outline })` — Chromium only `[≥1.42]`

---

## 17. Browser / context / page lifecycle

- `chromium.launch({ args, channel, artifactsDir `[≥1.59]` })`, `launchPersistentContext({ firefoxUserPrefs })`,
  `launchServer({ host })`, `connect()`, `connectOverCDP({ isLocal `[≥1.58]`, artifactsDir `[≥1.61]`, noDefaults `[≥1.60]` })`
  — `noDefaults` prevents Playwright from overriding download/focus/media behavior when attaching
  to a user's real browser
- Channels: `chromium` (new headless), `chrome`, `msedge`, and their dev/beta/canary variants.
  Playwright now runs Chrome for Testing builds — headed uses `chrome`, headless uses
  `chrome-headless-shell` (Chromium is retained on Arm64 Linux) `[≥1.57]`
- `browser.on('context')` `[≥1.60]`; `context.isClosed()` `[≥1.59]`
- BrowserContext mirrors page lifecycle events: `download`, `frameattached`, `framedetached`,
  `framenavigated`, `pageclose`, `pageload` `[≥1.60]`, plus `console`, `dialog`, `weberror`
- `close({ reason })` on `Page`/`BrowserContext`/`Browser` — the reason surfaces in errors from
  operations interrupted by the close `[≥1.40]`
- `removeAllListeners({ behavior })` `[≥1.47]`
- CDP: `context.newCDPSession(page)`, `cdpSession.on('event')` and `.on('close')` `[≥1.59]`
- `page.on('dialogclosed')` / `browserContext.on('dialogclosed')` — emitted when a JS dialog is
  accepted, dismissed, or closed by the user `[≥1.63]`

---

## 18. Component testing `[≥1.62 — model changed]`

Component testing moved to a **stories and galleries** model. A *story* wraps a component in one
scenario (fixed props, mocks, providers); a *gallery* page you serve renders stories on demand.

```js
test('click expands', async ({ mount }) => {
  const component = await mount('components/Expandable/Stateful');
  await component.getByRole('button').click();
  await expect(component.getByTestId('expanded')).toHaveValue('true');
});
```

`mount` navigates to the gallery, mounts the story by id, and returns a `Locator` scoped to the
story root. Pass a story type as a template argument for prop type-checking; call `update(props)`
and `unmount()` on the returned locator. The `router` fixture (`router.route()` / `router.use()`
with MSW handlers) handles network in component tests `[≥1.46]`.

**Do not scaffold** `@playwright/experimental-ct-svelte` (removed `[≥1.59]`),
`@playwright/experimental-ct-vue2`, or `@playwright/experimental-ct-solid` (both unmaintained since 1.49).

⚠️ **`@playwright/experimental-ct-react`, `-react17`, and `-vue` will no longer be updated `[1.63]`.**
Migrate to the stories model above (introduced 1.62). Story ids passed to `fixtures.mount()` can
now be typed through the generated Stories registry `[≥1.63]`.

---

## 19. ⛔ Deprecated, removed, or changed — never generate this

| Do not use | Use instead | Status |
|---|---|---|
| `page.accessibility` | Axe (`@axe-core/playwright`) | Removed 1.57 |
| `page.type()`, `frame.type()`, `locator.type()`, `elementHandle.type()` | `locator.fill()`; `locator.pressSequentially()` only for real key-by-key handling | Deprecated 1.38 |
| `_react=` / `_vue=` selectors | Role/test-id locators | Removed 1.58 |
| `:light` selector suffix | Standard CSS selectors | Removed 1.58 |
| `devtools: true` in `launch()` | `args: ['--auto-open-devtools-for-tabs']` | Removed 1.58 |
| `locator.ariaRef()` | `locator.ariaSnapshot()` | Removed 1.60 |
| `handle` option on `exposeBinding` | — | Removed 1.60 |
| `logger` option on `connect` / `connectOverCDP` | Tracing | Removed 1.60 |
| `videosPath` / `videoSize` context options | `recordVideo`, or `page.screencast` | Removed 1.60 |
| `context.on('backgroundpage')`, `context.backgroundPages()` | — (no longer emitted; returns empty) | Deprecated 1.56 |
| `consoleMessage.location().lineNumber` / `.columnNumber` | `.line` / `.column` | Deprecated 1.60 |
| `noWaitAfter` on `locator.selectOption()` | — | Deprecated 1.47 |
| `npx playwright open` for recording | `npx playwright codegen` | Changed 1.54 |
| `-gv` CLI flag | `--grep-invert` (or `-G`) | Removed 1.54 |
| `?` and `[]` in route glob patterns | Regular expressions | Removed 1.52 |
| Overriding `Cookie` via `route.continue()` | `context.addCookies()` | Removed 1.52 |
| `@playwright/experimental-ct-svelte` / `-vue2` / `-solid` | Current CT model (§18) | Removed / unmaintained |
| Chromium extension manifest v2 | Manifest v3 | Dropped 1.55 |
| `npx playwright-core install` confusion | `npx playwright install` (unless genuinely on `playwright-core`) | Renamed 1.35 |
| Relying on auto-download of browsers | `npx playwright install --with-deps` | Changed 1.38 |
| Installing both `playwright` and `@playwright/test` | `@playwright/test` only | Broken since 1.34 |

**Behavior changes worth knowing:**
- `toBeEditable()` / `isEditable()` throw if the element is not actually an editable element type `[1.50]`
- `toHaveAttribute(name, '')` no longer matches a *missing* attribute `[1.27]`
- `waitUntil: 'domcontentloaded'` waits only for the target frame; use `'load'` for all iframes `[1.26]`
- `updateSnapshots: 'all'` updates every snapshot; use `'changed'` for the old behavior `[1.50]`

**Platform support:** Debian 11 unsupported `[1.62]`; Ubuntu 18/20.04 unsupported (20.04 dropped `[1.63]`);
macOS 13 and 14 dropped for WebKit `[1.58 / 1.59]`; Ubuntu 24.04 `[1.45]` and 26.04 `[1.61]` and
Debian 13 `[1.55]` supported.

**Browser versions `[1.63]`:** Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6 — also tested
against Chrome 153 and Edge 153 stable channels.

---

## 20. Default test skeleton an agent should emit

```ts
import { test, expect } from '@playwright/test';

test.describe('checkout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cart');
  });

  test('applies a coupon', { tag: ['@smoke'] }, async ({ page }) => {
    await test.step('enter coupon', async () => {
      await page.getByLabel('Coupon code').fill('SAVE20');
      await page.getByRole('button', { name: 'Apply' }).click();
    });

    await expect(page.getByTestId('discount')).toHaveText('-20%');
    await expect(page.getByRole('status')).toMatchAriaSnapshot(`
      - status: /Coupon applied/
    `);
  });
});
```

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  retryStrategy: 'isolated',            // [≥1.62]
  failOnFlakyTests: !!process.env.CI,   // [≥1.52]
  reporter: [['html', { mergeFiles: true }], ['blob']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure-and-retries',   // [≥1.59]
    screenshot: 'only-on-failure',
    video: 'retain-on-failure-and-retries',   // [≥1.61]
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] }, dependencies: ['setup'] },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, dependencies: ['setup'] },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, dependencies: ['setup'] },
  ],
  webServer: {
    command: 'npm run start',
    wait: { stdout: /Listening on port (?<port>\d+)/ },   // [≥1.57]
    reuseExistingServer: !process.env.CI,
  },
});
```
