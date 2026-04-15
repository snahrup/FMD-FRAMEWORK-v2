import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Play, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Clock, RotateCcw, FileVideo, Image, FileSearch,
  ChevronDown, ChevronUp, Activity, Download,
  History, Monitor, Maximize2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, AreaChart, Area, CartesianGrid,
} from "recharts";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

interface TestResult {
  name: string;
  testDir: string;
  status: "passed" | "failed" | "skipped" | "unknown";
  durationMs: number;
  screenshot: string | null;
  video: string | null;
  trace: string | null;
}

interface RunSummary {
  runId: string;
  timestamp: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: TestResult[];
}

interface AuditStatus {
  status: "running" | "idle";
  pid?: number;
  lastExitCode?: number;
}

// ── Test Description Catalog ──
// Plain English descriptions of what each test does, what it checks, and what to expect.
// These are matched against test names from the run history via keyword matching.
// TODO: Replace with Agent SDK-generated dynamic descriptions per-run.

interface TestDescription {
  scenario: string;
  actions: string[];
  expected: string;
  failHint: string;
}

const TEST_CATALOG: Array<{ keywords: string[]; desc: TestDescription }> = [
  {
    keywords: ["execution matrix", "scrape execution"],
    desc: {
      scenario: "Opens the main Execution Matrix dashboard — the home page — and checks that all the headline numbers add up.",
      actions: [
        "Navigated to the home page (Execution Matrix)",
        "Read the KPI cards: Total Entities, Active Errors, Success Rate, Last Run",
        "Read the Layer Health section: how many entities succeeded, failed, or never ran for Landing Zone, Bronze, and Silver",
        "Checked the entity table count at the bottom",
      ],
      expected: "Each layer's succeeded + failed + never-run counts should add up to the total entity count. The table should show the same total.",
      failHint: "The layer health numbers don't add up to the total. Some entities are being double-counted or missing from a layer.",
    },
  },
  {
    keywords: ["engine control"],
    desc: {
      scenario: "Opens Engine Control to verify that pipeline run history is being tracked.",
      actions: [
        "Navigated to the Engine Control page",
        "Read the Run History count from the header",
      ],
      expected: "Run History should show at least 1 run if pipelines have been executed.",
      failHint: "Engine Control shows 0 runs — either no pipelines have been triggered, or the execution tracking isn't recording properly.",
    },
  },
  {
    keywords: ["validation"],
    desc: {
      scenario: "Opens the Validation Checklist and checks that the loading progress numbers match what the Execution Matrix reports.",
      actions: [
        "Navigated to the Validation page",
        "Read Total Active entities and loaded counts for each layer (LZ, Bronze, Silver)",
        "Compared Bronze loaded count against the Execution Matrix's Bronze succeeded count",
        "Compared Total Active against the Execution Matrix's total entity count",
      ],
      expected: "Validation's Bronze loaded count should exactly match Execution Matrix's Bronze succeeded count. Total Active should match total entities.",
      failHint: "The numbers don't agree between pages — likely a query or caching issue where one page is reading stale data.",
    },
  },
  {
    keywords: ["live monitor"],
    desc: {
      scenario: "Opens Live Monitor to verify the real-time loading progress matches other pages.",
      actions: [
        "Navigated to the Live Monitor page",
        "Read loaded and in-scope counts for Landing Zone, Bronze, and Silver",
        "Compared Bronze in-scope count against total tables in scope",
        "Cross-checked Bronze loaded against Execution Matrix and Validation",
      ],
      expected: "Bronze and Silver in-scope counts should equal total tables in scope. Bronze loaded should match Execution Matrix and Validation.",
      failHint: "Tables in scope don't match across pages — some routes are still reading a different query or stale cache.",
    },
  },
  {
    keywords: ["control plane connections", "5b"],
    desc: {
      scenario: "Opens the Control Plane's Connections tab and checks that entity counts per connection don't multiply.",
      actions: [
        "Navigated to Control Plane",
        "Clicked the Connections tab",
        "Added up the entity counts shown on each connection card",
        "Compared the sum against the known total entity count",
      ],
      expected: "The sum of entities across all connections should equal the total entity count — not 2x or 3x the real number.",
      failHint: "Entity count is multiplied — each connection is likely counting Landing Zone + Bronze + Silver separately instead of just Landing Zone entities.",
    },
  },
  {
    keywords: ["control plane"],
    desc: {
      scenario: "Opens the Control Plane and checks that header stats, tab counts, and entity metadata are all consistent.",
      actions: [
        "Navigated to the Control Plane page",
        "Read header stats: Connections, Sources, Entities",
        "Read tab counts: Entity Metadata, Connections tab, Execution Log",
        "Compared header entities to Entity Metadata tab count",
        "Cross-checked against Execution Matrix total entities",
      ],
      expected: "Header entity count, Entity Metadata tab count, and Execution Matrix total should all be the same number.",
      failHint: "The Control Plane header is showing a different number than its own Entity Metadata tab — likely a separate query that isn't filtering the same way.",
    },
  },
  {
    keywords: ["error intelligence"],
    desc: {
      scenario: "Opens Error Intelligence and checks that error counts match what the Execution Matrix reports as Active Errors.",
      actions: [
        "Navigated to the Error Intelligence page",
        "Read Total, Critical, Warnings, and Info counts",
        "Compared total against the Execution Matrix's Active Errors KPI",
        "Verified sub-totals (Critical + Warnings + Info) add up to the Total",
      ],
      expected: "Error Intelligence total should match Execution Matrix Active Errors. Sub-categories should add up to the total.",
      failHint: "Error counts don't match — either the Active Errors KPI on the home page is stale, or Error Intelligence is counting errors differently.",
    },
  },
  {
    keywords: ["execution log"],
    desc: {
      scenario: "Opens the Execution Log and checks that pipeline run counts are reasonable compared to Engine Control.",
      actions: [
        "Navigated to the Execution Log page",
        "Read Pipeline Runs, Copy Activities, and Notebook Runs counts",
        "Checked that pipeline runs don't wildly exceed actual engine runs",
        "Verified notebook runs exist if engine has recorded runs",
      ],
      expected: "Pipeline run count should be proportional to actual engine runs. Notebook runs should show real statuses, not 'unknown'.",
      failHint: "Pipeline run count is unreasonably high or notebook runs show 0 — the execution log may be counting individual activities instead of pipeline-level runs.",
    },
  },
  {
    keywords: ["pipeline runner"],
    desc: {
      scenario: "Opens Pipeline Runner and checks that each data source has equal entity counts across all three layers.",
      actions: [
        "Navigated to the Pipeline Runner page",
        "Read per-source entity counts: Landing, Bronze, Silver, Total",
        "Verified Landing = Bronze = Silver = Total for each source",
      ],
      expected: "Every source should show one consistent in-scope count, with Landing, Bronze, and Silver showing how much of that scope is actually loaded.",
      failHint: "Layer counts differ per source in a way that implies the same metric is being calculated differently across the page.",
    },
  },
  {
    keywords: ["source manager"],
    desc: {
      scenario: "Opens Source Manager and verifies that connection and entity counts are consistent with the rest of the dashboard.",
      actions: [
        "Navigated to the Source Manager page",
        "Read Gateway Connections, Data Sources, Landing Zone Entities, and SQL Connections counts",
        "Compared LZ entity count against Execution Matrix total",
      ],
      expected: "Landing Zone Entities on Source Manager should match the total entity count from Execution Matrix.",
      failHint: "Source Manager shows a different LZ entity count — it may be reading from a different table or missing a source's entities.",
    },
  },
  {
    keywords: ["data blender"],
    desc: {
      scenario: "Opens Data Blender and checks that per-layer table counts are consistent with other pages.",
      actions: [
        "Navigated to the Data Blender page",
        "Read Landing Zone, Bronze, Silver, and Total table counts",
        "Compared Bronze and Silver against Execution Matrix succeeded counts",
        "Verified Total = LZ + Bronze + Silver",
      ],
      expected: "LZ should equal total entities, Bronze/Silver should match Execution Matrix, and the total should be the sum of all three layers.",
      failHint: "Layer counts don't match other pages — Data Blender is likely querying lakehouse tables directly instead of the metadata, giving different numbers.",
    },
  },
  {
    keywords: ["flow explorer"],
    desc: {
      scenario: "Opens Flow Explorer and checks that the total table count and per-layer breakdowns are consistent.",
      actions: [
        "Navigated to the Flow Explorer page",
        "Read total tables and per-layer counts (Landing Zone, Bronze, Silver, Gold)",
        "Compared total against Execution Matrix total entities",
        "Cross-checked Bronze count against Data Blender",
      ],
      expected: "Total tables and LZ count should match total entities. Bronze should match Data Blender's Bronze count.",
      failHint: "Flow Explorer total is off — it may be counting layers or assets that are outside the managed Fabric scope.",
    },
  },
  {
    keywords: ["record counts"],
    desc: {
      scenario: "Opens Record Counts and checks that Bronze/Silver row counts match the Execution Matrix and that matched records have actual data.",
      actions: [
        "Navigated to the Record Counts page (waits extra time — this page queries SQL live)",
        "Read Bronze, Silver, Matched, Mismatched, and Total counts",
        "Compared Bronze/Silver against Execution Matrix succeeded counts",
        "Verified that matched records actually have non-zero row counts",
      ],
      expected: "Bronze and Silver counts should match Execution Matrix. If there are matched entities, their rows shouldn't be zero.",
      failHint: "Record Counts Bronze/Silver disagree with the home page, or entities show 'matched' status but zero rows — a display/query bug.",
    },
  },
  {
    keywords: ["data profiler"],
    desc: {
      scenario: "Opens Data Profiler and checks that it sees all entities, not just a subset.",
      actions: [
        "Navigated to the Data Profiler page",
        "Read the entity count from the source selector dropdown",
        "Compared against Execution Matrix total entities",
      ],
      expected: "Data Profiler should show the full entity count (all sources), not just one source's entities.",
      failHint: "Data Profiler is showing a subset — it's probably defaulting to a single source instead of 'All Sources', or the query is filtering by loaded status.",
    },
  },
  {
    keywords: ["data flow", "sankey", "should not be blank"],
    desc: {
      scenario: "Opens the Data Flow (Sankey) visualization page and checks that it actually renders content — not a blank screen.",
      actions: [
        "Navigated to the Data Flow / Sankey page",
        "Checked that the page body has meaningful content (more than just the nav bar)",
        "Looked for SVG elements, sankey nodes, links, and paths",
      ],
      expected: "The page should render a Sankey diagram or flow visualization with visible SVG elements and data.",
      failHint: "The page is blank — the Sankey component may have crashed, data may not be loading, or the visualization library isn't rendering.",
    },
  },
  {
    keywords: ["pipeline testing", "notebook debug", "should show tables"],
    desc: {
      scenario: "Opens Pipeline Testing (Notebook Debug) and checks that it can see available tables from the data sources.",
      actions: [
        "Navigated to the Pipeline Testing page",
        "Read the table count from the 'All sources' dropdown",
      ],
      expected: "The page should show available tables for testing — the count should be greater than zero.",
      failHint: "Pipeline Testing shows 0 tables — either the metadata query isn't returning results or the source connection is failing.",
    },
  },
  {
    keywords: ["cross-page", "consistency", "all 21 bugs", "16."],
    desc: {
      scenario: "The big final test — takes all numbers scraped from every page and runs 21 cross-page consistency checks to find bugs where different pages show different numbers for the same thing.",
      actions: [
        "Loaded all previously scraped data from every page",
        "Ran 21 specific bug checks comparing numbers across pages",
        "Checked Bronze/Silver counts across 6 pages (Bug 1 & 2)",
        "Checked entity multiplication on Control Plane (Bug 3)",
        "Checked Control Plane header vs tabs (Bug 4 & 5)",
        "Checked Active Errors vs Error Intelligence (Bug 6)",
        "Checked Last Run status vs Engine Control (Bug 7)",
        "Checked Success Rate makes sense (Bug 8)",
        "Checked run counts between Engine Control and Control Plane (Bug 9)",
        "Checked fail counts vs error counts (Bug 10)",
        "Checked in-scope counts on Live Monitor (Bug 11)",
        "Checked execution log pipeline runs are reasonable (Bug 12)",
        "Checked for 'status unknown' in notebook runs (Bug 13)",
        "Checked Data Flow page isn't blank (Bug 14)",
        "Checked Impact Pulse loaded count (Bug 15)",
        "Checked Data Profiler entity count (Bug 16)",
        "Checked Pipeline Testing shows tables (Bug 17)",
        "Checked source name consistency (Bug 18)",
        "Checked Record Counts rows aren't zero with matches (Bug 19 & 20)",
        "Checked Validation total matches Execution Matrix (Bug 21)",
      ],
      expected: "All 21 checks should pass — every page should agree on entity counts, layer progress, error totals, and run history.",
      failHint: "Multiple pages disagree on the same numbers. This is the most comprehensive check — individual failures above narrow down which specific pages are the source of truth vs which are buggy.",
    },
  },
];

