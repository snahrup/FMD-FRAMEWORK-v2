# TASK 008: Build Playwright E2E Suite for 8 Critical Pages

> **Authority**: Steve Nahrup
> **Created**: 2026-03-09
> **Category**: testing
> **Complexity**: large
> **Impact**: critical
> **Agent**: test-engineer, ui-specialist

---

## Problem Statement

The 8 critical dashboard pages **MUST be fully functional** before go-live (per DEFINITION-OF-DONE.md Section 5). Currently, there are **ZERO automated E2E tests** to validate:
- Pages load without errors
- Data displays correctly
- User interactions work (buttons, filters, search)
- No console errors
- No visual regressions

This is a **HARD GATE** — the project cannot be marked "done" without passing Playwright tests for all 8 critical pages.

### Target

- **Playwright test suite** covering all 8 critical pages
- **Test spec file per page** (8 files total)
- **Smoke tests** (page loads, no errors) for all pages
- **Interaction tests** (clicks, filters, search) for key workflows
- **Data validation tests** (KPI values, table data) against known state
- **All tests pass** in CI-equivalent run (`npx playwright test`)
- **MRI scan** (Machine Regression Intelligence) captures screenshots for visual baseline

---

## Scope

### In Scope - 8 Critical Pages

| # | Page | Route | Test File | Test Count |
|---|------|-------|-----------|-----------|
| 1 | **Execution Matrix** | `/` | `execution-matrix.spec.ts` | 12-15 tests |
| 2 | **Engine Control** | `/engine` | `engine-control.spec.ts` | 10-12 tests |
| 3 | **Control Plane** | `/control` | `control-plane.spec.ts` | 8-10 tests |
| 4 | **Live Monitor** | `/monitor` | `live-monitor.spec.ts` | 6-8 tests |
| 5 | **Record Counts** | `/records` | `record-counts.spec.ts` | 10-12 tests |
| 6 | **Source Manager** | `/sources` | `source-manager.spec.ts` | 12-15 tests |
| 7 | **Environment Setup** | `/setup` | `environment-setup.spec.ts` | 8-10 tests |
| 8 | **Execution Log** | `/logs` | `execution-log.spec.ts` | 8-10 tests |

**Total: 74-92 E2E tests**

### In Scope - Test Categories

- [ ] **Smoke tests** (T-LOAD): Page loads, no console errors, key elements visible
- [ ] **Data tests** (T-DATA): KPI values, table data, counts match expected
- [ ] **Interaction tests** (T-INT): Buttons work, filters apply, search functions
- [ ] **GUID tests** (T-GUID): No stale workspace IDs on any page
- [ ] **Visual regression** (MRI): Screenshot baselines for all 8 pages

### Out of Scope

- Tier 2/3 pages (14+ additional pages) — covered in separate task
- Performance testing (load time thresholds) — covered in separate task
- Accessibility testing (WCAG compliance) — stretch goal
- Cross-browser testing (Chrome only for MVP)

---

## Acceptance Criteria (Binary Checklist)

### A. Test Infrastructure

| # | Criterion | Validation |
|---|-----------|-----------|
| A.1 | Playwright installed | `npx playwright --version` returns version >= 1.40 |
| A.2 | Test directory exists | `dashboard/app/tests/e2e/` contains test files |
| A.3 | Playwright config file | `dashboard/app/playwright.config.ts` exists |
| A.4 | Base URL configured | Config points to `http://127.0.0.1:5173` |
| A.5 | Fixtures for auth (if needed) | Login fixture available for pages requiring auth |
| A.6 | API mocking capability | Can mock `/api/*` endpoints for deterministic tests |

### B. Page 1: Execution Matrix (`/`)

**File:** `tests/e2e/execution-matrix.spec.ts`

| # | Test Case | Assertion |
|---|-----------|-----------|
| B.1 | `test_page_loads_without_errors` | Page navigates to `/`, no network errors, no console errors |
| B.2 | `test_heading_visible` | `h1` or main heading contains "Execution" or "Matrix" |
| B.3 | `test_kpi_cards_render` | At least 4 KPI cards visible |
| B.4 | `test_entity_table_renders` | Table element visible with rows |
| B.5 | `test_total_entities_kpi_value` | KPI card shows "1,666" or value from `/api/entity-digest` |
| B.6 | `test_success_rate_calculated` | Success rate % is between 0-100 |
| B.7 | `test_search_filters_table` | Type "ETQ" in search, table filters to ~29 rows |
| B.8 | `test_status_filter_works` | Select "Failed" from filter, only failed rows shown |
| B.9 | `test_column_sorting` | Click "Table Name" header, rows sort alphabetically |
| B.10 | `test_row_expansion` | Click entity row, detail panel expands |
| B.11 | `test_no_stale_guids` | Page content does NOT contain `a3a180ff`, `146fe38c`, `f442f66c` |
| B.12 | `test_screenshot_baseline` | Capture full-page screenshot for MRI comparison |

