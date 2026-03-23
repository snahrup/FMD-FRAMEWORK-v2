import React, { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Play, Square, Loader2, AlertCircle, CheckCircle2, XCircle,
  ChevronDown, ChevronUp, Activity, RefreshCw, Clock, Zap,
  HeartPulse, RotateCcw, Terminal, Timer, Layers,
  Gauge, TrendingUp, AlertTriangle, Search, Filter, Database,
  FileBarChart, X, ArrowUpDown, Server, Settings, ArrowRight, WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { resolveSourceLabel } from "@/hooks/useSourceConfig";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";

// ── Types ──

interface EngineStatus {
  status: "idle" | "running" | "stopping" | "error";
  current_run_id: string | null;
  uptime_seconds: number;
  engine_version: string;
  load_method?: "local" | "pipeline";
  pipeline_fallback?: boolean;
  pipeline_configured?: boolean;
  last_run: {
    run_id: string;
    status: string;
    started_at: string;
    finished_at: string;
    duration_seconds: number;
  } | null;
}

interface RunConfig {
  layers: ("landing" | "bronze" | "silver")[];
  mode: "run" | "plan";
  entity_ids: number[];
}

interface StartResult {
  run_id: string;
  status: string;
}

interface PlanSource {
  name: string;
  namespace: string;
  server: string;
  database: string;
  entity_count: number;
  incremental: number;
  full_load: number;
}

interface PlanLayerStep {
  layer: string;
  action: string;
  method: string;
  entity_count: number;
  batch_size: number;
  chunk_rows: number | null;
  notebook_id: string | null;
  details: string;
}

interface PlanEntity {
  id: number;
  name: string;
  namespace: string;
  server: string;
  database: string;
  incremental: boolean;
  watermark_column: string | null;
  last_value: string | null;
  load_type: string;
  primary_keys: string | null;
}

interface PlanResult {
  run_id: string;
  entity_count: number;
  incremental_count: number;
  full_load_count: number;
  layers: string[];
  entities: PlanEntity[];
  sources: PlanSource[];
  layer_plan: PlanLayerStep[];
  config_snapshot: Record<string, unknown>;
  warnings: string[];
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  run_id?: string;
  entity_id?: number;
  layer?: string;
  status?: string;
  rows_read?: number;
  duration_seconds?: number;
}

interface EntityResult {
  entity_id: number;
  entity_name?: string;
  layer: string;
  status: "succeeded" | "failed" | "skipped";
  rows_read: number;
  duration_seconds: number;
  error?: string;
}

interface RunSummary {
  succeeded: number;
  failed: number;
  skipped: number;
  total_rows: number;
  duration_seconds?: number;
}

interface RunRecord {
  run_id: string;
  status: string;
  mode: string;
  started_at: string;
  finished_at: string | null;
  duration_seconds: number | null;
  entities_succeeded: number;
  entities_failed: number;
  entities_skipped: number;
  triggered_by: string;
  total_rows?: number;
}

interface HealthCheck {
  name: string;
  passed: boolean;
  message: string;
}

interface HealthReport {
  checks: HealthCheck[];
  all_passed: boolean;
}

interface MetricsData {
  runs: Array<{ run_id: string; status: string; started_at: string; duration_seconds: number }>;
  layers: Record<string, { count: number; avg_duration: number }>;
  slowest_entities: Array<{ EntityId: number; SourceName: string; DataSourceName: string; DurationSeconds: number; RowsRead: number }>;
  top_errors: Array<{ ErrorType: string; ErrorMessage: string; Occurrences: number }>;
}

// ── API ──

const API = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
  }
  return res.json();
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
  }
  return res.json();
}

// ── CSS-var reader (for Recharts SVG fill props) ──

const cssVar = (name: string) =>
  typeof document !== 'undefined'
    ? getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    : '';

// ── Helpers ──

function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || sec < 0) return "--";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function friendlyError(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes("forcibly closed") || s.includes("10054") || s.includes("communication link"))
    return "Connection dropped (network/VPN)";
  if (s.includes("timeout") || s.includes("hyt00"))
    return "Query timed out";
  if (s.includes("login failed") || s.includes("authentication"))
    return "Authentication failed";
  if (s.includes("out of memory") || s.includes("oom"))
    return "Out of memory";
  if (s.includes("permission") || s.includes("access denied"))
    return "Permission denied";
  if (s.includes("does not exist") || s.includes("invalid object"))
    return "Table not found";
  if (s.includes("throttl") || s.includes("429"))
    return "Throttled (too many requests)";
  if (s.includes("ssl") || s.includes("encryption"))
    return "SSL/encryption error";
  // Fallback: first meaningful chunk
  const match = raw.match(/\]([^[\]]{10,80})/);
  return match ? match[1].trim() : raw.slice(0, 60);
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtTimestamp(iso: string | null | undefined): string {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtTimeShort(iso: string | null | undefined): string {
  if (!iso) return "--";
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return iso;
  }
}

function truncateId(id: string | null | undefined, len = 8): string {
  if (!id) return "--";
  return id.length > len ? id.slice(0, len) + "..." : id;
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}

/** Pretty labels for engine config keys */
const CONFIG_LABELS: Record<string, string> = {
  load_method: "Load Method",
  pipeline_fallback: "Pipeline Fallback",
  batch_size: "Batch Size",
  chunk_rows: "Chunk Rows",
  query_timeout: "Query Timeout",
  lz_lakehouse: "LZ Lakehouse",
  bronze_lakehouse: "Bronze Lakehouse",
  silver_lakehouse: "Silver Lakehouse",
  workspace_data: "Data Workspace",
  workspace_code: "Code Workspace",
  notebook_lz: "LZ Notebook",
  notebook_bronze: "Bronze Notebook",
  notebook_silver: "Silver Notebook",
};

/** Map well-known GUIDs to Fabric entity names */
const GUID_NAMES: Record<string, string> = {
  "3b9a7e79-1615-4ec2-9e93-0bdebe985d5a": "LH_DATA_LANDINGZONE",
  "f06393ca-c024-435f-8d7f-9f5aa3bb4cb3": "LH_BRONZE_LAYER",
  "f85e1ba0-2e40-4de5-be1e-f8ad3ddbc652": "LH_SILVER_LAYER",
  "0596d0e7-e036-451d-a967-41a284302e8d": "INTEGRATION DATA (D)",
  "c0366b24-e6f8-4994-b4df-b765ecb5bbf8": "INTEGRATION CODE (D)",
  "a2712a97-ebde-4036-b704-4892b8c4f7af": "NB_FMD_LOAD_LANDING_BRONZE",
  "8ce7bc73-35ac-4844-8937-969b7d99ec3e": "NB_FMD_LOAD_BRONZE_SILVER",
  "efbd2436-83bf-4cad-b92e-f489dc255506": "NB_FMD_LOAD_LANDINGZONE_MAIN",
};

function ConfigValue({ k, v }: { k: string; v: unknown }) {
  const [showGuid, setShowGuid] = useState(false);
  const str = v ? String(v) : "";
  const isGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(str);
  const friendlyName = isGuid ? GUID_NAMES[str] : null;

  if (friendlyName) {
    return (
      <span
        className="text-foreground font-mono cursor-pointer hover:text-[var(--bp-copper)] transition-colors"
        title={`Click to ${showGuid ? "hide" : "show"} GUID`}
        onClick={() => setShowGuid(!showGuid)}
      >
        {showGuid ? str : friendlyName}
      </span>
    );
  }

  // Format booleans and numbers nicely
  if (typeof v === "boolean") return <span className="text-foreground font-mono">{v ? "Yes" : "No"}</span>;
  if (typeof v === "number") return <span className="text-foreground font-mono tabular-nums">{fmtNum(v)}</span>;
  return <span className="text-foreground font-mono">{str || "—"}</span>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; pulse: string; bgStyle?: React.CSSProperties }> = {
  idle: { label: "Idle", color: "text-[var(--bp-operational)]", bg: "border", pulse: "bg-[var(--bp-operational)]", bgStyle: { background: "var(--bp-operational-light)", borderColor: "var(--bp-operational)" } },
  running: { label: "Running", color: "text-[var(--bp-copper)]", bg: "border", pulse: "bg-[var(--bp-copper)]", bgStyle: { background: "var(--bp-copper-light)", borderColor: "var(--bp-copper)" } },
  stopping: { label: "Stopping", color: "text-[var(--bp-caution)]", bg: "border", pulse: "bg-[var(--bp-caution)]", bgStyle: { background: "var(--bp-caution-light)", borderColor: "var(--bp-caution)" } },
  error: { label: "Error", color: "text-[var(--bp-fault)]", bg: "border", pulse: "bg-[var(--bp-fault)]", bgStyle: { background: "var(--bp-fault-light)", borderColor: "var(--bp-fault)" } },
};

const LAYER_COLORS: Record<string, React.CSSProperties> = {
  landing: { color: "var(--bp-ink-secondary)", background: "var(--bp-surface-2)", borderColor: "var(--bp-border)" },
  bronze: { color: "var(--bp-caution)", background: "var(--bp-caution-light)", borderColor: "var(--bp-caution)" },
  silver: { color: "var(--bp-ink-tertiary)", background: "var(--bp-surface-inset)", borderColor: "var(--bp-border-strong)" },
};

// ── Sub-components ──

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.idle;
  return (
    <div className={cn("flex items-center gap-2 px-3 py-1.5 rounded-lg border", cfg.bg)}>
      <div className="relative flex items-center justify-center">
        <div className={cn("h-2.5 w-2.5 rounded-full", cfg.pulse, status === "running" && "animate-pulse")} />
      </div>
      <span className={cn("text-sm font-semibold", cfg.color)}>{cfg.label}</span>
    </div>
  );
}

function LayerBadge({ layer }: { layer: string }) {
  const style = LAYER_COLORS[layer.toLowerCase()] || { color: "var(--bp-ink-muted)", background: "var(--bp-surface-inset)", borderColor: "var(--bp-border)" };
  return (
    <span className="text-[10px] px-2 py-0.5 rounded border uppercase" style={{ fontFamily: "var(--bp-font-mono)", ...style }}>
      {layer}
    </span>
  );
}

function EntityStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "succeeded") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border" style={{ fontFamily: "var(--bp-font-mono)", background: "var(--bp-operational-light)", color: "var(--bp-operational)", borderColor: "var(--bp-operational)" }}>
        <CheckCircle2 className="h-3 w-3" /> OK
      </span>
    );
  }
  if (s === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border" style={{ fontFamily: "var(--bp-font-mono)", background: "var(--bp-fault-light)", color: "var(--bp-fault)", borderColor: "var(--bp-fault)" }}>
        <XCircle className="h-3 w-3" /> FAIL
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border" style={{ fontFamily: "var(--bp-font-mono)", background: "var(--bp-surface-inset)", color: "var(--bp-ink-muted)", borderColor: "var(--bp-border)" }}>
      <Clock className="h-3 w-3" /> {status}
    </span>
  );
}

function ProgressBar({ current, total, label }: { current: number; total: number; label?: string }) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-foreground">{label}</span>
          <span className="text-muted-foreground font-mono tabular-nums">
            {fmtNum(current)} / {fmtNum(total)} ({pct.toFixed(0)}%)
          </span>
        </div>
      )}
      <div className="h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            pct >= 100 ? "bg-[var(--bp-operational)]" : "bg-[var(--bp-copper)]",
          )}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

