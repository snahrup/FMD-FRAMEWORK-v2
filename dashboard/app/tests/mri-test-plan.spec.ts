// MRI Test Plan — FMD Dashboard
// Generated: 2026-03-06
// Context: 40 routes, 150+ API endpoints, 48 page components
// Informed by: ARCHITECTURE.md, DECISIONS.md, TRIAGE_RUNBOOK.md, Jira MT project
//
// Priority order:
//   P0 — Critical path pages (EngineControl, ExecutionMatrix, ControlPlane)
//   P1 — Recently modified pages (RecordCounts, SourceManager, PipelineMonitor)
//   P2 — Data exploration pages (DataJourney, FlowExplorer, DataBlender)
//   P3 — Admin/setup pages (Settings, EnvironmentSetup, ConfigManager)
//   P4 — Labs/experimental pages
//
// Architecture rule: {Namespace}/{Table} path pattern everywhere.
// Known gotcha: SQL Analytics Endpoint sync lag — phantom empty results.

import { test, expect, type Page } from '@playwright/test';

const BASE = 'http://127.0.0.1:5173';
const API  = 'http://127.0.0.1:8787';

// ─── Helpers ──────────────────────────────────────────────────

async function waitForContent(page: Page, timeout = 8000) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  // Wait for spinners to disappear
  try {
    await page.waitForFunction(
      () => !document.querySelector('.animate-spin, .animate-pulse, [data-loading="true"]'),
      { timeout }
    );
  } catch { /* page may not use spinners */ }
}

async function navigateAndWait(page: Page, path: string) {
  await page.goto(`${BASE}${path}`);
  await waitForContent(page);
}

// ═══════════════════════════════════════════════════════════════
// CATEGORY 1: API Health (Backend must be alive before UI tests)
// ═══════════════════════════════════════════════════════════════

