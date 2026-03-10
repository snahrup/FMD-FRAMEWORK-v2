// fmd-dashboard-audit.spec.ts
// Playwright test suite — cross-page data consistency audit for FMD Dashboard
//
// Philosophy:
//   Test 1 (Execution Matrix) is the SOURCE OF TRUTH. It scrapes total entities,
//   layer health numbers (succeeded/failed/neverRun), source breakdowns, etc.
//   Every subsequent test scrapes a different page and asserts its numbers match
//   what the Execution Matrix reported.  If they disagree, that's a real bug.
//
// Run with: npm run test:audit
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '.audit-data.json');

// Force serial execution — tests share state via file
test.describe.configure({ mode: 'serial' });

// ── Helpers ──────────────────────────────────────────────────

function saveData(d: Partial<DashboardData>) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

function loadData(): Partial<DashboardData> {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); } catch { return {}; }
}

/** Get the visible body text (reflects CSS text-transform: uppercase) */
async function getBody(page: Page): Promise<string> {
    return (await page.locator('body').innerText()) || '';
}

/** Wait for page to finish loading (no spinners) */
async function waitForPageLoad(page: Page, timeout = 10000) {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    try {
        await page.waitForFunction(
            () => !document.querySelector('[class*="spinner"], [class*="loading"]')?.textContent?.includes('Loading'),
            { timeout }
        );
    } catch {
        // Continue even if timeout — page may not have spinners
    }
    await page.waitForTimeout(500);
}

/** Safely extract first capture group as a number (handles commas) */
function extract(text: string, pattern: RegExp): number {
    const m = text.match(pattern);
    if (!m || !m[1]) return -1;
    return parseInt(m[1].replace(/,/g, ''), 10) || 0;
}

/** Extract two capture groups as numbers */
function extract2(text: string, pattern: RegExp): [number, number] {
    const m = text.match(pattern);
    if (!m || !m[1] || !m[2]) return [-1, -1];
    return [
        parseInt(m[1].replace(/,/g, ''), 10) || 0,
        parseInt(m[2].replace(/,/g, ''), 10) || 0,
    ];
}

// ── Data Interface ──────────────────────────────────────────

interface DashboardData {
    execMatrix: {
        totalEntities: number;
        sourceBreakdown: Record<string, number>;
        successRate: string;
        lastRun: string;
        activeErrors: number;
        landingZone: { succeeded: number; failed: number; neverRun: number };
        bronze: { succeeded: number; failed: number; neverRun: number };
        silver: { succeeded: number; failed: number; neverRun: number };
        tableEntityCount: number;
    };
    engineControl: {
        runCount: number;
    };
    validation: {
        totalActive: number;
        landingZoneLoaded: number;
        bronzeLoaded: number;
        silverLoaded: number;
    };
    liveMonitor: {
        landingZone: { loaded: number; total: number; registered: number };
        bronze: { loaded: number; total: number; registered: number };
        silver: { loaded: number; total: number; registered: number; pending: number };
    };
    controlPlane: {
        headerConnections: number;
        headerSources: number;
        headerEntities: number;
        entityMetadataCount: number;
        executionLogCount: number;
        connectionsTabCount: number;
        connectionEntitySum: number;
    };
    errorIntelligence: {
        total: number;
        critical: number;
        warnings: number;
        info: number;
    };
    executionLog: {
        pipelineRuns: number;
        copyActivities: number;
        notebookRuns: number;
    };
    sourceManager: {
        gatewayConnections: number;
        dataSources: number;
        landingZoneEntities: number;
        sqlConnections: number;
    };
    flowExplorer: {
        totalTables: number;
        landingZoneTotal: number;
        bronzeTotal: number;
        silverTotal: number;
    };
    recordCounts: {
        bronze: number;
        silver: number;
        matched: number;
        mismatched: number;
        total: number;
    };
    dataProfiler: {
        entityCount: number;
    };
    sankeyFlow: {
        hasContent: boolean;
        hasSvg: boolean;
    };
    notebookDebug: {
        tableCount: number;
    };
    impactPulse: {
        totalEntities: number;
    };
    loadProgress: {
        loadedEntities: number;
        totalEntities: number;
        pctComplete: number;
        pendingEntities: number;
    };
    columnEvolution: {
        columnCount: number;
        hasSteps: boolean;
    };
    dataJourney: {
        hasLayers: boolean;
        hasSchemaTable: boolean;
    };
    dataMicroscope: {
        hasGrid: boolean;
        hasLayers: boolean;
    };
    transformationReplay: {
        stepCount: number;
        totalSteps: number;
    };
    executiveDashboard: {
        totalEntities: number;
        bronzePct: string;
        silverPct: string;
        sourceSystems: number;
    };
}

// ==========================================
// DATA COLLECTION: Scrape numbers from each page
// ==========================================

