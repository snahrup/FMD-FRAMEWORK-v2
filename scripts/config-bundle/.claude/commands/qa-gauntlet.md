---
description: "Run the full QA gauntlet — static analysis, build, E2E tests, deep AI security/performance/logic audits, and compile a comprehensive QA report. The most thorough code quality analysis possible."
---

# QA Gauntlet — Comprehensive AI-Powered Code Quality Analysis

You are about to run the most thorough QA, validation, optimization, and bug identification workflow possible. This is a multi-phase pipeline that combines traditional static analysis with deep AI-powered semantic auditing and E2E browser testing.

## Phase 0: Project Discovery

Before anything else, understand what you're working with:

1. **Detect project type** by scanning for config files:
   - `package.json` → Node.js/JavaScript/TypeScript project
   - `tsconfig.json` → TypeScript project
   - `next.config.*` → Next.js project
   - `pyproject.toml` / `setup.py` / `requirements.txt` → Python project
   - `Cargo.toml` → Rust project
   - `go.mod` → Go project
   - `pom.xml` / `build.gradle` → Java project
   - `.csproj` / `.sln` → .NET project

2. **Detect available tools**: Check which linters, formatters, test runners, and build tools are installed/configured (eslint, prettier, jest, vitest, playwright, pytest, mypy, ruff, cargo clippy, etc.)

3. **Inventory source files**: Use `Glob` to find all source files (exclude node_modules, .next, dist, build, __pycache__, target, etc.). Count files by extension.

4. **Read ALL source files** using parallel Read calls (batches of 10). You MUST read every file to give the AI auditors full context. This is non-negotiable — the quality of the audit depends on having read the actual code.

5. **Check git status** to understand what's changed recently.

## Phase 1: Static Analysis (run in parallel)

Run all applicable checks simultaneously:

### TypeScript/JavaScript:
- `npx tsc --noEmit` — strict type checking
- `npx eslint src/` or equivalent — lint analysis
- `npx next build` (if Next.js) — production build verification

### Python:
- `mypy .` or `pyright .` — type checking
- `ruff check .` or `flake8 .` — lint analysis
- `python -m py_compile` on key files — syntax verification

### Rust:
- `cargo clippy -- -W clippy::all` — lint analysis
- `cargo build --release` — production build

### Go:
- `go vet ./...` — vet analysis
- `golangci-lint run` — comprehensive lint
- `go build ./...` — build verification

Record ALL warnings and errors. Zero tolerance for build failures.

## Phase 2: Deep AI Audits (launch 3 background agents in parallel)

Launch exactly 3 background Task agents simultaneously. Each reads the ENTIRE codebase and produces structured findings.

### Agent 1: Security Audit
Instruct the agent to read every source file and audit for:
- Authentication/authorization gaps
- Input validation failures (injection, XSS, SSRF, path traversal)
- Information disclosure (error messages, API key exposure, stack traces)
- Secrets handling (hardcoded credentials, insecure storage)
- Rate limiting gaps
- Kill switch / safety bypass vectors (critical for trading/financial apps)
- Denial of service vectors
- Session/state manipulation
- OWASP Top 10 coverage

Format: `SEC-NN | SEVERITY | file:line | description | attack vector | fix`

### Agent 2: Performance & Memory Audit
Instruct the agent to read every source file and audit for:
- Memory leaks (unbounded arrays, event listener leaks, interval leaks, RAF loops)
- CPU waste (unnecessary re-renders, polling without cleanup, busy loops)
- Crash vectors (null/undefined on required fields, missing error boundaries)
- Connection leaks (SSE, WebSocket, database connections not cleaned up on disconnect)
- Storage bloat (localStorage/IndexedDB growing without bounds)
- Effect cleanup issues (React useEffect without cleanup, stale closures)
- N+1 queries or redundant API calls
- Large payload / serialization issues

Format: `PERF-NN | SEVERITY | file:line | description | impact | fix`

