/**
 * UX Audit Screenshot Capture
 * Run: node tests/ux-capture.cjs
 * From: dashboard/app/
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'http://127.0.0.1:8787';
const OUT = path.resolve(__dirname, '..', '..', '..', 'knowledge', 'ux-audit-screenshots');

const PAGES = [
  ['/', '01-ExecutionMatrix'],
  ['/engine', '02-EngineControl'],
  ['/control', '03-ControlPlane'],
  ['/live', '04-LiveMonitor'],
  ['/counts', '05-RecordCounts'],
  ['/sources', '06-SourceManager'],
  ['/setup', '07-EnvironmentSetup'],
  ['/logs', '08-ExecutionLog'],
  ['/errors', '10-ErrorIntelligence'],
  ['/admin', '11-AdminGateway'],
  ['/flow', '12-FlowExplorer'],
  ['/blender', '13-DataBlender'],
  ['/config', '14-ConfigManager'],
  ['/notebook-config', '15-NotebookConfig'],
  ['/runner', '16-PipelineRunner'],
  ['/validation', '17-ValidationChecklist'],
  ['/notebook-debug', '18-NotebookDebug'],
  ['/sql-explorer', '19-SqlExplorer'],
  ['/load-progress', '20-LoadProgress'],
  ['/journey', '21-DataJourney'],
  ['/settings', '22-Settings'],
  ['/labs/dq-scorecard', '23-DqScorecard'],
  ['/labs/cleansing', '24-CleansingRules'],
  ['/labs/scd-audit', '25-ScdAudit'],
  ['/labs/gold-mlv', '26-GoldMlvManager'],
  ['/classification', '27-DataClassification'],
  ['/catalog', '28-DataCatalog'],
  ['/profile', '29-DataProfiler'],
  ['/columns', '30-ColumnEvolution'],
  ['/microscope', '31-DataMicroscope'],
  ['/sankey', '32-SankeyFlow'],
  ['/replay', '33-TransformationReplay'],
  ['/pulse', '34-ImpactPulse'],
  ['/impact', '35-ImpactAnalysis'],
  ['/lineage', '36-DataLineage'],
  ['/test-audit', '37-TestAudit'],
  ['/test-swarm', '38-TestSwarm'],
  ['/mri', '39-MRI'],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let ok = 0, fail = 0;

  for (const [route, name] of PAGES) {
    try {
      await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(OUT, name + '.png') });
      ok++;
      console.log('OK  ' + name);
    } catch (e) {
      fail++;
      console.log('FAIL ' + name + ': ' + e.message.slice(0, 80));
    }
  }

  await browser.close();
  console.log('\nDone: ' + ok + '/' + PAGES.length + ' captured, ' + fail + ' failed');
})();