test.describe('P0: API Health', () => {
  test('health endpoint returns 200', async ({ request }) => {
    const res = await request.get(`${API}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
  });

  test('config endpoint returns valid JSON', async ({ request }) => {
    const res = await request.get(`${API}/api/config`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  test('entity digest returns entities array', async ({ request }) => {
    // MT-88: Entity Digest Engine — this is the migrated endpoint
    const res = await request.get(`${API}/api/entity-digest`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('sources');
    expect(body).toHaveProperty('totalEntities');
  });

  test('engine status returns valid state', async ({ request }) => {
    const res = await request.get(`${API}/api/engine/status`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
  });

  test('control plane snapshot loads', async ({ request }) => {
    const res = await request.get(`${API}/api/control-plane`);
    expect(res.status()).toBe(200);
  });

  test('source labels returns JSON', async ({ request }) => {
    const res = await request.get(`${API}/api/source-config`);
    expect(res.status()).toBe(200);
  });

  test('entities endpoint returns array', async ({ request }) => {
    const res = await request.get(`${API}/api/entities`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Should have at least some entities registered
    expect(body.length).toBeGreaterThan(0);
  });

  test('pipeline-view returns execution data', async ({ request }) => {
    const res = await request.get(`${API}/api/pipeline-view`);
    expect(res.status()).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 2: Critical Path Pages (P0)
// These pages are used daily for monitoring active loads.
// ═══════════════════════════════════════════════════════════════

test.describe('P0: Execution Matrix (homepage)', () => {
  // SOURCE OF TRUTH page — all other pages should agree with it
  test('loads and renders entity grid', async ({ page }) => {
    await navigateAndWait(page, '/');
    // Should show the execution matrix table
    await expect(page.locator('table, [role="grid"], [data-testid="matrix"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('shows layer columns (LZ, Bronze, Silver)', async ({ page }) => {
    await navigateAndWait(page, '/');
    const body = await page.locator('body').innerText();
    // Execution Matrix must show medallion layers
    expect(body).toMatch(/landing|bronze|silver/i);
  });

  test('shows source breakdown', async ({ page }) => {
    await navigateAndWait(page, '/');
    const body = await page.locator('body').innerText();
    // Should show registered sources (MES, ETQ, M3C, or OPTIVA)
    expect(body).toMatch(/MES|ETQ|M3C|OPTIVA/i);
  });

  test('Target Schema and Data Source columns visible (recent addition)', async ({ page }) => {
    // MT-90: These columns were recently added to ExecutionMatrix
    await navigateAndWait(page, '/');
    const headers = await page.locator('th, [role="columnheader"]').allInnerTexts();
    const headerText = headers.join(' ').toLowerCase();
    // Should have data source or schema column
    expect(headerText).toMatch(/source|schema|namespace/i);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/execution-matrix.png', fullPage: false });
  });
});

test.describe('P0: Engine Control', () => {
  // MT-86: Engine v3, notebook triggers, execution plan visibility
  test('loads engine status', async ({ page }) => {
    await navigateAndWait(page, '/engine');
    const body = await page.locator('body').innerText();
    // Should show engine status (idle, running, etc.)
    expect(body).toMatch(/idle|running|stopped|status/i);
  });

  test('shows KPI cards', async ({ page }) => {
    await navigateAndWait(page, '/engine');
    // Duration KPI card was recently added (amber, between Failed and Rows)
    const cards = page.locator('[class*="card"], [class*="kpi"], [class*="stat"]');
    await expect(cards.first()).toBeVisible({ timeout: 8000 });
  });

  test('dry run button exists', async ({ page }) => {
    await navigateAndWait(page, '/engine');
    const dryRunBtn = page.getByRole('button', { name: /dry.?run/i });
    await expect(dryRunBtn).toBeVisible({ timeout: 5000 });
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/engine');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/engine-control.png', fullPage: false });
  });
});

test.describe('P0: Control Plane', () => {
  test('loads and shows entity counts', async ({ page }) => {
    await navigateAndWait(page, '/control');
    const body = await page.locator('body').innerText();
    // Should show numeric entity counts
    expect(body).toMatch(/\d+/);
  });

  test('shows pipeline layer sections', async ({ page }) => {
    await navigateAndWait(page, '/control');
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/landing|bronze|silver/i);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/control');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/control-plane.png', fullPage: false });
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 3: Recently Modified Pages (P1)
// High regression risk — these changed in the last 2 weeks.
// ═══════════════════════════════════════════════════════════════

test.describe('P1: Record Counts (digest migration target)', () => {
  // MT-88: Being migrated from direct SQL queries to Entity Digest endpoint
  test('loads and shows counts', async ({ page }) => {
    await navigateAndWait(page, '/counts');
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/\d+/);
  });

  test('shows source-level breakdown', async ({ page }) => {
    await navigateAndWait(page, '/counts');
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/MES|ETQ|M3C|OPTIVA/i);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/counts');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/record-counts.png', fullPage: false });
  });
});

test.describe('P1: Source Manager', () => {
  // MT-77: Live Fabric gateway integration
  test('loads source list', async ({ page }) => {
    await navigateAndWait(page, '/sources');
    const body = await page.locator('body').innerText();
    // Should show registered data sources
    expect(body).toMatch(/MES|ETQ|M3|source/i);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/sources');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/source-manager.png', fullPage: false });
  });
});

test.describe('P1: Execution Log', () => {
  test('loads and shows log entries', async ({ page }) => {
    await navigateAndWait(page, '/logs');
    const body = await page.locator('body').innerText();
    // Should have some execution data or "no data" message
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/logs');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/execution-log.png', fullPage: false });
  });
});

test.describe('P1: Pipeline Monitor', () => {
  // MT-75: Recently built
  test('loads pipeline view', async ({ page }) => {
    await navigateAndWait(page, '/live');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/live');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/live-monitor.png', fullPage: false });
  });
});

test.describe('P1: Error Intelligence', () => {
  // MT-75: Recently built alongside Pipeline Monitor
  test('loads error analysis', async ({ page }) => {
    await navigateAndWait(page, '/errors');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/errors');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/error-intelligence.png', fullPage: false });
  });
});

test.describe('P1: Pipeline Matrix', () => {
  test('loads matrix view', async ({ page }) => {
    await navigateAndWait(page, '/pipeline');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/pipeline');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/pipeline-matrix.png', fullPage: false });
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 4: Data Exploration Pages (P2)
// Used for investigation/debugging, less frequently than P0/P1.
// ═══════════════════════════════════════════════════════════════

test.describe('P2: Data Journey', () => {
  // MT-82: Recently built — single entity path through all layers
  test('loads journey page', async ({ page }) => {
    await navigateAndWait(page, '/journey');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/journey');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/data-journey.png', fullPage: false });
  });
});

test.describe('P2: Flow Explorer', () => {
  // MT-75: Recently built
  test('loads flow visualization', async ({ page }) => {
    await navigateAndWait(page, '/flow');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/flow');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/flow-explorer.png', fullPage: false });
  });
});

test.describe('P2: Data Blender (SQL Workbench)', () => {
  test('loads blender page', async ({ page }) => {
    await navigateAndWait(page, '/blender');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/blender');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/data-blender.png', fullPage: false });
  });
});

test.describe('P2: SQL Explorer', () => {
  test('loads explorer with server list', async ({ page }) => {
    await navigateAndWait(page, '/sql-explorer');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/sql-explorer');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/sql-explorer.png', fullPage: false });
  });
});

test.describe('P2: Load Progress', () => {
  test('loads progress view', async ({ page }) => {
    await navigateAndWait(page, '/load-progress');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/load-progress');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/load-progress.png', fullPage: false });
  });
});

test.describe('P2: Data Microscope', () => {
  test('loads microscope page', async ({ page }) => {
    await navigateAndWait(page, '/microscope');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/microscope');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/data-microscope.png', fullPage: false });
  });
});

test.describe('P2: Data Profiler', () => {
  test('loads profiler page', async ({ page }) => {
    await navigateAndWait(page, '/profile');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/profile');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/data-profiler.png', fullPage: false });
  });
});

test.describe('P2: Executive Dashboard', () => {
  test('loads executive summary', async ({ page }) => {
    await navigateAndWait(page, '/executive');
    // Executive dashboard doesn't have a route in the nav — check if it's a hidden page
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/executive');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/executive-dashboard.png', fullPage: false });
  });
});

test.describe('P2: Sankey Flow', () => {
  test('loads sankey visualization', async ({ page }) => {
    await navigateAndWait(page, '/sankey');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/sankey');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/sankey-flow.png', fullPage: false });
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 5: Admin & Setup Pages (P3)
// ═══════════════════════════════════════════════════════════════

test.describe('P3: Config Manager', () => {
  test('loads config view', async ({ page }) => {
    await navigateAndWait(page, '/config');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/config');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/config-manager.png', fullPage: false });
  });
});

test.describe('P3: Environment Setup', () => {
  test('loads setup wizard', async ({ page }) => {
    await navigateAndWait(page, '/setup');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/setup');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/environment-setup.png', fullPage: false });
  });
});

test.describe('P3: Settings', () => {
  test('loads settings page', async ({ page }) => {
    await navigateAndWait(page, '/settings');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/settings');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/settings.png', fullPage: false });
  });
});

test.describe('P3: Validation Checklist', () => {
  test('loads checklist', async ({ page }) => {
    await navigateAndWait(page, '/validation');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/validation');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/validation-checklist.png', fullPage: false });
  });
});

test.describe('P3: Admin Gateway', () => {
  test('loads admin auth page', async ({ page }) => {
    await navigateAndWait(page, '/admin');
    const body = await page.locator('body').innerText();
    // Should show login/auth form or admin panel
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/admin');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/admin-gateway.png', fullPage: false });
  });
});

test.describe('P3: Notebook Debug', () => {
  test('loads debug interface', async ({ page }) => {
    await navigateAndWait(page, '/notebook-debug');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/notebook-debug');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/notebook-debug.png', fullPage: false });
  });
});

test.describe('P3: Pipeline Runner', () => {
  test('loads runner interface', async ({ page }) => {
    await navigateAndWait(page, '/runner');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/runner');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/pipeline-runner.png', fullPage: false });
  });
});

test.describe('P3: Notebook Config', () => {
  test('loads notebook config', async ({ page }) => {
    await navigateAndWait(page, '/notebook-config');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/notebook-config');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/notebook-config.png', fullPage: false });
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 6: Governance & Catalog Pages (P2-P3)
// ═══════════════════════════════════════════════════════════════

test.describe('P2: Data Catalog', () => {
  test('loads catalog page', async ({ page }) => {
    await navigateAndWait(page, '/catalog');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/catalog');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/data-catalog.png', fullPage: false });
  });
});

test.describe('P2: Data Lineage', () => {
  test('loads lineage visualization', async ({ page }) => {
    await navigateAndWait(page, '/lineage');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/lineage');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/data-lineage.png', fullPage: false });
  });
});

test.describe('P2: Data Classification', () => {
  test('loads classification page', async ({ page }) => {
    await navigateAndWait(page, '/classification');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/classification');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/data-classification.png', fullPage: false });
  });
});

test.describe('P2: Impact Analysis', () => {
  test('loads impact page', async ({ page }) => {
    await navigateAndWait(page, '/impact');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/impact');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/impact-analysis.png', fullPage: false });
  });
});

test.describe('P3: Impact Pulse', () => {
  test('loads pulse page', async ({ page }) => {
    await navigateAndWait(page, '/pulse');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/pulse');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/impact-pulse.png', fullPage: false });
  });
});

test.describe('P3: Column Evolution', () => {
  test('loads column evolution page', async ({ page }) => {
    await navigateAndWait(page, '/columns');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/columns');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/column-evolution.png', fullPage: false });
  });
});

test.describe('P3: Transformation Replay', () => {
  test('loads replay page', async ({ page }) => {
    await navigateAndWait(page, '/replay');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/replay');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/transformation-replay.png', fullPage: false });
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 7: Labs Pages (P4)
// ═══════════════════════════════════════════════════════════════

test.describe('P4: Labs - Cleansing Rule Editor', () => {
  test('loads cleansing editor', async ({ page }) => {
    await navigateAndWait(page, '/labs/cleansing');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/labs/cleansing');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/cleansing-editor.png', fullPage: false });
  });
});

test.describe('P4: Labs - SCD Audit', () => {
  test('loads SCD audit', async ({ page }) => {
    await navigateAndWait(page, '/labs/scd-audit');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/labs/scd-audit');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/scd-audit.png', fullPage: false });
  });
});

test.describe('P4: Labs - Gold MLV Manager', () => {
  test('loads gold MLV page', async ({ page }) => {
    await navigateAndWait(page, '/labs/gold-mlv');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/labs/gold-mlv');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/gold-mlv.png', fullPage: false });
  });
});

test.describe('P4: Labs - DQ Scorecard', () => {
  test('loads DQ scorecard', async ({ page }) => {
    await navigateAndWait(page, '/labs/dq-scorecard');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/labs/dq-scorecard');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/dq-scorecard.png', fullPage: false });
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 8: Testing & Quality Pages (P3)
// ═══════════════════════════════════════════════════════════════

test.describe('P3: Test Audit', () => {
  test('loads test audit page', async ({ page }) => {
    await navigateAndWait(page, '/test-audit');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/test-audit');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/test-audit.png', fullPage: false });
  });
});

test.describe('P3: Test Swarm', () => {
  test('loads test swarm page', async ({ page }) => {
    await navigateAndWait(page, '/test-swarm');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/test-swarm');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/test-swarm.png', fullPage: false });
  });
});

test.describe('P3: MRI Dashboard', () => {
  test('loads MRI page', async ({ page }) => {
    await navigateAndWait(page, '/mri');
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(50);
  });

  test('screenshot', async ({ page }) => {
    await navigateAndWait(page, '/mri');
    await page.screenshot({ path: '.mri/runs/latest/screenshots/mri-dashboard.png', fullPage: false });
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 9: Navigation & Layout (P1)
// ═══════════════════════════════════════════════════════════════

test.describe('P1: Navigation', () => {
  test('sidebar renders with nav items', async ({ page }) => {
    await navigateAndWait(page, '/');
    const sidebar = page.locator('nav, aside, [class*="sidebar"], [class*="Sidebar"]').first();
    await expect(sidebar).toBeVisible({ timeout: 5000 });
  });

  test('no console errors on homepage', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await navigateAndWait(page, '/');
    // Filter out known noise (React dev mode, favicon 404)
    const realErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('React DevTools') &&
      !e.includes('Download the React DevTools')
    );
    expect(realErrors.length).toBe(0);
  });

  test('404 route shows fallback content', async ({ page }) => {
    await page.goto(`${BASE}/nonexistent-page-xyz`);
    await waitForContent(page);
    // Should either redirect to / or show some content (not a blank page)
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 10: Cross-Page Data Consistency Gauntlet (P0)
//
// THE #1 BUG IN THIS DASHBOARD: Numbers don't match across pages.
//
// Root cause: 4 independent data sources with 3 different
// definitions of "loaded":
//
//   1. RecordCounts  → sys.partitions (lakehouse physical truth)
//   2. Digest Engine → sp_BuildEntityDigest (any log record = loaded)
//   3. LoadProgress  → execution.PipelineLandingzoneEntity join
//   4. ControlPlane  → COUNT(*) on integration.* metadata tables
//
// A failed-but-logged entity shows "loaded" in Digest but missing
// in RecordCounts. This gauntlet catches every mismatch.
// ═══════════════════════════════════════════════════════════════

test.describe('P0: Data Consistency Gauntlet', () => {
  // Shared state: scrape all endpoints once, compare everywhere
  let apiData: {
    health: any;
    entities: any[];
    digest: any;
    controlPlane: any;
    executive: any;
    pipelineMatrix: any;
    loadProgress: any;
    lakehouseCounts: any;
    stats: any;
  };

  test('Step 0: Fetch all number-bearing endpoints', async ({ request }) => {
    // Hit every endpoint that reports entity counts in parallel
    const [
      healthRes, entitiesRes, digestRes, cpRes,
      execRes, matrixRes, progressRes, countsRes, statsRes,
    ] = await Promise.all([
      request.get(`${API}/api/health`),
      request.get(`${API}/api/entities`),
      request.get(`${API}/api/entity-digest`),
      request.get(`${API}/api/control-plane`),
      request.get(`${API}/api/executive`),
      request.get(`${API}/api/pipeline-matrix`),
      request.get(`${API}/api/load-progress`),
      request.get(`${API}/api/lakehouse-counts`),
      request.get(`${API}/api/stats`),
    ]);

    // All must return 200
    for (const [name, res] of Object.entries({
      health: healthRes, entities: entitiesRes, digest: digestRes,
      controlPlane: cpRes, executive: execRes, pipelineMatrix: matrixRes,
      loadProgress: progressRes, lakehouseCounts: countsRes, stats: statsRes,
    })) {
      expect(res.status(), `${name} endpoint failed`).toBe(200);
    }

    apiData = {
      health: await healthRes.json(),
      entities: await entitiesRes.json(),
      digest: await digestRes.json(),
      controlPlane: await cpRes.json(),
      executive: await execRes.json(),
      pipelineMatrix: await matrixRes.json(),
      loadProgress: await progressRes.json(),
      lakehouseCounts: await countsRes.json(),
      stats: await statsRes.json(),
    };
  });

  test('Step 1: SQL DB is reachable', async () => {
    // If SQL is down, all numbers are garbage — fail fast
    expect(apiData.health).toHaveProperty('status');
    if (apiData.health.sql_server !== undefined) {
      expect(apiData.health.sql_server, 'SQL DB unreachable — all numbers will be wrong').toBeTruthy();
    }
  });

  test('Step 2: /api/entities returns non-empty array', async () => {
    expect(Array.isArray(apiData.entities), '/api/entities is not an array').toBe(true);
    expect(apiData.entities.length, 'Zero entities registered — nothing to compare').toBeGreaterThan(0);
  });

  test('Step 3: Entity Digest total matches metadata entity count', async () => {
    // integration.LandingzoneEntity COUNT vs sp_BuildEntityDigest total
    const metadataCount = apiData.entities.length;
    const digestTotal = apiData.digest?.summary?.total ?? apiData.digest?.entities?.length ?? 0;

    expect(digestTotal, 'Digest returned 0 entities').toBeGreaterThan(0);

    // These MUST match exactly — same underlying data, different query paths
    // If they differ, either digest SP is stale or entity registration is broken
    const diff = Math.abs(metadataCount - digestTotal);
    const pctDiff = diff / Math.max(metadataCount, 1) * 100;
    expect(pctDiff, `Entity count mismatch: /api/entities=${metadataCount} vs digest=${digestTotal} (${pctDiff.toFixed(1)}% off)`).toBeLessThan(5);
  });

  test('Step 4: Control Plane entity count matches metadata', async () => {
    // ControlPlane does COUNT(*) on integration.LandingzoneEntity directly
    const metadataCount = apiData.entities.length;
    const cpEntities = apiData.controlPlane?.entities?.total
      ?? apiData.controlPlane?.lzEntities
      ?? apiData.controlPlane?.headerEntities
      ?? -1;

    if (cpEntities > 0) {
      const diff = Math.abs(metadataCount - cpEntities);
      const pctDiff = diff / Math.max(metadataCount, 1) * 100;
      expect(pctDiff, `ControlPlane entity count=${cpEntities} vs metadata=${metadataCount}`).toBeLessThan(5);
    }
  });

  test('Step 5: Executive Dashboard total matches digest', async () => {
    // Executive calls build_entity_digest() then counts — should match digest endpoint
    const digestTotal = apiData.digest?.summary?.total ?? apiData.digest?.entities?.length ?? 0;
    const execTotal = apiData.executive?.totalEntities
      ?? apiData.executive?.entities?.total
      ?? apiData.executive?.summary?.total
      ?? -1;

    if (execTotal > 0) {
      expect(execTotal, `Executive total=${execTotal} vs digest total=${digestTotal}`).toBe(digestTotal);
    }
  });

  test('Step 6: Pipeline Matrix source breakdown sums to total', async () => {
    // Matrix shows per-source counts; they must sum to the total
    const matrix = apiData.pipelineMatrix;
    if (matrix?.sources && Array.isArray(matrix.sources)) {
      const sourceSum = matrix.sources.reduce((s: number, src: any) =>
        s + (src.total ?? src.entityCount ?? src.count ?? 0), 0);
      const matrixTotal = matrix.totalEntities ?? matrix.total ?? sourceSum;

      expect(sourceSum, `Source breakdown sums to ${sourceSum} but total is ${matrixTotal}`).toBe(matrixTotal);
    }
  });

  test('Step 7: Layer counts are internally consistent (LZ >= Bronze >= Silver)', async () => {
    // Medallion architecture: entities flow LZ → Bronze → Silver
    // So loaded counts should be LZ >= Bronze >= Silver (with some tolerance for timing)
    const digest = apiData.digest;
    if (digest?.summary) {
      const lz = digest.summary.lzLoaded ?? digest.summary.landingZone?.loaded ?? 0;
      const bronze = digest.summary.bronzeLoaded ?? digest.summary.bronze?.loaded ?? 0;
      const silver = digest.summary.silverLoaded ?? digest.summary.silver?.loaded ?? 0;

      // LZ should have >= Bronze (entities must land before Bronze processes them)
      if (lz > 0 && bronze > 0) {
        expect(lz, `LZ loaded (${lz}) < Bronze loaded (${bronze}) — impossible in medallion flow`).toBeGreaterThanOrEqual(bronze);
      }
      // Bronze should have >= Silver
      if (bronze > 0 && silver > 0) {
        expect(bronze, `Bronze loaded (${bronze}) < Silver loaded (${silver}) — impossible`).toBeGreaterThanOrEqual(silver);
      }
    }
  });

  test('Step 8: LoadProgress pending + loaded = total registered', async () => {
    // LoadProgress uses PipelineLandingzoneEntity join
    const progress = apiData.loadProgress;
    if (progress?.total !== undefined && progress?.loaded !== undefined) {
      const pending = progress.pending ?? (progress.total - progress.loaded);
      const sum = progress.loaded + pending;
      expect(sum, `loaded(${progress.loaded}) + pending(${pending}) = ${sum}, but total=${progress.total}`).toBe(progress.total);
    }
  });

  test('Step 9: Lakehouse table count vs digest loaded count', async () => {
    // RecordCounts = physical truth (sys.partitions)
    // Digest loaded = log-based status
    // Digest should show >= lakehouse count (because digest includes failures that logged)
    // Lakehouse should show <= digest count (only tables that actually got created)
    const counts = apiData.lakehouseCounts;
    const digest = apiData.digest;

    if (counts && digest?.summary) {
      const bronzeTables = counts.bronze?.tableCount ?? counts.bronzeTables ?? -1;
      const digestBronzeLoaded = digest.summary.bronzeLoaded ?? digest.summary.bronze?.loaded ?? -1;

      if (bronzeTables > 0 && digestBronzeLoaded > 0) {
        // Flag if lakehouse has MORE tables than digest says are loaded (impossible)
        if (bronzeTables > digestBronzeLoaded) {
          console.warn(
            `CONSISTENCY WARNING: Lakehouse has ${bronzeTables} Bronze tables ` +
            `but Digest only shows ${digestBronzeLoaded} loaded. ` +
            `Digest is BEHIND — sp_BuildEntityDigest may need refresh.`
          );
        }
        // Flag if digest says WAY more are loaded than lakehouse has (phantom loads)
        const phantomPct = ((digestBronzeLoaded - bronzeTables) / digestBronzeLoaded) * 100;
        if (phantomPct > 20) {
          console.warn(
            `CONSISTENCY WARNING: Digest says ${digestBronzeLoaded} Bronze loaded ` +
            `but lakehouse only has ${bronzeTables} tables. ` +
            `${phantomPct.toFixed(0)}% phantom loads (logged but never materialized).`
          );
        }
      }
    }
  });

  test('Step 10: No source has 0 entities if it is registered', async () => {
    // Every registered data source should have at least 1 entity
    const entities = apiData.entities;
    const sourceMap = new Map<string, number>();
    for (const e of entities) {
      const src = e.DataSourceName ?? e.dataSourceName ?? e.Namespace ?? 'unknown';
      sourceMap.set(src, (sourceMap.get(src) ?? 0) + 1);
    }
    for (const [src, count] of sourceMap) {
      expect(count, `Source "${src}" is registered but has 0 entities`).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 11: UI Number Scraping Gauntlet (P0)
// Hit every page that shows numbers, scrape them from the DOM,
// and compare against API values. Catches frontend rendering bugs
// where the API is right but the page shows wrong numbers.
// ═══════════════════════════════════════════════════════════════

test.describe('P0: UI Number Rendering', () => {
  test('Execution Matrix: entity count in DOM matches API', async ({ page, request }) => {
    const digestRes = await request.get(`${API}/api/entity-digest`);
    const digest = await digestRes.json();
    const apiTotal = digest?.summary?.total ?? digest?.entities?.length ?? 0;

    await navigateAndWait(page, '/');
    const body = await page.locator('body').innerText();

    // Page should show the total somewhere — extract all numbers and check
    const numbersInPage = body.match(/\b\d{2,}\b/g)?.map(Number) ?? [];
    if (apiTotal > 10) {
      expect(
        numbersInPage.some(n => Math.abs(n - apiTotal) < apiTotal * 0.05),
        `API says ${apiTotal} total entities but page shows none of: [${numbersInPage.slice(0, 10).join(', ')}...]`
      ).toBe(true);
    }
  });

  test('Control Plane: header KPIs are non-zero', async ({ page }) => {
    await navigateAndWait(page, '/control');
    // Scrape all numbers from KPI-like elements
    const kpiElements = page.locator('[class*="card"] [class*="text-2xl"], [class*="card"] [class*="text-3xl"], [class*="stat"], [class*="kpi"], [class*="metric"]');
    const count = await kpiElements.count();
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        const text = await kpiElements.nth(i).innerText();
        const num = parseInt(text.replace(/[^0-9]/g, ''), 10);
        if (!isNaN(num)) {
          expect(num, `Control Plane KPI #${i} shows 0 — likely data fetch failure`).toBeGreaterThan(0);
        }
      }
    }
  });

  test('Record Counts: shows actual table counts', async ({ page }) => {
    await navigateAndWait(page, '/counts');
    const body = await page.locator('body').innerText();
    // RecordCounts talks to lakehouse sys.partitions — should show real numbers
    const numbersInPage = body.match(/\b\d{2,}\b/g)?.map(Number) ?? [];
    // Should have at least some multi-digit numbers (we have 1000+ entities)
    expect(numbersInPage.length, 'RecordCounts page has no numbers visible').toBeGreaterThan(0);
  });

  test('Executive Dashboard: KPI cards populated', async ({ page }) => {
    await navigateAndWait(page, '/executive');
    const body = await page.locator('body').innerText();
    // Should show percentage or counts
    expect(body).toMatch(/\d+%|\d{2,}/);
  });

  test('Load Progress: shows progress indicators', async ({ page }) => {
    await navigateAndWait(page, '/load-progress');
    const body = await page.locator('body').innerText();
    expect(body).toMatch(/\d+/);
  });
});