### Agent 3: Logic & Race Condition Audit
Instruct the agent to read every source file and audit for:
- Race conditions (non-atomic guards, concurrent state mutations, TOCTOU)
- Logic errors (off-by-one, wrong comparison, inverted conditions)
- State consistency (client vs server state drift, optimistic update failures)
- Duplicate / divergent code (same logic implemented differently in two places)
- Type safety (runtime type mismatches, unsafe assertions, missing null checks)
- Edge cases (empty arrays, zero values, negative numbers, timezone issues)
- Dead code / unreachable branches
- Concurrency issues (module-level singletons in serverless, shared mutable state)

Format: `LOGIC-NN | SEVERITY | file:line | description | trigger condition | fix`

## Phase 3: E2E Browser Testing (Playwright)

### Step 3a: Check for existing QA infrastructure

```bash
ls qa/run.mjs tests/e2e/ tests/sweep/ tests/a11y/ tests/visual/ playwright.config.js 2>/dev/null
```

### Step 3b: If `qa/run.mjs` exists — run the full E2E suite

The project has the Playwright QA workflow already scaffolded. Run it:

```bash
node qa/run.mjs
```

Then read the artifacts:
```bash
cat artifacts/qa/latest/SUMMARY.md
cat artifacts/qa/latest/summary.json
```

The E2E suite includes:
- **Golden-path tests**: Core user journeys with stable selectors and assertions
- **API CRUD tests**: Full lifecycle tests for every API endpoint
- **UI interaction sweep**: Enumerates all interactable elements (buttons, links, inputs, tabs, menus, selectors), safely clicks/fills/toggles each one with before/after screenshots. Denylist prevents destructive actions (delete/logout/pay/etc). Configurable via `qa/sweep_rules.json`.
- **Accessibility (axe-core)**: WCAG 2.x scan on all top pages
- **Visual regression**: Pixel-diff comparison against baseline screenshots
- **Electron E2E** (if applicable): Launches the Electron app, tests window creation, main process evaluation, multi-window support
- **Electron UI sweep** (if applicable): Same sweep engine against Electron renderer windows

All artifacts land in `./artifacts/qa/<timestamp>/`:
- HTML report, traces, videos, screenshots (checkpoints + sweep before/after)
- Console errors + failed network requests collected into summaries
- axe-core accessibility reports
- Sweep action logs (success/skip/error for each element)
- Machine-readable `summary.json` + human-readable `SUMMARY.md`

Configuration knobs (env vars):
- `QA_BASE_URL` — web app URL (default: auto-detect from project)
- `QA_HEADFUL=1` — visible browser for debugging
- `QA_SWEEP_MAX_ACTIONS` — max interactions per sweep page (default: 200)
- `QA_TIMEOUT_MINUTES` — timeout per suite (default: 30)
- `ELECTRON_ENTRY` — override Electron main.js path

### Step 3c: If NO QA infrastructure exists — scaffold it

If `qa/run.mjs` does NOT exist, you must scaffold the full Playwright E2E workflow:

1. **Install deps**:
```bash
npm install --save-dev @playwright/test @axe-core/playwright
npx playwright install chromium
```

2. **Create ALL of these files** (adapt URLs/routes/APIs to the actual project):

```
playwright.config.js          # 6 projects: web-golden-paths, web-sweep, a11y, visual, electron, electron-sweep
qa/run.mjs                    # Timestamped orchestrator (creates artifact folders, runs all suites, writes summary)
qa/sweep_rules.json           # Denylist: delete/remove/logout/pay/etc. Limits: maxActions, screenshotEveryN
tests/helpers/collector.js    # ErrorCollector: captures console errors + failed network requests
tests/helpers/sweep-engine.js # SweepEngine: enumerates interactables, safe interaction, recovery, screenshots
tests/e2e/web/*.spec.js       # Golden-path tests adapted to THIS project's pages and API
tests/e2e/electron/*.spec.js  # Electron launch tests (auto-skips if no Electron in project)
tests/sweep/ui_sweep_web.spec.js      # Web UI sweep
tests/sweep/ui_sweep_electron.spec.js # Electron UI sweep
tests/a11y/a11y-smoke.spec.js         # axe-core WCAG scan
tests/visual/visual-regression.spec.js # toHaveScreenshot baselines
QA_WORKFLOW.md                # How to run, add tests, tune sweep, interpret artifacts
```

