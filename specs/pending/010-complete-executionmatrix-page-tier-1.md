# Spec 010: Complete ExecutionMatrix Page (Tier 1 - All 40 Assertions)

> **Priority**: CRITICAL
> **Category**: ui_ux
> **Complexity**: large
> **Impact**: critical
> **Status**: pending
> **Owner**: ux-hype (UI Agent)
> **Blocked By**: 001-verify-bronze-silver-100-entity-activation
> **Blocks**: Production dashboard deployment

---

## User Story

**As a** Data Platform Operator
**I want to** a fully functional Execution Matrix dashboard page with all 40 test assertions passing
**So that** I can monitor pipeline execution, filter entities, drill into logs, and diagnose issues

---

## Context & Background

### Current State
**Page**: Execution Matrix (`/` — root path)
**Purpose**: Primary monitoring interface for FMD pipeline execution
**Current Test Coverage**: **0/40 assertions passing** (page exists but incomplete)

**Test Plan Authority**: `knowledge/TEST-PLAN.md` Section "Page 1: Execution Matrix"
- **40 total assertions** (T-LOAD-01, T-DATA-01 through T-DATA-03, T-INT-01 through T-INT-03)
- Covers: page load, KPI cards, entity table, filtering, search, time ranges, drill-down

### Why This Matters
The Execution Matrix is the **first page users see** when they open the dashboard. It must:
- Load fast (< 5s)
- Display accurate entity counts (1,666 total, broken down by source and status)
- Allow filtering by source, status, and search term
- Show real-time updates via auto-refresh
- Provide drill-down into entity logs

If this page is broken or slow, users **cannot monitor the pipeline**.

### Success Criteria (Binary Gate)
From `DEFINITION-OF-DONE.md` Section 8.1:
- ✅ **All 40 test assertions pass** in Playwright e2e test suite
- ✅ **Page loads in < 5 seconds** on first visit
- ✅ **KPI cards show correct values** matching `/api/entity-digest`
- ✅ **Entity table displays all 1,666 entities** (when no filters applied)
- ✅ **Filters work correctly** (source, status, search all functional)
- ✅ **Time range selector changes metrics** (1h/24h/7d buttons)
- ✅ **Auto-refresh polls API every 5 seconds** when enabled
- ✅ **Entity drill-down shows log entries** when row clicked

---

## Technical Architecture

### Page Component Structure