function LogLine({ entry }: { entry: LogEntry }) {
  const levelColor =
    entry.level === "ERROR" ? "var(--bp-fault)" :
    entry.level === "WARN" ? "var(--bp-caution)" :
    entry.level === "INFO" ? "var(--bp-info)" :
    "var(--bp-ink-muted)";

  const msgColor =
    entry.level === "ERROR" ? "var(--bp-fault-light)" :
    entry.level === "WARN" ? "var(--bp-caution-light)" :
    "#e2e8f0"; /* no exact bp token for default log text */

  return (
    <div className="flex items-start gap-2 py-[3px] font-mono text-[13px] leading-[1.7]">
      <span className="shrink-0 w-[72px] text-right text-[11px]" style={{ color: "var(--bp-ink-tertiary)" }}>
        {fmtTimeShort(entry.timestamp)}
      </span>
      <span className="shrink-0 w-[42px] text-right font-semibold text-[11px]" style={{ color: levelColor }}>
        {entry.level}
      </span>
      <span className="break-words whitespace-pre-wrap" style={{ color: msgColor }}>{entry.message}</span>
    </div>
  );
}

// ── Task Log type (from sp_GetEngineTaskLogs) ──

interface TaskLog {
  TaskId: string;
  RunId: string;
  EntityId: number;
  Layer: string;
  Status: string;
  StartedAtUtc: string;
  CompletedAtUtc: string | null;
  SourceServer: string | null;
  SourceDatabase: string | null;
  SourceTable: string | null;
  RowsRead: number | null;
  RowsWritten: number | null;
  BytesTransferred: number | null;
  DurationSeconds: number | null;
  RowsPerSecond: number | null;
  LoadType: string | null;
  WatermarkColumn: string | null;
  WatermarkBefore: string | null;
  WatermarkAfter: string | null;
  ErrorType: string | null;
  ErrorMessage: string | null;
  ErrorSuggestion: string | null;
  SourceSchema: string | null;
  SourceName: string | null;
  DataSourceName: string | null;
}

// ── Run Summary Modal ──