### C. Page 2: Engine Control (`/engine`)

**File:** `tests/e2e/engine-control.spec.ts`

| # | Test Case | Assertion |
|---|-----------|-----------|
| C.1 | `test_page_loads` | No errors, status badge visible |
| C.2 | `test_execute_button_visible` | "Execute" button rendered and clickable (if idle) |
| C.3 | `test_stop_button_disabled_when_idle` | "Stop" button grayed out when engine idle |
| C.4 | `test_layer_checkboxes_toggle` | Click LZ/Bronze/Silver checkboxes, state updates |
| C.5 | `test_plan_mode_shows_execution_plan` | Select "Plan" mode, click Execute, execution plan renders |
| C.6 | `test_execution_plan_shows_entity_count` | Plan displays "X entities will be processed" |
| C.7 | `test_duration_kpi_visible` | Duration KPI card shows formatted time |
| C.8 | `test_live_log_panel_opens` | When running, log panel visible with scrollable content |
| C.9 | `test_load_everything_button_visible` | "Load Everything" button present (from Task 004) |
| C.10 | `test_screenshot_baseline` | Capture full-page screenshot |

### D. Page 3: Control Plane (`/control`)

**File:** `tests/e2e/control-plane.spec.ts`

| # | Test Case | Assertion |
|---|-----------|-----------|
| D.1 | `test_page_loads` | No errors, source breakdown cards visible |
| D.2 | `test_total_entities_count` | Shows 1,666 total entities |
| D.3 | `test_etq_card_count` | ETQ card shows 29 entities |
| D.4 | `test_mes_card_count` | MES card shows 445 entities |
| D.5 | `test_m3_card_count` | M3 ERP card shows 596 entities |
| D.6 | `test_m3c_card_count` | M3 Cloud card shows 187 entities |
| D.7 | `test_optiva_card_count` | OPTIVA card shows 409 entities |
| D.8 | `test_layer_progress_bars` | LZ, Bronze, Silver progress bars visible |
| D.9 | `test_screenshot_baseline` | Capture full-page screenshot |

### E. Page 4: Live Monitor (`/monitor`)

**File:** `tests/e2e/live-monitor.spec.ts`

| # | Test Case | Assertion |
|---|-----------|-----------|
| E.1 | `test_page_loads` | No errors, activity log area visible |
| E.2 | `test_time_window_selector` | Time window dropdown present (5m, 15m, 60m) |
| E.3 | `test_activity_entries_render` | At least 1 activity entry visible (or "No activity" message) |
| E.4 | `test_time_window_change` | Select "5m", API called with `?minutes=5` |
| E.5 | `test_status_badges_colored` | Status badges use correct colors (green/red/amber) |
| E.6 | `test_screenshot_baseline` | Capture full-page screenshot |

### F. Page 5: Record Counts (`/records`)

**File:** `tests/e2e/record-counts.spec.ts`

| # | Test Case | Assertion |
|---|-----------|-----------|
| F.1 | `test_page_loads` | No errors, "Load Counts" button visible |
| F.2 | `test_summary_cards_render` | 5 summary cards visible (Bronze, Silver, Matched, Mismatched, Total) |
| F.3 | `test_load_counts_button_triggers_api` | Click "Load Counts", API call to `/api/lakehouse-counts` |
| F.4 | `test_table_renders_with_data` | Table shows rows with Table Name, Schema, Bronze Rows, Silver Rows, Delta |
| F.5 | `test_search_filters_table` | Type "ETQ" in search, only ETQ tables shown |
| F.6 | `test_match_filter_works` | Select "Matched" filter, only green-badge rows shown |
| F.7 | `test_sort_by_delta` | Click "Delta" column header, rows sorted by descending delta |
| F.8 | `test_journey_link_navigation` | Click Route icon, navigates to `/journey?table=X&schema=Y` |
| F.9 | `test_export_csv_button` | Click "Export CSV", downloads file |
| F.10 | `test_screenshot_baseline` | Capture full-page screenshot |

### G. Page 6: Source Manager (`/sources`)

**File:** `tests/e2e/source-manager.spec.ts`