**File**: `dashboard/app/pages/ExecutionMatrix.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import { useEntityDigest } from '../hooks/useEntityDigest';
import { useEngineStatus } from '../hooks/useEngineStatus';
import { KPICard } from '../components/KPICard';
import { EntityTable } from '../components/EntityTable';
import { PieChart } from '../components/PieChart';
import { TimeRangeSelector } from '../components/TimeRangeSelector';

export const ExecutionMatrix: React.FC = () => {
    const [timeRange, setTimeRange] = useState<number>(24); // hours
    const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [sourceFilter, setSourceFilter] = useState<string | null>(null);
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [expandedEntityId, setExpandedEntityId] = useState<number | null>(null);

    // Data hooks
    const { digest, loading: digestLoading, refresh: refreshDigest } = useEntityDigest(timeRange);
    const { status: engineStatus } = useEngineStatus();

    // Auto-refresh effect
    useEffect(() => {
        if (!autoRefresh) return;

        const interval = setInterval(() => {
            refreshDigest();
        }, 5000); // 5 seconds

        return () => clearInterval(interval);
    }, [autoRefresh, refreshDigest]);

    // Filtered entities
    const filteredEntities = React.useMemo(() => {
        let entities = digest?.entities || [];

        if (searchTerm) {
            entities = entities.filter(e =>
                e.table_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                e.source_name.toLowerCase().includes(searchTerm.toLowerCase())
            );
        }

        if (sourceFilter) {
            entities = entities.filter(e => e.source_name === sourceFilter);
        }

        if (statusFilter) {
            entities = entities.filter(e => e.overall_status === statusFilter);
        }

        return entities;
    }, [digest, searchTerm, sourceFilter, statusFilter]);

    // Calculate KPIs
    const totalEntities = digest?.total_entities || 0;
    const successCount = digest?.entities.filter(e => e.overall_status === 'succeeded').length || 0;
    const errorCount = digest?.entities.filter(e => e.overall_status === 'error').length || 0;
    const successRate = totalEntities > 0 ? (successCount / totalEntities * 100).toFixed(1) : '0.0';

    return (
        <div className="execution-matrix">
            <h1>Execution Matrix</h1>

            {/* KPI Cards */}
            <div className="kpi-grid">
                <KPICard
                    title="Total Entities"
                    value={totalEntities}
                    icon="database"
                />
                <KPICard
                    title="Success Rate"
                    value={`${successRate}%`}
                    icon="check-circle"
                    variant="success"
                />
                <KPICard
                    title="Errors"
                    value={errorCount}
                    icon="alert-circle"
                    variant={errorCount > 0 ? 'error' : 'neutral'}
                />
                <KPICard
                    title="Last Run"
                    value={engineStatus?.last_run?.status || 'N/A'}
                    icon="play-circle"
                />
            </div>

            {/* Time Range + Auto-Refresh */}
            <div className="controls">
                <TimeRangeSelector
                    value={timeRange}
                    onChange={setTimeRange}
                    options={[1, 24, 168]} // 1h, 24h, 7d
                />
                <label>
                    <input
                        type="checkbox"
                        checked={autoRefresh}
                        onChange={e => setAutoRefresh(e.target.checked)}
                    />
                    Auto-refresh
                </label>
                <button onClick={refreshDigest}>Refresh</button>
            </div>

            {/* Filters */}
            <div className="filters">
                <input
                    type="text"
                    placeholder="Search entities..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
                <select
                    value={sourceFilter || ''}
                    onChange={e => setSourceFilter(e.target.value || null)}
                >
                    <option value="">All Sources</option>
                    <option value="ETQ">ETQ</option>
                    <option value="MES">MES</option>
                    <option value="M3">M3</option>
                    <option value="M3C">M3C</option>
                    <option value="OPTIVA">OPTIVA</option>
                </select>
                <select
                    value={statusFilter || ''}
                    onChange={e => setStatusFilter(e.target.value || null)}
                >
                    <option value="">All Statuses</option>
                    <option value="succeeded">Succeeded</option>
                    <option value="failed">Failed</option>
                    <option value="pending">Pending</option>
                </select>
                <button onClick={() => {
                    setSearchTerm('');
                    setSourceFilter(null);
                    setStatusFilter(null);
                }}>Clear Filters</button>
            </div>

            {/* Pie Chart */}
            <div className="chart-container">
                <PieChart
                    data={digest?.layer_breakdown || []}
                    title="Layer Status Breakdown"
                />
            </div>

            {/* Entity Table */}
            <EntityTable
                entities={filteredEntities}
                expandedEntityId={expandedEntityId}
                onRowClick={setExpandedEntityId}
                loading={digestLoading}
            />
        </div>
    );
};
```

### API Endpoints Used

| Endpoint | Method | Purpose | Polling Interval |
|----------|--------|---------|-----------------|
| `/api/entity-digest` | GET | Entity counts, source breakdown, status | 5s (if auto-refresh enabled) |
| `/api/engine/status` | GET | Engine status, last run summary | 5s |
| `/api/entity/{id}/logs` | GET | Entity-specific log entries | On-demand (drill-down) |

### Data Flow

```
User visits /
    ↓
ExecutionMatrix component mounts
    ↓
useEntityDigest hook calls GET /api/entity-digest?hours=24
    ↓
Dashboard API queries control_plane_db.get_entity_digest()
    ↓
SQLite query aggregates entity_status table
    ↓
Returns JSON:
{
  "total_entities": 1666,
  "source_breakdown": [
    {"source": "ETQ", "count": 29, "succeeded": 29, "failed": 0},
    {"source": "MES", "count": 445, "succeeded": 440, "failed": 5},
    ...
  ],
  "layer_breakdown": [
    {"layer": "landing", "succeeded": 1666, "failed": 0, "pending": 0},
    {"layer": "bronze", "succeeded": 1666, "failed": 0, "pending": 0},
    {"layer": "silver", "succeeded": 100, "failed": 0, "pending": 1566}
  ],
  "entities": [
    {
      "id": 1,
      "source_name": "ETQ",
      "schema": "dbo",
      "table": "tbl_Users",
      "lz_status": "succeeded",
      "bronze_status": "succeeded",
      "silver_status": "pending",
      "overall_status": "pending",
      "last_load_time": "2026-03-09T14:30:00Z",
      "bronze_row_count": 5000
    },
    ...
  ]
}
    ↓
React renders KPI cards, table, chart
    ↓
User interacts (filters, drill-down, refresh)
    ↓
State updates trigger re-render
```