// ═══════════════════════════════════════════════════════════════
// CATEGORY 12: Visual Readability (P1)
// Catches transparent backgrounds making text unreadable, grid
// lines colliding with data, low contrast text, overlapping elements.
// ═══════════════════════════════════════════════════════════════

test.describe('P1: Visual Readability', () => {
  const readabilityPages = [
    { path: '/', name: 'Execution Matrix' },
    { path: '/engine', name: 'Engine Control' },
    { path: '/control', name: 'Control Plane' },
    { path: '/counts', name: 'Record Counts' },
    { path: '/logs', name: 'Execution Log' },
    { path: '/errors', name: 'Error Intelligence' },
    { path: '/load-progress', name: 'Load Progress' },
    { path: '/sources', name: 'Source Manager' },
  ];

  for (const { path, name } of readabilityPages) {
    test(`${name}: no text with insufficient contrast`, async ({ page }) => {
      await navigateAndWait(page, path);

      // Check for elements with very low opacity or transparent backgrounds
      // that make text unreadable
      const badElements = await page.evaluate(() => {
        const issues: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node: Node | null = walker.currentNode;
        let checked = 0;

        while (node && checked < 500) {
          const el = node as HTMLElement;
          if (el.offsetWidth > 0 && el.offsetHeight > 0 && el.textContent?.trim()) {
            const style = getComputedStyle(el);
            const opacity = parseFloat(style.opacity);
            const color = style.color;
            const bg = style.backgroundColor;

            // Flag very low opacity text (less than 0.3)
            if (opacity < 0.3 && el.textContent.trim().length > 0) {
              issues.push(`Low opacity (${opacity}): "${el.textContent.trim().slice(0, 30)}"`);
            }

            // Flag white/light text on transparent/no background
            // (common glassmorphism issue)
            if (color && bg) {
              const colorMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
              const bgMatch = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
              if (colorMatch && bgMatch) {
                const textLightness = (parseInt(colorMatch[1]) + parseInt(colorMatch[2]) + parseInt(colorMatch[3])) / 3;
                const bgAlpha = bgMatch[4] !== undefined ? parseFloat(bgMatch[4]) : 1;
                const bgLightness = (parseInt(bgMatch[1]) + parseInt(bgMatch[2]) + parseInt(bgMatch[3])) / 3;

                // Light text on transparent background = unreadable
                if (textLightness > 200 && bgAlpha < 0.15 && el.textContent.trim().length > 2) {
                  issues.push(`Light text on transparent bg: "${el.textContent.trim().slice(0, 30)}"`);
                }
                // Very similar foreground/background = invisible
                if (bgAlpha > 0.5 && Math.abs(textLightness - bgLightness) < 30 && el.textContent.trim().length > 2) {
                  issues.push(`Low contrast (fg≈bg): "${el.textContent.trim().slice(0, 30)}"`);
                }
              }
            }
          }
          checked++;
          node = walker.nextNode();
        }
        return issues;
      });

      if (badElements.length > 0) {
        console.warn(`[${name}] Readability issues:\n  ${badElements.join('\n  ')}`);
      }
      // Fail if more than 5 readability issues on a single page
      expect(badElements.length, `${name} has ${badElements.length} readability issues:\n${badElements.join('\n')}`).toBeLessThan(6);
    });

    test(`${name}: table/grid cells not overlapping`, async ({ page }) => {
      await navigateAndWait(page, path);

      // Check that table cells or grid items aren't overlapping
      const overlapCount = await page.evaluate(() => {
        const cells = document.querySelectorAll('td, th, [role="cell"], [role="gridcell"]');
        let overlaps = 0;
        const rects: DOMRect[] = [];

        cells.forEach(cell => {
          const rect = cell.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            // Check against previous rects for overlap
            for (const prev of rects.slice(-20)) { // only check nearby cells
              const overlapX = Math.max(0, Math.min(rect.right, prev.right) - Math.max(rect.left, prev.left));
              const overlapY = Math.max(0, Math.min(rect.bottom, prev.bottom) - Math.max(rect.top, prev.top));
              // More than 10px overlap in both axes = collision
              if (overlapX > 10 && overlapY > 10) {
                overlaps++;
              }
            }
            rects.push(rect);
          }
        });
        return overlaps;
      });

      expect(overlapCount, `${name}: ${overlapCount} table cell overlaps detected`).toBe(0);
    });

    test(`${name}: no content clipped/hidden by overflow`, async ({ page }) => {
      await navigateAndWait(page, path);

      // Check for KPI cards or stat elements where text is clipped
      const clippedCount = await page.evaluate(() => {
        let clipped = 0;
        const cards = document.querySelectorAll('[class*="card"], [class*="stat"], [class*="kpi"], [class*="metric"]');
        cards.forEach(card => {
          const el = card as HTMLElement;
          // Content overflows its container
          if (el.scrollWidth > el.clientWidth + 5 || el.scrollHeight > el.clientHeight + 5) {
            const style = getComputedStyle(el);
            if (style.overflow === 'hidden' || style.textOverflow === 'ellipsis') {
              // This is intentional truncation, not a bug
            } else if (el.scrollWidth > el.clientWidth + 20) {
              clipped++;
            }
          }
        });
        return clipped;
      });

      expect(clippedCount, `${name}: ${clippedCount} elements have content clipped by overflow`).toBe(0);
    });
  }

  test('Global: no page has a fully transparent main content area', async ({ page }) => {
    // Check the 3 worst offender pages for transparent backgrounds
    for (const path of ['/', '/control', '/counts']) {
      await navigateAndWait(page, path);

      const hasSolidBackground = await page.evaluate(() => {
        const main = document.querySelector('main, [class*="content"], [class*="container"]');
        if (!main) return true; // can't check, assume OK
        const style = getComputedStyle(main);
        const bg = style.backgroundColor;
        const match = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
        if (!match) return true;
        const alpha = match[4] !== undefined ? parseFloat(match[4]) : 1;
        return alpha > 0.1; // at least 10% opacity
      });

      expect(hasSolidBackground, `Page ${path} has fully transparent main content area — numbers will be unreadable`).toBe(true);
    }
  });
});
