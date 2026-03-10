/**
 * Playwright Global Teardown
 * Runs after all tests complete:
 *   1. Converts all .webm videos to .mp4 via ffmpeg
 *   2. Archives results into a timestamped run directory
 *   3. Maintains a run-history.json index for the dashboard
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const RESULTS_DIR = path.resolve(__dirname, '..', 'test-results');
const HISTORY_DIR = path.resolve(__dirname, '..', 'audit-history');
const HISTORY_INDEX = path.join(HISTORY_DIR, 'run-history.json');

interface RunSummary {
  runId: string;
  timestamp: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: Array<{
    name: string;
    testDir: string;
    status: string;
    durationMs: number;
    screenshot: string | null;
    video: string | null;
    trace: string | null;
  }>;
}

function convertWebmToMp4(webmPath: string): string | null {
  const mp4Path = webmPath.replace(/\.webm$/, '.mp4');
  try {
    execSync(`ffmpeg -y -i "${webmPath}" -c:v libx264 -preset fast -crf 23 -an "${mp4Path}"`, {
      stdio: 'pipe',
      timeout: 120_000,
    });
    // Remove original webm after successful conversion
    fs.unlinkSync(webmPath);
    return mp4Path;
  } catch (e) {
    console.warn(`[teardown] ffmpeg conversion failed for ${webmPath}:`, (e as Error).message);
    return null;
  }
}

function findFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findFiles(full, ext));
    else if (entry.name.endsWith(ext)) results.push(full);
  }
  return results;
}

export default async function globalTeardown() {
  const startTime = Date.now();
  console.log('[teardown] Starting post-run processing...');

  // Ensure history directory exists
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });

  // 1. Convert all webm → mp4
  const webmFiles = findFiles(RESULTS_DIR, '.webm');
  console.log(`[teardown] Converting ${webmFiles.length} webm videos to mp4...`);
  for (const webm of webmFiles) {
    const mp4 = convertWebmToMp4(webm);
    if (mp4) console.log(`[teardown]   ✓ ${path.basename(path.dirname(webm))}/video.mp4`);
  }

  // 2. Read Playwright JSON results
  const resultsJsonPath = path.join(RESULTS_DIR, 'results.json');
  let playwrightResults: any = null;
  if (fs.existsSync(resultsJsonPath)) {
    try {
      playwrightResults = JSON.parse(fs.readFileSync(resultsJsonPath, 'utf-8'));
    } catch { /* ignore parse errors */ }
  }

  // 3. Build run summary
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runDir = path.join(HISTORY_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });

  const tests: RunSummary['tests'] = [];
  let passed = 0, failed = 0, skipped = 0;

  // Walk test-results directories
  if (fs.existsSync(RESULTS_DIR)) {
    for (const entry of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const testDir = path.join(RESULTS_DIR, entry.name);
      const files = fs.readdirSync(testDir);

      // Extract test name from directory name
      const dirName = entry.name;
      // Directory names are like: fmd-dashboard-audit-FMD-Da-dea97-t-1-Scrape-Execution-Matrix-chromium
      const nameParts = dirName.replace(/-chromium$/, '').split('-');
      // Skip the prefix hash parts, extract meaningful name
      const hashIdx = nameParts.findIndex(p => /^[0-9a-f]{5}$/.test(p));
      const testName = hashIdx >= 0
        ? nameParts.slice(hashIdx + 1).join(' ')
        : dirName;

      // Find artifacts
      const screenshot = files.find(f => f.endsWith('.png')) || null;
      const video = files.find(f => f.endsWith('.mp4')) || files.find(f => f.endsWith('.webm')) || null;
      const trace = files.find(f => f.endsWith('.zip')) || null;

      // Copy artifacts to archive
      const archiveTestDir = path.join(runDir, entry.name);
      fs.mkdirSync(archiveTestDir, { recursive: true });
      for (const f of files) {
        fs.copyFileSync(path.join(testDir, f), path.join(archiveTestDir, f));
      }

      // Determine status from artifacts:
      // - test-failed-*.png = failed
      // - test-finished-*.png = passed
      // - No screenshot but trace exists = passed (API-only tests have no page)
      // - No artifacts at all = passed (test ran but produced nothing)
      const status = screenshot?.includes('failed') ? 'failed'
        : screenshot?.includes('finished') ? 'passed'
          : trace ? 'passed'   // API tests: no screenshot but trace = ran OK
            : 'passed';        // No artifacts = assume passed (Playwright reports real failures above)

      if (status === 'passed') passed++;
      else if (status === 'failed') failed++;
      else skipped++;

      tests.push({
        name: testName,
        testDir: entry.name,
        status,
        durationMs: 0,
        screenshot,
        video,
        trace,
      });
    }
  }

  // Use Playwright JSON results as authoritative source for pass/fail counts
  // The screenshot-based detection above is unreliable (naming varies)
  if (playwrightResults?.suites) {
    // Reset counts — JSON results are the source of truth
    passed = 0;
    failed = 0;
    skipped = 0;

    const flattenSpecs = (suites: any[]): any[] => {
      const specs: any[] = [];
      for (const suite of suites) {
        specs.push(...(suite.specs || []));
        if (suite.suites) specs.push(...flattenSpecs(suite.suites));
      }
      return specs;
    };

    for (const spec of flattenSpecs(playwrightResults.suites)) {
      for (const testResult of (spec.tests || [])) {
        const pwStatus = testResult.status;
        const pwDuration = testResult.results?.[0]?.duration || 0;
        if (pwStatus === 'expected') passed++;
        else if (pwStatus === 'unexpected') failed++;
        else if (pwStatus === 'skipped') skipped++;

        // Enrich artifact entries with duration
        const match = tests.find(t =>
          spec.title.toLowerCase().includes(t.name.toLowerCase().slice(0, 10)) ||
          t.name.toLowerCase().includes(spec.title.toLowerCase().slice(0, 10))
        );
        if (match) {
          match.durationMs = pwDuration;
          if (pwStatus === 'expected') match.status = 'passed';
          else if (pwStatus === 'unexpected') match.status = 'failed';
          else if (pwStatus === 'skipped') match.status = 'skipped';
        }
      }
    }
  }

  // Also copy results.json to archive
  if (fs.existsSync(resultsJsonPath)) {
    fs.copyFileSync(resultsJsonPath, path.join(runDir, 'results.json'));
  }

  // Clean test-results after archiving so stale artifacts don't contaminate next run
  if (fs.existsSync(RESULTS_DIR)) {
    for (const entry of fs.readdirSync(RESULTS_DIR, { withFileTypes: true })) {
      const full = path.join(RESULTS_DIR, entry.name);
      if (entry.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
    }
  }

  // 4. Write run summary
  const summary: RunSummary = {
    runId,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    total: tests.length,
    passed,
    failed,
    skipped,
    tests,
  };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));

  // 5. Update history index
  let history: RunSummary[] = [];
  if (fs.existsSync(HISTORY_INDEX)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_INDEX, 'utf-8'));
    } catch { /* start fresh */ }
  }
  history.unshift(summary); // newest first
  // Keep last 50 runs
  if (history.length > 50) {
    const removed = history.splice(50);
    // Clean up old archives
    for (const old of removed) {
      const oldDir = path.join(HISTORY_DIR, old.runId);
      if (fs.existsSync(oldDir)) fs.rmSync(oldDir, { recursive: true, force: true });
    }
  }
  fs.writeFileSync(HISTORY_INDEX, JSON.stringify(history, null, 2));

  console.log(`[teardown] Run ${runId}: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log(`[teardown] Archived to ${runDir}`);
  console.log('[teardown] Done.');
}