---

## Implementation Steps

### Step 1: Create Component Files

**Files to Create/Update**:
- `dashboard/app/pages/ExecutionMatrix.tsx` (main page)
- `dashboard/app/components/KPICard.tsx` (KPI card component)
- `dashboard/app/components/EntityTable.tsx` (data table with sorting, filtering, drill-down)
- `dashboard/app/components/PieChart.tsx` (layer breakdown chart)
- `dashboard/app/components/TimeRangeSelector.tsx` (1h/24h/7d buttons)
- `dashboard/app/hooks/useEntityDigest.ts` (data fetching hook)
- `dashboard/app/hooks/useEngineStatus.ts` (engine status hook)

### Step 2: Implement KPI Cards

**File**: `dashboard/app/components/KPICard.tsx`

```tsx
import React from 'react';
import './KPICard.css';

interface KPICardProps {
    title: string;
    value: string | number;
    icon: string;
    variant?: 'neutral' | 'success' | 'error' | 'warning';
}

export const KPICard: React.FC<KPICardProps> = ({ title, value, icon, variant = 'neutral' }) => {
    return (
        <div className={`kpi-card kpi-card--${variant}`}>
            <div className="kpi-card__icon">
                <i className={`icon-${icon}`}></i>
            </div>
            <div className="kpi-card__content">
                <div className="kpi-card__title">{title}</div>
                <div className="kpi-card__value">{value}</div>
            </div>
        </div>
    );
};
```

### Step 3: Implement Entity Table

**File**: `dashboard/app/components/EntityTable.tsx`

```tsx
import React, { useState } from 'react';
import './EntityTable.css';

interface Entity {
    id: number;
    source_name: string;
    schema: string;
    table: string;
    lz_status: string;
    bronze_status: string;
    silver_status: string;
    overall_status: string;
    last_load_time: string;
    bronze_row_count: number;
}

interface EntityTableProps {
    entities: Entity[];
    expandedEntityId: number | null;
    onRowClick: (id: number | null) => void;
    loading: boolean;
}

export const EntityTable: React.FC<EntityTableProps> = ({
    entities,
    expandedEntityId,
    onRowClick,
    loading
}) => {
    const [sortColumn, setSortColumn] = useState<string>('table');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    const handleSort = (column: string) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    const sortedEntities = React.useMemo(() => {
        const sorted = [...entities];
        sorted.sort((a, b) => {
            const aVal = a[sortColumn as keyof Entity];
            const bVal = b[sortColumn as keyof Entity];

            if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [entities, sortColumn, sortDirection]);

    if (loading) {
        return <div className="entity-table-loading">Loading entities...</div>;
    }

    return (
        <div className="entity-table-container">
            <table className="entity-table">
                <thead>
                    <tr>
                        <th onClick={() => handleSort('table')}>
                            Table Name
                            {sortColumn === 'table' && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                        </th>
                        <th onClick={() => handleSort('source_name')}>
                            Source
                            {sortColumn === 'source_name' && (sortDirection === 'asc' ? ' ↑' : ' ↓')}
                        </th>
                        <th>Target Schema</th>
                        <th>LZ Status</th>
                        <th>Bronze Status</th>
                        <th>Silver Status</th>
                        <th>Row Count</th>
                        <th>Last Load Time</th>
                    </tr>
                </thead>
                <tbody>
                    {sortedEntities.map(entity => (
                        <React.Fragment key={entity.id}>
                            <tr
                                className={expandedEntityId === entity.id ? 'expanded' : ''}
                                onClick={() => onRowClick(expandedEntityId === entity.id ? null : entity.id)}
                            >
                                <td>{entity.table}</td>
                                <td>{entity.source_name}</td>
                                <td>{entity.schema}</td>
                                <td>
                                    <span className={`status-badge status-badge--${entity.lz_status}`}>
                                        {entity.lz_status}
                                    </span>
                                </td>
                                <td>
                                    <span className={`status-badge status-badge--${entity.bronze_status}`}>
                                        {entity.bronze_status}
                                    </span>
                                </td>
                                <td>
                                    <span className={`status-badge status-badge--${entity.silver_status}`}>
                                        {entity.silver_status}
                                    </span>
                                </td>
                                <td>{entity.bronze_row_count?.toLocaleString() || 'N/A'}</td>
                                <td>{new Date(entity.last_load_time).toLocaleString()}</td>
                            </tr>
                            {expandedEntityId === entity.id && (
                                <tr className="entity-detail-row">
                                    <td colSpan={8}>
                                        <EntityDetailPanel entityId={entity.id} />
                                    </td>
                                </tr>
                            )}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const EntityDetailPanel: React.FC<{ entityId: number }> = ({ entityId }) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch(`/api/entity/${entityId}/logs`)
            .then(res => res.json())
            .then(data => {
                setLogs(data.logs || []);
                setLoading(false);
            });
    }, [entityId]);

    if (loading) return <div>Loading logs...</div>;

    return (
        <div className="entity-detail-panel">
            <h3>Recent Logs</h3>
            {logs.length === 0 ? (
                <p>No logs available</p>
            ) : (
                <table className="log-table">
                    <thead>
                        <tr>
                            <th>Timestamp</th>
                            <th>Layer</th>
                            <th>Status</th>
                            <th>Rows Read</th>
                            <th>Rows Written</th>
                            <th>Duration</th>
                        </tr>
                    </thead>
                    <tbody>
                        {logs.map((log, idx) => (
                            <tr key={idx}>
                                <td>{new Date(log.timestamp).toLocaleString()}</td>
                                <td>{log.layer}</td>
                                <td>{log.status}</td>
                                <td>{log.rows_read?.toLocaleString()}</td>
                                <td>{log.rows_written?.toLocaleString()}</td>
                                <td>{log.duration_seconds?.toFixed(2)}s</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
};
```