| # | Test Case | Assertion |
|---|-----------|-----------|
| G.1 | `test_page_loads` | No errors, source groups visible |
| G.2 | `test_all_5_sources_listed` | ETQ, MES, M3 ERP, M3 Cloud, OPTIVA groups present |
| G.3 | `test_etq_entity_count` | ETQ group shows 29 entities |
| G.4 | `test_expand_collapse_source_group` | Click toggle, group expands/collapses |
| G.5 | `test_entity_checkbox_selection` | Click entity checkbox, entity selected |
| G.6 | `test_source_group_checkbox` | Click source group checkbox, all entities in group selected |
| G.7 | `test_add_source_button_opens_wizard` | Click "Add Source", wizard modal opens (from Task 003) |
| G.8 | `test_load_all_button_visible` | "Load All" button present (from Task 004) |
| G.9 | `test_search_by_entity_name` | Type entity name, filters across all groups |
| G.10 | `test_expand_all_button` | Click "Expand All", all groups expand |
| G.11 | `test_screenshot_baseline` | Capture full-page screenshot |

### H. Page 7: Environment Setup (`/setup`)

**File:** `tests/e2e/environment-setup.spec.ts`

| # | Test Case | Assertion |
|---|-----------|-----------|
| H.1 | `test_page_loads` | No errors, mode selector with 3 tabs visible |
| H.2 | `test_provision_tab_renders` | Click "Provision" tab, ProvisionAll component renders |
| H.3 | `test_wizard_tab_renders` | Click "Wizard" tab, SetupWizard component renders |
| H.4 | `test_settings_tab_renders` | Click "Settings" tab, SetupSettings component renders |
| H.5 | `test_workspace_ids_displayed` | Data workspace ID `0596d0e7*` visible |
| H.6 | `test_no_stale_workspace_ids` | Content does NOT contain `a3a180ff`, `146fe38c`, `f442f66c` |
| H.7 | `test_sql_db_endpoint_correct` | Contains `7xuydsw5a3hutnnj5z2ed72tam` |
| H.8 | `test_screenshot_baseline` | Capture full-page screenshot |

### I. Page 8: Execution Log (`/logs`)

**File:** `tests/e2e/execution-log.spec.ts`

| # | Test Case | Assertion |
|---|-----------|-----------|
| I.1 | `test_page_loads` | No errors, tab bar with 3 tabs visible |
| I.2 | `test_pipelines_tab_default` | "Pipelines" tab active by default |
| I.3 | `test_data_table_renders` | Table with rows visible (or "No executions" message) |
| I.4 | `test_copies_tab_switch` | Click "Copies" tab, table refreshes with copy execution data |
| I.5 | `test_notebooks_tab_switch` | Click "Notebooks" tab, table refreshes with notebook data |
| I.6 | `test_status_filter_works` | Filter by "Failed", only failed rows shown |
| I.7 | `test_row_expansion` | Click row, detail panel expands with raw data |
| I.8 | `test_view_mode_toggle` | Toggle "Business" / "Technical" view, columns change |
| I.9 | `test_screenshot_baseline` | Capture full-page screenshot |

### J. Cross-Cutting Tests (All Pages)

| # | Test Case | Applies To | Assertion |
|---|-----------|-----------|-----------|
| J.1 | `test_no_console_errors` | All 8 pages | `page.on('console')` with level 'error', count = 0 |
| J.2 | `test_no_unhandled_exceptions` | All 8 pages | No uncaught promise rejections |
| J.3 | `test_page_title_set` | All 8 pages | `<title>` tag contains meaningful text |
| J.4 | `test_responsive_at_1280x720` | All 8 pages | Set viewport to 1280x720, no layout break |
| J.5 | `test_no_undefined_in_text` | All 8 pages | Page text content does NOT contain "undefined" or "NaN" |

### K. MRI (Machine Regression Intelligence) Scan

| # | Criterion | Validation |
|---|-----------|-----------|
| K.1 | Baseline screenshots captured for all 8 pages | 8 PNG files in `tests/e2e/screenshots/baseline/` |
| K.2 | MRI comparison script runs | `npx playwright test --update-snapshots` updates baselines |
| K.3 | Visual diff on changes | Future runs compare against baseline, flag pixel diffs |
| K.4 | Diff report generated | HTML report shows side-by-side comparison if diffs detected |

---

## Implementation Steps

### Step 1: Install Playwright

```bash
cd dashboard/app

# Install Playwright
npm install --save-dev @playwright/test

# Install browser binaries
npx playwright install
```

### Step 2: Create Playwright Config