function getTestDescription(testName: string): TestDescription | null {
  const lower = testName.toLowerCase();
  // More specific matches first (e.g., "control plane connections" before "control plane")
  for (const entry of TEST_CATALOG) {
    if (entry.keywords.every((kw) => lower.includes(kw))) return entry.desc;
  }
  // Fallback: partial match on any keyword
  for (const entry of TEST_CATALOG) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry.desc;
  }
  return null;
}

// ── Helpers ──

function fetchJson<T>(path: string): Promise<T> {
  return fetch(`${API}${path}`).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });
}

function postJson<T>(path: string): Promise<T> {
  return fetch(`${API}${path}`, { method: "POST" }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });
}

function formatDuration(ms: number): string {
  if (ms == null || isNaN(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function formatTimestamp(ts: string): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "—";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function aUrl(runId: string, testDir: string, fileName: string): string {
  return `${API}/api/audit/artifacts/${runId}/${testDir}/${fileName}`;
}

// ── Components ──

function ScoreBar({ run }: { run: RunSummary }) {
  const passRate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
  const ringColorHex = passRate >= 80 ? "var(--bp-operational)" : passRate >= 50 ? "var(--bp-caution)" : "var(--bp-fault)";

  return (
    <div className="flex items-center gap-6 px-6 py-4 rounded-lg" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
      {/* Pass rate ring */}
      <div className="relative w-16 h-16 shrink-0">
        <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" strokeWidth="2.5" style={{ stroke: 'var(--bp-surface-inset)' }}
          />
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" strokeWidth="3"
            strokeDasharray={`${passRate}, 100`} strokeLinecap="round" style={{ stroke: ringColorHex }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold" style={{ color: ringColorHex }}>{passRate}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--bp-ink-tertiary)' }}>
          <span>{run.runId}</span>
          <span style={{ fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>{formatTimestamp(run.timestamp)}</span>
        </div>
        <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: 'var(--bp-surface-inset)' }}>
          {run.passed > 0 && run.total > 0 && (
            <div className="h-full" style={{ width: `${(run.passed / run.total) * 100}%`, background: 'var(--bp-operational)' }} />
          )}
          {run.failed > 0 && run.total > 0 && (
            <div className="h-full" style={{ width: `${(run.failed / run.total) * 100}%`, background: 'var(--bp-fault)' }} />
          )}
          {run.skipped > 0 && run.total > 0 && (
            <div className="h-full" style={{ width: `${(run.skipped / run.total) * 100}%`, background: 'var(--bp-caution)' }} />
          )}
        </div>
      </div>

      {/* KPI chips */}
      <div className="flex items-center gap-4 shrink-0">
        {[
          { label: "Total", value: run.total, icon: Monitor, colorHex: "var(--bp-ink-secondary)" },
          { label: "Passed", value: run.passed, icon: CheckCircle2, colorHex: "var(--bp-operational)" },
          { label: "Failed", value: run.failed, icon: XCircle, colorHex: "var(--bp-fault)" },
          { label: "Duration", value: formatDuration(run.durationMs), icon: Clock, colorHex: "var(--bp-caution)" },
        ].map((k) => (
          <div key={k.label} className="text-center">
            <div className="text-lg font-bold" style={{ color: k.colorHex, fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
            <div className="text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>{k.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Recharts SVG fill/stroke requires raw hex — CSS vars don't resolve in SVG attributes.
// These mirror the BP design tokens; update here if index.css tokens change.
const CHART_COLORS = {
  passed: "#3D7C4F",  // --bp-operational
  failed: "#B93A2A",  // --bp-fault
  skipped: "#C27A1A", // --bp-caution
};
const CHART_AXIS_COLOR = "#78716C";    // --bp-ink-tertiary
const CHART_GRID_COLOR = "rgba(0,0,0,0.04)"; // --bp-border-subtle

function TrendChart({ history }: { history: RunSummary[] }) {
  // Show last 10 runs, oldest first
  const data = [...history].reverse().slice(-10).map((r) => ({
    run: r.runId.slice(11, 19).replace(/-/g, ":"), // extract time HH:MM:SS
    passed: r.passed,
    failed: r.failed,
    skipped: r.skipped,
    rate: r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0,
  }));

  return (
    <Card style={{ background: 'var(--bp-surface-1)', borderColor: 'var(--bp-border)' }}>
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-medium" style={{ color: 'var(--bp-ink-tertiary)' }}>Pass/Fail Trend</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="passGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.passed} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART_COLORS.passed} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="failGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.failed} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART_COLORS.failed} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} />
            <XAxis dataKey="run" tick={{ fontSize: 9, fill: CHART_AXIS_COLOR }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 9, fill: CHART_AXIS_COLOR }} tickLine={false} axisLine={false} width={25} />
            <Tooltip
              contentStyle={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", borderRadius: 8, fontSize: 11, color: "var(--bp-ink-primary)" }}
              labelStyle={{ color: "var(--bp-ink-tertiary)", fontSize: 10 }}
            />
            <Area type="monotone" dataKey="passed" stroke={CHART_COLORS.passed} fill="url(#passGrad)" strokeWidth={2} />
            <Area type="monotone" dataKey="failed" stroke={CHART_COLORS.failed} fill="url(#failGrad)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function ResultBreakdownChart({ run }: { run: RunSummary }) {
  const data = [
    { name: "Passed", value: run.passed, color: CHART_COLORS.passed },
    { name: "Failed", value: run.failed, color: CHART_COLORS.failed },
    { name: "Skipped", value: run.skipped, color: CHART_COLORS.skipped },
  ].filter(d => d.value > 0);

  return (
    <Card style={{ background: 'var(--bp-surface-1)', borderColor: 'var(--bp-border)' }}>
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-medium" style={{ color: 'var(--bp-ink-tertiary)' }}>Result Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2 flex items-center">
        <ResponsiveContainer width="50%" height={140}>
          <PieChart>
            <Pie
              data={data}
              cx="50%" cy="50%"
              innerRadius={35} outerRadius={55}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", borderRadius: 8, fontSize: 11, color: "var(--bp-ink-primary)" }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-2 pl-2">
          {data.map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="text-xs flex-1" style={{ color: 'var(--bp-ink-tertiary)' }}>{d.name}</span>
              <span className="text-sm font-bold" style={{ color: 'var(--bp-ink-primary)' }}>{d.value}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TestDurationChart({ run }: { run: RunSummary }) {
  const data = run.tests
    .filter(t => t.durationMs > 0)
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 10)
    .map(t => ({
      name: t.name.length > 20 ? t.name.slice(0, 20) + "..." : t.name,
      duration: Math.round(t.durationMs / 1000 * 10) / 10,
      status: t.status,
    }));

  if (data.length === 0) return null;

  return (
    <Card style={{ background: 'var(--bp-surface-1)', borderColor: 'var(--bp-border)' }}>
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-medium" style={{ color: 'var(--bp-ink-tertiary)' }}>Slowest Tests (seconds)</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_COLOR} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 9, fill: CHART_AXIS_COLOR }} tickLine={false} axisLine={false} />
            <YAxis
              type="category" dataKey="name" width={120}
              tick={{ fontSize: 9, fill: CHART_AXIS_COLOR }} tickLine={false} axisLine={false}
            />
            <Tooltip
              contentStyle={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", borderRadius: 8, fontSize: 11, color: "var(--bp-ink-primary)" }}
              formatter={(v: number | undefined) => [`${v ?? 0}s`, "Duration"]}
            />
            <Bar dataKey="duration" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={CHART_COLORS[d.status as keyof typeof CHART_COLORS] || CHART_AXIS_COLOR} fillOpacity={0.7} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

function TraceModal({ open, onClose, traceUrl, testName }: {
  open: boolean; onClose: () => void; traceUrl: string; testName: string;
}) {
  const [activated, setActivated] = useState(false);
  const viewerUrl = `https://trace.playwright.dev/?trace=${encodeURIComponent(traceUrl)}`;

  // Reset overlay when modal closes/reopens
  useEffect(() => { if (!open) setActivated(false); }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-3 pb-2 flex flex-row items-center gap-3" style={{ borderBottom: '1px solid var(--bp-border-subtle)' }}>
          <FileSearch className="w-4 h-4 shrink-0" style={{ color: 'var(--bp-caution)' }} />
          <div className="flex-1 min-w-0">
            <DialogTitle className="text-sm font-medium truncate">{testName}</DialogTitle>
            <DialogDescription className="text-[10px]" style={{ color: 'var(--bp-ink-tertiary)' }}>Playwright Trace Viewer</DialogDescription>
          </div>
          <a
            href={traceUrl}
            download
            className="inline-flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded-md"
            style={{ color: 'var(--bp-ink-tertiary)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <Download className="w-3 h-3" /> .zip
          </a>
        </DialogHeader>
        <div className="relative flex-1 w-full h-[calc(90vh-52px)]">
          {/* Only mount iframe after activation to avoid loading until user clicks */}
          {activated && (
            <iframe
              src={viewerUrl}
              className="w-full h-full border-0"
              title="Playwright Trace Viewer"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            />
          )}
          {/* Play overlay — click anywhere to activate */}
          {!activated && (
            <div
              className="absolute inset-0 z-10 flex flex-col items-center justify-center cursor-pointer transition-opacity"
              role="button"
              tabIndex={0}
              aria-label="Click to load Playwright trace viewer"
              style={{ background: 'var(--bp-code-block)' }}
              onClick={() => setActivated(true)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActivated(true); } }}
            >
              <div className="relative group">
                <div className="w-24 h-24 rounded-full bg-[var(--bp-caution-light)] flex items-center justify-center backdrop-blur-sm border border-[var(--bp-caution)] group-hover:bg-[var(--bp-caution-light)] group-hover:scale-110 transition-all duration-300">
                  <Play className="w-10 h-10 text-[var(--bp-caution)] ml-1 group-hover:text-[var(--bp-caution)] transition-colors" />
                </div>
                <div className="absolute inset-0 w-24 h-24 rounded-full animate-ping bg-[var(--bp-caution-light)] pointer-events-none" />
              </div>
              <p className="mt-4 text-sm" style={{ color: 'var(--bp-ink-tertiary)' }}>Click anywhere to load trace</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TestCard({ test, runId }: { test: TestResult; runId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [traceOpen, setTraceOpen] = useState(false);
  const hasArtifacts = !!(test.testDir && (test.screenshot || test.video || test.trace));
  const desc = getTestDescription(test.name);

  const statusBorderColor: Record<string, string> = {
    passed: "var(--bp-operational)",
    failed: "var(--bp-fault)",
    skipped: "var(--bp-caution)",
    unknown: "var(--bp-ink-muted)",
  };
  const statusBgColor: Record<string, string> = {
    passed: "var(--bp-operational-light)",
    failed: "var(--bp-fault-light)",
    skipped: "var(--bp-caution-light)",
    unknown: "var(--bp-surface-1)",
  };

  return (
    <div
      className="rounded-lg overflow-hidden transition-all duration-200"
      style={{
        border: '1px solid var(--bp-border)',
        borderLeft: `3px solid ${statusBorderColor[test.status] || statusBorderColor.unknown}`,
        background: statusBgColor[test.status] || 'transparent',
      }}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={`${test.name} — ${test.status}`}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(!expanded); } }}
      >
        {test.status === "passed" ? (
          <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: 'var(--bp-operational)' }} />
        ) : test.status === "failed" ? (
          <XCircle className="w-5 h-5 shrink-0" style={{ color: 'var(--bp-fault)' }} />
        ) : test.status === "skipped" ? (
          <AlertTriangle className="w-5 h-5 shrink-0" style={{ color: 'var(--bp-caution)' }} />
        ) : (
          <Clock className="w-5 h-5 shrink-0" style={{ color: 'var(--bp-ink-muted)' }} />
        )}

        <span className="flex-1 text-sm font-medium" style={{ color: 'var(--bp-ink-primary)' }}>{test.name}</span>

        <span className="text-xs tabular-nums mr-2" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
          {test.durationMs > 0 ? formatDuration(test.durationMs) : ""}
        </span>

        {hasArtifacts && (
          <div className="flex items-center gap-1.5 mr-2">
            {test.screenshot && <Image className="w-3.5 h-3.5 text-[var(--bp-ink-secondary)]" />}
            {test.video && <FileVideo className="w-3.5 h-3.5 text-[var(--bp-ink-tertiary)]" />}
            {test.trace && <FileSearch className="w-3.5 h-3.5 text-[var(--bp-caution)]" />}
          </div>
        )}

        {hasArtifacts && (
          expanded
            ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: 'var(--bp-ink-muted)' }} />
            : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--bp-ink-muted)' }} />
        )}
      </div>

      {/* Expanded: 50/50 split — description left, video right */}
      {expanded && hasArtifacts && (
        <div style={{ borderTop: '1px solid var(--bp-border-subtle)', background: 'var(--bp-surface-inset)' }}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
            {/* LEFT: Plain English description */}
            <div className="p-5 overflow-y-auto max-h-[420px] space-y-4" style={{ borderRight: '1px solid var(--bp-border-subtle)' }}>
              {desc ? (
                <>
                  {/* Scenario */}
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--bp-ink-tertiary)' }}>
                      What Was Tested
                    </h4>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--bp-ink-primary)' }}>{desc.scenario}</p>
                  </div>

                  {/* Actions */}
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--bp-ink-tertiary)' }}>
                      What It Did
                    </h4>
                    <ul className="space-y-1">
                      {desc.actions.map((a, i) => (
                        <li key={i} className="text-sm leading-relaxed flex gap-2" style={{ color: 'var(--bp-ink-secondary)' }}>
                          <span className="shrink-0 mt-0.5 text-xs" style={{ color: 'var(--bp-ink-muted)' }}>{i + 1}.</span>
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Expected */}
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--bp-ink-tertiary)' }}>
                      What Should Happen
                    </h4>
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--bp-ink-secondary)' }}>{desc.expected}</p>
                  </div>

                  {/* Result */}
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--bp-ink-tertiary)' }}>
                      Result
                    </h4>
                    {test.status === "passed" ? (
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-[var(--bp-operational)] mt-0.5 shrink-0" />
                        <p className="text-sm text-[var(--bp-operational)] leading-relaxed">
                          Passed — everything checked out. The numbers matched across pages as expected.
                        </p>
                      </div>
                    ) : test.status === "failed" ? (
                      <div className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-[var(--bp-fault)] mt-0.5 shrink-0" />
                        <p className="text-sm text-[var(--bp-fault)] leading-relaxed">
                          Failed — {desc.failHint}
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-[var(--bp-caution)] mt-0.5 shrink-0" />
                        <p className="text-sm text-[var(--bp-caution)] leading-relaxed">
                          Skipped or unknown — test didn't run to completion.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* No catalog entry — show generic info */
                <div className="flex flex-col items-center justify-center h-full text-center py-8">
                  <AlertTriangle className="w-8 h-8 mb-3" style={{ color: 'var(--bp-ink-muted)', opacity: 0.4 }} />
                  <p className="text-sm" style={{ color: 'var(--bp-ink-tertiary)' }}>
                    No description available for this test.
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--bp-ink-muted)' }}>
                    Test: {test.name}
                  </p>
                </div>
              )}

              {/* Trace + download bar inside left panel */}
              {test.trace && test.testDir && (
                <div className="flex items-center gap-2 pt-3" style={{ borderTop: '1px solid var(--bp-border-subtle)' }}>
                  <FileSearch className="w-3.5 h-3.5" style={{ color: 'var(--bp-caution)' }} />
                  <span className="text-xs flex-1" style={{ color: 'var(--bp-ink-tertiary)' }}>Trace Recording</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-xs text-[var(--bp-caution)] hover:text-[var(--bp-caution)] hover:bg-[var(--bp-caution-light)]"
                    onClick={(e) => { e.stopPropagation(); setTraceOpen(true); }}
                  >
                    <Maximize2 className="w-3 h-3" /> View Trace
                  </Button>
                  <a
                    href={aUrl(runId, test.testDir, test.trace)}
                    download
                    className="inline-flex items-center gap-1 text-xs transition-colors"
                    style={{ color: 'var(--bp-ink-tertiary)' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Download className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>

            {/* RIGHT: Video on loop (or screenshot fallback) */}
            <div className="relative bg-black flex items-center justify-center min-h-[300px]">
              {test.video && test.testDir ? (
                <>
                  <div className="absolute top-2 left-3 z-10 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm">
                    <FileVideo className="w-3 h-3 text-[var(--bp-ink-tertiary)]" />
                    <span className="text-[10px] font-medium text-[var(--bp-ink-muted)]">Recording</span>
                  </div>
                  <video
                    src={aUrl(runId, test.testDir, test.video)}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-contain"
                  >
                    Your browser does not support video playback.
                  </video>
                </>
              ) : test.screenshot && test.testDir ? (
                <>
                  <div className="absolute top-2 left-3 z-10 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm">
                    <Image className="w-3 h-3 text-[var(--bp-ink-tertiary)]" />
                    <span className="text-[10px] font-medium text-[var(--bp-ink-muted)]">Screenshot</span>
                  </div>
                  <img
                    src={aUrl(runId, test.testDir, test.screenshot)}
                    alt={`Screenshot: ${test.name}`}
                    className="w-full h-full object-contain"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 py-12" style={{ color: 'var(--bp-ink-muted)' }}>
                  <FileVideo className="w-10 h-10" />
                  <span className="text-xs">No recording available</span>
                </div>
              )}
            </div>
          </div>

          {/* Trace viewer modal */}
          {test.trace && test.testDir && traceOpen && (
            <TraceModal
              open={traceOpen}
              onClose={() => setTraceOpen(false)}
              traceUrl={`${window.location.origin}${API}/api/audit/artifacts/${runId}/${test.testDir}/${test.trace}`}
              testName={test.name}
            />
          )}
        </div>
      )}
    </div>
  );
}

function RunHistoryRow({ run, isLatest, isSelected, onSelect }: {
  run: RunSummary; isLatest: boolean; isSelected: boolean; onSelect: () => void;
}) {
  const passRate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;
  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-all duration-150"
      role="button"
      tabIndex={0}
      aria-current={isSelected ? "true" : undefined}
      aria-label={`Run ${run.runId} — ${run.passed} passed, ${run.failed} failed`}
      style={{
        background: isSelected ? 'var(--bp-copper-light)' : 'transparent',
        border: isSelected ? '1px solid var(--bp-copper)' : '1px solid transparent',
      }}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
    >
      <div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: passRate >= 80 ? 'var(--bp-operational)' : passRate >= 50 ? 'var(--bp-caution)' : 'var(--bp-fault)' }}
      />
      <span className="text-xs truncate flex-1" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-primary)' }}>{run.runId}</span>
      <span className="text-[10px] shrink-0" style={{ color: 'var(--bp-ink-tertiary)' }}>{formatTimestamp(run.timestamp)}</span>
      <div className="flex items-center gap-1 text-[10px] shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <span style={{ color: 'var(--bp-operational)' }}>{run.passed}</span>
        <span style={{ color: 'var(--bp-ink-muted)' }}>/</span>
        {run.failed > 0 && <span style={{ color: 'var(--bp-fault)' }}>{run.failed}</span>}
        {run.failed > 0 && <span style={{ color: 'var(--bp-ink-muted)' }}>/</span>}
        <span style={{ color: 'var(--bp-ink-tertiary)' }}>{run.total}</span>
      </div>
      {isLatest && (
        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--bp-copper-light)', color: 'var(--bp-copper)' }}>NEW</span>
      )}
    </div>
  );
}

// ── Main Page ──

export default function TestAudit() {
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunSummary | null>(null);
  const [auditStatus, setAuditStatus] = useState<AuditStatus>({ status: "idle" });
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasLoadedOnce = useRef(false);
  const selectedRunRef = useRef(selectedRun);
  const auditStatusRef = useRef(auditStatus);

  useEffect(() => {
    selectedRunRef.current = selectedRun;
  }, [selectedRun]);

  useEffect(() => {
    auditStatusRef.current = auditStatus;
  }, [auditStatus]);

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchJson<RunSummary[]>("/api/audit/history");
      if (!Array.isArray(data)) return;
      setHistory(data);
      if (!selectedRunRef.current && data.length > 0) setSelectedRun(data[0]);
    } catch (err) { console.warn("[TestAudit] Failed to load history:", err); }
    if (!hasLoadedOnce.current) {
      hasLoadedOnce.current = true;
      setLoading(false);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const status = await fetchJson<AuditStatus>("/api/audit/status");
      const wasRunning = auditStatusRef.current.status === "running";
      setAuditStatus(status);
      if (status.status === "idle" && wasRunning) loadHistory();
    } catch (err) { console.warn("[TestAudit] Failed to check status:", err); }
  }, [loadHistory]);

  useEffect(() => {
    loadHistory();
    checkStatus();
    pollRef.current = setInterval(checkStatus, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadHistory, checkStatus]);

  useEffect(() => {
    if (auditStatus.status === "idle" && hasLoadedOnce.current) loadHistory();
  }, [auditStatus.status, loadHistory]);

  const triggerRun = async () => {
    setTriggering(true);
    try {
      const result = await postJson<{ status: string; error?: string; pid?: number }>("/api/audit/run");
      if (result.error) alert(result.error);
      else setAuditStatus({ status: "running", pid: result.pid });
    } catch (e) {
      alert(`Failed to trigger: ${e}`);
    }
    setTriggering(false);
  };

  const isRunning = auditStatus.status === "running";

  return (
    <div className="space-y-4 animate-in fade-in duration-300" style={{ padding: 32, maxWidth: 1280, margin: '0 auto' }}>
      {/* Header — full width */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--bp-copper-light)', border: '1px solid var(--bp-copper)' }}>
            <Activity className="w-5 h-5" style={{ color: 'var(--bp-copper)' }} />
          </div>
          <div>
            <h1 style={{ fontFamily: 'var(--bp-font-display)', fontSize: 32, color: 'var(--bp-ink-primary)', fontWeight: 400, lineHeight: 1.2 }}>Test Audit</h1>
            <p className="text-xs" style={{ color: 'var(--bp-ink-secondary)' }}>
              Playwright cross-page consistency audit
              {selectedRun && ` — ${selectedRun.tests.length} tests`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full animate-pulse" style={{ background: 'var(--bp-copper-light)', border: '1px solid var(--bp-copper)' }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--bp-copper)' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--bp-copper)' }}>Running...</span>
            </div>
          )}
          {history.length > 1 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => setShowHistory(!showHistory)}
            >
              <History className="w-3.5 h-3.5" />
              {showHistory ? "Hide" : "History"}
              <Badge variant="outline" className="text-[9px] px-1 py-0 ml-1">{history.length}</Badge>
            </Button>
          )}
          <Button
            onClick={triggerRun}
            disabled={isRunning || triggering}
            size="sm"
            className="gap-1.5 text-white border-0"
            style={{ background: 'var(--bp-copper)', color: '#fff' }}
          >
            {isRunning ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running</>
            ) : triggering ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Starting</>
            ) : (
              <><Play className="w-3.5 h-3.5" /> Run Audit</>
            )}
          </Button>
          <Button variant="outline" size="icon" onClick={loadHistory} className="shrink-0 h-8 w-8">
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--bp-ink-muted)' }} />
        </div>
      ) : history.length === 0 ? (
        <Card style={{ background: 'var(--bp-surface-1)', borderColor: 'var(--bp-border)' }}>
          <CardContent className="py-16 text-center">
            <Activity className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--bp-ink-muted)', opacity: 0.4 }} />
            <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--bp-ink-primary)' }}>No audit runs yet</h3>
            <p className="text-sm mb-6" style={{ color: 'var(--bp-ink-tertiary)' }}>
              Click "Run Audit" to execute the Playwright test suite.
            </p>
            <Button
              onClick={triggerRun}
              disabled={isRunning || triggering}
              className="gap-2 text-white border-0 bg-[var(--bp-copper)]"
            >
              <Play className="w-4 h-4" /> Run First Audit
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Run history panel — collapsible, full width */}
          {showHistory && (
            <Card style={{ background: 'var(--bp-surface-1)', borderColor: 'var(--bp-border)' }}>
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-medium flex items-center gap-2" style={{ color: 'var(--bp-ink-tertiary)' }}>
                  <History className="w-3.5 h-3.5" /> Previous Runs
                </CardTitle>
              </CardHeader>
              <CardContent className="px-2 pb-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1">
                {history.map((run, i) => (
                  <RunHistoryRow
                    key={run.runId}
                    run={run}
                    isLatest={i === 0}
                    isSelected={selectedRun?.runId === run.runId}
                    onSelect={() => { setSelectedRun(run); setShowHistory(false); }}
                  />
                ))}
              </CardContent>
            </Card>
          )}

          {/* Score bar — full width */}
          {selectedRun && <ScoreBar run={selectedRun} />}

          {/* Charts row */}
          {selectedRun && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {history.length >= 2 && <TrendChart history={history} />}
              <ResultBreakdownChart run={selectedRun} />
              <TestDurationChart run={selectedRun} />
            </div>
          )}

          {/* Test results — full width, each row edge to edge */}
          {selectedRun && (
            <div className="space-y-2">
              {selectedRun.tests
                .sort((a, b) => {
                  const order: Record<string, number> = { failed: 0, skipped: 1, unknown: 2, passed: 3 };
                  return (order[a.status] ?? 2) - (order[b.status] ?? 2);
                })
                .map((test, i) => (
                  <TestCard key={i} test={test} runId={selectedRun.runId} />
                ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
