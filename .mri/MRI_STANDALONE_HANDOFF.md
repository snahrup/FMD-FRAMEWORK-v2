# MRI Standalone Repo — Handoff Document

## Mission

Extract MRI (Machine Regression Intelligence) from FMD_FRAMEWORK into its own standalone GitHub repo with a proper, beautiful dashboard frontend. The standalone version must:

1. Work as a **portable visual testing platform** for ANY project (not just FMD)
2. Have its own Vite + React frontend with a **killer UI** designed via `ui-ux-pro-max` skill
3. Include the Claude Code plugin (skills, agents, hooks)
4. Include its own lightweight Python server
5. NOT break FMD_FRAMEWORK in any way

---

## What Exists Today

### Plugin (copy verbatim)

**Location**: `~/.claude/plugins/mri/`

| File | Purpose | Lines |
|------|---------|-------|
| `plugin.json` | Plugin manifest | ~20 |
| `tsconfig.json` | TS config (ES2022, bundler resolution) | ~15 |
| `package.json` | Dev deps: @types/node, typescript | ~12 |
| `lib/types.ts` | ALL TypeScript interfaces | ~120 |
| `lib/config.ts` | YAML config loader (zero-dep, reads `.mri.yaml`) | ~100 |
| `lib/baseline-store.ts` | CRUD for `.mri/baselines/{testSlug}/{viewport}.png` | ~80 |
| `lib/mri-run-store.ts` | Run storage, subdirs for screenshots/diffs/videos | ~90 |
| `lib/screenshot-capture.ts` | Collects screenshots from Playwright test-results | ~60 |
| `lib/image-diff.ts` | pixelmatch wrapper + pure-JS pngjs fallback | ~150 |
| `lib/visual-engine.ts` | Orchestrates capture → diff → compare | ~100 |
| `lib/baseline-manager.ts` | Accept/reject with history tracking | ~80 |
| `lib/flake-detector.ts` | Run tests N times, identify unstable results | ~70 |
| `lib/ai-analyzer.ts` | Sends screenshots to Claude vision, gets structured analysis | ~120 |
| `lib/analysis-cache.ts` | SHA-256 content-keyed cache, 24hr TTL | ~60 |
| `lib/api-test-runner.ts` | YAML-based REST API test execution | ~130 |
| `lib/reporter.ts` | HTML/JSON/Markdown report generation | ~220 |
| `lib/webhook.ts` | POST run results to configurable URL | ~90 |
| `lib/cli-output.ts` | ANSI-colored terminal output | ~120 |
| `lib/externals.d.ts` | Type declarations for optional sharp/pixelmatch | ~20 |
| `skills/mri.md` | `/mri` slash command (run, visual, api, baseline, report, status) | ~50 |
| `agents/visual-fixer.md` | Agent that fixes visual regressions with screenshot context | ~40 |
| `hooks/post-visual-test.js` | PostToolUse hook for Playwright capture | ~30 |

### Dashboard Components (extract + adapt)

**Location**: `~/CascadeProjects/FMD_FRAMEWORK/dashboard/app/src/`

| File | Purpose | Lines |
|------|---------|-------|
| `hooks/useMRI.ts` | Data-fetching hook, 15s poll, scanning state with page-nav recovery | ~320 |
| `pages/MRI.tsx` | Main page, 5-tab layout, full-screen scanning overlay | ~300 |
| `components/mri/UnifiedKPIRow.tsx` | 6-card KPI strip | ~100 |
| `components/mri/VisualDiffViewer.tsx` | 3 viewing modes (side-by-side, slider, onion skin) | ~180 |
| `components/mri/ScreenshotGallery.tsx` | Filterable grid with status/AI badges | ~130 |
| `components/mri/BackendTestPanel.tsx` | API results table + response time chart | ~120 |
| `components/mri/AIAnnotationCard.tsx` | Risk badges, changes list, suggestions | ~100 |
| `components/mri/BaselineManager.tsx` | Accept/reject workflow, bulk actions | ~110 |
| `components/mri/FlakeGraph.tsx` | Pass rate bar chart | ~80 |
| `components/mri/CoverageHeatmap.tsx` | E2E/visual/API coverage grid | ~100 |
| `components/mri/CrossBranchCompare.tsx` | Run history table + stacked area trend chart | ~170 |

### Server Endpoints (extract + standalone)

**Location**: `~/CascadeProjects/FMD_FRAMEWORK/dashboard/app/api/server.py`

The MRI endpoints are embedded in FMD's 10,500+ line server. Extract these functions:

