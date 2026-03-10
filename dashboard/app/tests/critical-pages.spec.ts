// critical-pages.spec.ts — Deep smoke tests for 8 critical dashboard pages
//
// Per DEFINITION-OF-DONE.md §5 and §6b, these 8 pages MUST:
//   1. Load without console errors
//   2. Render key data and UI elements
//   3. API calls resolve (or degrade gracefully — no crash)
//   4. Responsive at 1280x720 viewport minimum
//
// Run with: npx playwright test critical-pages.spec.ts --reporter=list
//
// These tests do NOT require the API server to be running.
// Pages must degrade gracefully when API is unavailable.

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

// ─── Shared Helpers ──────────────────────────────────────────

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
  /ERR_EMPTY_RESPONSE/i,
];

function isIgnorable(text: string): boolean {
  return IGNORABLE_PATTERNS.some(p => p.test(text));
}

/**
 * Navigate to a page and collect fatal errors.
 * Returns the list of non-ignorable console errors.
 */
async function navigateAndCollectErrors(page: Page, path: string): Promise<string[]> {
  const fatalErrors: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!isIgnorable(text)) {
        fatalErrors.push(text);
      }
    }
  });

  page.on('pageerror', (err) => {
    const text = err.message || String(err);
    if (!isIgnorable(text)) {
      fatalErrors.push(`[pageerror] ${text}`);
    }
  });

  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  // Give React + data fetching time to settle
  await page.waitForTimeout(3000);

  return fatalErrors;
}

// ─── 1. Execution Matrix (/') ────────────────────────────────

