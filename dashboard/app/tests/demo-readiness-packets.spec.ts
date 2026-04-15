import { test, expect, type APIRequestContext, type ConsoleMessage, type Page } from '@playwright/test';

interface MetricContractResponse {
  tables: {
    inScope: { value: number };
    landingLoaded: { value: number };
    bronzeLoaded: { value: number };
    silverLoaded: { value: number };
    toolReady: { value: number };
    blocked: { value: number };
  };
  sources: {
    total: number;
    bySource: Array<{
      source: string;
      tablesInScope: number;
      landingLoaded: number;
      bronzeLoaded: number;
      silverLoaded: number;
      toolReady: number;
      blocked: number;
    }>;
  };
}

interface ValidationResponse {
  lz_status: Array<{ LzLoaded?: number }>;
  bronze_status: Array<{ BronzeLoaded?: number }>;
  silver_status: Array<{ SilverLoaded?: number }>;
  overview: Array<{ Active?: number }>;
}

interface EstateOverviewResponse {
  layers: Array<{ key: string; inScope: number; loaded: number; missing: number }>;
}

interface LiveMonitorResponse {
  counts: Record<string, number | string | undefined>;
}

interface RouteEntry {
  path: string;
  name: string;
}

const BUSINESS_ROUTES: RouteEntry[] = [
  { path: '/overview', name: 'BusinessOverview' },
  { path: '/alerts', name: 'BusinessAlerts' },
  { path: '/sources-portal', name: 'BusinessSources' },
  { path: '/catalog-portal', name: 'BusinessCatalog' },
  { path: '/requests', name: 'BusinessRequests' },
  { path: '/help', name: 'BusinessHelp' },
];

const ENGINEERING_ROUTES: RouteEntry[] = [
  { path: '/matrix', name: 'ExecutionMatrix' },
  { path: '/engine', name: 'EngineControl' },
  { path: '/control', name: 'ControlPlane' },
  { path: '/logs', name: 'ExecutionLog' },
  { path: '/errors', name: 'ErrorIntelligence' },
  { path: '/admin', name: 'AdminGateway' },
  { path: '/flow', name: 'FlowExplorer' },
  { path: '/explore', name: 'ExploreHub' },
  { path: '/sources', name: 'SourceManager' },
  { path: '/blender', name: 'DataBlender' },
  { path: '/counts', name: 'RecordCounts' },
  { path: '/journey', name: 'DataJourney' },
  { path: '/config', name: 'ConfigManager' },
  { path: '/notebook-config', name: 'NotebookConfig' },
  { path: '/validation', name: 'ValidationChecklist' },
  { path: '/notebook-debug', name: 'NotebookDebug' },
  { path: '/live', name: 'LiveMonitor' },
  { path: '/settings', name: 'Settings' },
  { path: '/setup', name: 'EnvironmentSetup' },
  { path: '/sql-explorer', name: 'SqlExplorer' },
  { path: '/load-progress', name: 'LoadProgress' },
  { path: '/profile', name: 'DataProfiler' },
  { path: '/columns', name: 'ColumnEvolution' },
  { path: '/microscope', name: 'DataMicroscope' },
  { path: '/sankey', name: 'SankeyFlow' },
  { path: '/replay', name: 'TransformationReplay' },
  { path: '/pulse', name: 'ImpactPulse' },
  { path: '/load-center', name: 'LoadCenter' },
  { path: '/load-mission-control', name: 'LoadMissionControl' },
];

const GOVERNANCE_AND_SPECIALTY_ROUTES: RouteEntry[] = [
  { path: '/gold/intake', name: 'GoldLedger' },
  { path: '/gold/cluster', name: 'GoldClusters' },
  { path: '/gold/canonical', name: 'GoldCanonical' },
  { path: '/gold/spec', name: 'GoldSpecs' },
  { path: '/gold/release', name: 'GoldValidation' },
  { path: '/gold/serve', name: 'GoldServe' },
  { path: '/lineage', name: 'DataLineage' },
  { path: '/classification', name: 'DataClassification' },
  { path: '/catalog', name: 'DataCatalog' },
  { path: '/impact', name: 'ImpactAnalysis' },
  { path: '/db-explorer', name: 'DatabaseExplorer' },
  { path: '/data-manager', name: 'DataManager' },
  { path: '/schema-validation', name: 'SchemaValidation' },
  { path: '/estate', name: 'DataEstate' },
  { path: '/labs/cleansing', name: 'CleansingRuleEditor' },
  { path: '/labs/scd-audit', name: 'ScdAudit' },
  { path: '/labs/dq-scorecard', name: 'DqScorecard' },
  { path: '/test-audit', name: 'TestAudit' },
  { path: '/test-swarm', name: 'TestSwarm' },
  { path: '/mri', name: 'MRI' },
];