| Function | Endpoint |
|----------|----------|
| `_get_mri_dir()` | Helper |
| `_get_mri_runs_dir()` | Helper |
| `get_mri_runs()` | `GET /api/mri/runs` |
| `get_mri_status()` | `GET /api/mri/status` |
| `get_mri_run_convergence()` | `GET /api/mri/runs/{id}/convergence` |
| `get_mri_run_json()` | `GET /api/mri/runs/{id}` |
| `get_mri_iteration()` | `GET /api/mri/runs/{id}/iteration/{n}` |
| `get_mri_baselines()` | `GET /api/mri/baselines` |
| `mri_accept_baseline()` | `POST /api/mri/baselines/{test}` |
| `mri_accept_all_baselines()` | `POST /api/mri/baselines/accept-all` |
| `mri_serve_artifact()` | `GET /api/mri/artifacts/{path}` |
| `mri_trigger_run()` | `POST /api/mri/run` |
| `mri_trigger_api_tests()` | `POST /api/mri/api-tests/run` |
| `_parse_mri_test_yaml()` | Helper |
| `_run_mri_api_test()` | Helper |

Also extract from do_GET/do_POST: visual-diffs, backend-results, ai-analyses, flake-results sub-routes.

### Config + Data

| Path | Purpose |
|------|---------|
| `.mri/api-tests/dashboard-api.yaml` | 10 API test definitions |
| `.mri/baselines/` | Screenshot baselines directory |
| `.mri/runs/` | Run history (timestamped directories) |

---

## Standalone Repo Structure

```
mri/
├── .claude/
│   └── CLAUDE.md                    # MRI-specific instructions
├── plugin/                          # Claude Code plugin (copy from ~/.claude/plugins/mri/)
│   ├── plugin.json
│   ├── tsconfig.json
│   ├── package.json
│   ├── lib/                         # All .ts files
│   ├── skills/mri.md
│   ├── agents/visual-fixer.md
│   └── hooks/post-visual-test.js
├── dashboard/                       # Standalone React app
│   ├── package.json                 # Vite, React, Tailwind v4, recharts, lucide-react, shadcn/ui
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── index.html
│   └── src/
│       ├── App.tsx                  # Router with MRI as the root page
│       ├── main.tsx
│       ├── index.css                # OKLCH design tokens (or new design system)
│       ├── lib/utils.ts             # cn() helper
│       ├── hooks/useMRI.ts
│       ├── pages/MRI.tsx
│       └── components/
│           ├── ui/                  # shadcn/ui primitives (button, badge, etc.)
│           └── mri/                 # All 9 MRI components
├── server/                          # Standalone Python server
│   ├── server.py                    # Extracted MRI endpoints only (~400 lines)
│   ├── requirements.txt             # stdlib only (no deps)
│   └── start.sh / start.ps1
├── .mri/                            # Config + data
│   ├── api-tests/
│   ├── baselines/
│   └── runs/
├── .mri.yaml                        # Default config
├── package.json                     # Root: scripts for dev, build, serve
└── README.md
```

---

## Critical Design Instructions

### Use `ui-ux-pro-max` Skill

Run the design system generator before building the frontend:

```bash
python3 skills/ui-ux-pro-max/scripts/search.py "developer tools testing dashboard dark" --design-system -p "MRI"
```

The current FMD dashboard uses:
- OKLCH color tokens
- DM Sans font (display) + system-ui (body)
- `backdrop-blur` glass cards
- shadcn/ui primitives
- Tailwind v4

The standalone MRI should have its **own identity** — it's a developer tool, not a data pipeline dashboard. Think:
- Dark-first (dev tools are dark)
- Monospace accents for test names, file paths, timing data
- High-contrast status colors (green/red/amber)
- Terminal/code aesthetic blended with modern dashboard
- The brain/neuroscience theme (MRI = brain scan metaphor)

### Key UI Features to Preserve

1. **Full-screen scanning overlay** — pulsing brain icon, elapsed timer, phase labels, progress dots
2. **VisualDiffViewer 3 modes** — side-by-side, overlay slider (drag to reveal), onion skin
3. **Screenshot gallery** — filterable grid with status badges (match/mismatch/new)
4. **AI annotation cards** — risk level badges, visual changes list, suggested fixes
5. **Baseline accept/reject workflow** — per-test and bulk actions
6. **Cross-branch comparison** — run history table + stacked area chart (recharts)
7. **Response time chart** — horizontal bars for API test results
8. **Flake detection graph** — pass rate bars per test

### Server Requirements