### Step 4: Create Playwright E2E Test Suite

**File**: `tests/e2e/execution-matrix.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:5173';

test.describe('Execution Matrix Page', () => {

    // ========================================================================
    // T-LOAD-01: Page loads and renders
    // ========================================================================

    test('T-LOAD-01.1: Page loads at /', async ({ page }) => {
        await page.goto(BASE_URL + '/');
        await expect(page).toHaveURL(BASE_URL + '/');
    });

    test('T-LOAD-01.2: No console errors', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', msg => {
            if (msg.type() === 'error') {
                errors.push(msg.text());
            }
        });

        await page.goto(BASE_URL + '/');
        await page.waitForLoadState('networkidle');

        expect(errors).toHaveLength(0);
    });

    test('T-LOAD-01.3: Page title or heading visible', async ({ page }) => {
        await page.goto(BASE_URL + '/');
        const heading = page.locator('h1');
        await expect(heading).toContainText(/execution|matrix/i);
    });

    test('T-LOAD-01.4: KPI cards render', async ({ page }) => {
        await page.goto(BASE_URL + '/');
        const kpiCards = page.locator('.kpi-card');
        await expect(kpiCards).toHaveCount(4);
    });

    test('T-LOAD-01.5: Entity table renders', async ({ page }) => {
        await page.goto(BASE_URL + '/');
        const table = page.locator('.entity-table');
        await expect(table).toBeVisible();

        const rows = table.locator('tbody tr');
        await expect(rows.first()).toBeVisible();
    });

    test('T-LOAD-01.6: Load time < 5s', async ({ page }) => {
        const startTime = Date.now();
        await page.goto(BASE_URL + '/');

        // Wait for all KPIs to be visible
        await page.locator('.kpi-card').nth(3).waitForSelector({ state: 'visible' });

        const loadTime = (Date.now() - startTime) / 1000;
        expect(loadTime).toBeLessThan(5);
    });

    // ========================================================================
    // T-DATA-01: KPI card values
    // ========================================================================

    test('T-DATA-01.7: Total Entities matches API', async ({ page, request }) => {
        await page.goto(BASE_URL + '/');

        // Get value from UI
        const totalEntitiesCard = page.locator('.kpi-card').filter({ hasText: 'Total Entities' });
        const uiValue = await totalEntitiesCard.locator('.kpi-card__value').textContent();

        // Get value from API
        const response = await request.get(BASE_URL.replace('5173', '8787') + '/api/entity-digest');
        const data = await response.json();

        expect(parseInt(uiValue || '0')).toBe(data.total_entities);
    });

    test('T-DATA-01.8: Success Rate % calculated correctly', async ({ page, request }) => {
        await page.goto(BASE_URL + '/');

        const successRateCard = page.locator('.kpi-card').filter({ hasText: 'Success Rate' });
        const uiValue = await successRateCard.locator('.kpi-card__value').textContent();

        const response = await request.get(BASE_URL.replace('5173', '8787') + '/api/entity-digest');
        const data = await response.json();

        const succeeded = data.entities.filter((e: any) => e.overall_status === 'succeeded').length;
        const total = data.total_entities;
        const expectedRate = (succeeded / total * 100).toFixed(1);

        expect(uiValue).toContain(expectedRate);
    });

    test('T-DATA-01.9: Error Count matches digest', async ({ page, request }) => {
        await page.goto(BASE_URL + '/');

        const errorCard = page.locator('.kpi-card').filter({ hasText: 'Errors' });
        const uiValue = await errorCard.locator('.kpi-card__value').textContent();

        const response = await request.get(BASE_URL.replace('5173', '8787') + '/api/entity-digest');
        const data = await response.json();

        const errorCount = data.entities.filter((e: any) => e.overall_status === 'error').length;

        expect(parseInt(uiValue || '0')).toBe(errorCount);
    });

    test('T-DATA-01.10: Last Run status badge matches API', async ({ page, request }) => {
        await page.goto(BASE_URL + '/');

        const lastRunCard = page.locator('.kpi-card').filter({ hasText: 'Last Run' });
        const uiValue = await lastRunCard.locator('.kpi-card__value').textContent();

        const response = await request.get(BASE_URL.replace('5173', '8787') + '/api/engine/status');
        const data = await response.json();

        expect(uiValue).toContain(data.last_run?.status || 'N/A');
    });

    // ========================================================================
    // T-INT-01: Filters and search
    // ========================================================================

    test('T-INT-01.24: Search box filters table', async ({ page }) => {
        await page.goto(BASE_URL + '/');

        // Wait for table to load
        await page.locator('.entity-table tbody tr').first().waitFor();

        // Get initial row count
        const initialRows = await page.locator('.entity-table tbody tr').count();

        // Type in search box
        await page.locator('input[placeholder*="Search"]').fill('ETQ');

        // Wait for filter to apply
        await page.waitForTimeout(500);

        // Get filtered row count
        const filteredRows = await page.locator('.entity-table tbody tr').count();

        // Should have fewer rows after filtering
        expect(filteredRows).toBeLessThan(initialRows);
        expect(filteredRows).toBeGreaterThan(0); // Should have some ETQ entities
    });

    test('T-INT-01.25: Status filter works', async ({ page }) => {
        await page.goto(BASE_URL + '/');

        await page.locator('select').filter({ hasText: 'All Statuses' }).selectOption('failed');
        await page.waitForTimeout(500);

        // All visible rows should have "failed" status badge
        const rows = page.locator('.entity-table tbody tr');
        const count = await rows.count();

        for (let i = 0; i < count; i++) {
            const statusBadge = rows.nth(i).locator('.status-badge--failed');
            await expect(statusBadge).toBeVisible();
        }
    });

    test('T-INT-01.27: Clear search box restores all rows', async ({ page }) => {
        await page.goto(BASE_URL + '/');

        const initialCount = await page.locator('.entity-table tbody tr').count();

        await page.locator('input[placeholder*="Search"]').fill('ETQ');
        await page.waitForTimeout(500);

        const filteredCount = await page.locator('.entity-table tbody tr').count();
        expect(filteredCount).toBeLessThan(initialCount);

        await page.locator('input[placeholder*="Search"]').clear();
        await page.waitForTimeout(500);

        const restoredCount = await page.locator('.entity-table tbody tr').count();
        expect(restoredCount).toBe(initialCount);
    });

    test('T-INT-01.28: Column header sorting works', async ({ page }) => {
        await page.goto(BASE_URL + '/');

        // Click "Table Name" header
        await page.locator('th').filter({ hasText: 'Table Name' }).click();

        // Get first row table name
        const firstRowTableName = await page.locator('.entity-table tbody tr').first().locator('td').first().textContent();

        // Click header again (toggle sort direction)
        await page.locator('th').filter({ hasText: 'Table Name' }).click();

        // Get first row table name after re-sort
        const newFirstRowTableName = await page.locator('.entity-table tbody tr').first().locator('td').first().textContent();

        // Should be different (alphabetical order reversed)
        expect(firstRowTableName).not.toBe(newFirstRowTableName);
    });

    // ========================================================================
    // T-INT-02: Time range and refresh
    // ========================================================================

    test('T-INT-02.31: Time range selector changes metrics', async ({ page }) => {
        await page.goto(BASE_URL + '/');

        // Click "1h" button
        await page.locator('button').filter({ hasText: '1h' }).click();

        // Verify API call was made with ?hours=1
        // (This requires intercepting network requests)
        const response = await page.waitForResponse(resp =>
            resp.url().includes('/api/entity-digest') && resp.url().includes('hours=1')
        );

        expect(response.status()).toBe(200);
    });

    test('T-INT-02.34: Auto-refresh toggle works', async ({ page }) => {
        await page.goto(BASE_URL + '/');

        // Enable auto-refresh
        await page.locator('input[type="checkbox"]').check();

        // Wait and verify API calls are recurring
        let callCount = 0;
        page.on('request', req => {
            if (req.url().includes('/api/entity-digest')) {
                callCount++;
            }
        });

        await page.waitForTimeout(12000); // 12 seconds → should have 2-3 calls (every 5s)

        expect(callCount).toBeGreaterThanOrEqual(2);
    });

    // ========================================================================
    // T-INT-03: Entity drill-down
    // ========================================================================

    test('T-INT-03.37: Clicking entity row expands detail panel', async ({ page }) => {
        await page.goto(BASE_URL + '/');

        // Click first row
        await page.locator('.entity-table tbody tr').first().click();

        // Detail panel should appear
        const detailPanel = page.locator('.entity-detail-panel');
        await expect(detailPanel).toBeVisible();
    });

    test('T-INT-03.38: Detail panel shows log entries', async ({ page }) => {
        await page.goto(BASE_URL + '/');

        await page.locator('.entity-table tbody tr').first().click();

        // Wait for logs to load
        await page.waitForTimeout(1000);

        const logTable = page.locator('.log-table');
        await expect(logTable).toBeVisible();

        // Should have at least one log entry
        const logRows = logTable.locator('tbody tr');
        await expect(logRows.first()).toBeVisible();
    });

    test('T-INT-03.40: Clicking expanded row again collapses panel', async ({ page }) => {
        await page.goto(BASE_URL + '/');

        const firstRow = page.locator('.entity-table tbody tr').first();

        // Expand
        await firstRow.click();
        await expect(page.locator('.entity-detail-panel')).toBeVisible();

        // Collapse
        await firstRow.click();
        await expect(page.locator('.entity-detail-panel')).not.toBeVisible();
    });

});
```