const IGNORABLE_PATTERNS = [
  /Failed to fetch/i,
  /NetworkError/i,
  /ERR_CONNECTION_REFUSED/i,
  /net::ERR_/i,
  /ECONNREFUSED/i,
  /AbortError/i,
  /Load failed/i,
  /TypeError: Load failed/i,
  /404.*api/i,
  /500.*api/i,
];

const BANNED_TEXT_PATTERNS = [
  /\bnot registered\b/i,
  /\balready registered\b/i,
  /\bready to register\b/i,
  /\bregistered entities\b/i,
  /\bregistered sources\b/i,
  /\bregistered pipelines\b/i,
  /\bentity registry\b/i,
  /\bschemas registered\b/i,
  /\bregistered\b/i,
];

function isIgnorable(text: string): boolean {
  return IGNORABLE_PATTERNS.some((pattern) => pattern.test(text));
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return parseInt(value.replace(/,/g, ''), 10) || 0;
  return 0;
}

function sum<T>(rows: T[], getter: (row: T) => unknown): number {
  return rows.reduce((total, row) => total + toInt(getter(row)), 0);
}

function extract(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  return match?.[1] ? toInt(match[1]) : -1;
}

function extractRatio(text: string, label: string): [number, number] {
  const match = text.match(new RegExp(`${label}[\\s\\S]{0,120}?([\\d,]+)\\s*\\/\\s*([\\d,]+)`, 'i'));
  if (!match?.[1] || !match?.[2]) return [-1, -1];
  return [toInt(match[1]), toInt(match[2])];
}

async function waitForPage(page: Page, timeoutMs = 15_000) {
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  try {
    await page.waitForFunction(
      () => !document.querySelector('[class*="spinner"], [class*="loading"]'),
      { timeout: timeoutMs },
    );
  } catch {
    // Some pages intentionally keep polling indicators mounted.
  }
  await page.waitForTimeout(500);
}

async function getBodyText(page: Page): Promise<string> {
  return (await page.locator('body').innerText().catch(() => '')) || '';
}

async function readFactCards(page: Page): Promise<Record<string, number>> {
  return page.locator('[data-metric-label]').evaluateAll((els) => {
    const result: Record<string, number> = {};
    for (const el of els) {
      const node = el as HTMLElement;
      const label = node.dataset.metricLabel || node.innerText.trim();
      const rawValue = node.dataset.metricValue || node.innerText || '0';
      const parsed = parseInt(rawValue.replace(/,/g, ''), 10) || 0;
      result[label] = parsed;
    }
    return result;
  });
}

async function waitForFactValues(page: Page, expectedFacts: Record<string, number>, timeoutMs = 40_000) {
  await page.waitForFunction(
    (entries) => {
      return entries.every(([label, expected]) => {
        const node = document.querySelector(`[data-metric-label="${label}"]`) as HTMLElement | null;
        if (!node) return false;
        const raw = node.dataset.metricValue || "";
        if (!raw || /loading/i.test(raw)) return false;
        const parsed = parseInt(raw.replace(/,/g, ''), 10);
        return parsed === expected;
      });
    },
    Object.entries(expectedFacts),
    { timeout: timeoutMs },
  );
}

async function waitForRatio(page: Page, label: string, loaded: number, scope: number, timeoutMs = 40_000) {
  await page.waitForFunction(
    ([targetLabel, targetLoaded, targetScope]) => {
      const text = document.body.innerText || "";
      const pattern = new RegExp(`${targetLabel}[\\s\\S]{0,120}?([\\d,]+)\\s*\\/\\s*([\\d,]+)`, 'i');
      const match = text.match(pattern);
      if (!match?.[1] || !match?.[2]) return false;
      const loadedValue = parseInt(match[1].replace(/,/g, ''), 10);
      const scopeValue = parseInt(match[2].replace(/,/g, ''), 10);
      return loadedValue === targetLoaded && scopeValue === targetScope;
    },
    [label, loaded, scope],
    { timeout: timeoutMs },
  );
}

