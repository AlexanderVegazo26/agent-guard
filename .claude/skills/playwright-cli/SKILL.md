---
name: playwright-cli
description: Automate browser interactions, test web pages and work with Playwright tests.
allowed-tools: Bash(npm run test:cli:*) Bash(npx:*) Bash(npm:*)
---

# Browser Automation with playwright-cli

This repo does not use the standalone `@playwright/cli` package — it drives
the CLI that already ships inside its own installed Playwright version via
`npx playwright cli`, wired up as `package.json`'s `test:cli` script. Every
command below is invoked as `npm run test:cli -- <command> [args]` rather
than a bare `playwright-cli` binary, so there's nothing extra to install and
the CLI's behavior always matches the exact Playwright version this repo
tests with (see `npm run test:cli -- --help` to confirm the full command
list matches what's documented here).

## Quick start

```bash
# open new browser
npm run test:cli -- open
# navigate to a page
npm run test:cli -- goto https://playwright.dev
# interact with the page using refs from the snapshot
npm run test:cli -- click e15
npm run test:cli -- type "page.click"
npm run test:cli -- press Enter
# take a screenshot (rarely used, as snapshot is more common)
npm run test:cli -- screenshot
# close the browser
npm run test:cli -- close
```

## Commands

### Core

```bash
npm run test:cli -- open
# open and navigate right away
npm run test:cli -- open https://example.com/
npm run test:cli -- goto https://playwright.dev
npm run test:cli -- type "search query"
npm run test:cli -- click e3
npm run test:cli -- dblclick e7
# --submit presses Enter after filling the element
npm run test:cli -- fill e5 "user@example.com"  --submit
npm run test:cli -- drag e2 e8
# drop files or data onto an element (from outside the page)
npm run test:cli -- drop e4 --path=./image.png
npm run test:cli -- drop e4 --data="text/plain=hello world"
npm run test:cli -- hover e4
npm run test:cli -- select e9 "option-value"
npm run test:cli -- upload ./document.pdf
npm run test:cli -- check e12
npm run test:cli -- uncheck e12
npm run test:cli -- snapshot
# search the snapshot for text or a regexp, returns matching nodes with surrounding context
npm run test:cli -- find "Sign in"
npm run test:cli -- find --regex "Sign (in|up)"
# wrap the regexp in slashes to add flags, e.g. /i for case-insensitive
npm run test:cli -- find --regex "/sign (in|up)/i"
npm run test:cli -- eval "document.title"
npm run test:cli -- eval "el => el.textContent" e5
# get element id, class, or any attribute not visible in the snapshot
npm run test:cli -- eval "el => el.id" e5
npm run test:cli -- eval "el => el.getAttribute('data-testid')" e5
npm run test:cli -- dialog-accept
npm run test:cli -- dialog-accept "confirmation text"
npm run test:cli -- dialog-dismiss
npm run test:cli -- resize 1920 1080
npm run test:cli -- close
```

### Navigation

```bash
npm run test:cli -- go-back
npm run test:cli -- go-forward
npm run test:cli -- reload
```

### Keyboard

```bash
npm run test:cli -- press Enter
npm run test:cli -- press ArrowDown
npm run test:cli -- keydown Shift
npm run test:cli -- keyup Shift
```

### Mouse

```bash
npm run test:cli -- mousemove 150 300
npm run test:cli -- mousedown
npm run test:cli -- mousedown right
npm run test:cli -- mouseup
npm run test:cli -- mouseup right
npm run test:cli -- mousewheel 0 100
```

### Save as

```bash
npm run test:cli -- screenshot
npm run test:cli -- screenshot e5
npm run test:cli -- screenshot --filename=page.png
npm run test:cli -- screenshot --hires
npm run test:cli -- pdf --filename=page.pdf
```

### Tabs

```bash
npm run test:cli -- tab-list
npm run test:cli -- tab-new
npm run test:cli -- tab-new https://example.com/page
npm run test:cli -- tab-close
npm run test:cli -- tab-close 2
npm run test:cli -- tab-select 0
```

### Storage

```bash
npm run test:cli -- state-save
npm run test:cli -- state-save auth.json
npm run test:cli -- state-load auth.json

# Cookies
npm run test:cli -- cookie-list
npm run test:cli -- cookie-list --domain=example.com
npm run test:cli -- cookie-get session_id
npm run test:cli -- cookie-set session_id abc123
npm run test:cli -- cookie-set session_id abc123 --domain=example.com --httpOnly --secure
npm run test:cli -- cookie-delete session_id
npm run test:cli -- cookie-clear

# LocalStorage
npm run test:cli -- localstorage-list
npm run test:cli -- localstorage-get theme
npm run test:cli -- localstorage-set theme dark
npm run test:cli -- localstorage-delete theme
npm run test:cli -- localstorage-clear

# SessionStorage
npm run test:cli -- sessionstorage-list
npm run test:cli -- sessionstorage-get step
npm run test:cli -- sessionstorage-set step 3
npm run test:cli -- sessionstorage-delete step
npm run test:cli -- sessionstorage-clear
```

### Network

```bash
npm run test:cli -- route "**/*.jpg" --status=404
npm run test:cli -- route "https://api.example.com/**" --body='{"mock": true}'
npm run test:cli -- route-list
npm run test:cli -- unroute "**/*.jpg"
npm run test:cli -- unroute
```

### DevTools

```bash
npm run test:cli -- console
npm run test:cli -- console warning
npm run test:cli -- requests
npm run test:cli -- request 5
npm run test:cli -- run-code "async page => await page.context().grantPermissions(['geolocation'])"
npm run test:cli -- run-code --filename=script.js
npm run test:cli -- tracing-start
npm run test:cli -- tracing-stop
npm run test:cli -- video-start video.webm
npm run test:cli -- video-chapter "Chapter Title" --description="Details" --duration=2000
npm run test:cli -- video-stop

# annotate each subsequent action (click, type, ...) with a callout naming the action and highlighting the target
npm run test:cli -- video-show-actions --duration=600 --position=top-right
npm run test:cli -- video-hide-actions

# launch the dashboard for UI review / design feedback — user annotates the page, you receive the annotated screenshot, snapshot, and notes
npm run test:cli -- show --annotate

# generate a Playwright locator for an element from its ref or selector
npm run test:cli -- generate-locator e5 --raw

# show a persistent highlight overlay for an element, optionally with a custom style
npm run test:cli -- highlight e5
npm run test:cli -- highlight e5 --style="outline: 3px dashed red"
# hide a single element highlight, or all page highlights when no target is given
npm run test:cli -- highlight e5 --hide
npm run test:cli -- highlight --hide
```

## Raw output

The global `--raw` option strips page status, generated code, and snapshot sections from the output, returning only the result value. Use it to pipe command output into other tools. Commands that don't produce output return nothing.

```bash
npm run test:cli -- --raw eval "JSON.stringify(performance.timing)" | jq '.loadEventEnd - .navigationStart'
npm run test:cli -- --raw eval "JSON.stringify([...document.querySelectorAll('a')].map(a => a.href))" > links.json
npm run test:cli -- --raw snapshot > before.yml
npm run test:cli -- click e5
npm run test:cli -- --raw snapshot > after.yml
diff before.yml after.yml
TOKEN=$(npm run test:cli -- --raw cookie-get session_id)
npm run test:cli -- --raw localstorage-get theme
```

For structured output wrapping every reply as JSON, pass --json
```bash
npm run test:cli -- list --json
```

## Open parameters
```bash
# Use specific browser when creating session
npm run test:cli -- open --browser=chrome
npm run test:cli -- open --browser=firefox
npm run test:cli -- open --browser=webkit
npm run test:cli -- open --browser=msedge

# Emulate a generic mobile device (Pixel 10 for Chromium, iPhone 17 for WebKit).
# Prefer this when a mobile layout is acceptable: mobile pages are usually
# lighter, so snapshots are smaller and cheaper.
npm run test:cli -- open --mobile
npm run test:cli -- open --device="iPhone 15"

# Use persistent profile (by default profile is in-memory)
npm run test:cli -- open --persistent
# Use persistent profile with custom directory
npm run test:cli -- open --profile=/path/to/profile

# Connect to browser via Playwright Extension
npm run test:cli -- attach --extension=chrome

# Connect to a running Chrome or Edge by channel name
npm run test:cli -- attach --cdp=chrome
npm run test:cli -- attach --cdp=msedge

# Connect to a running browser via CDP endpoint
npm run test:cli -- attach --cdp=http://localhost:9222

# Start with config file
npm run test:cli -- open --config=my-config.json

# Close the browser
npm run test:cli -- close
# Detach from an attached browser (leaves the external browser running)
npm run test:cli -- -s=msedge detach
# Delete user data for the default session
npm run test:cli -- delete-data
```

## URLs with `&` on Windows

On Windows, `cmd.exe` and PowerShell treat `&` as a command separator, so URLs with multiple query parameters get truncated before `playwright-cli` runs. Escape `&` with `^&` in `cmd.exe`, or use `--%` in PowerShell:

```batch
npm run test:cli -- goto "https://example.com/?a=1^&b=2"
```

```powershell
npm run test:cli -- --% goto "https://example.com/?a=1&b=2"
```

## Snapshots

After each command, playwright-cli provides a snapshot of the current browser state.

```bash
> npm run test:cli -- goto https://example.com
### Page
- Page URL: https://example.com/
- Page Title: Example Domain
### Snapshot
[Snapshot](.playwright-cli/page-2026-02-14T19-22-42-679Z.yml)
```

You can also take a snapshot on demand using `npm run test:cli -- snapshot` command. All the options below can be combined as needed.

```bash
# default - save to a file with timestamp-based name
npm run test:cli -- snapshot

# save to file, use when snapshot is a part of the workflow result
npm run test:cli -- snapshot --filename=after-click.yaml

# snapshot an element instead of the whole page
npm run test:cli -- snapshot "#main"

# limit snapshot depth for efficiency, take a partial snapshot afterwards
npm run test:cli -- snapshot --depth=4
npm run test:cli -- snapshot e34

# include each element's bounding box as [box=x,y,width,height]
npm run test:cli -- snapshot --boxes

# search a large snapshot instead of capturing it all — returns matching nodes
# with 3 lines of context around each match (like grep -C)
npm run test:cli -- find "Add to cart"
npm run test:cli -- find --regex "\\$[0-9]+\\.[0-9]{2}"
```

## Targeting elements

By default, use refs from the snapshot to interact with page elements.

```bash
# get snapshot with refs
npm run test:cli -- snapshot

# interact using a ref
npm run test:cli -- click e15
```

You can also use css selectors or Playwright locators.

```bash
# css selector
npm run test:cli -- click "#main > button.submit"

# role locator
npm run test:cli -- click "getByRole('button', { name: 'Submit' })"

# test id
npm run test:cli -- click "getByTestId('submit-button')"
```

## Browser Sessions

```bash
# create new browser session named "mysession" with persistent profile
npm run test:cli -- -s=mysession open example.com --persistent
# same with manually specified profile directory (use when requested explicitly)
npm run test:cli -- -s=mysession open example.com --profile=/path/to/profile
npm run test:cli -- -s=mysession click e6
npm run test:cli -- -s=mysession close  # stop a named browser
npm run test:cli -- -s=mysession delete-data  # delete user data for persistent session

npm run test:cli -- list
# Close all browsers
npm run test:cli -- close-all
# Forcefully kill all browser processes
npm run test:cli -- kill-all
```

> **⚠️ Never use OS-level process killing on browsers** (`taskkill /IM chrome.exe /F`,
> `pkill chrome`, `Stop-Process -Name chrome`, etc.) to clean up stray/orphaned
> Playwright browsers. This kills **every** Chrome/Edge/Firefox process on the
> machine, including the user's own personal browser windows and unsaved work —
> not just the ones this session launched. Only close what you opened, via
> `npm run test:cli -- close` / `close-all` / `kill-all` (which are scoped to
> playwright-cli-managed sessions) or MCP `browser_close`/`browser_tabs`. If a
> playwright-cli-managed session is genuinely stuck, `kill-all` is the acceptable
> last resort — a bare OS `taskkill`/`pkill` against the browser binary name never is.

## Installation

Nothing to install — `test:cli` in `package.json` already runs `npx playwright cli`, using this repo's own `@playwright/test` dependency. Confirm it resolves with:

```bash
npm run test:cli -- --version
```

## Example: Form submission

```bash
npm run test:cli -- open https://example.com/form
npm run test:cli -- snapshot

npm run test:cli -- fill e1 "user@example.com"
npm run test:cli -- fill e2 "password123"
npm run test:cli -- click e3
npm run test:cli -- snapshot
npm run test:cli -- close
```

## Example: Multi-tab workflow

```bash
npm run test:cli -- open https://example.com
npm run test:cli -- tab-new https://example.com/other
npm run test:cli -- tab-list
npm run test:cli -- tab-select 0
npm run test:cli -- snapshot
npm run test:cli -- close
```

## Example: Debugging with DevTools

```bash
npm run test:cli -- open https://example.com
npm run test:cli -- click e4
npm run test:cli -- fill e7 "test"
npm run test:cli -- console
npm run test:cli -- requests
npm run test:cli -- close
```

```bash
npm run test:cli -- open https://example.com
npm run test:cli -- tracing-start
npm run test:cli -- click e4
npm run test:cli -- fill e7 "test"
npm run test:cli -- tracing-stop
npm run test:cli -- close
```

## Example: Interactive session

Ask the user for UI review or design feedback. The user draws boxes on the live page and types comments; you receive the annotated screenshot, the snapshot of the marked region, and the user's notes. Use this whenever the user asks for "UI review", "design feedback", or to "ask the user what they think / want / mean":

```bash
npm run test:cli -- open https://example.com
npm run test:cli -- show --annotate
```

## Specific tasks

* **Running and Debugging Playwright tests** [references/playwright-tests.md](references/playwright-tests.md)
* **Request mocking** [references/request-mocking.md](references/request-mocking.md)
* **Running Playwright code** [references/running-code.md](references/running-code.md)
* **Browser session management** [references/session-management.md](references/session-management.md)
* **Storage state (cookies, localStorage)** [references/storage-state.md](references/storage-state.md)
* **Test generation (plan / generate / heal)** [references/test-generation.md](references/test-generation.md)
* **Tracing** [references/tracing.md](references/tracing.md)
* **Video recording** [references/video-recording.md](references/video-recording.md)
* **Inspecting element attributes** [references/element-attributes.md](references/element-attributes.md)