function RunSummaryModal({
  run,
  onClose,
}: {
  run: RunRecord;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<TaskLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "failures" | "entities">(
    run.entities_failed > 0 ? "failures" : "overview"
  );
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string>("Entity");
  const [sortAsc, setSortAsc] = useState(true);

  // Fetch task logs on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchJson<{ logs: TaskLog[]; count: number }>(
          `/engine/logs?run_id=${run.run_id}&limit=5000`
        );
        if (!cancelled) setTasks(data.logs || []);
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [run.run_id]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // ── Aggregation ──

  const totalRows = tasks.reduce((s, t) => s + (t.RowsRead || 0), 0);
  const totalSucceeded = tasks.filter(t => t.Status?.toLowerCase() === "succeeded").length;
  const totalFailed = tasks.filter(t => t.Status?.toLowerCase() === "failed").length;
  const totalSkipped = tasks.filter(t => t.Status?.toLowerCase() === "skipped").length;
  const totalEntities = tasks.length;

  // Group by DataSource
  const bySource = tasks.reduce<Record<string, { count: number; succeeded: number; failed: number; rows: number; duration: number }>>((acc, t) => {
    const src = t.DataSourceName || "Unknown";
    if (!acc[src]) acc[src] = { count: 0, succeeded: 0, failed: 0, rows: 0, duration: 0 };
    acc[src].count++;
    if (t.Status?.toLowerCase() === "succeeded") acc[src].succeeded++;
    if (t.Status?.toLowerCase() === "failed") acc[src].failed++;
    acc[src].rows += t.RowsRead || 0;
    acc[src].duration += t.DurationSeconds || 0;
    return acc;
  }, {});

  // Group by Layer
  const byLayer = tasks.reduce<Record<string, { succeeded: number; failed: number; skipped: number; totalDur: number; count: number }>>((acc, t) => {
    const layer = (t.Layer || "unknown").toLowerCase();
    if (!acc[layer]) acc[layer] = { succeeded: 0, failed: 0, skipped: 0, totalDur: 0, count: 0 };
    acc[layer].count++;
    if (t.Status?.toLowerCase() === "succeeded") acc[layer].succeeded++;
    if (t.Status?.toLowerCase() === "failed") acc[layer].failed++;
    if (t.Status?.toLowerCase() === "skipped") acc[layer].skipped++;
    acc[layer].totalDur += t.DurationSeconds || 0;
    return acc;
  }, {});

  // Group failures by ErrorType + truncated ErrorMessage
  const errorGroups = tasks
    .filter(t => t.Status?.toLowerCase() === "failed")
    .reduce<Record<string, { count: number; suggestion: string | null; entities: string[] }>>((acc, t) => {
      const errType = t.ErrorType || "unknown";
      const errMsg = (t.ErrorMessage || "No message").slice(0, 80);
      const key = `${errType}::${errMsg}`;
      if (!acc[key]) acc[key] = { count: 0, suggestion: t.ErrorSuggestion || null, entities: [] };
      acc[key].count++;
      const name = t.SourceName ? `${t.SourceSchema || "dbo"}.${t.SourceName}` : `Entity ${t.EntityId}`;
      if (acc[key].entities.length < 10) acc[key].entities.push(name);
      return acc;
    }, {});

  // Sort entity table
  const sortedTasks = [...tasks].sort((a, b) => {
    let va: string | number = 0, vb: string | number = 0;
    switch (sortCol) {
      case "Entity": va = a.SourceName || ""; vb = b.SourceName || ""; break;
      case "Source": va = a.DataSourceName || ""; vb = b.DataSourceName || ""; break;
      case "Layer": va = a.Layer || ""; vb = b.Layer || ""; break;
      case "Status": va = a.Status || ""; vb = b.Status || ""; break;
      case "Rows": va = a.RowsRead || 0; vb = b.RowsRead || 0; break;
      case "Duration": va = a.DurationSeconds || 0; vb = b.DurationSeconds || 0; break;
    }
    if (typeof va === "number" && typeof vb === "number") return sortAsc ? va - vb : vb - va;
    return sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  const handleSort = (col: string) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  const fmtNum = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n);

  const runStatus = (run.status || "").toLowerCase();
  const statusColor =
    runStatus === "completed" || runStatus === "succeeded" ? "text-[var(--bp-operational)]" :
    runStatus === "failed" ? "text-[var(--bp-fault)]" :
    runStatus === "aborted" ? "text-[var(--bp-caution)]" : "text-muted-foreground";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-muted">
          <div className="flex items-center gap-4">
            <FileBarChart className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                Run Report
                <span className="font-mono text-xs text-muted-foreground">{truncateId(run.run_id, 12)}</span>
              </h2>
              <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                <span className={cn("font-semibold uppercase", statusColor)}>{run.status}</span>
                <span>{fmtTimestamp(run.started_at)}</span>
                <span>{fmtDuration(run.duration_seconds)}</span>
                <span>via {run.triggered_by || "dashboard"}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="ml-3 text-sm text-muted-foreground">Loading run data...</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-lg border bg-muted p-3 text-center">
                <div className="text-2xl font-bold font-mono tabular-nums">{totalEntities}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Total Tasks</div>
              </div>
              <div className="rounded-lg border bg-[var(--bp-operational-light)] border-[var(--bp-operational)] p-3 text-center">
                <div className="text-2xl font-bold font-mono tabular-nums text-[var(--bp-operational)]">{totalSucceeded}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">
                  Succeeded {totalEntities > 0 && <span className="text-[var(--bp-operational)]">({(totalSucceeded / totalEntities * 100).toFixed(0)}%)</span>}
                </div>
              </div>
              <div className="rounded-lg border bg-[var(--bp-fault-light)] border-[var(--bp-fault)] p-3 text-center">
                <div className="text-2xl font-bold font-mono tabular-nums text-[var(--bp-fault)]">{totalFailed}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">
                  Failed {totalEntities > 0 && totalFailed > 0 && <span className="text-[var(--bp-fault)]">({(totalFailed / totalEntities * 100).toFixed(0)}%)</span>}
                </div>
              </div>
              <div className="rounded-lg border bg-muted p-3 text-center">
                <div className="text-2xl font-bold font-mono tabular-nums">{fmtNum(totalRows)}</div>
                <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Rows Loaded</div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b">
              {(["overview", "failures", "entities"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "px-4 py-2 text-xs font-medium border-b-2 transition-colors capitalize",
                    activeTab === tab
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                    tab === "failures" && totalFailed > 0 && activeTab !== tab && "text-[var(--bp-fault)]",
                  )}
                >
                  {tab}
                  {tab === "failures" && totalFailed > 0 && (
                    <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bp-fault-light)] text-[var(--bp-fault)] font-mono">
                      {totalFailed}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            {activeTab === "overview" && (
              <div className="space-y-4">
                {/* By Source */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">By Data Source</h3>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted">
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Source</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Entities</th>
                          <th className="px-3 py-2 text-right font-medium text-[var(--bp-operational)]">OK</th>
                          <th className="px-3 py-2 text-right font-medium text-[var(--bp-fault)]">Fail</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Rows</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {Object.entries(bySource)
                          .sort(([, a], [, b]) => b.count - a.count)
                          .map(([src, d]) => (
                            <tr key={src} className="hover:bg-muted/50">
                              <td className="px-3 py-1.5 font-medium">{resolveSourceLabel(src)}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{d.count}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--bp-operational)]">{d.succeeded}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--bp-fault)]">{d.failed || ""}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtNum(d.rows)}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{fmtDuration(d.duration)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* By Layer */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">By Layer</h3>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted">
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Layer</th>
                          <th className="px-3 py-2 text-right font-medium text-[var(--bp-operational)]">OK</th>
                          <th className="px-3 py-2 text-right font-medium text-[var(--bp-fault)]">Fail</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Skip</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Avg Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {["landing", "bronze", "silver"].filter(l => byLayer[l]).map(layer => {
                          const d = byLayer[layer];
                          const avg = d.count > 0 ? d.totalDur / d.count : 0;
                          return (
                            <tr key={layer} className="hover:bg-muted/50">
                              <td className="px-3 py-1.5">
                                <LayerBadge layer={layer} />
                              </td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--bp-operational)]">{d.succeeded}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[var(--bp-fault)]">{d.failed || ""}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{d.skipped || ""}</td>
                              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">{avg > 0 ? `${avg.toFixed(1)}s` : "--"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "failures" && (
              <div className="space-y-4">
                {totalFailed === 0 ? (
                  <div className="text-center py-8">
                    <CheckCircle2 className="h-8 w-8 text-[var(--bp-operational)] opacity-30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No failures in this run</p>
                  </div>
                ) : (
                  <>
                    {/* Error Groups */}
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Error Groups</h3>
                      <div className="space-y-2">
                        {Object.entries(errorGroups)
                          .sort(([, a], [, b]) => b.count - a.count)
                          .map(([key, group]) => {
                            const [errType, errMsg] = key.split("::");
                            return (
                              <div key={key} className="rounded-lg border border-[var(--bp-fault)] bg-[var(--bp-fault-light)] p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bp-fault-light)] text-[var(--bp-fault)] border border-[var(--bp-fault)] font-mono">
                                        {errType}
                                      </span>
                                      <span className="text-xs font-mono text-[var(--bp-fault)] truncate">{errMsg}</span>
                                    </div>
                                    {group.suggestion && (
                                      <p className="text-xs text-[var(--bp-caution)] mt-1">
                                        <AlertTriangle className="h-3 w-3 inline mr-1" />
                                        {group.suggestion}
                                      </p>
                                    )}
                                    <p className="text-[10px] text-muted-foreground mt-1.5 truncate">
                                      {group.entities.join(", ")}{group.count > 10 ? ` (+${group.count - 10} more)` : ""}
                                    </p>
                                  </div>
                                  <span className="text-lg font-bold font-mono text-[var(--bp-fault)] shrink-0">{group.count}</span>
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </div>

                    {/* Failed Entity Table */}
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Failed Entities</h3>
                      <div className="rounded-lg border overflow-hidden">
                        <div className="max-h-[300px] overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-muted/40 z-10">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Entity</th>
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Source</th>
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Layer</th>
                                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Error</th>
                                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Duration</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                              {tasks
                                .filter(t => t.Status?.toLowerCase() === "failed")
                                .sort((a, b) => (a.SourceName || "").localeCompare(b.SourceName || ""))
                                .map((t) => (
                                  <tr key={t.TaskId} className="hover:bg-muted/50">
                                    <td className="px-3 py-1.5 font-mono">
                                      <span className="text-foreground">{t.SourceSchema || "dbo"}.{t.SourceName || `Entity ${t.EntityId}`}</span>
                                    </td>
                                    <td className="px-3 py-1.5 text-muted-foreground">{resolveSourceLabel(t.DataSourceName) || "--"}</td>
                                    <td className="px-3 py-1.5"><LayerBadge layer={t.Layer} /></td>
                                    <td className="px-3 py-1.5 text-[var(--bp-fault)] max-w-[200px] truncate" title={t.ErrorMessage || ""}>
                                      {friendlyError(t.ErrorMessage ?? undefined) || t.ErrorType || "--"}
                                    </td>
                                    <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">
                                      {t.DurationSeconds != null ? `${t.DurationSeconds.toFixed(1)}s` : "--"}
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === "entities" && (
              <div>
                <div className="rounded-lg border overflow-hidden">
                  <div className="max-h-[450px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/40 z-10">
                        <tr>
                          {["Entity", "Source", "Layer", "Status", "Rows", "Duration", "Load Type"].map(col => (
                            <th
                              key={col}
                              className={cn(
                                "px-3 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none",
                                col === "Rows" || col === "Duration" ? "text-right" : "text-left",
                              )}
                              onClick={() => handleSort(col)}
                            >
                              <span className="inline-flex items-center gap-1">
                                {col}
                                {sortCol === col && <ArrowUpDown className="h-3 w-3" />}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {sortedTasks.map((t) => {
                          const isExp = expandedTaskId === t.TaskId;
                          const s = (t.Status || "").toLowerCase();
                          return (
                            <tr key={t.TaskId} className="group">
                              <td colSpan={7} className="p-0">
                                <div
                                  className={cn(
                                    "flex items-center px-3 py-1.5 cursor-pointer transition-colors hover:bg-muted/50",
                                    isExp && "bg-muted/5",
                                  )}
                                  onClick={() => setExpandedTaskId(isExp ? null : t.TaskId)}
                                >
                                  <div className="w-[200px] shrink-0 font-mono truncate" title={`${t.SourceSchema}.${t.SourceName}`}>
                                    {t.SourceSchema || "dbo"}.{t.SourceName || `Entity ${t.EntityId}`}
                                  </div>
                                  <div className="w-[90px] shrink-0 text-muted-foreground">{resolveSourceLabel(t.DataSourceName) || "--"}</div>
                                  <div className="w-[80px] shrink-0"><LayerBadge layer={t.Layer} /></div>
                                  <div className="w-[70px] shrink-0">
                                    <EntityStatusBadge status={t.Status} />
                                  </div>
                                  <div className="w-[80px] shrink-0 text-right font-mono tabular-nums">
                                    {t.RowsRead != null ? fmtNum(t.RowsRead) : "--"}
                                  </div>
                                  <div className="w-[70px] shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                                    {t.DurationSeconds != null ? `${t.DurationSeconds.toFixed(1)}s` : "--"}
                                  </div>
                                  <div className="flex-1 text-right">
                                    <span className={cn(
                                      "text-[10px] px-1.5 py-0.5 rounded font-mono",
                                      t.LoadType === "incremental" ? "bg-[var(--bp-copper-light)] text-[var(--bp-copper)]" : "bg-muted text-muted-foreground",
                                    )}>
                                      {t.LoadType || "--"}
                                    </span>
                                  </div>
                                </div>
                                {/* Expanded detail */}
                                {isExp && (
                                  <div className="px-4 py-2 bg-muted/5 border-t border-border/30 text-[11px] space-y-1">
                                    {(t.SourceServer || t.SourceDatabase) && (
                                      <div><span className="text-muted-foreground">Source:</span> <span className="font-mono">{resolveSourceLabel(t.SourceDatabase || t.SourceServer)}</span></div>
                                    )}
                                    {t.WatermarkColumn && (
                                      <div>
                                        <span className="text-muted-foreground">Watermark:</span>{" "}
                                        <span className="font-mono">{t.WatermarkColumn}</span>{" "}
                                        <span className="text-muted-foreground">{t.WatermarkBefore || "null"} → {t.WatermarkAfter || "null"}</span>
                                      </div>
                                    )}
                                    {t.RowsPerSecond != null && t.RowsPerSecond > 0 && (
                                      <div><span className="text-muted-foreground">Throughput:</span> <span className="font-mono">{fmtNum(t.RowsPerSecond)} rows/s</span></div>
                                    )}
                                    {t.BytesTransferred != null && t.BytesTransferred > 0 && (
                                      <div><span className="text-muted-foreground">Bytes:</span> <span className="font-mono">{fmtNum(t.BytesTransferred)}</span></div>
                                    )}
                                    {s === "failed" && t.ErrorMessage && (
                                      <div className="mt-1 p-2 rounded bg-[var(--bp-fault-light)] border border-[var(--bp-fault)]">
                                        <div className="text-[var(--bp-fault)] font-mono text-xs break-words leading-relaxed">{t.ErrorMessage}</div>
                                        {t.ErrorSuggestion && (
                                          <div className="text-[var(--bp-caution)] mt-1 text-xs leading-relaxed">
                                            <AlertTriangle className="h-3 w-3 inline mr-1" />
                                            {t.ErrorSuggestion}
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Collapsible Section ──

function Section({
  title,
  icon,
  badge,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader className="pb-2 cursor-pointer select-none" onClick={() => setOpen(!open)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {icon}
            {title}
            {badge}
          </CardTitle>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

// ── Main Component ──

export default function EngineControl() {
  // Engine status
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Run config panel
  const [configOpen, setConfigOpen] = useState(false);
  const [configLayers, setConfigLayers] = useState<Set<string>>(new Set(["landing", "bronze", "silver"]));
  const [configMode, setConfigMode] = useState<"run" | "plan">("run");
  // configEntityIds removed — replaced by multi-select table (selectedEntityIds)
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  // Load method — sync from engine ONCE on mount, then user selection is king
  const [loadMethod, setLoadMethod] = useState<"local" | "pipeline">("local");
  const loadMethodSynced = useRef(false);
  const [pipelineFallback, setPipelineFallback] = useState(true);
  const [pipelineConfigured, setPipelineConfigured] = useState(false);

  // Manual reload entity selector
  const [entitySelectorOpen, setEntitySelectorOpen] = useState(false);
  const [allEntities, setAllEntities] = useState<Array<{
    entity_id: number; source_schema: string; source_name: string;
    namespace: string; datasource: string; source_database: string;
    is_incremental: boolean; last_loaded: string | null; lz_status: string;
  }>>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(false);
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<number>>(new Set());
  const [entitySearch, setEntitySearch] = useState("");

  // Plan result
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);

  // Live run state
  const [liveRunId, setLiveRunId] = useState<string | null>(null);
  const [logBuffer, setLogBuffer] = useState<LogEntry[]>([]);
  const [entityResults, setEntityResults] = useState<EntityResult[]>([]);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  // Fabric notebook job tracking (pipeline/notebook mode)
  const [fabricJobs, setFabricJobs] = useState<Array<{
    job_id: string; layer: string; status: string; elapsed_seconds: number;
  }>>([]);
  const [fabricRunElapsed, setFabricRunElapsed] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Run history
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedRunLogs, setExpandedRunLogs] = useState<LogEntry[]>([]);
  const [expandedRunLogsLoading, setExpandedRunLogsLoading] = useState(false);
  const [reportRun, setReportRun] = useState<RunRecord | null>(null);

  // Health check — collapsed by default, auto-polls every 10s while panel is open
  const [healthOpen, setHealthOpen] = useState(false);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthLastChecked, setHealthLastChecked] = useState<Date | null>(null);

  // Metrics
  const [metrics, setMetrics] = useState<MetricsData | null>(null);

  // Stopping
  const [stopping, setStopping] = useState(false);

  // Retry
  const [retrying, setRetrying] = useState<string | null>(null);

  // Log view mode

  const isRunning = status?.status === "running";
  const isStopping = status?.status === "stopping";

  // Refs to break dependency cycles in the status poll callback
  const liveRunIdRef = useRef(liveRunId);
  liveRunIdRef.current = liveRunId;
  const runSummaryRef = useRef(runSummary);
  runSummaryRef.current = runSummary;

  // ── Fetch engine status ──
  const fetchStatus = useCallback(async () => {
    try {
      const s = await fetchJson<EngineStatus>("/engine/status");
      setStatus(s);
      setError(null);

      // Sync load method from engine ONCE on mount — after that, user's selection wins
      if (s.load_method && !loadMethodSynced.current) {
        setLoadMethod(s.load_method);
        loadMethodSynced.current = true;
      }
      if (s.pipeline_fallback !== undefined) setPipelineFallback(s.pipeline_fallback);
      if (s.pipeline_configured !== undefined) setPipelineConfigured(s.pipeline_configured);

      // If engine is running and we don't have an active SSE, start one
      // But don't re-trigger if SSE already gave up after max retries
      if (s.status === "running" && s.current_run_id && !liveRunIdRef.current && !sseGaveUp.current) {
        setLiveRunId(s.current_run_id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cannot reach engine");
    } finally {
      setLoading(false);
    }
  }, []); // stable — no deps, reads refs

  // ── Auto-refresh status every 5 seconds ──
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // ── Fetch run history ──
  const fetchRuns = useCallback(async () => {
    setRunsLoading(true);
    try {
      const data = await fetchJson<{ runs: RunRecord[]; count: number }>("/engine/runs?limit=20");
      setRuns(data.runs || []);
    } catch {
      // silently fail — history is non-critical
    } finally {
      setRunsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // Refresh runs when a run completes
  useEffect(() => {
    if (runSummary) fetchRuns();
  }, [runSummary, fetchRuns]);

  // ── Fetch entities for manual reload selector ──
  const fetchEntities = useCallback(async () => {
    setEntitiesLoading(true);
    try {
      const data = await fetchJson<{ entities: typeof allEntities; count: number }>("/engine/entities");
      setAllEntities(data.entities || []);
    } catch {
      // silently fail
    } finally {
      setEntitiesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (entitySelectorOpen && allEntities.length === 0) fetchEntities();
  }, [entitySelectorOpen, allEntities.length, fetchEntities]);

  // ── Fetch metrics ──
  const fetchMetrics = useCallback(async () => {
    try {
      const raw = await fetchJson<Record<string, unknown>>("/engine/metrics?hours=24");
      // Normalize: backend returns `layers` as an array of objects with
      // {Layer, TotalTasks, AvgDurationSeconds, ...} but the frontend
      // MetricsData interface expects a Record<string, {count, avg_duration}>.
      let normalizedLayers: MetricsData["layers"] = {};
      const rawLayers = raw.layers;
      if (Array.isArray(rawLayers)) {
        for (const row of rawLayers) {
          const key = String(row.Layer || "unknown").toLowerCase();
          normalizedLayers[key] = {
            count: Number(row.TotalTasks || 0),
            avg_duration: Number(row.AvgDurationSeconds || 0),
          };
        }
      } else if (rawLayers && typeof rawLayers === "object") {
        normalizedLayers = rawLayers as MetricsData["layers"];
      }

      setMetrics({
        runs: (raw.runs || []) as MetricsData["runs"],
        layers: normalizedLayers,
        slowest_entities: (raw.slowest_entities || []) as MetricsData["slowest_entities"],
        top_errors: (raw.top_errors || []) as MetricsData["top_errors"],
      });
    } catch {
      // silently fail — metrics are non-critical
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  // ── SSE Stream for live run ──
  // Connect SSE only when liveRunId is set. Use a ref-based guard so the
  // effect doesn't re-fire on every status poll cycle.
  const sseRunIdRef = useRef<string | null>(null);
  const sseRetryCount = useRef(0);
  const sseGaveUp = useRef(false);
  const [sseDisconnected, setSseDisconnected] = useState(false);
  const SSE_MAX_RETRIES = 5;

  useEffect(() => {
    // Only open SSE when we have a live run and haven't already connected for it
    if (!liveRunId || sseRunIdRef.current === liveRunId) return;
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    sseRunIdRef.current = liveRunId;
    const es = new EventSource(`${API}/engine/logs/stream`);
    eventSourceRef.current = es;

    es.addEventListener("open", () => {
      // Connection established — reset retry counter
      sseRetryCount.current = 0;
      setSseDisconnected(false);
    });

    es.addEventListener("log", (e: MessageEvent) => {
      try {
        const data: LogEntry = JSON.parse(e.data);
        setLogBuffer((prev) => [...prev, data]);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener("entity_result", (e: MessageEvent) => {
      try {
        const data: EntityResult = JSON.parse(e.data);
        setEntityResults((prev) => [...prev, data]);
      } catch { /* ignore */ }
    });

    es.addEventListener("job_status", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.jobs) setFabricJobs(data.jobs);
        if (data.elapsed_seconds != null) setFabricRunElapsed(data.elapsed_seconds);
      } catch { /* ignore */ }
    });

    es.addEventListener("run_complete", (e: MessageEvent) => {
      try {
        const data: RunSummary = JSON.parse(e.data);
        setRunSummary(data);
      } catch { /* ignore */ }
      setFabricJobs([]);
      setFabricRunElapsed(0);
      sseRetryCount.current = 0;
      es.close();
      eventSourceRef.current = null;
      sseRunIdRef.current = null;
    });

    es.addEventListener("run_error", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        setRunError(data.error || "Unknown error");
      } catch { /* ignore */ }
      sseRetryCount.current = 0;
      es.close();
      eventSourceRef.current = null;
      sseRunIdRef.current = null;
    });

    es.onerror = () => {
      // SSE connection failed — close and attempt reconnection with backoff.
      // The effect dep array is [liveRunId] which hasn't changed, so we must
      // force a re-render cycle to trigger reconnection.
      es.close();
      eventSourceRef.current = null;
      sseRunIdRef.current = null;
      sseRetryCount.current += 1;

      if (sseRetryCount.current > SSE_MAX_RETRIES) {
        // Give up — the SSE endpoint is unreachable. The status poll
        // (every 5s) still tracks the engine, so the UI isn't blind.
        // Set gaveUp flag so fetchStatus won't re-trigger SSE.
        sseGaveUp.current = true;
        setSseDisconnected(true);
        console.warn(`SSE reconnect failed after ${SSE_MAX_RETRIES} attempts, giving up`);
        return;
      }

      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      const delay = Math.min(2000 * Math.pow(2, sseRetryCount.current - 1), 32000);
      setTimeout(() => {
        if (liveRunIdRef.current && !eventSourceRef.current) {
          // Briefly clear and re-set liveRunId to force the effect to re-fire
          const currentId = liveRunIdRef.current;
          setLiveRunId(null);
          requestAnimationFrame(() => setLiveRunId(currentId));
        }
      }, delay);
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [liveRunId]);

  // Note: /api/engine/jobs endpoint does not exist — fabric job tracking
  // comes from SSE job_status events instead. Polling removed to stop 404s.

  // ── Auto-scroll log container ──
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logBuffer, autoScroll]);

  // ── Actions ──

  const handleStart = async () => {
    setLaunchError(null);
    setLaunching(true);
    setRunSummary(null);
    setRunError(null);
    setLogBuffer([]);
    setEntityResults([]);
    sseRetryCount.current = 0;

    const layers = Array.from(configLayers) as ("landing" | "bronze" | "silver")[];
    const entityIds = Array.from(selectedEntityIds);

    // Build plan query params (shared by both dry run and actual run)
    const params = new URLSearchParams();
    if (layers.length < 3) params.set("layers", layers.join(","));
    if (entityIds.length > 0) params.set("entity_ids", entityIds.join(","));
    params.set("load_method", loadMethod);
    params.set("pipeline_fallback", String(pipelineFallback));

    try {
      if (configMode === "plan") {
        // Dry run — just show the plan
        const plan = await fetchJson<PlanResult>(`/engine/plan?${params.toString()}`);
        setPlanResult(plan);
      } else {
        // Actual run — fetch the plan first so it stays visible during execution
        try {
          const plan = await fetchJson<PlanResult>(`/engine/plan?${params.toString()}`);
          setPlanResult(plan);
        } catch {
          // Plan fetch failed — don't block the run, just clear
          setPlanResult(null);
        }

        const body: Record<string, unknown> = {
          mode: "run",
          layers,
          triggered_by: "dashboard",
          load_method: loadMethod,
          pipeline_fallback: pipelineFallback,
        };
        if (entityIds.length > 0) body.entity_ids = entityIds;

        const result = await postJson<StartResult>("/engine/start", body);
        setLiveRunId(result.run_id);
        setConfigOpen(false);
        fetchStatus();
      }
    } catch (err) {
      setLaunchError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setLaunching(false);
    }
  };

  const handleStop = async () => {
    if (!window.confirm("Stop the engine? In-flight entities will finish but no new ones will start.")) return;
    setStopping(true);
    try {
      await postJson("/engine/stop", {});
      fetchStatus();
      fetchRuns();
    } catch {
      // ignore
    } finally {
      setStopping(false);
    }
  };

  const handleHealthCheck = useCallback(async () => {
    setHealthLoading(true);
    try {
      const report = await fetchJson<HealthReport>("/engine/health");
      setHealthReport(report);
      setHealthLastChecked(new Date());
    } catch (err) {
      setHealthReport({
        checks: [{ name: "API Connectivity", passed: false, message: err instanceof Error ? err.message : "Failed" }],
        all_passed: false,
      });
      setHealthLastChecked(new Date());
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // Auto-poll health every 10s while panel is open
  useEffect(() => {
    if (!healthOpen) return;
    handleHealthCheck();
    const interval = setInterval(handleHealthCheck, 10000);
    return () => clearInterval(interval);
  }, [healthOpen, handleHealthCheck]);

  const handleRetry = async (runId: string) => {
    setRetrying(runId);
    try {
      const result = await postJson<StartResult>("/engine/retry", { run_id: runId });
      setLiveRunId(result.run_id);
      setLogBuffer([]);
      setEntityResults([]);
      setRunSummary(null);
      setRunError(null);
      fetchStatus();
    } catch {
      // ignore
    } finally {
      setRetrying(null);
    }
  };

  const [aborting, setAborting] = useState<string | null>(null);

  const handleAbortRun = async (runId: string) => {
    setAborting(runId);
    try {
      await postJson<{ aborted: number; message: string }>("/engine/abort-run", { run_id: runId });
      fetchRuns();
      fetchStatus();
    } catch {
      // ignore
    } finally {
      setAborting(null);
    }
  };

  const handleAbortAll = async () => {
    if (!window.confirm("Abort ALL runs? This will cancel every in-progress entity immediately.")) return;
    setAborting("__all__");
    try {
      await postJson<{ aborted: number; message: string }>("/engine/abort-run", { all: true });
      fetchRuns();
      fetchStatus();
    } catch {
      // ignore
    } finally {
      setAborting(null);
    }
  };

  const handleExpandRun = async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    setExpandedRunLogsLoading(true);
    setExpandedRunLogs([]);
    try {
      const data = await fetchJson<{ logs: TaskLog[]; count: number }>(`/engine/logs?run_id=${runId}&limit=200`);
      // The API returns TaskLog objects (from sp_GetEngineTaskLogs) which have
      // PascalCase fields like {TaskId, RunId, EntityId, Layer, Status, StartedAtUtc...}.
      // Map them into LogEntry shape so LogLine can render them.
      const mapped: LogEntry[] = (data.logs || []).map((task) => {
        const entityLabel = task.SourceName
          ? `${task.SourceSchema || "dbo"}.${task.SourceName}`
          : `Entity ${task.EntityId}`;
        const statusLower = (task.Status || "").toLowerCase();
        const level = statusLower === "failed" ? "ERROR" : statusLower === "succeeded" ? "INFO" : "WARN";
        const parts = [`[${(task.Layer || "?").toUpperCase()}] ${entityLabel}: ${task.Status || "unknown"}`];
        if (task.RowsRead != null && task.RowsRead > 0) parts.push(`${task.RowsRead.toLocaleString()} rows`);
        if (task.DurationSeconds != null) parts.push(`${task.DurationSeconds.toFixed(1)}s`);
        if (statusLower === "failed" && task.ErrorMessage) parts.push(`- ${task.ErrorMessage.slice(0, 100)}`);
        return {
          timestamp: task.StartedAtUtc || task.CompletedAtUtc || "",
          level,
          message: parts.join(" "),
          run_id: task.RunId,
          entity_id: task.EntityId,
          layer: task.Layer,
          status: task.Status,
          rows_read: task.RowsRead ?? undefined,
          duration_seconds: task.DurationSeconds ?? undefined,
        };
      });
      setExpandedRunLogs(mapped);
    } catch {
      setExpandedRunLogs([]);
    } finally {
      setExpandedRunLogsLoading(false);
    }
  };

  const toggleLayer = (layer: string) => {
    setConfigLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        if (next.size > 1) next.delete(layer); // must keep at least one
      } else {
        next.add(layer);
      }
      return next;
    });
  };

  // ── Derived values ──

  const completedEntities = entityResults.length;
  const succeededEntities = entityResults.filter((e) => e.status === "succeeded").length;
  const failedEntities = entityResults.filter((e) => e.status === "failed").length;
  const skippedEntities = entityResults.filter((e) => e.status === "skipped").length;
  const totalRows = entityResults.reduce((sum, e) => sum + (e.rows_read || 0), 0);
  const totalDuration = entityResults.reduce((sum, e) => sum + (e.duration_seconds || 0), 0);

  // ── Loading state ──

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Connecting to FMD Engine...</p>
        </div>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <AlertCircle className="h-8 w-8 text-[var(--bp-fault)] mx-auto mb-4" />
          <p className="text-foreground font-medium mb-2">Cannot Reach FMD Engine</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button onClick={fetchStatus} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const engineStatus = status?.status || "idle";
  const statusCfg = STATUS_CONFIG[engineStatus] || STATUS_CONFIG.idle;

  return (
    <div className="space-y-4" style={{ padding: "32px", maxWidth: "1280px" }}>
      {/* ═══════════════════════════════════════════════════ */}
      {/* Top Bar                                             */}
      {/* ═══════════════════════════════════════════════════ */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="flex items-center gap-3" style={{ fontFamily: "var(--font-display)", fontSize: "32px", color: "var(--bp-ink-primary)", lineHeight: "1.1" }}>
            <Zap className="h-7 w-7" style={{ color: "var(--bp-copper)" }} />
            Engine Control
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            FMD v3 Python loading engine — start, monitor, and manage data pipeline runs
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHealthOpen(!healthOpen)}
            className="gap-1.5"
          >
            <HeartPulse className="h-3.5 w-3.5" />
            Health Check
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleStop}
            disabled={!isRunning || stopping}
            className={cn("gap-1.5", isRunning && "border-[var(--bp-fault)] text-[var(--bp-fault)] hover:bg-[var(--bp-fault-light)]")}
          >
            {stopping ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
            Stop
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setConfigOpen(!configOpen);
              setPlanResult(null);
              setLaunchError(null);
            }}
            disabled={isRunning || isStopping}
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5" />
            Start Run
          </Button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* Status Bar                                          */}
      {/* ═══════════════════════════════════════════════════ */}
      <div className={cn("rounded-xl p-4 flex flex-wrap items-center gap-4", statusCfg.bg)} style={statusCfg.bgStyle}>
        <StatusBadge status={engineStatus} />

        <div className="h-8 w-px bg-border/40 hidden sm:block" />

        {status?.engine_version && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">Version</span>
            <span className="font-mono font-semibold text-foreground">{status.engine_version}</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-xs">
          {loadMethod === "pipeline" ? (
            <Zap className="h-3 w-3 text-[var(--bp-copper)]" />
          ) : (
            <Terminal className="h-3 w-3 text-[var(--bp-caution)]" />
          )}
          <span className="text-muted-foreground">Method</span>
          <span className={cn(
            "font-mono font-semibold",
            loadMethod === "pipeline" ? "text-[var(--bp-copper)]" : "text-[var(--bp-caution)]",
          )}>
            {loadMethod === "pipeline" ? "Notebook" : "Local"}
          </span>
        </div>

        {status && status.uptime_seconds > 0 && (
          <div className="flex items-center gap-1.5 text-xs">
            <Timer className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Uptime</span>
            <span className="font-mono font-semibold text-foreground">{fmtUptime(status.uptime_seconds)}</span>
          </div>
        )}

        {status?.current_run_id && (
          <div className="flex items-center gap-1.5 text-xs">
            <Activity className="h-3 w-3 text-[var(--bp-copper)] animate-pulse" />
            <span className="text-muted-foreground">Run</span>
            <span className="font-mono font-semibold text-foreground">{truncateId(status.current_run_id)}</span>
          </div>
        )}

        {status?.last_run && !isRunning && (
          <>
            <div className="h-8 w-px bg-border/40 hidden sm:block" />
            <div className="flex items-center gap-3 text-xs">
              <span className="text-muted-foreground">Last run:</span>
              <span className={cn(
                "font-mono font-semibold",
                status.last_run.status === "completed" ? "text-[var(--bp-operational)]" :
                status.last_run.status === "failed" ? "text-[var(--bp-fault)]" : "text-muted-foreground",
              )}>
                {status.last_run.status}
              </span>
              <span className="text-muted-foreground font-mono">{fmtDuration(status.last_run.duration_seconds)}</span>
              <span className="text-muted-foreground/60">{fmtTimestamp(status.last_run.finished_at)}</span>
            </div>
          </>
        )}

        {error && (
          <>
            <div className="h-8 w-px bg-border/40 hidden sm:block" />
            <span className="text-xs text-[var(--bp-caution)] flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              Status poll failed
            </span>
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════ */}
      {/* Health Check Panel                                  */}
      {/* ═══════════════════════════════════════════════════ */}
      {healthOpen && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <HeartPulse className="h-4 w-4 text-[var(--bp-fault)]" />
                System Health
                {healthReport && (
                  <Badge
                    variant={healthReport.all_passed ? "success" : "destructive"}
                    className="ml-2"
                  >
                    {healthReport.all_passed ? "All Passed" : "Issues Found"}
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                {healthLoading && healthReport && (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )}
                {healthLastChecked && !healthLoading && (
                  <span className="text-[10px] text-muted-foreground">
                    {healthLastChecked.toLocaleTimeString()}
                  </span>
                )}
                <Button variant="ghost" size="sm" onClick={() => setHealthOpen(false)}>
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {healthLoading && !healthReport ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">Running health checks...</span>
              </div>
            ) : healthReport ? (
              <div className="divide-y divide-border">
                {healthReport.checks.map((check, i) => (
                  <div key={i} className="flex items-center gap-3 py-2.5">
                    {check.passed ? (
                      <CheckCircle2 className="h-4 w-4 text-[var(--bp-operational)] shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-[var(--bp-fault)] shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground">{check.name}</span>
                    </div>
                    <span className={cn(
                      "text-xs",
                      check.passed ? "text-muted-foreground" : "text-[var(--bp-fault)]",
                    )}>
                      {check.message}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* Run Config Panel                                    */}
      {/* ═══════════════════════════════════════════════════ */}
      {configOpen && !isRunning && (
        <Card className="border-2 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              Run Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-2">
            {/* Layer selection */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                Layers
              </label>
              <div className="flex gap-2">
                {(["landing", "bronze", "silver"] as const).map((layer) => {
                  const selected = configLayers.has(layer);
                  const colors: Record<string, string> = {
                    landing: "border-[var(--bp-copper)] bg-[var(--bp-copper-light)] text-[var(--bp-copper)]",
                    bronze: "border-[var(--bp-caution)] bg-[var(--bp-caution-light)] text-[var(--bp-caution)]",
                    silver: "border-[var(--bp-copper)] bg-[var(--bp-copper-light)] text-[var(--bp-copper)]",
                  };
                  return (
                    <button
                      key={layer}
                      onClick={() => toggleLayer(layer)}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all text-sm font-medium capitalize",
                        selected
                          ? colors[layer]
                          : "border-border text-muted-foreground hover:border-muted-foreground/40",
                      )}
                    >
                      <div className={cn(
                        "w-4 h-4 rounded border-2 flex items-center justify-center transition-all",
                        selected ? "border-current bg-current/20" : "border-muted-foreground/30",
                      )}>
                        {selected && <CheckCircle2 className="w-3 h-3" />}
                      </div>
                      {layer}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mode selection */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                Mode
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfigMode("run")}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all text-sm font-medium",
                    configMode === "run"
                      ? "border-[var(--bp-operational)] bg-[var(--bp-operational-light)] text-[var(--bp-operational)]"
                      : "border-border text-muted-foreground hover:border-muted-foreground/40",
                  )}
                >
                  <Play className="h-4 w-4" />
                  Run
                </button>
                <button
                  onClick={() => setConfigMode("plan")}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all text-sm font-medium",
                    configMode === "plan"
                      ? "border-[var(--bp-copper)] bg-[var(--bp-copper-light)] text-[var(--bp-copper)]"
                      : "border-border text-muted-foreground hover:border-muted-foreground/40",
                  )}
                >
                  <Search className="h-4 w-4" />
                  Plan (Dry Run)
                </button>
              </div>
            </div>

            {/* Load Method */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                Load Method
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setLoadMethod("pipeline")}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all text-sm font-medium",
                    loadMethod === "pipeline"
                      ? "border-[var(--bp-copper)] bg-[var(--bp-copper-light)] text-[var(--bp-copper)]"
                      : "border-border text-muted-foreground hover:border-muted-foreground/40",
                    !pipelineConfigured && "opacity-50",
                  )}
                >
                  <Zap className="h-4 w-4" />
                  Fabric Notebook
                  {!pipelineConfigured && (
                    <span className="text-[10px] text-[var(--bp-caution)] ml-1">(not configured)</span>
                  )}
                </button>
                <button
                  onClick={() => setLoadMethod("local")}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 transition-all text-sm font-medium",
                    loadMethod === "local"
                      ? "border-[var(--bp-caution)] bg-[var(--bp-caution-light)] text-[var(--bp-caution)]"
                      : "border-border text-muted-foreground hover:border-muted-foreground/40",
                  )}
                >
                  <Terminal className="h-4 w-4" />
                  Local (Python)
                </button>
              </div>
              {loadMethod === "pipeline" && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    onClick={() => setPipelineFallback(!pipelineFallback)}
                    className={cn(
                      "w-4 h-4 rounded border-2 flex items-center justify-center transition-all",
                      pipelineFallback
                        ? "border-[var(--bp-copper)] bg-[var(--bp-copper-light)] text-[var(--bp-copper)]"
                        : "border-muted-foreground/30",
                    )}
                  >
                    {pipelineFallback && <CheckCircle2 className="w-3 h-3" />}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    Auto-fallback to Local on pipeline failure
                  </span>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground mt-1.5">
                {loadMethod === "pipeline"
                  ? `Triggers ${Array.from(configLayers).map(l => l === "landing" ? "LZ" : l === "bronze" ? "Bronze" : "Silver").join(" → ")} notebook${configLayers.size > 1 ? "s" : ""} in Fabric — cloud-native, parallel entity processing`
                  : "Extracts via pyodbc on this machine, uploads Parquet to OneLake — slower but reliable"}
              </p>
            </div>

            {/* Entity selector */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                Entities
              </label>

              {/* Toggle: All vs Select Specific */}
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => { setEntitySelectorOpen(false); setSelectedEntityIds(new Set()); }}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                    !entitySelectorOpen
                      ? "border-[var(--bp-operational)] bg-[var(--bp-operational-light)] text-[var(--bp-operational)]"
                      : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-muted-foreground/50",
                  )}
                >
                  <Database className="h-4 w-4" />
                  All Entities
                </button>
                <button
                  onClick={() => setEntitySelectorOpen(true)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all",
                    entitySelectorOpen
                      ? "border-[var(--bp-copper)] bg-[var(--bp-copper-light)] text-[var(--bp-copper)]"
                      : "border-border bg-background text-muted-foreground hover:text-foreground hover:border-muted-foreground/50",
                  )}
                >
                  <Filter className="h-4 w-4" />
                  Select Specific
                  {selectedEntityIds.size > 0 && (
                    <Badge variant="outline" className="text-[var(--bp-copper)] border-[var(--bp-border)] bg-[var(--bp-copper-light)] ml-1">
                      {selectedEntityIds.size}
                    </Badge>
                  )}
                </button>
              </div>

              {entitySelectorOpen && (
                <div className="rounded-lg border border-border bg-background">
                  {/* Search + bulk actions */}
                  <div className="flex items-center gap-2 p-2.5 border-b border-border">
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    <input
                      type="text"
                      value={entitySearch}
                      onChange={(e) => setEntitySearch(e.target.value)}
                      placeholder="Search by table name, schema, namespace, or source..."
                      className="flex-1 text-sm bg-transparent text-foreground placeholder:text-muted-foreground/50 focus:outline-none font-mono"
                    />
                    {(() => {
                      const filtered = allEntities.filter((e) => {
                        if (!entitySearch) return true;
                        const q = entitySearch.toLowerCase();
                        return (
                          e.source_name.toLowerCase().includes(q) ||
                          e.source_schema.toLowerCase().includes(q) ||
                          e.namespace.toLowerCase().includes(q) ||
                          e.datasource.toLowerCase().includes(q) ||
                          e.source_database.toLowerCase().includes(q)
                        );
                      });
                      return (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => {
                              const ids = new Set(selectedEntityIds);
                              const allSelected = filtered.every((e) => ids.has(e.entity_id));
                              if (allSelected) {
                                filtered.forEach((e) => ids.delete(e.entity_id));
                              } else {
                                filtered.forEach((e) => ids.add(e.entity_id));
                              }
                              setSelectedEntityIds(ids);
                            }}
                            className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground transition-colors"
                          >
                            {filtered.every((e) => selectedEntityIds.has(e.entity_id)) && filtered.length > 0
                              ? "Deselect all"
                              : "Select all"}
                          </button>
                          {selectedEntityIds.size > 0 && (
                            <button
                              onClick={() => setSelectedEntityIds(new Set())}
                              className="text-xs px-2 py-1 rounded text-[var(--bp-fault)] hover:bg-[var(--bp-fault-light)] transition-colors"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Entity table */}
                  <div className="max-h-[300px] overflow-y-auto">
                    {entitiesLoading ? (
                      <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading entities...
                      </div>
                    ) : allEntities.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                        <Database className="h-6 w-6 opacity-40" />
                        <span>No entities found</span>
                        <span className="text-[10px]">Server may need a restart to enable this endpoint</span>
                      </div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead className="bg-muted/50 sticky top-0">
                          <tr>
                            <th className="w-8 px-2 py-1.5"></th>
                            <th className="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">Source</th>
                            <th className="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">Schema.Table</th>
                            <th className="px-2 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">Status</th>
                            <th className="px-2 py-1.5 text-right text-[10px] font-medium text-muted-foreground uppercase">Last Loaded</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allEntities
                            .filter((e) => {
                              if (!entitySearch) return true;
                              const q = entitySearch.toLowerCase();
                              return (
                                e.source_name.toLowerCase().includes(q) ||
                                e.source_schema.toLowerCase().includes(q) ||
                                e.namespace.toLowerCase().includes(q) ||
                                e.datasource.toLowerCase().includes(q) ||
                                e.source_database.toLowerCase().includes(q)
                              );
                            })
                            .map((e) => {
                              const checked = selectedEntityIds.has(e.entity_id);
                              return (
                                <tr
                                  key={e.entity_id}
                                  onClick={() => {
                                    const next = new Set(selectedEntityIds);
                                    if (checked) next.delete(e.entity_id);
                                    else next.add(e.entity_id);
                                    setSelectedEntityIds(next);
                                  }}
                                  className={cn(
                                    "cursor-pointer border-b border-border/50 transition-colors",
                                    checked ? "bg-[var(--bp-copper-light)]" : "hover:bg-muted/50",
                                  )}
                                >
                                  <td className="px-2 py-1.5">
                                    <div className={cn(
                                      "w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                                      checked ? "border-[var(--bp-copper)] bg-[var(--bp-copper-light)]" : "border-muted-foreground/30",
                                    )}>
                                      {checked && <CheckCircle2 className="w-3 h-3 text-[var(--bp-copper)]" />}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-muted-foreground font-mono">{e.namespace || e.datasource}</td>
                                  <td className="px-2 py-1.5 font-mono text-foreground">
                                    {e.source_schema}.{e.source_name}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <span className={cn(
                                      "text-[10px] px-1.5 py-0.5 rounded font-mono",
                                      e.lz_status === "loaded" ? "text-[var(--bp-operational)] bg-[var(--bp-operational-light)]" :
                                      e.lz_status === "failed" ? "text-[var(--bp-fault)] bg-[var(--bp-fault-light)]" :
                                      "text-muted-foreground bg-muted",
                                    )}>
                                      {e.lz_status}
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5 text-right text-muted-foreground font-mono">
                                    {e.last_loaded ? fmtTimestamp(e.last_loaded) : "--"}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="flex items-center justify-between px-2.5 py-2 border-t border-border bg-muted text-xs text-muted-foreground">
                    <span>{allEntities.length} total entities</span>
                    <span className={selectedEntityIds.size > 0 ? "text-[var(--bp-copper)] font-medium" : ""}>
                      {selectedEntityIds.size > 0 ? `${selectedEntityIds.size} selected` : "None selected — will run all"}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Launch button + error */}
            {launchError && (
              <div className="flex items-center gap-2 p-3 rounded-lg" style={{ background: "var(--bp-fault-light)", border: "1px solid var(--bp-fault)" }}>
                <AlertCircle className="w-4 h-4 text-[var(--bp-fault)] shrink-0" />
                <p className="text-sm text-[var(--bp-fault)]">{launchError}</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <Button variant="outline" size="sm" onClick={() => setConfigOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleStart}
                disabled={launching || configLayers.size === 0}
                className={cn(
                  "gap-2",
                  configMode === "run"
                    ? "bg-[var(--bp-operational)] hover:bg-[var(--bp-operational)] text-white"
                    : "bg-[var(--bp-copper)] hover:bg-[var(--bp-copper-hover)] text-white",
                )}
              >
                {launching ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {configMode === "plan" ? "Planning..." : "Launching..."}</>
                ) : configMode === "plan" ? (
                  <><Search className="h-4 w-4" /> Generate Plan</>
                ) : (
                  <><Zap className="h-4 w-4" /> Launch</>
                )}
              </Button>
            </div>

          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* Execution Plan — visible for both dry runs AND live runs */}
      {/* ═══════════════════════════════════════════════════ */}
      {planResult && (
        <Card className={cn(
          "border-2",
          liveRunId ? "border-[var(--bp-copper)]" : "border-[var(--bp-copper)]",
        )}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-5 w-5 text-[var(--bp-copper)]" />
              <span className="text-[var(--bp-copper)]">Execution Plan</span>
              {liveRunId && (
                <Badge variant="outline" className="ml-2 text-[10px] border-[var(--bp-copper)] text-[var(--bp-copper)]">
                  <Activity className="h-3 w-3 mr-1 animate-pulse" /> Running
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground font-mono ml-auto">{planResult.run_id.slice(0, 8)}</span>
              {!liveRunId && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-1" onClick={() => setPlanResult(null)}>
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            {/* KPI Row */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-2 rounded bg-background border text-center">
                <p className="text-xl font-bold text-foreground tabular-nums">{fmtNum(planResult.entity_count)}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Entities</p>
              </div>
              <div className="p-2 rounded bg-background border text-center">
                <p className="text-xl font-bold text-[var(--bp-copper)] tabular-nums">{fmtNum(planResult.incremental_count)}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Incremental</p>
              </div>
              <div className="p-2 rounded bg-background border text-center">
                <p className="text-xl font-bold text-[var(--bp-caution)] tabular-nums">{fmtNum(planResult.full_load_count)}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Full Load</p>
              </div>
              <div className="p-2 rounded bg-background border text-center">
                <p className="text-xl font-bold text-foreground tabular-nums">{planResult.layers.length}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Layers</p>
              </div>
              <div className="p-2 rounded bg-background border text-center">
                <p className="text-xl font-bold text-foreground tabular-nums">{planResult.sources?.length || 0}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sources</p>
              </div>
            </div>

            {/* Layer badges */}
            <div className="flex gap-2">
              {planResult.layers.map((l) => (
                <LayerBadge key={l} layer={l} />
              ))}
            </div>

            {/* Warnings */}
            {planResult.warnings && planResult.warnings.length > 0 && (
              <div className="rounded-lg border border-[var(--bp-caution)] bg-[var(--bp-caution-light)] p-3 space-y-1">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-[var(--bp-caution)]" />
                  <span className="text-xs font-semibold text-[var(--bp-caution)]">Warnings ({planResult.warnings.length})</span>
                </div>
                {planResult.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-[var(--bp-caution)] pl-6">{w}</p>
                ))}
              </div>
            )}

            {/* Layer-by-Layer Execution Steps */}
            {planResult.layer_plan && planResult.layer_plan.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-foreground" />
                  <span className="text-sm font-semibold text-foreground">Execution Steps</span>
                </div>
                <div className="space-y-2">
                  {planResult.layer_plan.map((step, i) => (
                    <div key={step.layer} className="rounded border border-border/50 bg-background p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--bp-copper-light)] text-[var(--bp-copper)] text-[10px] font-bold">{i + 1}</span>
                        <LayerBadge layer={step.layer} />
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className="text-xs text-foreground font-medium">{step.action}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground pl-7">{step.details}</p>
                      <div className="flex gap-4 pl-7 mt-1.5">
                        <span className="text-[10px] text-muted-foreground">
                          Entities: <span className="text-foreground font-mono tabular-nums">{fmtNum(step.entity_count)}</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          Method: <span className="text-foreground font-mono">{step.method}</span>
                        </span>
                        {step.batch_size && (
                          <span className="text-[10px] text-muted-foreground">
                            Batch Size: <span className="text-foreground font-mono tabular-nums">{fmtNum(step.batch_size)}</span>
                          </span>
                        )}
                        {step.notebook_id && (
                          <span className="text-[10px] text-muted-foreground">
                            Notebook: <span className="text-foreground font-mono">{GUID_NAMES[step.notebook_id] || step.notebook_id.slice(0, 8) + "..."}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Per-Source Breakdown */}
            {planResult.sources && planResult.sources.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-foreground" />
                  <span className="text-sm font-semibold text-foreground">Source Breakdown</span>
                </div>
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">Source</th>
                        <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">Server</th>
                        <th className="px-3 py-1.5 text-right text-[10px] font-medium text-muted-foreground uppercase">Entities</th>
                        <th className="px-3 py-1.5 text-right text-[10px] font-medium text-muted-foreground uppercase">Incremental</th>
                        <th className="px-3 py-1.5 text-right text-[10px] font-medium text-muted-foreground uppercase">Full Load</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {planResult.sources.map((src) => (
                        <tr key={src.name} className="hover:bg-muted/50">
                          <td className="px-3 py-1.5 font-semibold text-foreground uppercase">{src.namespace || src.name}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{src.server || "—"}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-foreground tabular-nums">{fmtNum(src.entity_count)}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-[var(--bp-copper)] tabular-nums">{fmtNum(src.incremental)}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-[var(--bp-caution)] tabular-nums">{fmtNum(src.full_load)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Engine Config */}
            {planResult.config_snapshot && (
              <details className="rounded-lg border border-border bg-card">
                <summary className="px-4 py-2.5 cursor-pointer flex items-center gap-2 text-sm font-semibold text-foreground hover:bg-muted/50">
                  <Settings className="h-4 w-4" />
                  Engine Configuration
                </summary>
                <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
                  {Object.entries(planResult.config_snapshot).map(([k, v]) => (
                    <div key={k} className="text-[11px] flex items-baseline gap-1.5">
                      <span className="text-muted-foreground whitespace-nowrap">{CONFIG_LABELS[k] || k}:</span>
                      <ConfigValue k={k} v={v} />
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* Full Entity List */}
            {planResult.entities && planResult.entities.length > 0 && (
              <details className="rounded-lg border border-border bg-card">
                <summary className="px-4 py-2.5 cursor-pointer flex items-center gap-2 text-sm font-semibold text-foreground hover:bg-muted/50">
                  <Database className="h-4 w-4" />
                  Entity Details ({fmtNum(planResult.entities.length)})
                </summary>
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr>
                        <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">ID</th>
                        <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">Entity</th>
                        <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">Source</th>
                        <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">Type</th>
                        <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">Watermark</th>
                        <th className="px-3 py-1.5 text-left text-[10px] font-medium text-muted-foreground uppercase">PKs</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {planResult.entities.map((e) => (
                        <tr key={e.id} className="hover:bg-muted/50">
                          <td className="px-3 py-1 font-mono text-muted-foreground tabular-nums">{e.id}</td>
                          <td className="px-3 py-1 font-mono text-foreground text-[11px]">{e.name}</td>
                          <td className="px-3 py-1 text-foreground font-semibold uppercase text-[11px]">{e.namespace || e.database}</td>
                          <td className="px-3 py-1">
                            <span className={cn(
                              "px-1.5 py-0.5 rounded border text-[10px] font-mono",
                              e.incremental
                                ? "text-[var(--bp-copper)] bg-[var(--bp-copper-light)] border-[var(--bp-copper)]"
                                : "text-muted-foreground bg-muted border-border",
                            )}>
                              {e.incremental ? "INCR" : "FULL"}
                            </span>
                          </td>
                          <td className="px-3 py-1 font-mono text-[10px] text-muted-foreground">{e.watermark_column || "—"}</td>
                          <td className="px-3 py-1 font-mono text-[10px] text-muted-foreground truncate max-w-[120px]" title={e.primary_keys || ""}>{e.primary_keys || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </CardContent>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* Live Run Panel                                      */}
      {/* ═══════════════════════════════════════════════════ */}
      {(isRunning || isStopping || liveRunId) && (
        <div className="space-y-4">
          {/* Progress + Summary */}
          <Card className={cn(
            "border-2",
            runSummary ? (runSummary.failed > 0 ? "border-[var(--bp-caution)]" : "border-[var(--bp-operational)]") :
            runError ? "border-[var(--bp-fault)]" :
            "border-[var(--bp-copper)]",
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {runSummary ? (
                  runSummary.failed > 0 ? (
                    <AlertTriangle className="h-4 w-4 text-[var(--bp-caution)]" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-[var(--bp-operational)]" />
                  )
                ) : runError ? (
                  <XCircle className="h-4 w-4 text-[var(--bp-fault)]" />
                ) : (
                  <Activity className="h-4 w-4 text-[var(--bp-copper)] animate-pulse" />
                )}
                {runSummary ? "Run Complete" : runError ? "Run Error" : "Live Run"}
                {liveRunId && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono ml-2">
                    {truncateId(liveRunId, 12)}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              {/* SSE disconnected warning */}
              {sseDisconnected && !runSummary && !runError && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-[var(--bp-caution-light)] border border-[var(--bp-caution)] text-[var(--bp-caution)]">
                  <WifiOff className="h-4 w-4 flex-shrink-0" />
                  Live log stream disconnected — status updates continue via polling.
                </div>
              )}
              {/* Run summary (when complete) */}
              {runSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3 rounded-lg bg-[var(--bp-operational-light)] border border-[var(--bp-operational)] text-center">
                    <p className="text-2xl font-bold text-[var(--bp-operational)] tabular-nums">{fmtNum(runSummary.succeeded)}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Succeeded</p>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--bp-fault-light)] border border-[var(--bp-fault)] text-center">
                    <p className="text-2xl font-bold text-[var(--bp-fault)] tabular-nums">{fmtNum(runSummary.failed)}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Failed</p>
                  </div>
                  <div className="p-3 rounded-lg bg-muted border border-border text-center">
                    <p className="text-2xl font-bold text-muted-foreground tabular-nums">{fmtNum(runSummary.skipped)}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Skipped</p>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--bp-copper-light)] border border-[var(--bp-copper)] text-center">
                    <p className="text-2xl font-bold text-[var(--bp-copper)] tabular-nums">{fmtNum(runSummary.total_rows)}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Rows</p>
                  </div>
                </div>
              )}

              {/* Run error */}
              {runError && (
                <div className="flex items-start gap-2 p-3 rounded-lg" style={{ background: "var(--bp-fault-light)", border: "1px solid var(--bp-fault)" }}>
                  <AlertCircle className="w-4 h-4 text-[var(--bp-fault)] shrink-0 mt-0.5" />
                  <p className="text-sm text-[var(--bp-fault)] break-all">{runError}</p>
                </div>
              )}

              {/* In-progress stats */}
              {!runSummary && !runError && (
                <div className="space-y-3">
                  {/* Fabric notebook job tracker (pipeline/notebook mode) */}
                  {fabricJobs.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Server className="h-3.5 w-3.5 text-[var(--bp-copper)]" />
                        <span>Fabric Notebook Jobs</span>
                        <span className="ml-auto tabular-nums">{fmtDuration(fabricRunElapsed)} elapsed</span>
                      </div>
                      {fabricJobs.map((job) => (
                        <div key={job.job_id} className={cn(
                          "flex items-center gap-3 p-2.5 rounded-lg border",
                          job.status === "Completed" ? "border-[var(--bp-operational)] bg-[var(--bp-operational-light)]" :
                          job.status === "Failed" || job.status === "Cancelled" ? "border-[var(--bp-fault)] bg-[var(--bp-fault-light)]" :
                          "border-[var(--bp-border)] bg-[var(--bp-copper-light)]",
                        )}>
                          {job.status === "Completed" ? (
                            <CheckCircle2 className="h-4 w-4 text-[var(--bp-operational)] shrink-0" />
                          ) : job.status === "Failed" || job.status === "Cancelled" ? (
                            <XCircle className="h-4 w-4 text-[var(--bp-fault)] shrink-0" />
                          ) : (
                            <Loader2 className="h-4 w-4 text-[var(--bp-copper)] animate-spin shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium capitalize">{job.layer} Notebook</p>
                            <p className="text-[10px] text-muted-foreground font-mono">{job.job_id.slice(0, 12)}...</p>
                          </div>
                          <Badge variant="outline" className={cn(
                            "text-[10px] shrink-0",
                            job.status === "Completed" ? "border-[var(--bp-operational)] text-[var(--bp-operational)]" :
                            job.status === "Failed" ? "border-[var(--bp-fault)] text-[var(--bp-fault)]" :
                            "border-[var(--bp-copper)] text-[var(--bp-copper)]",
                          )}>
                            {job.status === "InProgress" ? `Running ${fmtDuration(job.elapsed_seconds)}` : job.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Entity-level counters (local mode or when entities stream in) */}
                  {(entityResults.length > 0 || fabricJobs.length === 0) && (
                  <div className="grid grid-cols-5 gap-3">
                    <div className="p-2 rounded bg-muted border text-center">
                      <p className="text-lg font-bold text-foreground tabular-nums">{fmtNum(completedEntities)}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Processed</p>
                    </div>
                    <div className="p-2 rounded bg-[var(--bp-operational-light)] border border-[var(--bp-operational)] text-center">
                      <p className="text-lg font-bold text-[var(--bp-operational)] tabular-nums">{fmtNum(succeededEntities)}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">OK</p>
                    </div>
                    <div className="p-2 rounded bg-[var(--bp-fault-light)] border border-[var(--bp-fault)] text-center">
                      <p className="text-lg font-bold text-[var(--bp-fault)] tabular-nums">{fmtNum(failedEntities)}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Failed</p>
                    </div>
                    <div className="p-2 rounded bg-[var(--bp-caution-light)] border border-[var(--bp-caution)] text-center">
                      <p className="text-lg font-bold text-[var(--bp-caution)] tabular-nums">{fmtDuration(totalDuration)}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Duration</p>
                    </div>
                    <div className="p-2 rounded bg-[var(--bp-copper-light)] border border-[var(--bp-copper)] text-center">
                      <p className="text-lg font-bold text-[var(--bp-copper)] tabular-nums">{fmtNum(totalRows)}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Rows</p>
                    </div>
                  </div>
                  )}
                </div>
              )}

              {/* Clear live run button when done */}
              {(runSummary || runError) && !isRunning && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setLiveRunId(null);
                      setLogBuffer([]);
                      setEntityResults([]);
                      setRunSummary(null);
                      setRunError(null);
                      setPlanResult(null);
                      setFabricJobs([]);
                      setFabricRunElapsed(0);
                    }}
                    className="gap-1.5 text-xs"
                  >
                    Dismiss
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Entity results stream */}
          {entityResults.length > 0 && (
            <Section
              title="Entity Results"
              icon={<Layers className="h-4 w-4 text-[var(--bp-operational)]" />}
              badge={
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 font-mono text-muted-foreground ml-1">
                  {entityResults.length}
                </span>
              }
            >
              <div className="max-h-[400px] overflow-y-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Entity</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Layer</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Rows</th>
                      <th className="px-3 py-2 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Duration</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {entityResults.map((er, i) => (
                      <tr key={i} className="hover:bg-muted/50 transition-colors">
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-foreground">
                              {er.entity_name || `Entity ${er.entity_id}`}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5">
                          <LayerBadge layer={er.layer} />
                        </td>
                        <td className="px-3 py-1.5">
                          <EntityStatusBadge status={er.status} />
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-foreground tabular-nums">
                          {er.rows_read > 0 ? er.rows_read.toLocaleString() : "--"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-muted-foreground tabular-nums">
                          {fmtDuration(er.duration_seconds)}
                        </td>
                        <td className="px-3 py-1.5 max-w-[250px]">
                          {er.status === "failed" && er.error ? (
                            <span className="text-[var(--bp-fault)] text-[11px]" title={er.error}>
                              {friendlyError(er.error)}
                            </span>
                          ) : er.status === "succeeded" ? (
                            <span className="text-[var(--bp-operational)] text-[11px]">OK</span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Live log stream — dual view */}
          <Section
            title="Log Stream"
            icon={<Terminal className="h-4 w-4 text-[var(--bp-operational)]" />}
            badge={
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 font-mono text-muted-foreground ml-1">
                {logBuffer.length} lines
              </span>
            }
          >
            <div className="space-y-2">
              <div className="flex items-center justify-end">
                <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="rounded"
                  />
                  Auto-scroll
                </label>
              </div>
              <div
                ref={logContainerRef}
                {/* border-[#30363d]: no exact bp token */}
                className="h-[480px] overflow-y-auto rounded-lg border border-[#30363d] bg-[var(--bp-code-block)] p-4 scrollbar-thin [&_span]:!text-opacity-100"
              >
                {logBuffer.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-muted-foreground/50 text-sm">
                    {isRunning ? "Waiting for log output..." : "No log entries"}
                  </div>
                ) : (
                  logBuffer.map((entry, i) => <LogLine key={i} entry={entry} />)
                )}
              </div>
            </div>
          </Section>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* 24h Metrics (mini charts)                           */}
      {/* ═══════════════════════════════════════════════════ */}
      {metrics && (metrics.runs?.length > 0 || metrics.top_errors?.length > 0) && (
        <Section
          title="24h Metrics"
          icon={<TrendingUp className="h-4 w-4 text-[var(--bp-copper)]" />}
          defaultOpen={false}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Layer breakdown chart */}
            {metrics.layers && Object.keys(metrics.layers).length > 0 && (
              <div className="rounded-lg border bg-muted/5 p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Runs by Layer
                </p>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={Object.entries(metrics.layers).map(([layer, data]) => ({
                        layer: layer.charAt(0).toUpperCase() + layer.slice(1),
                        count: data.count,
                        avgDuration: Math.round(data.avg_duration),
                      }))}
                    >
                      <XAxis
                        dataKey="layer"
                        tick={{ fontSize: 11, fill: cssVar("--bp-ink-muted") }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: cssVar("--bp-ink-muted") }}
                        axisLine={false}
                        tickLine={false}
                        width={30}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--bp-surface-1)",
                          border: "1px solid var(--bp-border)",
                          borderRadius: "8px",
                          fontSize: "12px",
                        }}
                        labelStyle={{ color: "var(--bp-ink-primary)", fontWeight: 600 }}
                        itemStyle={{ color: "var(--bp-ink-secondary)" }}
                        formatter={((value: number | undefined, name: string | undefined) => [
                          name === "count" ? `${value ?? 0} runs` : `${value ?? 0}s avg`,
                          name === "count" ? "Runs" : "Avg Duration",
                        ]) as any}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {Object.keys(metrics.layers).map((layer, i) => {
                          const colors: Record<string, string> = {
                            landing: cssVar("--bp-ink-muted"),
                            bronze: cssVar("--bp-caution"),
                            silver: cssVar("--bp-copper"),
                          };
                          return <Cell key={i} fill={colors[layer] || cssVar("--bp-ink-muted")} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Slowest entities */}
            {metrics.slowest_entities && metrics.slowest_entities.length > 0 && (
              <div className="rounded-lg border bg-muted/5 p-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Slowest Entities (avg)
                </p>
                <div className="space-y-2">
                  {metrics.slowest_entities.slice(0, 8).map((ent, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground w-6 text-right">{i + 1}.</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-foreground truncate">
                            {ent.SourceName || `Entity ${ent.EntityId}`}
                          </span>
                          {ent.DataSourceName && (
                            <span className="text-[10px] text-muted-foreground">({resolveSourceLabel(ent.DataSourceName)})</span>
                          )}
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-1">
                          <div
                            className="h-full rounded-full"
                            style={{
                              background: "var(--bp-caution)",
                              width: `${Math.min(
                                (ent.DurationSeconds / (metrics.slowest_entities[0]?.DurationSeconds || 1)) * 100,
                                100,
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                      <span className="text-xs font-mono text-[var(--bp-caution)] shrink-0">
                        {fmtDuration(ent.DurationSeconds)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top errors */}
            {metrics.top_errors && metrics.top_errors.length > 0 && (
              <div className="rounded-lg border bg-muted/5 p-4 md:col-span-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  Top Errors
                </p>
                <div className="space-y-2">
                  {metrics.top_errors.slice(0, 5).map((err, i) => (
                    <div key={i} className="flex items-start gap-3 py-1.5">
                      <span className="text-xs font-bold text-[var(--bp-fault)] shrink-0 tabular-nums w-8 text-right">
                        x{err.Occurrences}
                      </span>
                      <div className="text-xs text-foreground/80 break-all">
                        {err.ErrorType && (
                          <span className="font-semibold text-[var(--bp-fault)]">{err.ErrorType}: </span>
                        )}
                        {err.ErrorMessage}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* ═══════════════════════════════════════════════════ */}
      {/* Run History                                         */}
      {/* ═══════════════════════════════════════════════════ */}
      <Section
        title="Run History"
        icon={<Clock className="h-4 w-4 text-muted-foreground" />}
        badge={
          runs.length > 0 ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted/60 font-mono text-muted-foreground ml-1">
              {runs.length}
            </span>
          ) : undefined
        }
        defaultOpen={true}
      >
        {runsLoading && runs.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="ml-2 text-sm text-muted-foreground">Loading run history...</span>
          </div>
        ) : runs.length === 0 ? (
          <div className="text-center py-8">
            <Clock className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No runs recorded yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Start a run using the button above</p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40">
                    <th className="px-3 py-2.5 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Run ID</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Mode</th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Started</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Duration</th>
                    <th className="px-3 py-2.5 text-center text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                      <span className="text-[var(--bp-operational)]">OK</span> / <span className="text-[var(--bp-fault)]">Fail</span> / <span className="text-muted-foreground">Skip</span>
                    </th>
                    <th className="px-3 py-2.5 text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Triggered By</th>
                    <th className="px-3 py-2.5 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {runs.map((run) => {
                    const isExpanded = expandedRunId === run.run_id;
                    const runStatus = (run.status || "unknown").toLowerCase();
                    const hasFailures = run.entities_failed > 0;
                    return (
                      <tr key={run.run_id} className="group">
                        <td colSpan={8} className="p-0">
                          <div>
                            {/* Main row */}
                            <div
                              className={cn(
                                "flex items-center px-3 py-2 cursor-pointer transition-colors hover:bg-muted/50",
                                isExpanded && "bg-muted",
                              )}
                              onClick={() => handleExpandRun(run.run_id)}
                            >
                              <div className="w-[120px] shrink-0">
                                <span className="font-mono text-foreground/70">{truncateId(run.run_id, 10)}</span>
                              </div>
                              <div className="w-[100px] shrink-0">
                                <span className={cn(
                                  "inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border font-mono",
                                  runStatus === "completed" || runStatus === "succeeded" ? "bg-[var(--bp-operational-light)] text-[var(--bp-operational)] border-[var(--bp-operational)]" :
                                  runStatus === "failed" ? "bg-[var(--bp-fault-light)] text-[var(--bp-fault)] border-[var(--bp-fault)]" :
                                  runStatus === "running" || runStatus === "inprogress" ? "bg-[var(--bp-copper-light)] text-[var(--bp-copper)] border-[var(--bp-copper)]" :
                                  runStatus === "aborted" ? "bg-[var(--bp-caution-light)] text-[var(--bp-caution)] border-[var(--bp-caution)]" :
                                  "bg-muted text-muted-foreground border-border",
                                )}>
                                  {(runStatus === "running" || runStatus === "inprogress") && <Loader2 className="h-3 w-3 animate-spin" />}
                                  {(runStatus === "completed" || runStatus === "succeeded") && <CheckCircle2 className="h-3 w-3" />}
                                  {runStatus === "failed" && <XCircle className="h-3 w-3" />}
                                  {runStatus === "aborted" && <AlertTriangle className="h-3 w-3" />}
                                  {run.status}
                                </span>
                              </div>
                              <div className="w-[60px] shrink-0">
                                <span className="text-muted-foreground font-mono">{run.mode || "--"}</span>
                              </div>
                              <div className="w-[140px] shrink-0 text-muted-foreground font-mono">
                                {fmtTimestamp(run.started_at)}
                              </div>
                              <div className="w-[80px] shrink-0 text-right font-mono text-foreground">
                                {fmtDuration(run.duration_seconds)}
                              </div>
                              <div className="w-[100px] shrink-0 text-center font-mono tabular-nums">
                                <span className="text-[var(--bp-operational)]">{fmtNum(run.entities_succeeded)}</span>
                                {" / "}
                                <span className="text-[var(--bp-fault)]">{fmtNum(run.entities_failed)}</span>
                                {" / "}
                                <span className="text-muted-foreground">{fmtNum(run.entities_skipped)}</span>
                              </div>
                              <div className="w-[90px] shrink-0 text-muted-foreground">
                                {run.triggered_by || "--"}
                              </div>
                              <div className="flex-1 flex justify-end gap-1">
                                {(runStatus === "running" || runStatus === "inprogress") && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[10px] gap-1 text-[var(--bp-fault)] hover:text-[var(--bp-fault)] hover:bg-[var(--bp-fault-light)]"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleAbortRun(run.run_id);
                                    }}
                                    disabled={aborting === run.run_id}
                                  >
                                    {aborting === run.run_id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <XCircle className="h-3 w-3" />
                                    )}
                                    Abort
                                  </Button>
                                )}
                                {hasFailures && runStatus !== "running" && runStatus !== "inprogress" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[10px] gap-1 text-[var(--bp-caution)] hover:text-[var(--bp-caution)]"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRetry(run.run_id);
                                    }}
                                    disabled={retrying === run.run_id || isRunning}
                                  >
                                    {retrying === run.run_id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <RotateCcw className="h-3 w-3" />
                                    )}
                                    Retry
                                  </Button>
                                )}
                                {runStatus !== "running" && runStatus !== "inprogress" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[10px] gap-1 text-primary hover:text-primary/80"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setReportRun(run);
                                    }}
                                    title="Run Report"
                                  >
                                    <FileBarChart className="h-3 w-3" />
                                    Report
                                  </Button>
                                )}
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                              </div>
                            </div>

                            {/* Expanded logs */}
                            {isExpanded && (
                              <div className="border-t border-border bg-muted/5 px-3 py-3">
                                {expandedRunLogsLoading ? (
                                  <div className="flex items-center justify-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                    <span className="ml-2 text-xs text-muted-foreground">Loading logs...</span>
                                  </div>
                                ) : expandedRunLogs.length === 0 ? (
                                  <p className="text-xs text-muted-foreground text-center py-4">No log entries for this run</p>
                                ) : (
                                  {/* border-[#30363d]: no exact bp token */}
                                  <div className="max-h-[480px] overflow-y-auto rounded border border-[#30363d] bg-[var(--bp-code-block)] p-4">
                                    {expandedRunLogs.map((entry, i) => (
                                      <LogLine key={i} entry={entry} />
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Actions bar */}
            <div className="flex justify-center gap-3 py-2 border-t border-border bg-muted">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-muted-foreground"
                onClick={fetchRuns}
                disabled={runsLoading}
              >
                <RefreshCw className={cn("h-3 w-3", runsLoading && "animate-spin")} />
                Refresh
              </Button>
              {runs.some(r => {
                const s = (r.status || "").toLowerCase();
                return s === "inprogress" || s === "running";
              }) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs text-[var(--bp-fault)] hover:text-[var(--bp-fault)] hover:bg-[var(--bp-fault-light)]"
                  onClick={handleAbortAll}
                  disabled={aborting === "__all__"}
                >
                  {aborting === "__all__" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <XCircle className="h-3 w-3" />
                  )}
                  Abort All Stuck
                </Button>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* ── Footer ── */}
      <div className="text-center text-[10px] text-muted-foreground pb-2">
        FMD v3 Engine Control
        {status?.engine_version && ` v${status.engine_version}`}
        {" | "}
        <span className={statusCfg.color}>{statusCfg.label}</span>
        {status && status.uptime_seconds > 0 && ` | Uptime ${fmtUptime(status.uptime_seconds)}`}
      </div>

      {/* Run Summary Modal */}
      {reportRun && (
        <RunSummaryModal run={reportRun} onClose={() => setReportRun(null)} />
      )}
    </div>
  );
}
