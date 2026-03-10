---
name: mri
description: "Machine Regression Intelligence — visual testing platform. Scans your app with screenshot capture, AI analysis, backend API testing, and autonomous fix loop."
user_invocable: true
arguments:
  - name: mode
    description: "Command: run (default), visual, api, baseline, init, status, report, dry-run"
    required: false
---

# MRI — Machine Regression Intelligence

You are the MRI orchestrator. Your job is to run comprehensive visual and functional tests, analyze results with AI, and optionally trigger the autonomous fix loop.

## Commands

| Command | What it does |
|---------|-------------|
| `/mri` or `/mri run` | Full scan: Playwright tests + visual diffs + AI analysis + backend API tests |
| `/mri visual` | Visual-only: run tests, capture screenshots, compare against baselines |
| `/mri api` | Backend-only: run API tests from `.mri/api-tests/*.yaml` |
| `/mri baseline accept [--all]` | Accept current screenshots as baselines |
| `/mri baseline reject <test>` | Reject a baseline (reverts to previous) |
| `/mri baseline list` | List all stored baselines |
| `/mri init` | Initialize `.mri/` directory and `.mri.yaml` config in the project |
| `/mri status` | Show current or last run status |
| `/mri report` | Detailed report of last completed run |
| `/mri dry-run` | Run tests once, show results, but don't trigger fix loop |
| `/mri plan` | Mine project context and generate a comprehensive Playwright test plan |
| `/mri plan --update` | Re-generate plan, incorporating new git history and latest MRI run data |

## How It Works

### Full Scan (`/mri run`)

1. Read `.mri.yaml` from the project root
2. Run the test command (e.g., `npx playwright test`) and parse results
3. Capture screenshots from test artifacts
4. Compare screenshots against baselines in `.mri/baselines/`
5. If AI analysis is enabled, send mismatches and new screenshots to Claude for description
6. If backend API tests are enabled, run them from `.mri/api-tests/`
7. Save all results to `.mri/runs/{timestamp}/`
8. If tests failed and `max_iterations > 0`, enter the fix loop:
   a. Build fix prompt with: test failures + visual diffs + AI analysis + prior attempts
   b. Spawn a visual-fixer agent
   c. Re-run tests
   d. Loop until: all pass, max iterations, or circuit breaker trips
9. Print summary

### Visual Scan (`/mri visual`)

Same as full scan but skips the fix loop. Captures screenshots, compares against baselines, runs AI analysis.

### Backend Tests (`/mri api`)

Reads YAML test definitions from `.mri/api-tests/` and executes them:

```yaml
name: "Dashboard API"
tests:
  - name: "Engine status endpoint"
    method: GET
    path: /api/engine/status
    expect:
      status: 200
      body:
        has_keys: ["status"]
      response_time_ms: 5000
```

### Test Plan Generation (`/mri plan`)

Analyzes the entire project to generate a comprehensive, context-aware Playwright test plan.

1. Load config from `.mri.yaml`, resolve project root
2. Spawn the `test-architect` agent with context:
   - Project root path and scope patterns
   - Existing test coverage summary
   - Historical failure/flake data from prior MRI runs
   - `test_architect` config section (focus areas, context sources)
3. Agent mines context and writes:
   - `.mri/test-plan.spec.ts` — executable Playwright test file with inline reasoning
   - `.mri/test-plan.json` — structured metadata for dashboard display
4. Verify the spec is syntactically valid: `npx playwright test .mri/test-plan.spec.ts --list`
5. Register this project in `~/.mri/projects.json` (global registry for dashboard cross-project access)
6. Print summary: "Generated N tests across M categories. Run `/mri run` to execute."

The `--update` flag re-generates incorporating:
- New git commits since last generation
- Latest MRI run results (new failures, resolved issues)
- Any `.mri/test-notes/*.md` additions

## Config (`.mri.yaml`)

```yaml
test_command: "npx playwright test"
test_output: "json"
max_iterations: 5
scope:
  - "src/**/*.ts"
  - "src/**/*.tsx"
exclude:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "node_modules/**"

visual:
  enabled: true
  threshold: 0.1

ai:
  enabled: true
  model: "claude-sonnet-4-6"
  analyze_visual_diffs: true

api_tests:
  enabled: true
  base_url: "http://localhost:8787"
  test_dir: ".mri/api-tests"
```

## Data Storage

All results persist to `.mri/` for dashboard consumption:

```
.mri/
  baselines/{test-slug}/default.png     # Golden screenshots
  runs/{timestamp}/
    summary.json                         # Run overview
    convergence.json                     # Iteration convergence data
    iteration-{n}.json                   # Per-iteration detail
    visual-diffs.json                    # Visual comparison results
    ai-analyses.json                     # Claude's screenshot analysis
    api-results.json                     # Backend test results
    screenshots/                         # Captured screenshots
    diffs/                               # Diff overlay images
    videos/                              # Test recordings
  api-tests/*.yaml                       # Backend test definitions
```

## Step-by-Step Execution

### Step 1: Load Config
Read `.mri.yaml`. If missing, suggest running `/mri init`.

### Step 2: Run Tests
Execute the `test_command` and parse output based on `test_output` format.

### Step 3: Collect Artifacts
Gather screenshots, videos, and traces from the test output directory.

### Step 4: Visual Comparison
For each screenshot, compare against the baseline using pixel diffing. Classify results as `match`, `mismatch`, `new`, or `missing_baseline`.

### Step 5: AI Analysis (if enabled)
Send mismatched and new screenshots to Claude. Ask for:
- Plain-English description of what the screenshot shows
- List of visual changes between baseline and actual
- Risk assessment (low/medium/high)
- Suggested fixes

### Step 6: Backend Tests (if enabled)
Execute API test definitions from `.mri/api-tests/`. Record status codes, response times, payload validation.

### Step 7: Save Results
Write all data to `.mri/runs/{timestamp}/`.

### Step 8: Fix Loop (if failures exist and iterations > 0)
Enter the test-swarm autonomous fix loop with enhanced context that includes visual diff descriptions and AI analysis.

### Step 9: Report
Print summary: tests passed/failed, visual diffs found, AI risk assessment, backend test results.