---

## Acceptance Criteria

### ✅ Definition of Done

| ID | Criterion | Verification Method |
|----|-----------|-------------------|
| AC-1 | All 40 test assertions pass | `npm run test:e2e -- execution-matrix.spec.ts` → 40/40 passed |
| AC-2 | Page loads in < 5 seconds | Playwright performance test passes |
| AC-3 | KPI cards display correct values | API values match UI values (T-DATA-01) |
| AC-4 | Entity table shows all 1,666 entities | Table row count = 1,666 (when no filters) |
| AC-5 | Search filter works | Typing "ETQ" filters to ~29 entities |
| AC-6 | Status filter works | Selecting "Failed" shows only failed entities |
| AC-7 | Source filter works | Selecting "MES" shows only MES entities |
| AC-8 | Column sorting works | Clicking headers re-sorts table |
| AC-9 | Time range selector works | Clicking 1h/24h/7d changes API query parameter |
| AC-10 | Auto-refresh polls API | Network tab shows requests every 5s when enabled |
| AC-11 | Entity drill-down works | Clicking row expands detail panel with logs |
| AC-12 | Pie chart renders | Layer breakdown chart visible |
| AC-13 | No console errors | Browser console clean |
| AC-14 | Responsive design | Page usable on 1920×1080 and 1366×768 |

