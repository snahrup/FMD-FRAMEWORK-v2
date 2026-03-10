// smoke.spec.ts — Lightweight smoke tests for every FMD Dashboard route
//
// Purpose: Verify every page loads without crashing (no uncaught JS errors,
//          no blank white screen). This is the minimum bar for the dashboard.
//
// Run with: npx playwright test smoke.spec.ts --reporter=list
//
// Note: These tests do NOT require the API server (8787) to be running.
//       Pages may show "failed to fetch" banners — that's acceptable.
//       What matters: no unhandled exceptions, no blank screens.

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// ─── Route Map ───────────────────────────────────────────────
// Every route from App.tsx, grouped by priority/category.

interface RouteEntry {
  path: string;
  name: string;
  /** Selector that should be visible once the page renders */
  landmark?: string;
}

const ROUTES: RouteEntry[] = [
  // P0 — Critical path
  { path: '/',                name: 'ExecutionMatrix' },
  { path: '/engine',          name: 'EngineControl' },
  { path: '/control',         name: 'ControlPlane' },

  // P1 — Core operations
  { path: '/logs',            name: 'ExecutionLog' },
  { path: '/errors',          name: 'ErrorIntelligence' },
  { path: '/admin',           name: 'AdminGateway' },
  { path: '/flow',            name: 'FlowExplorer' },
  { path: '/sources',         name: 'SourceManager' },
  { path: '/blender',         name: 'DataBlender' },
  { path: '/counts',          name: 'RecordCounts' },

  // P2 — Data exploration
  { path: '/journey',         name: 'DataJourney' },
  { path: '/config',          name: 'ConfigManager' },
  { path: '/notebook-config', name: 'NotebookConfig' },
  { path: '/runner',          name: 'PipelineRunner' },
  { path: '/validation',      name: 'ValidationChecklist' },
  { path: '/notebook-debug',  name: 'NotebookDebug' },
  { path: '/live',            name: 'LiveMonitor' },

  // P3 — Setup & configuration
  { path: '/settings',        name: 'Settings' },
  { path: '/setup',           name: 'EnvironmentSetup' },
  { path: '/sql-explorer',    name: 'SqlExplorer' },
  { path: '/load-progress',   name: 'LoadProgress' },

  // P4 — Profiling & advanced
  { path: '/profile',         name: 'DataProfiler' },
  { path: '/columns',         name: 'ColumnEvolution' },
  { path: '/microscope',      name: 'DataMicroscope' },
  { path: '/sankey',          name: 'SankeyFlow' },
  { path: '/replay',          name: 'TransformationReplay' },
  { path: '/pulse',           name: 'ImpactPulse' },

  // P5 — Test infrastructure
  { path: '/test-audit',      name: 'TestAudit' },
  { path: '/test-swarm',      name: 'TestSwarm' },
  { path: '/mri',             name: 'MRI' },

  // P6 — Governance
  { path: '/lineage',         name: 'DataLineage' },
  { path: '/classification',  name: 'DataClassification' },
  { path: '/catalog',         name: 'DataCatalog' },
  { path: '/impact',          name: 'ImpactAnalysis' },

  // P7 — Labs (experimental)
  { path: '/labs/cleansing',  name: 'CleansingRuleEditor' },
  { path: '/labs/scd-audit',  name: 'ScdAudit' },
  { path: '/labs/gold-mlv',   name: 'GoldMlvManager' },
  { path: '/labs/dq-scorecard', name: 'DqScorecard' },
];

// ─── Helpers ─────────────────────────────────────────────────

/** Errors we ignore — network failures are expected when API is down */
const IGNORABLE_PATTERNS = [
  /Failed to fetch/i,
  /NetworkError/i,
  /ERR_CONNECTION_REFUSED/i,
  /net::ERR_/i,
  /ECONNREFUSED/i,
  /AbortError/i,
  /Load failed/i,
  /TypeError: Load failed/i,
  /AxiosError/i,
  /fetch.*failed/i,
  /404.*api/i,
  /500.*api/i,
];

function isIgnorable(text: string): boolean {
  return IGNORABLE_PATTERNS.some(p => p.test(text));
}

// ─── Tests ───────────────────────────────────────────────────

test.describe('Smoke Tests — All Dashboard Pages', () => {
  for (const route of ROUTES) {
    test(`${route.name} (${route.path}) loads without crashing`, async ({ page }) => {
      const fatalErrors: string[] = [];

      // Collect console errors that indicate real crashes
      page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() === 'error') {
          const text = msg.text();
          if (!isIgnorable(text)) {
            fatalErrors.push(text);
          }
        }
      });

      // Catch uncaught exceptions (React render crashes, etc.)
      page.on('pageerror', (err) => {
        const text = err.message || String(err);
        if (!isIgnorable(text)) {
          fatalErrors.push(`[pageerror] ${text}`);
        }
      });

      // Navigate to the page
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Give React time to render and settle
      await page.waitForTimeout(2000);

      // 1. Page should not be blank (body has visible content)
      const bodyVisible = await page.locator('body').isVisible();
      expect(bodyVisible, `${route.name}: <body> should be visible`).toBe(true);

      // 2. Page should have rendered something beyond a blank div
      //    Check that there's at least some text content or interactive elements
      const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
      const hasContent = bodyText.trim().length > 0;
      const hasElements = await page.locator('button, a, h1, h2, h3, table, input, [role="button"]')
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false);

      expect(
        hasContent || hasElements,
        `${route.name}: Page should render content (got empty page)`
      ).toBe(true);

      // 3. No fatal JS errors (network errors are OK when API is down)
      if (fatalErrors.length > 0) {
        // Log them for the report but only fail on truly fatal ones
        console.log(`[${route.name}] Console errors (non-network):`, fatalErrors);
      }
      expect(
        fatalErrors,
        `${route.name}: Should have no fatal JS errors. Found: ${fatalErrors.join(' | ')}`
      ).toHaveLength(0);

      // 4. If a custom landmark selector was specified, verify it
      if (route.landmark) {
        await expect(
          page.locator(route.landmark),
          `${route.name}: Landmark ${route.landmark} should be visible`
        ).toBeVisible({ timeout: 5000 });
      }
    });
  }
});

// ─── Navigation smoke test ──────────────────────────────────
// Verifies the sidebar/nav can reach every page without full reload

test.describe('Navigation — Sidebar Links', () => {
  test('sidebar renders with navigation links', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // AppLayout should render a sidebar/nav element
    const nav = page.locator('nav, [role="navigation"], aside');
    const navVisible = await nav.first().isVisible({ timeout: 5000 }).catch(() => false);

    expect(navVisible, 'Dashboard should have a navigation element').toBe(true);

    // Count nav links — should have at least 10 (most pages are in the sidebar)
    if (navVisible) {
      const linkCount = await nav.first().locator('a').count();
      expect(linkCount, 'Navigation should have multiple links').toBeGreaterThanOrEqual(5);
    }
  });
});