3. **Add package.json scripts**:
```json
{
  "qa:install": "npm install && npx playwright install chromium",
  "qa:web": "npx playwright test --project=web-golden-paths",
  "qa:electron": "npx playwright test --project=electron",
  "qa:sweep": "npx playwright test --project=web-sweep --project=electron-sweep",
  "qa:a11y": "npx playwright test --project=a11y",
  "qa:visual": "npx playwright test --project=visual",
  "qa:all": "node qa/run.mjs",
  "qa:report": "npx playwright show-report artifacts/qa/latest/html-report",
  "qa": "node qa/run.mjs"
}
```

4. **Critical adaptation rules**:
   - Read the project's route/page files to discover actual URLs to test
   - Read API route files to discover endpoints for CRUD tests
   - Auto-detect the web server port from `.env`, server config, or package.json
   - Auto-detect Electron entry from package.json `main` field or common paths
   - The sweep engine MUST use denylist heuristics to avoid destructive actions
   - The sweep engine MUST take before/after screenshots
   - The sweep engine MUST recover from navigation (goBack / close modals)

5. **Then run it**:
```bash
node qa/run.mjs
```

### Reference implementation

The Nexus project at `~/CascadeProjects/nexus` has the complete reference implementation of all QA files. When scaffolding for a new project, use those files as templates and adapt the routes/APIs/ports.

## Phase 4: Compile QA Report

Wait for ALL phases to complete, then compile everything into `QA_REPORT.md`:

```markdown
# QA Report — [Project Name]
Generated: [timestamp]

## Executive Summary
- **TypeScript**: X errors, Y warnings
- **ESLint**: X errors, Y warnings
- **Build**: PASS/FAIL
- **E2E Tests**: X/Y passed (Z failed)
- **Security Findings**: X CRITICAL, Y HIGH, Z MEDIUM, W LOW
- **Performance Findings**: X CRITICAL, Y HIGH, Z MEDIUM, W LOW
- **Logic Findings**: X CRITICAL, Y HIGH, Z MEDIUM, W LOW
- **Total Issues**: N

## Critical Issues (fix immediately)
[All CRITICAL findings from all audits, sorted by impact]

## High Priority Issues
[All HIGH findings]

## Medium Priority Issues
[All MEDIUM findings]

## Low Priority Issues
[All LOW findings]

## Static Analysis Details
### TypeScript Compilation
[Full output]
### ESLint
[Full output]
### Build
[Full output]

## E2E Test Results
[Full test results with failure details]

## Security Audit — Full Findings
[All SEC-NN findings]

## Performance Audit — Full Findings
[All PERF-NN findings]

## Logic Audit — Full Findings
[All LOGIC-NN findings]

## Recommendations
[Prioritized fix plan]
```

## Phase 5 (Optional): Comprehensive Documentation

If the user requested documentation, also produce `PLATFORM_DOCS.md` covering:
- Architecture overview (stack, data flow, component tree)
- Every feature with description, implementation details, and selling points
- API reference (all routes/endpoints)
- Configuration options
- Design system / theming
- Security model
- Deployment guide

## Rules

1. **Read EVERY source file** — no shortcuts. The audit quality is directly proportional to how much code you've actually read.
2. **Run audits in parallel** — always launch all 3 background agents simultaneously.
3. **Be specific** — every finding must include exact file path and line number.
4. **Severity must be justified** — CRITICAL means "will cause data loss, security breach, or crash in production." Don't inflate.
5. **Fixes must be actionable** — "add input validation" is not enough. Show the specific check needed.
6. **Track progress** — use TodoWrite to show the user what phase you're in.
7. **Never skip the build** — if it doesn't build, that's finding #1.