async function waitForBodyMetric(page: Page, pattern: string, expected: number, timeoutMs = 40_000) {
  await page.waitForFunction(
    ([rawPattern, target]) => {
      const text = document.body.innerText || "";
      const match = text.match(new RegExp(rawPattern, 'i'));
      if (!match?.[1]) return false;
      return parseInt(match[1].replace(/,/g, ''), 10) === target;
    },
    [pattern, expected],
    { timeout: timeoutMs },
  );
}

async function requestJson<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  expect(response.ok(), `${url} should return 200`).toBeTruthy();
  return response.json() as Promise<T>;
}

async function auditRouteGroup(page: Page, routes: RouteEntry[]) {
  for (const route of routes) {
    const fatalErrors: string[] = [];

    const consoleHandler = (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (!isIgnorable(text)) fatalErrors.push(text);
    };
    const pageErrorHandler = (err: Error) => {
      const text = err.message || String(err);
      if (!isIgnorable(text)) fatalErrors.push(`[pageerror] ${text}`);
    };

    page.on('console', consoleHandler);
    page.on('pageerror', pageErrorHandler);

    await test.step(`${route.name} ${route.path}`, async () => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForPage(page);

      const body = page.locator('body');
      await expect(body, `${route.name}: body should be visible`).toBeVisible();

      const bodyText = await getBodyText(page);
      const hasContent = bodyText.trim().length > 0;
      const hasUi = await page.locator('button, a, h1, h2, h3, table, input, [role="button"]').first().isVisible().catch(() => false);

      expect(hasContent || hasUi, `${route.name}: page should render content`).toBe(true);

      for (const pattern of BANNED_TEXT_PATTERNS) {
        expect(pattern.test(bodyText), `${route.name}: should not show "${pattern}"`).toBe(false);
      }

      expect(fatalErrors, `${route.name}: should have no fatal JS errors. Found: ${fatalErrors.join(' | ')}`).toHaveLength(0);
    });

    page.off('console', consoleHandler);
    page.off('pageerror', pageErrorHandler);
  }
}

test.describe.configure({ mode: 'serial' });