- **Python stdlib only** — no Flask, no FastAPI, just `http.server`
- Same pattern as FMD server but only MRI endpoints
- CORS headers for local dev
- File serving for screenshots/diffs
- Process management for Playwright subprocess
- Stale process cleanup (10 min timeout)
- Thread-safe run state management

---

## Type Interfaces (source of truth)

```typescript
interface VisualDiffResult {
  testName: string;
  baselinePath: string;
  actualPath: string;
  diffPath: string;
  mismatchPixels: number;
  mismatchPercentage: number;
  dimensions: { width: number; height: number };
  status: 'match' | 'mismatch' | 'new' | 'missing_baseline';
}

interface AIAnalysis {
  testName: string;
  screenshotDescription: string;
  visualChanges: string[];
  suggestedFixes: string[];
  riskLevel: 'low' | 'medium' | 'high';
  timestamp: number;
}

interface BackendTestResult {
  name: string;
  endpoint: string;
  method: string;
  status: 'passed' | 'failed' | 'skipped';
  statusCode: number;
  expectedStatusCode: number;
  responseTimeMs: number;
  payloadValid: boolean;
  error?: string;
}

interface FlakeResult {
  testName: string;
  runs: number;
  passed: number;
  failed: number;
  passRate: number;
  isFlaky: boolean;
}

interface MRIRunSummary {
  runId: string;
  status: 'converged' | 'max_iterations' | 'circuit_breaker' | 'in_progress' | 'error';
  startedAt: number;
  completedAt?: number;
  totalDuration: number;
  iterations: number;
  testsBefore: { total: number; passed: number; failed: number };
  testsAfter: { total: number; passed: number; failed: number };
  testsFixed: number;
  visualSummary?: { totalScreenshots: number; mismatches: number; newScreenshots: number; matches: number };
  error?: string;
}

interface MRIConfig {
  test_command: string;
  test_output: string;
  max_iterations: number;
  scope: string[];
  visual: { enabled: boolean; threshold: number; viewport: { width: number; height: number } };
  ai: { enabled: boolean; model: string; analyze_visual_diffs: boolean };
  api_tests: { enabled: boolean; base_url: string; test_dir: string };
  conductor_url: string;
  webhook?: { url: string; headers?: Record<string, string>; events?: string[] };
}
```

---

## What NOT to Copy

- DO NOT copy FMD-specific pages (ControlPlane, ExecutionMatrix, SourceManager, etc.)
- DO NOT copy FMD's server.py wholesale — extract MRI functions only
- DO NOT copy test-swarm components directly (they're lazy-loaded in the Swarm tab — can be a future integration)
- DO NOT copy FMD's `config.json`, `admin_config.json`, etc.
- DO NOT include any Fabric/SQL/pipeline code

---

## Dependencies for Standalone Dashboard

```json
{
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "react-router-dom": "^7",
    "recharts": "^2.15",
    "lucide-react": "^0.468",
    "clsx": "^2.1",
    "tailwind-merge": "^3"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4",
    "vite": "^6",
    "typescript": "^5.7",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "tailwindcss": "^4",
    "@tailwindcss/vite": "^4"
  }
}
```

shadcn/ui components to include: `button`, `badge`, `dialog` (for screenshot zoom), `tooltip`

---

## Nexus Memory Keys

All MRI info is stored in Nexus shared memory under these keys:
- `mri-overview` — High-level summary
- `mri-plugin-files` — Plugin file inventory
- `mri-dashboard-files` — Dashboard file inventory
- `mri-server-endpoints` — All API endpoints
- `mri-architecture` — Architecture decisions
- `mri-standalone-repo-plan` — Standalone plan
- `mri-phase-status` — Build completion status
- `mri-type-interfaces` — TypeScript interfaces
- `mri-existing-infrastructure` — What MRI builds on

Query: `curl -s http://localhost:3777/api/memory/context`

---

## Verification Checklist

After building the standalone repo:

- [ ] `npm run dev` starts Vite + Python server
- [ ] Dashboard loads at localhost with all 5 tabs
- [ ] "Run MRI Scan" triggers Playwright and shows scanning overlay
- [ ] Scanning overlay recovers if user navigates away and returns
- [ ] Screenshots appear in gallery after scan completes
- [ ] Visual diff viewer works in all 3 modes
- [ ] Baseline accept/reject works
- [ ] API tests run and show results
- [ ] History tab shows run trend chart
- [ ] No FMD_FRAMEWORK references in the standalone repo
- [ ] Plugin installs cleanly as a Claude Code plugin
- [ ] `tsc --noEmit` passes on plugin code
- [ ] `npm run build` produces clean production bundle
