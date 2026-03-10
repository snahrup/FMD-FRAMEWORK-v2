/**
 * UX Audit Screenshot Capture
 * Navigates to all 40 dashboard pages and captures viewport screenshots.
 * Run from dashboard/app: node ../../knowledge/ux-audit-screenshots/_capture.mjs
 */
import { chromium } from 'playwright';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://127.0.0.1:5173';
const OUT = __dirname;

const PAGES = [
  { route: '/', name: '01-ExecutionMatrix' },
  { route: '/engine', name: '02-EngineControl' },
  { route: '/control', name: '03-ControlPlane' },
  { route: '/live', name: '04-LiveMonitor' },
  { route: '/counts', name: '05-RecordCounts' },
  { route: '/sources', name: '06-SourceManager' },
  { route: '/setup', name: '07-EnvironmentSetup' },
  { route: '/logs', name: '08-ExecutionLog' },
  { route: '/errors', name: '10-ErrorIntelligence' },
  { route: '/admin', name: '11-AdminGateway' },
  { route: '/flow', name: '12-FlowExplorer' },
  { route: '/blender', name: '13-DataBlender' },
  { route: '/config', name: '14-ConfigManager' },
  { route: '/notebook-config', name: '15-NotebookConfig' },
  { route: '/runner', name: '16-PipelineRunner' },
  { route: '/validation', name: '17-ValidationChecklist' },
  { route: '/notebook-debug', name: '18-NotebookDebug' },
  { route: '/sql-explorer', name: '19-SqlExplorer' },
  { route: '/load-progress', name: '20-LoadProgress' },
  { route: '/journey', name: '21-DataJourney' },
  { route: '/settings', name: '22-Settings' },
  { route: '/labs/dq-scorecard', name: '23-DqScorecard' },
  { route: '/labs/cleansing', name: '24-CleansingRules' },
  { route: '/labs/scd-audit', name: '25-ScdAudit' },
  { route: '/labs/gold-mlv', name: '26-GoldMlvManager' },
  { route: '/classification', name: '27-DataClassification' },
  { route: '/catalog', name: '28-DataCatalog' },
  { route: '/profile', name: '29-DataProfiler' },
  { route: '/columns', name: '30-ColumnEvolution' },
  { route: '/microscope', name: '31-DataMicroscope' },
  { route: '/sankey', name: '32-SankeyFlow' },
  { route: '/replay', name: '33-TransformationReplay' },
  { route: '/pulse', name: '34-ImpactPulse' },
  { route: '/impact', name: '35-ImpactAnalysis' },
  { route: '/lineage', name: '36-DataLineage' },
  { route: '/test-audit', name: '37-TestAudit' },
  { route: '/test-swarm', name: '38-TestSwarm' },
  { route: '/mri', name: '39-MRI' },
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

let captured = 0, failed = 0;

for (const p of PAGES) {
  try {
    await page.goto(BASE + p.route, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, p.name + '.png'), fullPage: false });
    captured++;
    console.log(`OK  ${p.name}`);
  } catch (e) {
    console.error(`FAIL ${p.name}: ${e.message.slice(0, 80)}`);
    failed++;
  }
}

await browser.close();
console.log(`\nDone: ${captured} captured, ${failed} failed out of ${PAGES.length}`);