**File:** `dashboard/app/playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

### Step 3: Create Test Files

**Example:** `tests/e2e/execution-matrix.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Execution Matrix Page', () => {
  test.beforeEach(async ({ page }) => {
    // Mock API responses for deterministic tests
    await page.route('/api/entity-digest', async (route) => {
      await route.fulfill({
        json: {
          totalEntities: 1666,
          sources: [
            { name: 'ETQ', count: 29 },
            { name: 'MES', count: 445 },
            { name: 'M3', count: 596 },
            { name: 'M3C', count: 187 },
            { name: 'OPTIVA', count: 409 },
          ],
          successRate: 98.5,
        },
      });
    });

    await page.goto('/');
  });

  test('page loads without errors', async ({ page }) => {
    // Verify no network errors
    await expect(page).toHaveURL('/');

    // Verify no console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // Wait for page to fully load
    await page.waitForLoadState('networkidle');

    expect(consoleErrors).toHaveLength(0);
  });

  test('heading visible', async ({ page }) => {
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible();
    await expect(heading).toContainText(/execution|matrix/i);
  });

  test('KPI cards render', async ({ page }) => {
    // Verify at least 4 KPI cards visible
    const kpiCards = page.locator('[data-testid="kpi-card"]'); // Use data-testid for reliable selection
    await expect(kpiCards).toHaveCount(4, { timeout: 5000 });
  });

  test('total entities KPI value', async ({ page }) => {
    // Find the "Total Entities" KPI card
    const totalEntitiesCard = page.locator('text=Total Entities').locator('..');
    await expect(totalEntitiesCard).toBeVisible();

    // Verify value is 1,666
    await expect(totalEntitiesCard).toContainText('1,666');
  });

  test('entity table renders', async ({ page }) => {
    const table = page.locator('table, [role="grid"]');
    await expect(table).toBeVisible();

    // Verify table has rows
    const rows = table.locator('tbody tr, [role="row"]');
    await expect(rows).not.toHaveCount(0);
  });

  test('search filters table', async ({ page }) => {
    // Type "ETQ" in search box
    const searchBox = page.locator('input[type="search"], input[placeholder*="search" i]');
    await searchBox.fill('ETQ');

    // Wait for filtering
    await page.waitForTimeout(500);

    // Verify table filtered to ~29 rows (ETQ entities)
    const rows = page.locator('tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(50); // Roughly 29, allow some variance
  });

  test('status filter works', async ({ page }) => {
    // Select "Failed" from status filter dropdown
    await page.selectOption('select[name="status"], select[aria-label*="status" i]', 'failed');

    // Wait for filtering
    await page.waitForTimeout(500);

    // Verify all visible rows have "failed" status badge
    const statusBadges = page.locator('tbody tr .badge, tbody tr [data-status]');
    const count = await statusBadges.count();

    for (let i = 0; i < count; i++) {
      const badge = statusBadges.nth(i);
      const text = await badge.textContent();
      expect(text?.toLowerCase()).toContain('fail');
    }
  });

  test('column sorting', async ({ page }) => {
    // Click "Table Name" column header
    const tableNameHeader = page.locator('th:has-text("Table Name"), [role="columnheader"]:has-text("Table Name")');
    await tableNameHeader.click();

    // Get first 5 table names
    const tableNames = await page.locator('tbody tr td:first-child').allTextContents();
    const first5 = tableNames.slice(0, 5);

    // Verify alphabetical order (ascending)
    const sorted = [...first5].sort();
    expect(first5).toEqual(sorted);

    // Click again for descending
    await tableNameHeader.click();
    await page.waitForTimeout(500);

    const tableNamesDesc = await page.locator('tbody tr td:first-child').allTextContents();
    const first5Desc = tableNamesDesc.slice(0, 5);
    const sortedDesc = [...first5Desc].sort().reverse();
    expect(first5Desc).toEqual(sortedDesc);
  });

  test('row expansion', async ({ page }) => {
    // Click first row
    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();

    // Wait for detail panel to expand
    await page.waitForTimeout(500);

    // Verify detail panel visible
    const detailPanel = page.locator('[data-testid="detail-panel"], .detail-panel, [aria-label*="detail" i]');
    await expect(detailPanel).toBeVisible();
  });

  test('no stale GUIDs', async ({ page }) => {
    const content = await page.textContent('body');
    expect(content).not.toContain('a3a180ff');
    expect(content).not.toContain('146fe38c');
    expect(content).not.toContain('f442f66c');
  });

  test('screenshot baseline', async ({ page }) => {
    // Capture full-page screenshot for MRI comparison
    await expect(page).toHaveScreenshot('execution-matrix.png', {
      fullPage: true,
      maxDiffPixels: 100, // Allow small diffs (e.g., timestamps)
    });
  });
});
```

### Step 4: Run Tests

```bash
# Run all E2E tests
npx playwright test

