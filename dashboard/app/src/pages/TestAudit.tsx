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
  BarChart3, History, Monitor, ChevronLeft, Maximize2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, AreaChart, Area, CartesianGrid, Legend,
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
        "Read loaded/total/registered counts for Landing Zone, Bronze, and Silver",
        "Compared Bronze registered count against total entities",
        "Cross-checked Bronze loaded against Execution Matrix and Validation",
      ],
      expected: "Bronze and Silver registered counts should equal total entities. Bronze loaded should match Execution Matrix and Validation.",
      failHint: "Registered entities don't match total — some entities may not have been registered for all layers, or the counts are coming from different queries.",
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
      expected: "Every source should show the same count for Landing, Bronze, and Silver — they're the same entities registered at each layer.",
      failHint: "Layer counts differ per source — some entities may only be registered for certain layers, or the query is filtering incorrectly.",
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
      failHint: "Flow Explorer total is off — it may be counting Gold or other layers that aren't registered yet.",
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
        "Checked registered entity counts on Live Monitor (Bug 11)",
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
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
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
  const ringColor = passRate >= 80 ? "text-emerald-400" : passRate >= 50 ? "text-amber-400" : "text-red-400";
  const barColor = passRate >= 80 ? "bg-emerald-400" : passRate >= 50 ? "bg-amber-400" : "bg-red-400";

  return (
    <div className="flex items-center gap-6 px-6 py-4 rounded-xl bg-card border border-border/50">
      {/* Pass rate ring */}
      <div className="relative w-16 h-16 shrink-0">
        <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="currentColor" strokeWidth="2.5" className="text-muted/20"
          />
          <path
            d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            fill="none" stroke="currentColor" strokeWidth="3"
            strokeDasharray={`${passRate}, 100`} strokeLinecap="round" className={ringColor}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn("text-lg font-bold", ringColor)}>{passRate}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex-1 space-y-1.5">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{run.runId}</span>
          <span>{formatTimestamp(run.timestamp)}</span>
        </div>
        <div className="h-2.5 rounded-full bg-muted overflow-hidden flex">
          {run.passed > 0 && (
            <div className="bg-emerald-400 h-full" style={{ width: `${(run.passed / run.total) * 100}%` }} />
          )}
          {run.failed > 0 && (
            <div className="bg-red-400 h-full" style={{ width: `${(run.failed / run.total) * 100}%` }} />
          )}
          {run.skipped > 0 && (
            <div className="bg-amber-400 h-full" style={{ width: `${(run.skipped / run.total) * 100}%` }} />
          )}
        </div>
      </div>

      {/* KPI chips */}
      <div className="flex items-center gap-4 shrink-0">
        {[
          { label: "Total", value: run.total, icon: Monitor, color: "text-blue-400" },
          { label: "Passed", value: run.passed, icon: CheckCircle2, color: "text-emerald-400" },
          { label: "Failed", value: run.failed, icon: XCircle, color: "text-red-400" },
          { label: "Duration", value: formatDuration(run.durationMs), icon: Clock, color: "text-amber-400" },
        ].map((k) => (
          <div key={k.label} className="text-center">
            <div className={cn("text-lg font-bold", k.color)}>{k.value}</div>
            <div className="text-[10px] text-muted-foreground">{k.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const CHART_COLORS = {
  passed: "#34d399",  // emerald-400
  failed: "#f87171",  // red-400
  skipped: "#fbbf24", // amber-400
};

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
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">Pass/Fail Trend</CardTitle>
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
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="run" tick={{ fontSize: 9, fill: "#888" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 9, fill: "#888" }} tickLine={false} axisLine={false} width={25} />
            <Tooltip
              contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
              labelStyle={{ color: "#999", fontSize: 10 }}
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
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">Result Breakdown</CardTitle>
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
              contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="flex-1 space-y-2 pl-2">
          {data.map((d) => (
            <div key={d.name} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="text-xs text-muted-foreground flex-1">{d.name}</span>
              <span className="text-sm font-bold text-foreground">{d.value}</span>
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
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-1 pt-3 px-4">
        <CardTitle className="text-xs font-medium text-muted-foreground">Slowest Tests (seconds)</CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 9, fill: "#888" }} tickLine={false} axisLine={false} />
            <YAxis
              type="category" dataKey="name" width={120}
              tick={{ fontSize: 9, fill: "#888" }} tickLine={false} axisLine={false}
            />
            <Tooltip
              contentStyle={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 11 }}
              formatter={(v: number | undefined) => [`${v ?? 0}s`, "Duration"]}
            />
            <Bar dataKey="duration" radius={[0, 4, 4, 0]}>
              {data.map((d, i) => (
                <Cell key={i} fill={CHART_COLORS[d.status as keyof typeof CHART_COLORS] || "#666"} fillOpacity={0.7} />
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
        <DialogHeader className="px-4 pt-3 pb-2 border-b border-border/30 flex flex-row items-center gap-3">
          <FileSearch className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <DialogTitle className="text-sm font-medium truncate">{testName}</DialogTitle>
            <DialogDescription className="text-[10px] text-muted-foreground">Playwright Trace Viewer</DialogDescription>
          </div>
          <a
            href={traceUrl}
            download
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-accent/50"
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
              className="absolute inset-0 z-10 flex flex-col items-center justify-center cursor-pointer bg-[#0a0a1a] transition-opacity"
              onClick={() => setActivated(true)}
            >
              <div className="relative group">
                <div className="w-24 h-24 rounded-full bg-amber-500/20 flex items-center justify-center backdrop-blur-sm border border-amber-500/30 group-hover:bg-amber-500/30 group-hover:scale-110 transition-all duration-300">
                  <Play className="w-10 h-10 text-amber-400 ml-1 group-hover:text-amber-300 transition-colors" />
                </div>
                <div className="absolute inset-0 w-24 h-24 rounded-full animate-ping bg-amber-500/10 pointer-events-none" />
              </div>
              <p className="mt-4 text-sm text-muted-foreground">Click anywhere to load trace</p>
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

  const statusColors: Record<string, string> = {
    passed: "border-l-emerald-400",
    failed: "border-l-red-400",
    skipped: "border-l-amber-400",
    unknown: "border-l-zinc-400",
  };
  const statusBg: Record<string, string> = {
    passed: "bg-emerald-500/8",
    failed: "bg-red-500/8",
    skipped: "bg-amber-500/8",
    unknown: "",
  };

  return (
    <div className={cn(
      "rounded-lg border border-border/40 overflow-hidden transition-all duration-200 border-l-[3px]",
      statusColors[test.status] || statusColors.unknown,
      statusBg[test.status] || "",
    )}>
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {test.status === "passed" ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
        ) : test.status === "failed" ? (
          <XCircle className="w-5 h-5 text-red-400 shrink-0" />
        ) : test.status === "skipped" ? (
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
        ) : (
          <Clock className="w-5 h-5 text-muted-foreground shrink-0" />
        )}

        <span className="flex-1 text-sm font-medium text-foreground">{test.name}</span>

        <span className="text-xs text-muted-foreground tabular-nums mr-2">
          {test.durationMs > 0 ? formatDuration(test.durationMs) : ""}
        </span>

        {hasArtifacts && (
          <div className="flex items-center gap-1.5 mr-2">
            {test.screenshot && <Image className="w-3.5 h-3.5 text-blue-400/60" />}
            {test.video && <FileVideo className="w-3.5 h-3.5 text-violet-400/60" />}
            {test.trace && <FileSearch className="w-3.5 h-3.5 text-amber-400/60" />}
          </div>
        )}

        {hasArtifacts && (
          expanded
            ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
            : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </div>

      {/* Expanded: 50/50 split — description left, video right */}
      {expanded && hasArtifacts && (
        <div className="border-t border-border/30 bg-black/5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
            {/* LEFT: Plain English description */}
            <div className="p-5 border-r border-border/20 overflow-y-auto max-h-[420px] space-y-4">
              {desc ? (
                <>
                  {/* Scenario */}
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      What Was Tested
                    </h4>
                    <p className="text-sm text-foreground/90 leading-relaxed">{desc.scenario}</p>
                  </div>

                  {/* Actions */}
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      What It Did
                    </h4>
                    <ul className="space-y-1">
                      {desc.actions.map((a, i) => (
                        <li key={i} className="text-sm text-foreground/80 leading-relaxed flex gap-2">
                          <span className="text-muted-foreground/50 shrink-0 mt-0.5 text-xs">{i + 1}.</span>
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Expected */}
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      What Should Happen
                    </h4>
                    <p className="text-sm text-foreground/80 leading-relaxed">{desc.expected}</p>
                  </div>

                  {/* Result */}
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                      Result
                    </h4>
                    {test.status === "passed" ? (
                      <div className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                        <p className="text-sm text-emerald-300/90 leading-relaxed">
                          Passed — everything checked out. The numbers matched across pages as expected.
                        </p>
                      </div>
                    ) : test.status === "failed" ? (
                      <div className="flex items-start gap-2">
                        <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                        <p className="text-sm text-red-300/90 leading-relaxed">
                          Failed — {desc.failHint}
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                        <p className="text-sm text-amber-300/90 leading-relaxed">
                          Skipped or unknown — test didn't run to completion.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* No catalog entry — show generic info */
                <div className="flex flex-col items-center justify-center h-full text-center py-8">
                  <AlertTriangle className="w-8 h-8 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">
                    No description available for this test.
                  </p>
                  <p className="text-xs text-muted-foreground/60 mt-1">
                    Test: {test.name}
                  </p>
                </div>
              )}

              {/* Trace + download bar inside left panel */}
              {test.trace && test.testDir && (
                <div className="flex items-center gap-2 pt-3 border-t border-border/20">
                  <FileSearch className="w-3.5 h-3.5 text-amber-400/70" />
                  <span className="text-xs text-muted-foreground flex-1">Trace Recording</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                    onClick={(e) => { e.stopPropagation(); setTraceOpen(true); }}
                  >
                    <Maximize2 className="w-3 h-3" /> View Trace
                  </Button>
                  <a
                    href={aUrl(runId, test.testDir, test.trace)}
                    download
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
                    <FileVideo className="w-3 h-3 text-violet-300" />
                    <span className="text-[10px] font-medium text-violet-200">Recording</span>
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
                    <Image className="w-3 h-3 text-blue-300" />
                    <span className="text-[10px] font-medium text-blue-200">Screenshot</span>
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
                <div className="flex flex-col items-center gap-2 text-muted-foreground/40 py-12">
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
      className={cn(
        "flex items-center gap-3 px-4 py-2.5 rounded-lg cursor-pointer transition-all duration-150",
        "hover:bg-accent/40",
        isSelected && "bg-primary/10 border border-primary/30",
        !isSelected && "border border-transparent",
      )}
      onClick={onSelect}
    >
      <div className={cn(
        "w-2 h-2 rounded-full shrink-0",
        passRate >= 80 ? "bg-emerald-400" : passRate >= 50 ? "bg-amber-400" : "bg-red-400",
      )} />
      <span className="text-xs font-mono text-foreground truncate flex-1">{run.runId}</span>
      <span className="text-[10px] text-muted-foreground shrink-0">{formatTimestamp(run.timestamp)}</span>
      <div className="flex items-center gap-1 text-[10px] tabular-nums shrink-0">
        <span className="text-emerald-400">{run.passed}</span>
        <span className="text-muted-foreground/40">/</span>
        {run.failed > 0 && <span className="text-red-400">{run.failed}</span>}
        {run.failed > 0 && <span className="text-muted-foreground/40">/</span>}
        <span className="text-muted-foreground">{run.total}</span>
      </div>
      {isLatest && (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">NEW</span>
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

  const loadHistory = useCallback(async () => {
    try {
      const data = await fetchJson<RunSummary[]>("/api/audit/history");
      setHistory(data);
      if (!selectedRun && data.length > 0) setSelectedRun(data[0]);
    } catch { /* no history */ }
    setLoading(false);
  }, [selectedRun]);

  const checkStatus = useCallback(async () => {
    try {
      const status = await fetchJson<AuditStatus>("/api/audit/status");
      const wasRunning = auditStatus.status === "running";
      setAuditStatus(status);
      if (status.status === "idle" && wasRunning) loadHistory();
    } catch { /* ignore */ }
  }, [auditStatus.status, loadHistory]);

  useEffect(() => {
    loadHistory();
    checkStatus();
    pollRef.current = setInterval(checkStatus, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (auditStatus.status === "idle") loadHistory();
  }, [auditStatus.status]);

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
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Header — full width */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 flex items-center justify-center border border-violet-500/20">
            <Activity className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Test Audit</h1>
            <p className="text-xs text-muted-foreground">
              Playwright cross-page consistency audit
              {selectedRun && ` — ${selectedRun.tests.length} tests`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 animate-pulse">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span className="text-xs font-medium text-blue-400">Running...</span>
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
            className="gap-1.5 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white border-0 shadow-lg shadow-violet-500/20"
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
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : history.length === 0 ? (
        <Card className="bg-card border-border/50">
          <CardContent className="py-16 text-center">
            <Activity className="w-12 h-12 mx-auto mb-4 text-muted-foreground/30" />
            <h3 className="text-lg font-medium text-foreground mb-2">No audit runs yet</h3>
            <p className="text-sm text-muted-foreground mb-6">
              Click "Run Audit" to execute the Playwright test suite.
            </p>
            <Button
              onClick={triggerRun}
              disabled={isRunning || triggering}
              className="gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white border-0"
            >
              <Play className="w-4 h-4" /> Run First Audit
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Run history panel — collapsible, full width */}
          {showHistory && (
            <Card className="bg-card border-border/50">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
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