### Test Execution Commands

```bash
# Step 1: Start dashboard server
cd dashboard
npm run dev  # Starts on http://127.0.0.1:5173

# Step 2: Start API server (in separate terminal)
cd dashboard/app/api
python server.py  # Starts on http://127.0.0.1:8787

# Step 3: Run Playwright tests
npm run test:e2e -- execution-matrix.spec.ts

# Step 4: Run specific test category
npm run test:e2e -- execution-matrix.spec.ts -g "T-LOAD"  # Page load tests only
npm run test:e2e -- execution-matrix.spec.ts -g "T-DATA"  # Data validation tests
npm run test:e2e -- execution-matrix.spec.ts -g "T-INT"   # Interaction tests

# Step 5: Run tests with UI (debug mode)
npm run test:e2e -- execution-matrix.spec.ts --headed --slowMo=500

# Step 6: Generate HTML report
npm run test:e2e -- execution-matrix.spec.ts --reporter=html

# Step 7: Manual verification checklist
# - Navigate to http://127.0.0.1:5173/
# - Verify Total Entities = 1,666
# - Verify Success Rate % matches calculation
# - Click "ETQ" source filter → should show ~29 entities
# - Type "User" in search → should filter table
# - Click entity row → detail panel should expand
# - Toggle auto-refresh ON → network tab should show API calls every 5s
# - Click time range buttons → should trigger API calls
```