# Run tests for a specific page
npx playwright test execution-matrix.spec.ts

# Run tests in headed mode (see browser)
npx playwright test --headed

# Run tests in debug mode
npx playwright test --debug

# Update screenshot baselines
npx playwright test --update-snapshots

# Generate HTML report
npx playwright show-report
```

**Expected output:**

```
Running 74 tests using 1 worker

  ✓ execution-matrix.spec.ts:7:3 › page loads without errors (2s)
  ✓ execution-matrix.spec.ts:22:3 › heading visible (1s)
  ✓ execution-matrix.spec.ts:28:3 › KPI cards render (1s)
  ✓ execution-matrix.spec.ts:34:3 › total entities KPI value (1s)
  ✓ execution-matrix.spec.ts:42:3 › entity table renders (1s)
  ✓ execution-matrix.spec.ts:50:3 › search filters table (2s)
  ✓ execution-matrix.spec.ts:62:3 › status filter works (2s)
  ✓ execution-matrix.spec.ts:75:3 › column sorting (3s)
  ✓ execution-matrix.spec.ts:95:3 › row expansion (2s)
  ✓ execution-matrix.spec.ts:106:3 › no stale GUIDs (1s)
  ✓ execution-matrix.spec.ts:113:3 › screenshot baseline (2s)
  ... (63 more tests)

  74 passed (2.3m)

To open last HTML report run:

  npx playwright show-report
```

### Step 5: Add Data Attributes for Testability

**Update React components to add `data-testid` attributes:**

```tsx
// Example: ExecutionMatrix.tsx
<div className="kpi-cards">
  <Card data-testid="kpi-card">
    <CardHeader>Total Entities</CardHeader>
    <CardContent>
      <div className="text-3xl font-bold">{totalEntities}</div>
    </CardContent>
  </Card>

  <Card data-testid="kpi-card">
    <CardHeader>Success Rate</CardHeader>
    <CardContent>
      <div className="text-3xl font-bold">{successRate}%</div>
    </CardContent>
  </Card>

  {/* ... more KPI cards */}
</div>

<div data-testid="detail-panel" className={detailPanelOpen ? 'open' : 'closed'}>
  {/* Detail content */}
</div>
```

**Why?** `data-testid` attributes make tests more reliable and resilient to CSS class changes.

---

## Validation Criteria

### Minimum Passing Criteria

- [ ] All 8 test spec files created (one per critical page)
- [ ] `npx playwright test` exits with code 0 (all tests pass)
- [ ] Minimum 74 tests implemented (B.1 - I.9 + J.1 - J.5)
- [ ] All smoke tests pass (page loads, no console errors)
- [ ] All GUID tests pass (no stale workspace IDs)
- [ ] HTML test report generated
- [ ] Baseline screenshots captured for all 8 pages

### Stretch Goals

- [ ] 92+ tests implemented (all optional tests included)
- [ ] Visual regression tests pass (MRI scan detects no unintended changes)
- [ ] Test execution time < 5 minutes (parallel execution)
- [ ] Accessibility tests (aXe) pass for all pages
- [ ] Cross-browser testing (Firefox, Safari) passes

---

## Cross-Reference

- **DEFINITION-OF-DONE.md**: Section 6b (Playwright E2E hard gate)
- **TEST-PLAN.md**: All T-LOAD, T-DATA, T-INT, T-GUID tests mapped to Playwright specs
- **TASK 010**: Complete Execution Matrix Page (depends on these tests passing)

---

## Dependencies

- **Blocked by**: Task 001 (Entity Activation) — pages need real data to test against
- **Blocked by**: Task 002 (Full Load) — need successful run to have test data
- **Blocks**: Task 009 (CI/CD Pipeline) — CI runs these tests
- **Blocks**: Project completion — HARD GATE, cannot mark done without passing

---

## Sign-Off

- [ ] Playwright installed and configured
- [ ] All 8 test spec files created
- [ ] All tests pass: `npx playwright test` exits 0
- [ ] Minimum 74 tests implemented
- [ ] HTML report generated and reviewed
- [ ] Baseline screenshots captured
- [ ] No console errors on any page
- [ ] No stale GUIDs on any page
- [ ] All smoke tests pass
- [ ] All interaction tests pass

**Completed by**: ___________
**Date**: ___________
**Test Count**: _______ / 74 minimum
**Verified by**: ___________