test.describe('Demo Readiness Packets', () => {
  test('Packet 1 — API truth is internally consistent', async ({ request }) => {
    const contract = await requestJson<MetricContractResponse>(request, '/api/metric-contract');
    const live = await requestJson<LiveMonitorResponse>(request, '/api/live-monitor');
    const estate = await requestJson<EstateOverviewResponse>(request, '/api/estate/overview');
    const validation = await requestJson<ValidationResponse>(request, '/api/engine/validation');

    const inScope = contract.tables.inScope.value;
    const landingLoaded = contract.tables.landingLoaded.value;
    const bronzeLoaded = contract.tables.bronzeLoaded.value;
    const silverLoaded = contract.tables.silverLoaded.value;
    const toolReady = contract.tables.toolReady.value;

    expect(inScope).toBeGreaterThan(0);
    expect(landingLoaded).toBeLessThanOrEqual(inScope);
    expect(bronzeLoaded).toBeLessThanOrEqual(inScope);
    expect(silverLoaded).toBeLessThanOrEqual(inScope);
    expect(toolReady).toBeLessThanOrEqual(silverLoaded);

    expect(sum(contract.sources.bySource, (row) => row.tablesInScope)).toBe(inScope);
    expect(sum(contract.sources.bySource, (row) => row.landingLoaded)).toBe(landingLoaded);
    expect(sum(contract.sources.bySource, (row) => row.bronzeLoaded)).toBe(bronzeLoaded);
    expect(sum(contract.sources.bySource, (row) => row.silverLoaded)).toBe(silverLoaded);

    expect(toInt(live.counts.lzTotal)).toBe(inScope);
    expect(toInt(live.counts.brzTotal)).toBe(inScope);
    expect(toInt(live.counts.slvTotal)).toBe(inScope);
    expect(toInt(live.counts.lzLoaded)).toBe(landingLoaded);
    expect(toInt(live.counts.brzLoaded)).toBe(bronzeLoaded);
    expect(toInt(live.counts.slvLoaded)).toBe(silverLoaded);
    expect(toInt(live.counts.toolReady)).toBe(toolReady);

    const landingLayer = estate.layers.find((layer) => layer.key === 'landing');
    const bronzeLayer = estate.layers.find((layer) => layer.key === 'bronze');
    const silverLayer = estate.layers.find((layer) => layer.key === 'silver');
    expect(landingLayer?.inScope).toBe(inScope);
    expect(bronzeLayer?.inScope).toBe(inScope);
    expect(silverLayer?.inScope).toBe(inScope);
    expect(landingLayer?.loaded).toBe(landingLoaded);
    expect(bronzeLayer?.loaded).toBe(bronzeLoaded);
    expect(silverLayer?.loaded).toBe(silverLoaded);

    expect(sum(validation.overview, (row) => row.Active)).toBe(inScope);
    expect(sum(validation.lz_status, (row) => row.LzLoaded)).toBe(landingLoaded);
    expect(sum(validation.bronze_status, (row) => row.BronzeLoaded)).toBe(bronzeLoaded);
    expect(sum(validation.silver_status, (row) => row.SilverLoaded)).toBe(silverLoaded);
  });

  test('Packet 2 — Core pages show the same Fabric counts', async ({ page, request }) => {
    test.setTimeout(240_000);
    const contract = await requestJson<MetricContractResponse>(request, '/api/metric-contract');

    await page.goto('/sources');
    await waitForPage(page);
    await waitForFactValues(page, {
      'Tables In Scope': contract.tables.inScope.value,
      'Landing Loaded': contract.tables.landingLoaded.value,
      'Bronze Loaded': contract.tables.bronzeLoaded.value,
      'Silver Loaded': contract.tables.silverLoaded.value,
    });
    const sourceFacts = await readFactCards(page);
    expect(sourceFacts['Tables In Scope']).toBe(contract.tables.inScope.value);
    expect(sourceFacts['Landing Loaded']).toBe(contract.tables.landingLoaded.value);
    expect(sourceFacts['Bronze Loaded']).toBe(contract.tables.bronzeLoaded.value);
    expect(sourceFacts['Silver Loaded']).toBe(contract.tables.silverLoaded.value);

    await page.goto('/validation');
    await waitForPage(page);
    await waitForFactValues(page, {
      'Tables In Scope': contract.tables.inScope.value,
      'Landing': contract.tables.landingLoaded.value,
      'Bronze': contract.tables.bronzeLoaded.value,
      'Silver': contract.tables.silverLoaded.value,
    });
    const validationFacts = await readFactCards(page);
    expect(validationFacts['Tables In Scope']).toBe(contract.tables.inScope.value);
    expect(validationFacts['Landing']).toBe(contract.tables.landingLoaded.value);
    expect(validationFacts['Bronze']).toBe(contract.tables.bronzeLoaded.value);
    expect(validationFacts['Silver']).toBe(contract.tables.silverLoaded.value);

    await page.goto('/overview');
    await waitForPage(page);
    await waitForRatio(page, 'Landing Loaded', contract.tables.landingLoaded.value, contract.tables.inScope.value);
    await waitForRatio(page, 'Bronze Loaded', contract.tables.bronzeLoaded.value, contract.tables.inScope.value);
    await waitForRatio(page, 'Silver Loaded', contract.tables.silverLoaded.value, contract.tables.inScope.value);
    const overviewText = await getBodyText(page);
    const [overviewLandingLoaded, overviewLandingScope] = extractRatio(overviewText, 'Landing Loaded');
    const [overviewBronzeLoaded, overviewBronzeScope] = extractRatio(overviewText, 'Bronze Loaded');
    const [overviewSilverLoaded, overviewSilverScope] = extractRatio(overviewText, 'Silver Loaded');
    expect(overviewLandingLoaded).toBe(contract.tables.landingLoaded.value);
    expect(overviewBronzeLoaded).toBe(contract.tables.bronzeLoaded.value);
    expect(overviewSilverLoaded).toBe(contract.tables.silverLoaded.value);
    expect(overviewLandingScope).toBe(contract.tables.inScope.value);
    expect(overviewBronzeScope).toBe(contract.tables.inScope.value);
    expect(overviewSilverScope).toBe(contract.tables.inScope.value);

    await page.goto('/estate');
    await waitForPage(page);
    await waitForBodyMetric(page, 'Tables In Scope\\s*([\\d,]+)', contract.tables.inScope.value);
    await waitForBodyMetric(page, 'Landing Loaded\\s*([\\d,]+)', contract.tables.landingLoaded.value);
    await waitForBodyMetric(page, 'Bronze Loaded\\s*([\\d,]+)', contract.tables.bronzeLoaded.value);
    await waitForBodyMetric(page, 'Silver Loaded\\s*([\\d,]+)', contract.tables.silverLoaded.value);
    const estateText = await getBodyText(page);
    expect(extract(estateText, /Tables In Scope\s*([\d,]+)/i)).toBe(contract.tables.inScope.value);
    expect(extract(estateText, /Landing Loaded\s*([\d,]+)/i)).toBe(contract.tables.landingLoaded.value);
    expect(extract(estateText, /Bronze Loaded\s*([\d,]+)/i)).toBe(contract.tables.bronzeLoaded.value);
    expect(extract(estateText, /Silver Loaded\s*([\d,]+)/i)).toBe(contract.tables.silverLoaded.value);

    await page.goto('/live');
    await waitForPage(page);
    await waitForBodyMetric(page, 'Landing Zone[\\s\\S]{0,160}?In scope:\\s*([\\d,]+)', contract.tables.inScope.value);
    await waitForBodyMetric(page, 'Landing Zone[\\s\\S]{0,160}?Loaded:\\s*([\\d,]+)', contract.tables.landingLoaded.value);
    await waitForBodyMetric(page, 'Bronze[\\s\\S]{0,160}?In scope:\\s*([\\d,]+)', contract.tables.inScope.value);
    await waitForBodyMetric(page, 'Bronze[\\s\\S]{0,160}?Loaded:\\s*([\\d,]+)', contract.tables.bronzeLoaded.value);
    await waitForBodyMetric(page, 'Silver[\\s\\S]{0,220}?In scope:\\s*([\\d,]+)', contract.tables.inScope.value);
    await waitForBodyMetric(page, 'Silver[\\s\\S]{0,220}?Loaded:\\s*([\\d,]+)', contract.tables.silverLoaded.value);
    const liveText = await getBodyText(page);
    expect(extract(liveText, /Landing Zone[\s\S]{0,160}?In scope:\s*([\d,]+)/i)).toBe(contract.tables.inScope.value);
    expect(extract(liveText, /Landing Zone[\s\S]{0,160}?Loaded:\s*([\d,]+)/i)).toBe(contract.tables.landingLoaded.value);
    expect(extract(liveText, /Bronze[\s\S]{0,160}?In scope:\s*([\d,]+)/i)).toBe(contract.tables.inScope.value);
    expect(extract(liveText, /Bronze[\s\S]{0,160}?Loaded:\s*([\d,]+)/i)).toBe(contract.tables.bronzeLoaded.value);
    expect(extract(liveText, /Silver[\s\S]{0,220}?In scope:\s*([\d,]+)/i)).toBe(contract.tables.inScope.value);
    expect(extract(liveText, /Silver[\s\S]{0,220}?Loaded:\s*([\d,]+)/i)).toBe(contract.tables.silverLoaded.value);
  });

  test('Packet 3 — Business routes load cleanly with no stale terminology', async ({ page }) => {
    test.setTimeout(600_000);
    await auditRouteGroup(page, BUSINESS_ROUTES);
  });

  test('Packet 4 — Engineering routes load cleanly with no stale terminology', async ({ page }) => {
    test.setTimeout(600_000);
    await auditRouteGroup(page, ENGINEERING_ROUTES);
  });

  test('Packet 5 — Governance and specialty routes load cleanly with no stale terminology', async ({ page }) => {
    test.setTimeout(600_000);
    await auditRouteGroup(page, GOVERNANCE_AND_SPECIALTY_ROUTES);
  });
});