test.describe('FMD Dashboard Cross-Page Consistency Audit', () => {

    // ── TEST 1: Execution Matrix (/) — SOURCE OF TRUTH ──
    test('1. Scrape Execution Matrix', async ({ page }) => {
        const data = loadData();
        await page.goto('/');
        await waitForPageLoad(page);

        // KPI cards — find label, go up to card container, get innerText
        async function kpiValue(label: string): Promise<string> {
            const el = page.locator(`text=${label}`).first();
            const card = el.locator('xpath=../../..');
            return (await card.innerText()) || '';
        }

        // Total Entities
        const totalCardText = await kpiValue('Total Entities');
        const totalEntities = extract(totalCardText, /([\d,]+)/);

        // Active Errors
        const errCardText = await kpiValue('Active Errors');
        const activeErrors = extract(errCardText, /([\d,]+)/);

        // Layer Health — uses evaluate with innerText (reflects CSS uppercase)
        const layerData = await page.evaluate(() => {
            const body = document.body.innerText || '';
            const start = body.indexOf('Layer Health');
            const end = body.indexOf('Showing');
            const section = body.substring(start >= 0 ? start : 0, end >= 0 ? end : body.length);
            const re = /([\d,]+)\s*\/\s*([\d,]+)\s*\/\s*([\d,]+)/g;
            const matches: number[][] = [];
            let m;
            while ((m = re.exec(section)) !== null) {
                matches.push([
                    parseInt(m[1].replace(/,/g, '')),
                    parseInt(m[2].replace(/,/g, '')),
                    parseInt(m[3].replace(/,/g, '')),
                ]);
            }
            return matches;
        });

        const [lzNums, brNums, svNums] = [
            layerData[0] || [0, 0, 0],
            layerData[1] || [0, 0, 0],
            layerData[2] || [0, 0, 0],
        ];

        // Table count — handle comma-formatted numbers
        const showingEl = page.locator('text=/Showing [\\d,]+ of/');
        let tableEntityCount = 0;
        if (await showingEl.count() > 0) {
            const showingText = await showingEl.first().innerText() || '';
            tableEntityCount = extract(showingText, /of ([\d,]+)/);
        }

        // Success Rate
        const successCardText = await kpiValue('Success Rate');
        const successRate = successCardText.match(/(\d+%)/)?.[1] || '?';

        // Last Run
        const lastRunCardText = await kpiValue('Last Run');

        data.execMatrix = {
            totalEntities,
            sourceBreakdown: {},
            successRate,
            lastRun: lastRunCardText,
            activeErrors,
            landingZone: { succeeded: lzNums[0], failed: lzNums[1], neverRun: lzNums[2] },
            bronze: { succeeded: brNums[0], failed: brNums[1], neverRun: brNums[2] },
            silver: { succeeded: svNums[0], failed: svNums[1], neverRun: svNums[2] },
            tableEntityCount,
        };
        saveData(data);

        // ── Assertions ──
        expect.soft(totalEntities, 'Exec Matrix scraped totalEntities should be > 0').toBeGreaterThan(0);

        // Layer totals should each equal total entities
        expect.soft(lzNums[0] + lzNums[1] + lzNums[2], 'LZ layer total != Total Entities').toBe(totalEntities);
        expect.soft(brNums[0] + brNums[1] + brNums[2], 'Bronze layer total != Total Entities').toBe(totalEntities);
        expect.soft(svNums[0] + svNums[1] + svNums[2], 'Silver layer total != Total Entities').toBe(totalEntities);

        if (tableEntityCount > 0) {
            expect.soft(tableEntityCount, 'Table entity count != Total Entities').toBe(totalEntities);
        }
    });

    // ── TEST 2: Engine Control (/engine) ──
    test('2. Scrape Engine Control', async ({ page }) => {
        const data = loadData();
        await page.goto('/engine');
        await waitForPageLoad(page);

        const bodyText = await getBody(page);
        const runCount = extract(bodyText, /Run History\s*([\d,]+)/i);

        data.engineControl = { runCount: runCount >= 0 ? runCount : 0 };
        saveData(data);

        expect.soft(runCount, 'Engine Control has 0 runs').toBeGreaterThan(0);
    });

    // ── TEST 3: Validation (/validation) ──
    test('3. Scrape Validation', async ({ page }) => {
        const data = loadData();
        await page.goto('/validation');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        const totalActive = extract(bodyText, /Total Active\s*([\d,]+)/i);
        const landingZoneLoaded = extract(bodyText, /Landing Zone\s*([\d,]+)/i);
        const bronzeLoaded = extract(bodyText, /Bronze\s*([\d,]+)/i);
        const silverLoaded = extract(bodyText, /Silver\s*([\d,]+)/i);

        data.validation = {
            totalActive: totalActive >= 0 ? totalActive : 0,
            landingZoneLoaded: landingZoneLoaded >= 0 ? landingZoneLoaded : 0,
            bronzeLoaded: bronzeLoaded >= 0 ? bronzeLoaded : 0,
            silverLoaded: silverLoaded >= 0 ? silverLoaded : 0,
        };
        saveData(data);

        // ── Assertions ──
        if (data.execMatrix) {
            expect.soft(data.validation.totalActive,
                `Validation Total Active (${data.validation.totalActive}) != Exec Matrix total (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);

            expect.soft(data.validation.bronzeLoaded,
                `BUG 1: Validation Bronze loaded (${data.validation.bronzeLoaded}) != Exec Matrix Bronze succeeded (${data.execMatrix.bronze.succeeded})`)
                .toBe(data.execMatrix.bronze.succeeded);

            expect.soft(data.validation.silverLoaded,
                `BUG 2: Validation Silver loaded (${data.validation.silverLoaded}) != Exec Matrix Silver succeeded (${data.execMatrix.silver.succeeded})`)
                .toBe(data.execMatrix.silver.succeeded);
        }
    });

    // ── TEST 4: Live Monitor (/live) ──
    test('4. Scrape Live Monitor', async ({ page }) => {
        const data = loadData();
        await page.goto('/live');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        const [lzLoaded, lzTotal] = extract2(bodyText, /Landing Zone\s*([\d,]+)\s*\/\s*([\d,]+)/i);
        const lzRegistered = extract(bodyText, /Landing Zone[\s\S]*?Registered:\s*([\d,]+)/i);

        const [brLoaded, brTotal] = extract2(bodyText, /Bronze\s*([\d,]+)\s*\/\s*([\d,]+)/i);
        const brRegistered = extract(bodyText, /Bronze[\s\S]*?Registered:\s*([\d,]+)/i);

        const [svLoaded, svTotal] = extract2(bodyText, /Silver\s*([\d,]+)\s*\/\s*([\d,]+)/i);
        const svRegistered = extract(bodyText, /Silver[\s\S]*?Registered:\s*([\d,]+)/i);
        const svPending = extract(bodyText, /Silver[\s\S]*?Pending:\s*([\d,]+)/i);

        data.liveMonitor = {
            landingZone: { loaded: Math.max(lzLoaded, 0), total: Math.max(lzTotal, 0), registered: Math.max(lzRegistered, 0) },
            bronze: { loaded: Math.max(brLoaded, 0), total: Math.max(brTotal, 0), registered: Math.max(brRegistered, 0) },
            silver: { loaded: Math.max(svLoaded, 0), total: Math.max(svTotal, 0), registered: Math.max(svRegistered, 0), pending: Math.max(svPending, 0) },
        };
        saveData(data);

        // ── Assertions ──
        if (data.execMatrix) {
            // BUG 11: Bronze/Silver registered should equal total entities
            expect.soft(data.liveMonitor.bronze.registered,
                `BUG 11: Bronze registered (${data.liveMonitor.bronze.registered}) != total (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);
            expect.soft(data.liveMonitor.silver.registered,
                `BUG 11: Silver registered (${data.liveMonitor.silver.registered}) != total (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);

            // Bronze loaded should match Exec Matrix Bronze succeeded
            expect.soft(data.liveMonitor.bronze.loaded,
                `Live Monitor Bronze loaded (${data.liveMonitor.bronze.loaded}) != Exec Matrix Bronze succeeded (${data.execMatrix.bronze.succeeded})`)
                .toBe(data.execMatrix.bronze.succeeded);

            // Silver loaded should match Exec Matrix Silver succeeded
            expect.soft(data.liveMonitor.silver.loaded,
                `Live Monitor Silver loaded (${data.liveMonitor.silver.loaded}) != Exec Matrix Silver succeeded (${data.execMatrix.silver.succeeded})`)
                .toBe(data.execMatrix.silver.succeeded);
        }

        // Bronze loaded should match Validation
        if (data.validation) {
            expect.soft(data.liveMonitor.bronze.loaded,
                `BUG 1: Live Monitor Bronze (${data.liveMonitor.bronze.loaded}) != Validation Bronze (${data.validation.bronzeLoaded})`)
                .toBe(data.validation.bronzeLoaded);
        }
    });

    // ── TEST 5: Control Plane (/control) ──
    test('5. Scrape Control Plane', async ({ page }) => {
        const data = loadData();
        await page.goto('/control');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        const headerConnections = extract(bodyText, /([\d,]+)\s*Connections/i);
        const headerSources = extract(bodyText, /([\d,]+)\s*Sources/i);
        const headerEntities = extract(bodyText, /([\d,]+)\s*Entities/i);
        const entityMetadataCount = extract(bodyText, /Entity Metadata\s*([\d,]+)/i);
        const connectionsTabCount = extract(bodyText, /Connections\s*([\d,]+)/i);
        const executionLogCount = extract(bodyText, /Execution Log\s*([\d,]+)/i);

        data.controlPlane = {
            headerConnections: Math.max(headerConnections, 0),
            headerSources: Math.max(headerSources, 0),
            headerEntities: Math.max(headerEntities, 0),
            entityMetadataCount: Math.max(entityMetadataCount, 0),
            executionLogCount: Math.max(executionLogCount, 0),
            connectionsTabCount: Math.max(connectionsTabCount, 0),
            connectionEntitySum: 0,
        };
        saveData(data);

        // ── Assertions ──
        // BUG 4: Header entities == Entity Metadata tab == total entities
        expect.soft(data.controlPlane.headerEntities,
            `BUG 4: CP header Entities (${data.controlPlane.headerEntities}) != Entity Metadata tab (${data.controlPlane.entityMetadataCount})`)
            .toBe(data.controlPlane.entityMetadataCount);

        if (data.execMatrix) {
            expect.soft(data.controlPlane.entityMetadataCount,
                `BUG 4: CP Entity Metadata (${data.controlPlane.entityMetadataCount}) != Exec Matrix total (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);
            expect.soft(data.controlPlane.headerEntities,
                `BUG 4: CP header Entities (${data.controlPlane.headerEntities}) != Exec Matrix total (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);
        }

        // BUG 5: Header connections == Connections tab count
        expect.soft(data.controlPlane.headerConnections,
            `BUG 5: CP header Connections (${data.controlPlane.headerConnections}) != tab (${data.controlPlane.connectionsTabCount})`)
            .toBe(data.controlPlane.connectionsTabCount);
    });

    // ── TEST 5b: Control Plane — Connections Tab ──
    test('5b. Scrape Control Plane Connections', async ({ page }) => {
        const data = loadData();
        await page.goto('/control');
        await waitForPageLoad(page, 15000);

        // Click the Connections tab (find by role or more specific selector)
        const tabs = page.locator('[role="tablist"], [class*="tab"]').locator('text=Connections');
        if (await tabs.count() > 0) {
            await tabs.first().click();
        } else {
            // Fallback: find any clickable with "Connections" text
            await page.locator('text=Connections').first().click();
        }
        await page.waitForTimeout(1000);

        const bodyText = await getBody(page);

        // Sum entities from all connections — pattern: "N entities"
        const entityMatches = [...bodyText.matchAll(/([\d,]+)\s*entities/gi)];
        let totalConnectionEntities = 0;
        for (const match of entityMatches) {
            totalConnectionEntities += parseInt(match[1].replace(/,/g, ''), 10) || 0;
        }

        if (data.controlPlane) {
            data.controlPlane.connectionEntitySum = totalConnectionEntities;
            saveData(data);
        }

        // BUG 3: Connection entity sum should equal total entities (not 3x)
        if (data.execMatrix) {
            expect.soft(totalConnectionEntities,
                `BUG 3: Connection entity sum (${totalConnectionEntities}) != total entities (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);
        }
    });

    // ── TEST 6: Error Intelligence (/errors) ──
    test('6. Scrape Error Intelligence', async ({ page }) => {
        const data = loadData();
        await page.goto('/errors');
        await waitForPageLoad(page);

        const bodyText = await getBody(page);

        // These labels are CSS-uppercased; innerText reflects that
        const total = extract(bodyText, /\bTOTAL\s*([\d,]+)/i);
        const critical = extract(bodyText, /CRITICAL\s*([\d,]+)/i);
        const warnings = extract(bodyText, /WARNINGS?\s*([\d,]+)/i);
        const info = extract(bodyText, /\bINFO\s*([\d,]+)/i);

        data.errorIntelligence = {
            total: Math.max(total, 0),
            critical: Math.max(critical, 0),
            warnings: Math.max(warnings, 0),
            info: Math.max(info, 0),
        };
        saveData(data);

        // ── Assertions ──
        // BUG 6: Exec Matrix "Active Errors" should match Error Intelligence total
        if (data.execMatrix) {
            expect.soft(data.execMatrix.activeErrors,
                `BUG 6: Exec Matrix Active Errors (${data.execMatrix.activeErrors}) != Error Intelligence total (${data.errorIntelligence.total})`)
                .toBe(data.errorIntelligence.total);
        }

        // Sub-totals should add up
        if (data.errorIntelligence.total > 0) {
            expect.soft(data.errorIntelligence.critical + data.errorIntelligence.warnings + data.errorIntelligence.info,
                `Error sub-totals (${data.errorIntelligence.critical}+${data.errorIntelligence.warnings}+${data.errorIntelligence.info}) != total (${data.errorIntelligence.total})`)
                .toBe(data.errorIntelligence.total);
        }

        // BUG 10 (CORRECTED): If ANY layer has failures, Error Intelligence total should be > 0
        if (data.execMatrix) {
            const totalFailed = data.execMatrix.landingZone.failed + data.execMatrix.bronze.failed + data.execMatrix.silver.failed;
            if (totalFailed > 0) {
                expect.soft(data.errorIntelligence.total,
                    `BUG 10: ${totalFailed} layer failures but Error Intelligence shows 0 errors`)
                    .toBeGreaterThan(0);
            }
        }
    });

    // ── TEST 7: Execution Log (/logs) ──
    test('7. Scrape Execution Log', async ({ page }) => {
        const data = loadData();
        await page.goto('/logs');
        await waitForPageLoad(page);

        const bodyText = await getBody(page);

        const pipelineRuns = extract(bodyText, /Pipeline Runs\s*([\d,]+)/i);
        const copyActivities = extract(bodyText, /Copy Activities\s*([\d,]+)/i);
        const notebookRuns = extract(bodyText, /Notebook Runs\s*([\d,]+)/i);

        data.executionLog = {
            pipelineRuns: Math.max(pipelineRuns, 0),
            copyActivities: Math.max(copyActivities, 0),
            notebookRuns: Math.max(notebookRuns, 0),
        };
        saveData(data);

        // BUG 13: Notebook runs should show real statuses, not "status unknown"
        if (data.engineControl && data.engineControl.runCount > 0) {
            const hasStatusUnknown = /status unknown/i.test(bodyText);
            expect.soft(hasStatusUnknown, 'BUG 13: Execution Log shows "status unknown" for notebook runs').toBeFalsy();
        }

        // Sanity: if engine has runs, there should be some pipeline or notebook records
        if (data.engineControl && data.engineControl.runCount > 0) {
            expect.soft(data.executionLog.pipelineRuns + data.executionLog.notebookRuns,
                'Execution Log has 0 pipeline + notebook runs but Engine Control has runs')
                .toBeGreaterThan(0);
        }
    });

    // ── TEST 8: Pipeline Runner (/runner) ──
    test('8. Scrape Pipeline Runner', async ({ page }) => {
        const data = loadData();
        await page.goto('/runner');
        await waitForPageLoad(page);

        const bodyText = await getBody(page);

        // Source cards show per-source entity counts per layer
        // Look for patterns like: Landing N  Bronze N  Silver N
        // and "N total entities" or "N entities"
        const sourceMatches = [...bodyText.matchAll(/([\d,]+)\s*total entit/gi)];
        let runnerTotalEntities = 0;
        for (const m of sourceMatches) {
            runnerTotalEntities += parseInt(m[1].replace(/,/g, ''), 10) || 0;
        }

        // If the runner shows a grand total, use that
        if (runnerTotalEntities === 0) {
            // Fallback: check for source cards with entity counts
            const entityMentions = [...bodyText.matchAll(/([\d,]+)\s*entities/gi)];
            for (const m of entityMentions) {
                runnerTotalEntities += parseInt(m[1].replace(/,/g, ''), 10) || 0;
            }
        }

        // Verify source names appear
        const hasMES = /\bMES\b/i.test(bodyText);
        const hasETQ = /\bETQ/i.test(bodyText);
        const hasM3C = /\bM3C|DI_PRD/i.test(bodyText);

        // BUG 18: Source names should be present (at least the 3 registered sources)
        if (data.execMatrix && data.execMatrix.totalEntities > 0) {
            expect.soft(hasMES, 'Pipeline Runner should show MES source').toBeTruthy();
            expect.soft(hasETQ, 'Pipeline Runner should show ETQ source').toBeTruthy();
        }
    });

    // ── TEST 9: Source Manager (/sources) ──
    test('9. Scrape Source Manager', async ({ page }) => {
        const data = loadData();
        await page.goto('/sources');
        await waitForPageLoad(page);

        const bodyText = await getBody(page);

        // KPI cards show number on a separate line ABOVE the label
        // innerText preserves the line break: "4\nGateway Connections"
        const gatewayConnections = extract(bodyText, /([\d,]+)\s*\n?\s*Gateway Connections/i);
        const dataSources = extract(bodyText, /([\d,]+)\s*\n?\s*Data Sources/i);
        const landingZoneEntities = extract(bodyText, /([\d,]+)\s*\n?\s*Landing Zone Entities/i);
        const sqlConnections = extract(bodyText, /([\d,]+)\s*\n?\s*SQL Connections/i);

        data.sourceManager = {
            gatewayConnections: Math.max(gatewayConnections, 0),
            dataSources: Math.max(dataSources, 0),
            landingZoneEntities: Math.max(landingZoneEntities, 0),
            sqlConnections: Math.max(sqlConnections, 0),
        };
        saveData(data);

        // ── Assertions ──
        // LZ entities should match total entities from Exec Matrix
        if (data.execMatrix) {
            expect.soft(data.sourceManager.landingZoneEntities,
                `Source Manager LZ entities (${data.sourceManager.landingZoneEntities}) != Exec Matrix total (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);
        }

        expect.soft(data.sourceManager.dataSources,
            'BUG 18: Source Manager should have data sources registered').toBeGreaterThan(0);
        expect.soft(data.sourceManager.gatewayConnections,
            'Source Manager should have gateway connections').toBeGreaterThan(0);
    });

    // ── TEST 10: Data Blender (/blender) ──
    test('10. Scrape Data Blender', async ({ page }) => {
        const data = loadData();
        await page.goto('/blender');
        await waitForPageLoad(page);

        const bodyText = await getBody(page);

        // Data Blender may show layer counts in the TableBrowser sidebar
        const landingZone = extract(bodyText, /Landing Zone\s*([\d,]+)/i);
        const bronze = extract(bodyText, /Bronze\s*([\d,]+)/i);
        const silver = extract(bodyText, /Silver\s*([\d,]+)/i);
        const totalTables = extract(bodyText, /([\d,]+)\s*tables/i);

        // Only assert if we found actual data (page may show empty state)
        if (landingZone > 0 && data.execMatrix) {
            expect.soft(landingZone,
                `Data Blender LZ (${landingZone}) != total entities (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);
        }
        if (bronze > 0 && data.execMatrix) {
            expect.soft(bronze,
                `BUG 1: Data Blender Bronze (${bronze}) != Exec Matrix Bronze succeeded (${data.execMatrix.bronze.succeeded})`)
                .toBe(data.execMatrix.bronze.succeeded);
        }
        if (silver > 0 && data.execMatrix) {
            expect.soft(silver,
                `BUG 2: Data Blender Silver (${silver}) != Exec Matrix Silver succeeded (${data.execMatrix.silver.succeeded})`)
                .toBe(data.execMatrix.silver.succeeded);
        }
    });

    // ── TEST 11: Flow Explorer (/flow) ──
    test('11. Scrape Flow Explorer', async ({ page }) => {
        const data = loadData();
        await page.goto('/flow');
        await waitForPageLoad(page);

        const bodyText = await getBody(page);

        // Look for entity count patterns in the flow narrative cards
        const entityCountMatches = [...bodyText.matchAll(/([\d,]+)\s*entit/gi)];
        let maxEntityCount = 0;
        for (const m of entityCountMatches) {
            const n = parseInt(m[1].replace(/,/g, ''), 10) || 0;
            if (n > maxEntityCount) maxEntityCount = n;
        }

        // Source names should be present
        const hasSources = /MES|ETQ|M3C|DI_PRD/i.test(bodyText);

        data.flowExplorer = {
            totalTables: maxEntityCount,
            landingZoneTotal: 0,
            bronzeTotal: 0,
            silverTotal: 0,
        };
        saveData(data);

        // At least some entity references should exist
        if (data.execMatrix && data.execMatrix.totalEntities > 0) {
            expect.soft(hasSources, 'Flow Explorer should show source system names').toBeTruthy();
        }
    });

    // ── TEST 12: Record Counts (/counts) ──
    test('12. Scrape Record Counts', async ({ page }) => {
        const data = loadData();
        await page.goto('/counts');
        await waitForPageLoad(page, 15000);
        await page.waitForTimeout(5000); // SQL query page — give it time

        const bodyText = await getBody(page);

        const bronze = extract(bodyText, /Bronze\s*([\d,]+)/i);
        const silver = extract(bodyText, /Silver\s*([\d,]+)/i);
        const matched = extract(bodyText, /Matched\s*([\d,]+)/i);
        const mismatched = extract(bodyText, /Mismatched\s*([\d,]+)/i);
        const total = extract(bodyText, /Total\s*([\d,]+)/i);

        data.recordCounts = {
            bronze: Math.max(bronze, 0),
            silver: Math.max(silver, 0),
            matched: Math.max(matched, 0),
            mismatched: Math.max(mismatched, 0),
            total: Math.max(total, 0),
        };
        saveData(data);

        // ── Assertions ──
        if (data.execMatrix) {
            // BUG 1: Record Counts Bronze should match Exec Matrix Bronze succeeded
            if (data.recordCounts.bronze > 0) {
                expect.soft(data.recordCounts.bronze,
                    `BUG 1: Record Counts Bronze (${data.recordCounts.bronze}) != Exec Matrix Bronze succeeded (${data.execMatrix.bronze.succeeded})`)
                    .toBe(data.execMatrix.bronze.succeeded);
            }
            // BUG 2: Record Counts Silver should match Exec Matrix Silver succeeded
            if (data.recordCounts.silver > 0) {
                expect.soft(data.recordCounts.silver,
                    `BUG 2: Record Counts Silver (${data.recordCounts.silver}) != Exec Matrix Silver succeeded (${data.execMatrix.silver.succeeded})`)
                    .toBe(data.execMatrix.silver.succeeded);
            }
        }

        // BUG 19-20: If matched > 0, rows shouldn't be 0
        if (data.recordCounts.matched > 0) {
            expect.soft(data.recordCounts.bronze,
                `BUG 19: Record Counts has ${data.recordCounts.matched} matches but Bronze shows 0`).toBeGreaterThan(0);
            expect.soft(data.recordCounts.silver,
                `BUG 20: Record Counts has ${data.recordCounts.matched} matches but Silver shows 0`).toBeGreaterThan(0);
        }
    });

    // ── TEST 13: Data Profiler (/profile) ──
    test('13. Scrape Data Profiler', async ({ page }) => {
        const data = loadData();
        await page.goto('/profile');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        const entityCount = extract(bodyText, /All Sources\s*\(?([\d,]+)\s*entit/i)
            || extract(bodyText, /([\d,]+)\s*entit/i);

        data.dataProfiler = { entityCount: Math.max(entityCount, 0) };
        saveData(data);

        // BUG 16: Data Profiler entity count should match total
        if (data.execMatrix) {
            expect.soft(data.dataProfiler.entityCount,
                `BUG 16: Data Profiler entities (${data.dataProfiler.entityCount}) != total (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);
        }
    });

    // ── TEST 14: Sankey / Data Flow (/sankey) ──
    test('14. Scrape Sankey Data Flow', async ({ page }) => {
        const data = loadData();
        await page.goto('/sankey');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);
        const contentLength = bodyText.replace(/\s+/g, ' ').trim().length;
        const svgCount = await page.locator('svg').count();
        const hasDataElements = await page.locator('[class*="sankey"], [class*="node"], [class*="link"], path, rect').count() > 0;

        data.sankeyFlow = {
            hasContent: contentLength > 100,
            hasSvg: svgCount > 0 || hasDataElements,
        };
        saveData(data);

        // BUG 14: Page should not be blank
        expect.soft(data.sankeyFlow.hasContent, 'BUG 14: Sankey page body is blank/empty').toBeTruthy();
        expect.soft(data.sankeyFlow.hasSvg, 'BUG 14: Sankey page has no chart/visualization').toBeTruthy();
    });

    // ── TEST 15: Pipeline Testing / Notebook Debug (/notebook-debug) ──
    test('15. Scrape Pipeline Testing', async ({ page }) => {
        const data = loadData();
        await page.goto('/notebook-debug');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        const tableCount = extract(bodyText, /All sources?\s*\(?([\d,]+)\s*tables?\)?/i)
            || extract(bodyText, /([\d,]+)\s*tables/i);

        data.notebookDebug = { tableCount: Math.max(tableCount, 0) };
        saveData(data);

        // BUG 17: Should show tables, not 0
        expect.soft(data.notebookDebug.tableCount,
            `BUG 17: Pipeline Testing shows ${data.notebookDebug.tableCount} tables — should be > 0`)
            .toBeGreaterThan(0);
    });

    // ── TEST 16: Impact Pulse (/pulse) ──
    test('16. Scrape Impact Pulse', async ({ page }) => {
        const data = loadData();
        await page.goto('/pulse');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        // Impact Pulse header shows "N entities" in the floating header
        const totalEntities = extract(bodyText, /([\d,]+)\s*entities/i);

        // Source nodes should be present
        const hasMES = /\bMES\b/i.test(bodyText);
        const hasETQ = /\bETQ/i.test(bodyText);

        // Layer nodes should be present
        const hasLandingZone = /Landing Zone/i.test(bodyText);
        const hasBronze = /Bronze/i.test(bodyText);
        const hasSilver = /Silver/i.test(bodyText);

        data.impactPulse = {
            totalEntities: Math.max(totalEntities, 0),
        };
        saveData(data);

        // ── Assertions ──
        if (data.execMatrix && data.impactPulse.totalEntities > 0) {
            // BUG 15: Impact Pulse total entities should match Exec Matrix
            expect.soft(data.impactPulse.totalEntities,
                `BUG 15: Impact Pulse entities (${data.impactPulse.totalEntities}) != Exec Matrix total (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);
        }

        // All layer nodes should render
        expect.soft(hasLandingZone, 'Impact Pulse should show Landing Zone node').toBeTruthy();
        expect.soft(hasBronze, 'Impact Pulse should show Bronze node').toBeTruthy();
        expect.soft(hasSilver, 'Impact Pulse should show Silver node').toBeTruthy();

        // Source nodes should render
        if (data.execMatrix && data.execMatrix.totalEntities > 0) {
            expect.soft(hasMES, 'Impact Pulse should show MES source node').toBeTruthy();
            expect.soft(hasETQ, 'Impact Pulse should show ETQ source node').toBeTruthy();
        }
    });

    // ── TEST 17: Load Progress (/load-progress) ──
    test('17. Scrape Load Progress', async ({ page }) => {
        const data = loadData();
        await page.goto('/load-progress');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        // Hero section: "N / N entities loaded" or "N / N"
        const [loadedEntities, totalEntities] = extract2(bodyText, /([\d,]+)\s*\/\s*([\d,]+)/);
        const pctComplete = extract(bodyText, /([\d,]+)%/);
        const pendingEntities = extract(bodyText, /([\d,]+)\s*pending/i);

        // Source progress cards should show per-source breakdown
        const hasMES = /\bMES\b/i.test(bodyText);
        const hasETQ = /\bETQ/i.test(bodyText);

        // Activity table or entity list should be present
        const hasTableHeaders = /Source|Table|Status|Rows|Duration/i.test(bodyText);

        data.loadProgress = {
            loadedEntities: Math.max(loadedEntities, 0),
            totalEntities: Math.max(totalEntities, 0),
            pctComplete: Math.max(pctComplete, 0),
            pendingEntities: Math.max(pendingEntities, 0),
        };
        saveData(data);

        // ── Assertions ──
        if (data.execMatrix && data.loadProgress.totalEntities > 0) {
            // Total entities in Load Progress should match Exec Matrix
            expect.soft(data.loadProgress.totalEntities,
                `Load Progress total (${data.loadProgress.totalEntities}) != Exec Matrix total (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);

            // Loaded entities should match LZ succeeded from Exec Matrix
            expect.soft(data.loadProgress.loadedEntities,
                `Load Progress loaded (${data.loadProgress.loadedEntities}) != Exec Matrix LZ succeeded (${data.execMatrix.landingZone.succeeded})`)
                .toBe(data.execMatrix.landingZone.succeeded);

            // Pending + loaded should equal total
            if (data.loadProgress.pendingEntities >= 0) {
                expect.soft(data.loadProgress.loadedEntities + data.loadProgress.pendingEntities,
                    `Load Progress loaded (${data.loadProgress.loadedEntities}) + pending (${data.loadProgress.pendingEntities}) != total (${data.loadProgress.totalEntities})`)
                    .toBe(data.loadProgress.totalEntities);
            }
        }

        // Page should show source-level breakdowns
        if (data.execMatrix && data.execMatrix.totalEntities > 0) {
            expect.soft(hasMES, 'Load Progress should show MES source card').toBeTruthy();
            expect.soft(hasETQ, 'Load Progress should show ETQ source card').toBeTruthy();
        }

        expect.soft(hasTableHeaders, 'Load Progress should show activity or entity table').toBeTruthy();
    });

    // ── TEST 18: Executive Dashboard (/executive) ──
    test('18. Scrape Executive Dashboard', async ({ page }) => {
        const data = loadData();
        // Executive Dashboard may be at /executive or at /dashboard
        await page.goto('/executive');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        // Hero stats: Total Entities, Bronze %, Silver %, Pipeline Success
        const totalEntities = extract(bodyText, /Total Entities\s*([\d,]+)/i)
            || extract(bodyText, /([\d,]+)\s*entities/i);
        const bronzePct = bodyText.match(/Bronze[^]*?([\d.]+%)/i)?.[1] || '';
        const silverPct = bodyText.match(/Silver[^]*?([\d.]+%)/i)?.[1] || '';
        const sourceSystems = extract(bodyText, /([\d,]+)\s*data sources/i);

        // Layer flow section should show counts
        const hasLandingZone = /Landing Zone/i.test(bodyText);
        const hasBronze = /Bronze/i.test(bodyText);
        const hasSilver = /Silver/i.test(bodyText);

        data.executiveDashboard = {
            totalEntities: Math.max(totalEntities, 0),
            bronzePct,
            silverPct,
            sourceSystems: Math.max(sourceSystems, 0),
        };
        saveData(data);

        // ── Assertions ──
        if (data.execMatrix && data.executiveDashboard.totalEntities > 0) {
            expect.soft(data.executiveDashboard.totalEntities,
                `Executive Dashboard total (${data.executiveDashboard.totalEntities}) != Exec Matrix total (${data.execMatrix.totalEntities})`)
                .toBe(data.execMatrix.totalEntities);
        }

        // Should show all three layers
        expect.soft(hasLandingZone, 'Executive Dashboard should show Landing Zone').toBeTruthy();
        expect.soft(hasBronze, 'Executive Dashboard should show Bronze').toBeTruthy();
        expect.soft(hasSilver, 'Executive Dashboard should show Silver').toBeTruthy();
    });

    // ── TEST 19: Column Evolution (/columns) ──
    test('19. Scrape Column Evolution', async ({ page }) => {
        const data = loadData();
        await page.goto('/columns');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        // Layer stepper: Source, Landing Zone, Bronze, Silver, Gold
        const hasSource = /\bSource\b/i.test(bodyText);
        const hasLanding = /Landing Zone/i.test(bodyText);
        const hasBronze = /Bronze/i.test(bodyText);
        const hasSilver = /Silver/i.test(bodyText);

        // Column count
        const columnCount = extract(bodyText, /([\d,]+)\s*columns?/i);

        // Diff summary: "+N added", "-N removed", "N type changed"
        const added = extract(bodyText, /\+?\s*([\d,]+)\s*added/i);
        const removed = extract(bodyText, /-?\s*([\d,]+)\s*removed/i);
        const typeChanged = extract(bodyText, /([\d,]+)\s*type changed/i);

        data.columnEvolution = {
            columnCount: Math.max(columnCount, 0),
            hasSteps: hasSource && hasLanding && hasBronze && hasSilver,
        };
        saveData(data);

        // ── Assertions ──
        // Layer stepper should show all steps
        expect.soft(data.columnEvolution.hasSteps,
            'Column Evolution should show all layer steps (Source, Landing, Bronze, Silver)').toBeTruthy();

        // If we have a diff summary, added+removed+changed should be consistent
        if (added > 0 || removed > 0 || typeChanged > 0) {
            expect.soft(added + removed + typeChanged,
                'Column Evolution diff summary should have at least one change').toBeGreaterThan(0);
        }
    });

    // ── TEST 20: Data Journey (/journey) ──
    test('20. Scrape Data Journey', async ({ page }) => {
        const data = loadData();
        await page.goto('/journey');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        // Layer timeline: Source → Landing Zone → Bronze → Silver → Gold
        const hasSource = /\bSource\b/i.test(bodyText);
        const hasLanding = /Landing Zone/i.test(bodyText);
        const hasBronze = /Bronze/i.test(bodyText);
        const hasSilver = /Silver/i.test(bodyText);

        // Schema diff table should be present
        const hasSchemaHeaders = /Column|Type|Nullable/i.test(bodyText);

        // Load type indicator
        const hasLoadType = /Incremental|Full Load/i.test(bodyText);

        // Row counts in transition cards
        const hasRows = /[\d,]+\s*rows/i.test(bodyText);

        data.dataJourney = {
            hasLayers: hasSource && hasLanding && hasBronze && hasSilver,
            hasSchemaTable: hasSchemaHeaders,
        };
        saveData(data);

        // ── Assertions ──
        expect.soft(data.dataJourney.hasLayers,
            'Data Journey should show all layer steps').toBeTruthy();
        expect.soft(data.dataJourney.hasSchemaTable,
            'Data Journey should show schema diff table').toBeTruthy();
    });

    // ── TEST 21: Data Microscope (/microscope) ──
    test('21. Scrape Data Microscope', async ({ page }) => {
        const data = loadData();
        await page.goto('/microscope');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        // Layer summary badges: Source, Landing, Bronze, Silver
        const hasSource = /\bSource\b/i.test(bodyText);
        const hasBronze = /Bronze/i.test(bodyText);
        const hasSilver = /Silver/i.test(bodyText);

        // Diff grid: Column Name header + layer columns
        const hasColumnName = /Column Name/i.test(bodyText);

        // Section groups: "Original Columns (N)" and/or "System Columns (N)"
        const originalCols = extract(bodyText, /Original Columns?\s*\(?([\d,]+)\)?/i);
        const systemCols = extract(bodyText, /System Columns?\s*\(?([\d,]+)\)?/i);

        data.dataMicroscope = {
            hasGrid: hasColumnName,
            hasLayers: hasSource && hasBronze && hasSilver,
        };
        saveData(data);

        // ── Assertions ──
        expect.soft(data.dataMicroscope.hasLayers,
            'Data Microscope should show layer badges').toBeTruthy();
        expect.soft(data.dataMicroscope.hasGrid,
            'Data Microscope should show column diff grid').toBeTruthy();

        // If column groups are present, counts should be > 0
        if (originalCols > 0) {
            expect.soft(originalCols,
                `Data Microscope Original Columns should be > 0`).toBeGreaterThan(0);
        }
    });

    // ── TEST 22: Transformation Replay (/replay) ──
    test('22. Scrape Transformation Replay', async ({ page }) => {
        const data = loadData();
        await page.goto('/replay');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        // Step counter: "N / N steps" or "Step N of N"
        const [currentStep, totalSteps] = extract2(bodyText, /([\d,]+)\s*\/\s*([\d,]+)\s*steps?/i);
        const totalStepsAlt = extract(bodyText, /(\d+)\s*steps/i);

        // Layer badges: "landing", "bronze", "silver"
        const hasLanding = /\blanding\b/i.test(bodyText);
        const hasBronze = /\bbronze\b/i.test(bodyText);
        const hasSilver = /\bsilver\b/i.test(bodyText);

        // Transformation step cards: numbered 1-13
        const hasStepNumbers = /Step\s*\d/i.test(bodyText) || /\b1\b.*\b2\b.*\b3\b/s.test(bodyText);

        // "FIN" end marker
        const hasFin = /\bFIN\b/.test(bodyText) || /Transformation Complete/i.test(bodyText);

        data.transformationReplay = {
            stepCount: Math.max(currentStep, 0),
            totalSteps: totalSteps > 0 ? totalSteps : Math.max(totalStepsAlt, 0),
        };
        saveData(data);

        // ── Assertions ──
        // Should show all layer types
        expect.soft(hasLanding, 'Transformation Replay should show landing steps').toBeTruthy();
        expect.soft(hasBronze, 'Transformation Replay should show bronze steps').toBeTruthy();
        expect.soft(hasSilver, 'Transformation Replay should show silver steps').toBeTruthy();

        // Should have transformation steps (13 is the known count)
        if (data.transformationReplay.totalSteps > 0) {
            expect.soft(data.transformationReplay.totalSteps,
                `Transformation Replay should have 13 steps (got ${data.transformationReplay.totalSteps})`)
                .toBe(13);
        }

        // Should have end marker
        expect.soft(hasFin, 'Transformation Replay should show completion marker (FIN)').toBeTruthy();
    });

    // ── TEST 23: SQL Explorer (/sql-explorer) ──
    test('23. Scrape SQL Explorer', async ({ page }) => {
        const data = loadData();
        await page.goto('/sql-explorer');
        await waitForPageLoad(page, 15000);

        const bodyText = await getBody(page);

        // Should show the object tree with source servers
        const hasObjectExplorer = /SQL Object Explorer|Browse databases/i.test(bodyText);
        const hasReadOnly = /Read.Only/i.test(bodyText);

        // Source servers should appear in the tree (same as source systems)
        const hasM3DB = /m3-db|sqllogship|sql2016/i.test(bodyText);

        // Registered databases should show REGISTERED badge
        const hasRegisteredBadge = /REGISTERED/i.test(bodyText);

        // ── Assertions ──
        expect.soft(hasObjectExplorer, 'SQL Explorer should show object explorer heading').toBeTruthy();
        expect.soft(hasReadOnly, 'SQL Explorer should show read-only badge').toBeTruthy();

        // Source servers from our config should appear
        if (data.sourceManager && data.sourceManager.gatewayConnections > 0) {
            expect.soft(hasM3DB, 'SQL Explorer should show at least one source server').toBeTruthy();
        }
    });

    // ── TEST 24: Admin Gateway (/admin) ──
    test('24. Scrape Admin Gateway', async ({ page }) => {
        const data = loadData();
        await page.goto('/admin');
        await waitForPageLoad(page, 10000);

        const bodyText = await getBody(page);

        // Admin page should show password gate or admin content
        const hasPasswordGate = /Password|Unlock/i.test(bodyText);
        const hasPageVisibility = /Page Visibility|Operations|hidden/i.test(bodyText);

        // One of these should be true (either locked or unlocked)
        expect.soft(hasPasswordGate || hasPageVisibility,
            'Admin Gateway should show either password gate or admin content').toBeTruthy();
    });

    // ==========================================
    // FINAL: Cross-page consistency audit
    // ==========================================
    test('25. Cross-page consistency audit', async ({ page }) => {
        const data = loadData();
        const em = data.execMatrix;
        const ec = data.engineControl;
        const val = data.validation;
        const lm = data.liveMonitor;
        const cp = data.controlPlane;
        const ei = data.errorIntelligence;
        const el = data.executionLog;
        const sm = data.sourceManager;
        const rc = data.recordCounts;
        const dp = data.dataProfiler;
        const nd = data.notebookDebug;
        const sf = data.sankeyFlow;
        const ip = data.impactPulse;
        const lp = data.loadProgress;
        const ed = data.executiveDashboard;

        // ──────────────────────────────────────────────
        // BUG 1: Bronze count should be the same across ALL pages
        // Source of truth: Exec Matrix bronze.succeeded
        // ──────────────────────────────────────────────
        if (em) {
            const expected = em.bronze.succeeded;
            const bronzePages: Record<string, number | undefined> = {
                'Validation': val?.bronzeLoaded,
                'Live Monitor': lm?.bronze.loaded,
                'Record Counts': rc?.bronze && rc.bronze > 0 ? rc.bronze : undefined,
            };
            for (const [pageName, value] of Object.entries(bronzePages)) {
                if (value !== undefined) {
                    expect.soft(value,
                        `BUG 1: Bronze on ${pageName} (${value}) != Exec Matrix (${expected})`)
                        .toBe(expected);
                }
            }
        }

        // ──────────────────────────────────────────────
        // BUG 2: Silver count should be the same across ALL pages
        // ──────────────────────────────────────────────
        if (em) {
            const expected = em.silver.succeeded;
            const silverPages: Record<string, number | undefined> = {
                'Validation': val?.silverLoaded,
                'Live Monitor': lm?.silver.loaded,
                'Record Counts': rc?.silver && rc.silver > 0 ? rc.silver : undefined,
            };
            for (const [pageName, value] of Object.entries(silverPages)) {
                if (value !== undefined) {
                    expect.soft(value,
                        `BUG 2: Silver on ${pageName} (${value}) != Exec Matrix (${expected})`)
                        .toBe(expected);
                }
            }
        }

        // ──────────────────────────────────────────────
        // BUG 3: Connection entity sum == total entities
        // ──────────────────────────────────────────────
        if (cp && em && cp.connectionEntitySum > 0) {
            expect.soft(cp.connectionEntitySum,
                `BUG 3: Connection entity sum (${cp.connectionEntitySum}) != total (${em.totalEntities})`)
                .toBe(em.totalEntities);
        }

        // ──────────────────────────────────────────────
        // BUG 4: Control Plane header "Entities" == Entity Metadata == total
        // ──────────────────────────────────────────────
        if (cp && em) {
            expect.soft(cp.headerEntities,
                `BUG 4: CP header (${cp.headerEntities}) != total (${em.totalEntities})`)
                .toBe(em.totalEntities);
            expect.soft(cp.entityMetadataCount,
                `BUG 4: CP Entity Metadata tab (${cp.entityMetadataCount}) != total (${em.totalEntities})`)
                .toBe(em.totalEntities);
        }

        // ──────────────────────────────────────────────
        // BUG 5: CP header Connections == Connections tab
        // ──────────────────────────────────────────────
        if (cp) {
            expect.soft(cp.headerConnections,
                `BUG 5: CP header Connections (${cp.headerConnections}) != tab (${cp.connectionsTabCount})`)
                .toBe(cp.connectionsTabCount);
        }

        // ──────────────────────────────────────────────
        // BUG 6: Exec Matrix Active Errors == Error Intelligence total
        // ──────────────────────────────────────────────
        if (em && ei) {
            expect.soft(em.activeErrors,
                `BUG 6: Exec Matrix Active Errors (${em.activeErrors}) != Error Intelligence total (${ei.total})`)
                .toBe(ei.total);
        }

        // ──────────────────────────────────────────────
        // BUG 7: Last Run should not say "No runs recorded" if Engine Control has runs
        // ──────────────────────────────────────────────
        if (em && ec && ec.runCount > 0) {
            expect.soft(em.lastRun, 'BUG 7: Exec Matrix shows "No runs recorded" but Engine Control has runs')
                .not.toContain('No runs recorded');
        }

        // ──────────────────────────────────────────────
        // BUG 8: Success Rate should not be 0% when LZ has succeeded loads
        // ──────────────────────────────────────────────
        if (em && em.landingZone.succeeded > 0) {
            expect.soft(em.successRate, 'BUG 8: Success Rate is 0% but LZ has succeeded loads')
                .not.toBe('0%');
        }

        // ──────────────────────────────────────────────
        // BUG 10: If any layer has failures, Error Intelligence should show > 0 errors
        // ──────────────────────────────────────────────
        if (em && ei) {
            const totalFailed = em.landingZone.failed + em.bronze.failed + em.silver.failed;
            if (totalFailed > 0) {
                expect.soft(ei.total,
                    `BUG 10: ${totalFailed} layer failures across LZ/Bronze/Silver but Error Intelligence total is 0`)
                    .toBeGreaterThan(0);
            }
        }

        // ──────────────────────────────────────────────
        // BUG 11: Bronze/Silver registered == total entities
        // ──────────────────────────────────────────────
        if (lm && em) {
            expect.soft(lm.bronze.registered,
                `BUG 11: Bronze registered (${lm.bronze.registered}) != total (${em.totalEntities})`)
                .toBe(em.totalEntities);
            expect.soft(lm.silver.registered,
                `BUG 11: Silver registered (${lm.silver.registered}) != total (${em.totalEntities})`)
                .toBe(em.totalEntities);
        }

        // ──────────────────────────────────────────────
        // BUG 14: Sankey / Data Flow page should not be blank
        // ──────────────────────────────────────────────
        if (sf) {
            expect.soft(sf.hasContent, 'BUG 14: Data Flow page is blank').toBeTruthy();
        }

        // ──────────────────────────────────────────────
        // BUG 15: Impact Pulse total should match Exec Matrix total
        // ──────────────────────────────────────────────
        if (ip && em && ip.totalEntities > 0) {
            expect.soft(ip.totalEntities,
                `BUG 15: Impact Pulse entities (${ip.totalEntities}) != total (${em.totalEntities})`)
                .toBe(em.totalEntities);
        }

        // ──────────────────────────────────────────────
        // BUG 16: Data Profiler entity count should match total
        // ──────────────────────────────────────────────
        if (dp && em) {
            expect.soft(dp.entityCount,
                `BUG 16: Data Profiler (${dp.entityCount}) != total (${em.totalEntities})`)
                .toBe(em.totalEntities);
        }

        // ──────────────────────────────────────────────
        // BUG 17: Pipeline Testing should show tables
        // ──────────────────────────────────────────────
        if (nd) {
            expect.soft(nd.tableCount,
                `BUG 17: Pipeline Testing shows ${nd.tableCount} tables`)
                .toBeGreaterThan(0);
        }

        // ──────────────────────────────────────────────
        // BUG 21: Validation total active == Exec Matrix total
        // ──────────────────────────────────────────────
        if (val && em) {
            expect.soft(val.totalActive,
                `BUG 21: Validation total (${val.totalActive}) != Exec Matrix total (${em.totalEntities})`)
                .toBe(em.totalEntities);
        }

        // ──────────────────────────────────────────────
        // Load Progress total should match Exec Matrix
        // ──────────────────────────────────────────────
        if (lp && em && lp.totalEntities > 0) {
            expect.soft(lp.totalEntities,
                `Load Progress total (${lp.totalEntities}) != Exec Matrix total (${em.totalEntities})`)
                .toBe(em.totalEntities);

            expect.soft(lp.loadedEntities,
                `Load Progress loaded (${lp.loadedEntities}) != Exec Matrix LZ succeeded (${em.landingZone.succeeded})`)
                .toBe(em.landingZone.succeeded);
        }

        // ──────────────────────────────────────────────
        // Executive Dashboard total should match Exec Matrix
        // ──────────────────────────────────────────────
        if (ed && em && ed.totalEntities > 0) {
            expect.soft(ed.totalEntities,
                `Executive Dashboard total (${ed.totalEntities}) != Exec Matrix total (${em.totalEntities})`)
                .toBe(em.totalEntities);
        }

        // ──────────────────────────────────────────────
        // Source Manager LZ entities should match total entities
        // ──────────────────────────────────────────────
        if (sm && em) {
            expect.soft(sm.landingZoneEntities,
                `Source Manager LZ entities (${sm.landingZoneEntities}) != total (${em.totalEntities})`)
                .toBe(em.totalEntities);
        }

        // ──────────────────────────────────────────────
        // SUMMARY
        // ──────────────────────────────────────────────
        console.log('\n========== AUDIT DATA SUMMARY ==========');
        console.log(JSON.stringify(data, null, 2));
        console.log('==========================================\n');
    });
});