---

## Dependencies

### Upstream Dependencies
- ✅ 001-verify-bronze-silver-100-entity-activation (need entities to display)
- ✅ `/api/entity-digest` endpoint functional
- ✅ `/api/engine/status` endpoint functional
- ✅ Control plane DB populated with entity data

### Downstream Dependencies
- 🔒 Dashboard production deployment
- 🔒 User training and onboarding
- 🔒 Operational monitoring playbook

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Test pass rate | 100% (40/40) | Playwright test output |
| Page load time | < 5s | Playwright performance test |
| API response time | < 500ms | Network tab timing |
| Table render time | < 1s for 1,666 rows | React profiler |
| Filter response time | < 100ms | User perception (instant) |
| Search response time | < 100ms | User perception (instant) |
| Auto-refresh stability | 0 errors in 1-hour run | Extended test |

---

## Notes & Gotchas

1. **Virtualized scrolling for 1,666 rows**
   - Rendering all 1,666 rows at once is slow (> 2s)
   - Use `react-window` or `react-virtualized` for performance
   - Only render visible rows + buffer

2. **Auto-refresh doesn't spam API**
   - 5-second interval is reasonable (not too aggressive)
   - Can add exponential backoff if API is slow
   - Pause auto-refresh when user is interacting (debounce)

3. **Search is client-side (fast)**
   - Filtering 1,666 entities in-memory is instant
   - Server-side search not needed for this dataset size
   - If entity count grows to 10K+, consider server-side pagination

4. **Status badge colors**
   - succeeded = green (#10b981)
   - failed = red (#ef4444)
   - pending = amber (#f59e0b)
   - Use semantic CSS classes, not inline styles

5. **Drill-down panel performance**
   - Lazy-load logs only when row is clicked
   - Cache logs in React state (don't re-fetch on collapse/expand)
   - Show loading spinner while fetching

6. **Playwright test stability**
   - Use `waitForLoadState('networkidle')` before assertions
   - Avoid hard-coded `waitForTimeout` when possible
   - Use `await expect(...).toBeVisible()` with built-in retry logic

---

## References

- `knowledge/TEST-PLAN.md` § Page 1: Execution Matrix (40 assertions)
- `knowledge/DEFINITION-OF-DONE.md` § 8.1: Dashboard page completion criteria
- `dashboard/app/api/control_plane_db.py`: Backend data source
- Playwright docs: https://playwright.dev/
- React performance optimization: https://react.dev/learn/render-and-commit

---

**Estimated Effort**: 16 hours (8h implementation + 4h testing + 2h debugging + 2h polish)
**Risk Level**: Medium (UI work, many moving parts, browser compatibility)
**Reviewer**: ux-hype (@ux-hype)