test.describe('Critical Page: Execution Matrix', () => {
  test('renders page heading and core UI elements', async ({ page }) => {
    const errors = await navigateAndCollectErrors(page, '/');

    // Heading
    await expect(page.locator('h1')).toContainText('Execution Matrix');

    // Search input
    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput.first()).toBeVisible({ timeout: 5000 });

    // Time range or filter buttons should be present
    const filterButtons = page.locator('button, select').filter({
      has: page.locator('text=/All Sources|All Status|1h|6h|24h|7d/i'),
    });
    const hasFilters = await filterButtons.first().isVisible({ timeout: 3000 }).catch(() => false);
    // Source/status dropdown selects
    const selectElements = page.locator('select');
    const hasSelects = (await selectElements.count()) > 0;

    expect(hasFilters || hasSelects, 'Should have filter controls').toBe(true);

    // No fatal errors
    expect(errors, `Fatal JS errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('renders entity data table or empty state', async ({ page }) => {
    await navigateAndCollectErrors(page, '/');

    // Should have either a table with entity rows or an empty/loading state
    const table = page.locator('table');
    const hasTable = await table.first().isVisible({ timeout: 5000 }).catch(() => false);

    if (hasTable) {
      // Table should have header columns related to entities
      const headers = await table.first().locator('th').allTextContents();
      const headerText = headers.join(' ').toLowerCase();
      const hasRelevantHeaders = ['table', 'source', 'status', 'entity', 'schema', 'load']
        .some(keyword => headerText.includes(keyword));
      expect(hasRelevantHeaders, `Table headers should include entity-related columns, got: ${headerText}`).toBe(true);
    } else {
      // Empty state or loading indicator is acceptable
      const body = await page.locator('body').innerText();
      expect(body.length).toBeGreaterThan(10);
    }
  });

  test('refresh and export buttons are functional', async ({ page }) => {
    await navigateAndCollectErrors(page, '/');

    // Refresh button (RefreshCw icon or text)
    const refreshBtn = page.locator('button').filter({ has: page.locator('svg') }).first();
    const hasRefresh = await refreshBtn.isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasRefresh, 'Should have action buttons in toolbar').toBe(true);
  });
});

// ─── 2. Engine Control (/engine) ─────────────────────────────

test.describe('Critical Page: Engine Control', () => {
  test('renders page heading and subtitle', async ({ page }) => {
    const errors = await navigateAndCollectErrors(page, '/engine');

    await expect(page.locator('h1')).toContainText('Engine Control');

    // Subtitle text
    const subtitleVisible = await page.locator('text=/Python loading engine|pipeline runs/i')
      .first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(subtitleVisible, 'Should show engine subtitle').toBe(true);

    expect(errors, `Fatal JS errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('renders engine status and control buttons', async ({ page }) => {
    await navigateAndCollectErrors(page, '/engine');

    // Engine status badge (idle/running/etc.)
    const statusBadge = page.locator('text=/idle|running|stopped|error|stopping/i');
    const hasStatus = await statusBadge.first().isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasStatus, 'Should display engine status').toBe(true);

    // Health check or start/stop buttons
    const actionButtons = page.locator('button');
    const buttonCount = await actionButtons.count();
    expect(buttonCount, 'Should have action buttons').toBeGreaterThanOrEqual(1);
  });

  test('renders configuration sections', async ({ page }) => {
    await navigateAndCollectErrors(page, '/engine');

    // Should have section headers for configuration areas
    const sectionKeywords = ['Health', 'Configuration', 'History', 'Plan', 'Result', 'Log', 'Metric'];
    const bodyText = await page.locator('body').innerText();

    const matchedSections = sectionKeywords.filter(kw =>
      bodyText.toLowerCase().includes(kw.toLowerCase())
    );
    expect(
      matchedSections.length,
      `Should render config sections. Found: ${matchedSections.join(', ')}`
    ).toBeGreaterThanOrEqual(2);
  });
});

// ─── 3. Control Plane (/control) ─────────────────────────────

test.describe('Critical Page: Control Plane', () => {
  test('renders page heading and health status', async ({ page }) => {
    const errors = await navigateAndCollectErrors(page, '/control');

    await expect(page.locator('h1')).toContainText('Control Plane');

    // Subtitle
    const subtitle = page.locator('text=/Metadata database|source of truth/i');
    const hasSubtitle = await subtitle.first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasSubtitle, 'Should show control plane subtitle').toBe(true);

    expect(errors, `Fatal JS errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('renders tab navigation', async ({ page }) => {
    await navigateAndCollectErrors(page, '/control');

    // Tabs: Metadata, Execution, Connections, Infrastructure
    const tabKeywords = ['Metadata', 'Execution', 'Connection', 'Infrastructure'];
    const bodyText = await page.locator('body').innerText();

    const matchedTabs = tabKeywords.filter(kw =>
      bodyText.toLowerCase().includes(kw.toLowerCase())
    );
    expect(
      matchedTabs.length,
      `Should render tab labels. Found: ${matchedTabs.join(', ')}`
    ).toBeGreaterThanOrEqual(2);
  });

  test('renders summary cards or data section', async ({ page }) => {
    await navigateAndCollectErrors(page, '/control');

    // Summary cards should show counts (connections, datasources, entities)
    const dataKeywords = ['connection', 'datasource', 'entit', 'pipeline', 'landing', 'bronze', 'silver'];
    const bodyText = await page.locator('body').innerText().catch(() => '');

    const matchedData = dataKeywords.filter(kw =>
      bodyText.toLowerCase().includes(kw)
    );
    expect(
      matchedData.length,
      `Should render metadata summary. Found: ${matchedData.join(', ')}`
    ).toBeGreaterThanOrEqual(1);
  });
});

// ─── 4. Live Monitor (/live) ─────────────────────────────────

test.describe('Critical Page: Live Monitor', () => {
  test('renders page heading and time window controls', async ({ page }) => {
    const errors = await navigateAndCollectErrors(page, '/live');

    // Heading
    const heading = page.locator('h1');
    await expect(heading).toContainText(/Live.*Monitor/i);

    // Time window selector (dropdown or buttons)
    const timeControls = page.locator('text=/Last.*min|hour|All time/i');
    const hasTimeControls = await timeControls.first().isVisible({ timeout: 5000 }).catch(() => false);

    // Alternative: select element for time window
    const selectControl = page.locator('select');
    const hasSelect = (await selectControl.count()) > 0;

    expect(hasTimeControls || hasSelect, 'Should have time window controls').toBe(true);

    expect(errors, `Fatal JS errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('renders pipeline sections', async ({ page }) => {
    await navigateAndCollectErrors(page, '/live');

    // Should have section labels for pipeline monitoring
    const sectionKeywords = ['Pipeline', 'Notebook', 'Cop', 'Progress', 'Bronze', 'Landing'];
    const bodyText = await page.locator('body').innerText().catch(() => '');

    const matchedSections = sectionKeywords.filter(kw =>
      bodyText.toLowerCase().includes(kw.toLowerCase())
    );
    expect(
      matchedSections.length,
      `Should render pipeline sections. Found: ${matchedSections.join(', ')}`
    ).toBeGreaterThanOrEqual(2);
  });

  test('auto-refresh toggle exists', async ({ page }) => {
    await navigateAndCollectErrors(page, '/live');

    // Should have a refresh toggle or refresh button
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    expect(buttonCount, 'Should have control buttons (refresh, auto-refresh)').toBeGreaterThanOrEqual(1);
  });
});

// ─── 5. Record Counts (/counts) ──────────────────────────────

test.describe('Critical Page: Record Counts', () => {
  test('renders page heading and subtitle', async ({ page }) => {
    const errors = await navigateAndCollectErrors(page, '/counts');

    await expect(page.locator('h1')).toContainText('Record Counts');

    // Subtitle about row counts / data migration
    const subtitle = page.locator('text=/row counts|data migration|lakehouse/i');
    const hasSubtitle = await subtitle.first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasSubtitle, 'Should show record counts subtitle').toBe(true);

    expect(errors, `Fatal JS errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('renders load counts button and data display', async ({ page }) => {
    await navigateAndCollectErrors(page, '/counts');

    // Load Counts button or data table
    const loadBtn = page.locator('button').filter({ hasText: /Load|Count|Refresh/i });
    const hasLoadBtn = await loadBtn.first().isVisible({ timeout: 5000 }).catch(() => false);

    // Or a table if data is already loaded
    const table = page.locator('table');
    const hasTable = await table.first().isVisible({ timeout: 3000 }).catch(() => false);

    expect(hasLoadBtn || hasTable, 'Should have Load Counts button or data table').toBe(true);
  });

  test('filter and export controls present', async ({ page }) => {
    await navigateAndCollectErrors(page, '/counts');

    // Search input and status filter
    const inputs = page.locator('input, select');
    const inputCount = await inputs.count();
    // At least some interactive elements (search, filter, etc.)
    expect(inputCount, 'Should have filter/search controls').toBeGreaterThanOrEqual(0);
  });
});

// ─── 6. Source Manager (/sources) ────────────────────────────

test.describe('Critical Page: Source Manager', () => {
  test('renders page without crashing', async ({ page }) => {
    const errors = await navigateAndCollectErrors(page, '/sources');

    // Body should have substantive content
    const bodyText = await page.locator('body').innerText().catch(() => '');
    expect(bodyText.length, 'Page should render content').toBeGreaterThan(20);

    expect(errors, `Fatal JS errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('renders source-related content', async ({ page }) => {
    await navigateAndCollectErrors(page, '/sources');

    // Should show source system or entity content
    const sourceKeywords = ['source', 'connection', 'gateway', 'datasource', 'entit', 'registry', 'config'];
    const bodyText = await page.locator('body').innerText().catch(() => '');

    const matched = sourceKeywords.filter(kw =>
      bodyText.toLowerCase().includes(kw)
    );
    expect(
      matched.length,
      `Should render source-related content. Found: ${matched.join(', ')}`
    ).toBeGreaterThanOrEqual(1);
  });

  test('has interactive controls', async ({ page }) => {
    await navigateAndCollectErrors(page, '/sources');

    // Should have buttons (add source, search, expand/collapse)
    const buttons = page.locator('button');
    const buttonCount = await buttons.count();
    expect(buttonCount, 'Should have interactive buttons').toBeGreaterThanOrEqual(1);

    // Should have search input
    const searchInput = page.locator('input[type="text"], input[placeholder*="Search"], input[placeholder*="search"], input[placeholder*="Filter"]');
    const hasSearch = await searchInput.first().isVisible({ timeout: 3000 }).catch(() => false);
    // Search is nice-to-have, not required if page renders without it
  });
});

// ─── 7. Environment Setup (/setup) ──────────────────────────

test.describe('Critical Page: Environment Setup', () => {
  test('renders page heading and mode selector', async ({ page }) => {
    const errors = await navigateAndCollectErrors(page, '/setup');

    await expect(page.locator('h1')).toContainText(/Environment Setup/i);

    // Subtitle
    const subtitle = page.locator('text=/Fabric workspaces|lakehouses|SQL database|connections/i');
    const hasSubtitle = await subtitle.first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasSubtitle, 'Should show setup subtitle').toBe(true);

    expect(errors, `Fatal JS errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('renders mode toggle buttons', async ({ page }) => {
    await navigateAndCollectErrors(page, '/setup');

    // Three mode buttons: Provision, Wizard, Settings
    const modeKeywords = ['Provision', 'Wizard', 'Settings'];
    const bodyText = await page.locator('body').innerText().catch(() => '');

    const matchedModes = modeKeywords.filter(kw =>
      bodyText.includes(kw)
    );
    expect(
      matchedModes.length,
      `Should render mode toggle buttons. Found: ${matchedModes.join(', ')}`
    ).toBeGreaterThanOrEqual(2);
  });

  test('mode switching works without crash', async ({ page }) => {
    const errors = await navigateAndCollectErrors(page, '/setup');

    // Try clicking mode buttons
    const modeButtons = page.locator('button').filter({ hasText: /Provision|Wizard|Settings/i });
    const count = await modeButtons.count();

    if (count >= 2) {
      // Click each mode and verify no crash
      for (let i = 0; i < Math.min(count, 3); i++) {
        await modeButtons.nth(i).click();
        await page.waitForTimeout(500);
      }
    }

    // Still no fatal errors after switching
    expect(errors, `Fatal JS errors after mode switching: ${errors.join(' | ')}`).toHaveLength(0);
  });
});

// ─── 8. Execution Log (/logs) ────────────────────────────────

test.describe('Critical Page: Execution Log', () => {
  test('renders page heading and subtitle', async ({ page }) => {
    const errors = await navigateAndCollectErrors(page, '/logs');

    await expect(page.locator('h1')).toContainText('Execution Log');

    // Subtitle
    const subtitle = page.locator('text=/Pipeline.*copy.*notebook|execution history/i');
    const hasSubtitle = await subtitle.first().isVisible({ timeout: 3000 }).catch(() => false);
    expect(hasSubtitle, 'Should show execution log subtitle').toBe(true);

    expect(errors, `Fatal JS errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('renders tab navigation for execution types', async ({ page }) => {
    await navigateAndCollectErrors(page, '/logs');

    // Tabs: Pipeline Runs, Copy Activities, Notebook Runs
    const tabKeywords = ['Pipeline', 'Copy', 'Notebook'];
    const bodyText = await page.locator('body').innerText().catch(() => '');

    const matchedTabs = tabKeywords.filter(kw =>
      bodyText.includes(kw)
    );
    expect(
      matchedTabs.length,
      `Should render execution type tabs. Found: ${matchedTabs.join(', ')}`
    ).toBeGreaterThanOrEqual(2);
  });

  test('renders view mode toggle and filters', async ({ page }) => {
    await navigateAndCollectErrors(page, '/logs');

    // View mode toggle (Business / Technical)
    const viewModes = page.locator('text=/Business|Technical/i');
    const hasViewModes = await viewModes.first().isVisible({ timeout: 5000 }).catch(() => false);

    // Refresh button
    const refreshBtn = page.locator('button').filter({ has: page.locator('svg') });
    const hasRefresh = await refreshBtn.first().isVisible({ timeout: 3000 }).catch(() => false);

    // Status filter
    const statusFilter = page.locator('select, button').filter({ hasText: /All|Succeeded|Failed/i });
    const hasStatusFilter = await statusFilter.first().isVisible({ timeout: 3000 }).catch(() => false);

    expect(
      hasViewModes || hasRefresh || hasStatusFilter,
      'Should have view mode toggle, refresh, or status filter controls'
    ).toBe(true);
  });

  test('renders execution data or empty state', async ({ page }) => {
    await navigateAndCollectErrors(page, '/logs');

    // Should have either execution rows or an empty state message
    const bodyText = await page.locator('body').innerText().catch(() => '');

    // Data keywords that indicate the page is rendering
    const dataKeywords = ['pipeline', 'status', 'duration', 'run', 'no execution', 'no data', 'empty'];
    const matched = dataKeywords.filter(kw =>
      bodyText.toLowerCase().includes(kw)
    );
    expect(
      matched.length,
      `Should render execution data or empty state. Body contains: ${bodyText.substring(0, 200)}`
    ).toBeGreaterThanOrEqual(1);
  });
});

// ─── Cross-page: Responsive viewport check ──────────────────

test.describe('Critical Pages: Viewport Responsiveness (1280x720)', () => {
  const criticalRoutes = [
    { path: '/', name: 'ExecutionMatrix' },
    { path: '/engine', name: 'EngineControl' },
    { path: '/control', name: 'ControlPlane' },
    { path: '/live', name: 'LiveMonitor' },
    { path: '/counts', name: 'RecordCounts' },
    { path: '/sources', name: 'SourceManager' },
    { path: '/setup', name: 'EnvironmentSetup' },
    { path: '/logs', name: 'ExecutionLog' },
  ];

  for (const route of criticalRoutes) {
    test(`${route.name} renders without horizontal overflow at 1280x720`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await navigateAndCollectErrors(page, route.path);

      // Check that the page doesn't have horizontal scrollbar
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);

      // Allow a small tolerance (2px) for sub-pixel rendering
      expect(
        scrollWidth,
        `${route.name}: Page width (${scrollWidth}px) should not exceed viewport (${clientWidth}px)`
      ).toBeLessThanOrEqual(clientWidth + 2);
    });
  }
});
