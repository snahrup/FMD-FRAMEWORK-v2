// ============================================================================
// EntityTable — Sortable, paginated entity data table with drill-down
//
// Displays the entity matrix: one row per entity with layer status badges,
// last load times, and expandable detail rows showing engine task logs.
// Supports column sorting, pagination, watermark reset, and CSV export.
// ============================================================================

import { useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Database,
  RotateCcw,
  Loader2,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DigestEntity } from "@/hooks/useEntityDigest";
import type { EngineLog } from "@/hooks/useEngineStatus";

// ── Types ──

export type SortKey =
  | "id"
  | "tableName"
  | "source"
  | "targetSchema"
  | "lzStatus"
  | "bronzeStatus"
  | "silverStatus"
  | "lzLastLoad";

export type SortDir = "asc" | "desc";

export interface EntityTableProps {
  /** Filtered entity list (filtering done externally) */
  entities: DigestEntity[];
  /** Total entity count (before filtering) for display */
  totalCount: number;
  /** Callback to fetch logs when a row is expanded */
  onFetchLogs: (entityId: number) => Promise<EngineLog[]>;
  /** Callback to reset entity watermark */
  onResetWatermark: (entityId: number) => Promise<void>;
  /** Page size (default 50) */
  pageSize?: number;
  /** Additional className on the wrapper */
  className?: string;
}

// ── Helpers ──

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function timeAgo(isoDate: string | null | undefined): string {
  if (!isoDate) return "\u2014";
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  if (isNaN(then)) return "\u2014";
  const diff = now - then;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "\u2014";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function humanDuration(seconds: number | null | undefined): string {
  if (seconds == null || isNaN(seconds)) return "\u2014";
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

// The entity_status.Status column may contain values beyond the canonical
// "loaded"/"pending"/"not_started" — e.g., "Succeeded", "complete", "Failed",
// "error", "InProgress". We bucket them for display.
const SUCCESS_STATUSES = new Set(["loaded", "complete", "succeeded"]);
const PENDING_STATUSES = new Set(["pending", "inprogress", "running"]);
const NEVER_RUN_STATUSES = new Set(["not_started", ""]);

type LayerStatus = string; // Broadened from union — raw DB values may vary

function layerStatusLabel(s: LayerStatus): string {
  const lower = s.toLowerCase();
  if (SUCCESS_STATUSES.has(lower)) return "Succeeded";
  if (PENDING_STATUSES.has(lower)) return "Pending";
  if (NEVER_RUN_STATUSES.has(lower)) return "Never Run";
  // "failed", "error", or unknown
  if (lower === "failed" || lower === "error") return "Failed";
  return s || "Never Run";
}

function layerStatusCls(s: LayerStatus): string {
  const lower = s.toLowerCase();
  if (SUCCESS_STATUSES.has(lower)) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (PENDING_STATUSES.has(lower)) return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  if (lower === "failed" || lower === "error") return "bg-red-500/10 text-red-400 border-red-500/20";
  return "bg-zinc-500/10 text-zinc-500 border-zinc-500/20";
}

function layerStatusIcon(s: LayerStatus) {
  const lower = s.toLowerCase();
  if (SUCCESS_STATUSES.has(lower)) return <CheckCircle2 className="w-3 h-3" />;
  if (PENDING_STATUSES.has(lower)) return <Clock className="w-3 h-3" />;
  if (lower === "failed" || lower === "error") return <XCircle className="w-3 h-3 text-red-400" />;
  return <XCircle className="w-3 h-3 opacity-40" />;
}

function overallStatusCls(overall: string): string {
  if (overall === "complete") return "text-emerald-400";
  if (overall === "error") return "text-red-400";
  if (overall === "partial") return "text-amber-400";
  if (overall === "pending") return "text-blue-400";
  return "text-zinc-500";
}

// ── Component ──

export function EntityTable({
  entities,
  totalCount,
  onFetchLogs,
  onResetWatermark,
  pageSize = 50,
  className,
}: EntityTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("tableName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(0);
  const [expandedEntity, setExpandedEntity] = useState<number | null>(null);
  const [entityLogs, setEntityLogs] = useState<EngineLog[]>([]);
  const [entityLogsLoading, setEntityLogsLoading] = useState(false);
  const [resetConfirm, setResetConfirm] = useState<number | null>(null);

  // ── Sorting ──
  const sortedEntities = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...entities].sort((a, b) => {
      switch (sortKey) {
        case "id":
          return dir * (a.id - b.id);
        case "tableName":
          return dir * a.tableName.localeCompare(b.tableName);
        case "source":
          return dir * (a.dataSourceName || a.source).localeCompare(b.dataSourceName || b.source);
        case "targetSchema":
          return dir * (a.targetSchema || "").localeCompare(b.targetSchema || "");
        case "lzStatus":
          return dir * a.lzStatus.localeCompare(b.lzStatus);
        case "bronzeStatus":
          return dir * a.bronzeStatus.localeCompare(b.bronzeStatus);
        case "silverStatus":
          return dir * a.silverStatus.localeCompare(b.silverStatus);
        case "lzLastLoad": {
          const at = a.lzLastLoad ? new Date(a.lzLastLoad).getTime() : 0;
          const bt = b.lzLastLoad ? new Date(b.lzLastLoad).getTime() : 0;
          return dir * (at - bt);
        }
        default:
          return 0;
      }
    });
  }, [entities, sortKey, sortDir]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedEntities.length / pageSize));
  const pagedEntities = sortedEntities.slice(page * pageSize, (page + 1) * pageSize);

  // Reset page when entities change (filters changed externally)
  const prevLenRef = useMemo(() => entities.length, [entities]);
  if (page > 0 && page >= Math.ceil(prevLenRef / pageSize)) {
    // Reset synchronously if out of bounds — safe because it's in render
    setPage(0);
  }

  // Sort toggle
  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey]
  );

  // Expand/collapse row
  const toggleExpand = useCallback(
    async (entityId: number) => {
      if (expandedEntity === entityId) {
        setExpandedEntity(null);
        setEntityLogs([]);
      } else {
        setExpandedEntity(entityId);
        setEntityLogsLoading(true);
        try {
          const logs = await onFetchLogs(entityId);
          setEntityLogs(logs);
        } catch {
          setEntityLogs([]);
        } finally {
          setEntityLogsLoading(false);
        }
      }
    },
    [expandedEntity, onFetchLogs]
  );

  // Watermark reset
  const handleReset = useCallback(
    async (entityId: number) => {
      try {
        await onResetWatermark(entityId);
        setResetConfirm(null);
      } catch (e: unknown) {
        alert(`Reset failed: ${e instanceof Error ? e.message : "Unknown error"}`);
      }
    },
    [onResetWatermark]
  );

  // CSV export
  const exportCsv = useCallback(() => {
    if (!sortedEntities.length) return;
    const header =
      "Entity ID,Table Name,Schema,Data Source,Target Schema,LZ Status,LZ Last Load,Bronze Status,Bronze Last Load,Silver Status,Silver Last Load,Overall";
    const csvRows = sortedEntities.map(
      (e) =>
        `${e.id},"${e.tableName}","${e.sourceSchema}","${e.dataSourceName || e.source}","${e.targetSchema}","${layerStatusLabel(e.lzStatus)}","${e.lzLastLoad || ""}","${layerStatusLabel(e.bronzeStatus)}","${e.bronzeLastLoad || ""}","${layerStatusLabel(e.silverStatus)}","${e.silverLastLoad || ""}","${e.overall}"`
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `execution-matrix-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedEntities]);

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  return (
    <div className={className} data-testid="entity-table">
      {/* Table header bar */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-muted-foreground">
          Showing {fmt(pagedEntities.length)} of {fmt(sortedEntities.length)} entities
          {sortedEntities.length !== totalCount && ` (${fmt(totalCount)} total)`}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportCsv}
            disabled={!sortedEntities.length}
            data-testid="export-csv"
          >
            <Download className="w-3.5 h-3.5" />
          </Button>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <span className="text-xs text-muted-foreground px-2" data-testid="page-indicator">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages - 1}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("id")}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                  >
                    ID <SortIcon col="id" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("tableName")}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                  >
                    Source Name <SortIcon col="tableName" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("source")}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                  >
                    Data Source <SortIcon col="source" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("targetSchema")}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                  >
                    Target Schema <SortIcon col="targetSchema" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleSort("lzStatus")}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                  >
                    Landing Zone <SortIcon col="lzStatus" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleSort("bronzeStatus")}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                  >
                    Bronze <SortIcon col="bronzeStatus" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleSort("silverStatus")}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                  >
                    Silver <SortIcon col="silverStatus" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => toggleSort("lzLastLoad")}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                  >
                    Last Load <SortIcon col="lzLastLoad" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Actions
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedEntities.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center" data-testid="empty-state">
                    <Database className="w-10 h-10 text-muted-foreground/15 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No entities match your filters</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      Try adjusting your search or filter criteria
                    </p>
                  </td>
                </tr>
              )}
              {pagedEntities.map((entity) => (
                <EntityRow
                  key={entity.id}
                  entity={entity}
                  isExpanded={expandedEntity === entity.id}
                  onToggleExpand={() => toggleExpand(entity.id)}
                  logs={expandedEntity === entity.id ? entityLogs : []}
                  logsLoading={expandedEntity === entity.id && entityLogsLoading}
                  resetConfirm={resetConfirm}
                  setResetConfirm={setResetConfirm}
                  onReset={handleReset}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-3">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <span className="text-xs text-muted-foreground px-3">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

// ── EntityRow sub-component ──

interface EntityRowProps {
  entity: DigestEntity;
  isExpanded: boolean;
  onToggleExpand: () => void;
  logs: EngineLog[];
  logsLoading: boolean;
  resetConfirm: number | null;
  setResetConfirm: (id: number | null) => void;
  onReset: (id: number) => void;
}

function EntityRow({
  entity,
  isExpanded,
  onToggleExpand,
  logs,
  logsLoading,
  resetConfirm,
  setResetConfirm,
  onReset,
}: EntityRowProps) {
  const e = entity;

  // Most recent load time across all layers
  const lastLoadTime = useMemo(() => {
    const times = [e.lzLastLoad, e.bronzeLastLoad, e.silverLastLoad].filter(Boolean);
    if (!times.length) return null;
    return times.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  }, [e.lzLastLoad, e.bronzeLastLoad, e.silverLastLoad]);

  return (
    <>
      <tr
        className={cn(
          "border-b border-border/50 cursor-pointer transition-colors",
          isExpanded ? "bg-muted/30" : "hover:bg-muted/20"
        )}
        onClick={onToggleExpand}
        data-testid={`entity-row-${e.id}`}
      >
        {/* Expand chevron */}
        <td className="px-3 py-2">
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </td>

        {/* Entity ID */}
        <td className="px-3 py-2">
          <span className="text-xs font-mono text-muted-foreground">{e.id}</span>
        </td>

        {/* Source Name (schema.table) */}
        <td className="px-3 py-2">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-foreground">{e.tableName}</span>
            <span className="text-[10px] text-muted-foreground">{e.sourceSchema}</span>
          </div>
        </td>

        {/* Data Source */}
        <td className="px-3 py-2">
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded border",
              overallStatusCls(e.overall),
              "border-current/20 bg-current/5"
            )}
          >
            {e.dataSourceName || e.source}
          </span>
        </td>

        {/* Target Schema */}
        <td className="px-3 py-2">
          <span className="text-[10px] font-mono text-muted-foreground">{e.targetSchema}</span>
        </td>

        {/* Landing Zone */}
        <td className="px-3 py-2 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium",
                layerStatusCls(e.lzStatus)
              )}
            >
              {layerStatusIcon(e.lzStatus)} {layerStatusLabel(e.lzStatus)}
            </span>
            {e.lzLastLoad && <span className="text-[9px] text-muted-foreground">{timeAgo(e.lzLastLoad)}</span>}
          </div>
        </td>

        {/* Bronze */}
        <td className="px-3 py-2 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium",
                layerStatusCls(e.bronzeStatus)
              )}
            >
              {layerStatusIcon(e.bronzeStatus)} {layerStatusLabel(e.bronzeStatus)}
            </span>
            {e.bronzeLastLoad && (
              <span className="text-[9px] text-muted-foreground">{timeAgo(e.bronzeLastLoad)}</span>
            )}
          </div>
        </td>

        {/* Silver */}
        <td className="px-3 py-2 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium",
                layerStatusCls(e.silverStatus)
              )}
            >
              {layerStatusIcon(e.silverStatus)} {layerStatusLabel(e.silverStatus)}
            </span>
            {e.silverLastLoad && (
              <span className="text-[9px] text-muted-foreground">{timeAgo(e.silverLastLoad)}</span>
            )}
          </div>
        </td>

        {/* Last Load */}
        <td className="px-3 py-2 text-right">
          <span className="text-[10px] text-muted-foreground">{formatTimestamp(lastLoadTime)}</span>
        </td>

        {/* Actions */}
        <td className="px-3 py-2 text-center" onClick={(ev) => ev.stopPropagation()}>
          {resetConfirm === e.id ? (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="destructive"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => onReset(e.id)}
              >
                Confirm
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-[10px] px-2"
                onClick={() => setResetConfirm(null)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] px-2 text-muted-foreground hover:text-foreground"
              onClick={() => setResetConfirm(e.id)}
              title="Reset watermark"
            >
              <RotateCcw className="w-3 h-3" />
            </Button>
          )}
        </td>
      </tr>

      {/* Expanded row: entity logs */}
      {isExpanded && (
        <tr className="bg-muted/20" data-testid={`entity-detail-${e.id}`}>
          <td colSpan={10} className="px-6 py-3">
            <div className="space-y-2">
              {/* Entity metadata summary */}
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground mb-2 flex-wrap">
                <span>
                  Watermark:{" "}
                  <strong className="text-foreground font-mono">{e.watermarkColumn || "none"}</strong>
                </span>
                <span>
                  Incremental: <strong className="text-foreground">{e.isIncremental ? "Yes" : "No"}</strong>
                </span>
                <span>
                  Bronze ID: <strong className="text-foreground font-mono">{e.bronzeId ?? "\u2014"}</strong>
                </span>
                <span>
                  Silver ID: <strong className="text-foreground font-mono">{e.silverId ?? "\u2014"}</strong>
                </span>
                {e.bronzePKs && (
                  <span>
                    PKs: <strong className="text-foreground font-mono">{e.bronzePKs}</strong>
                  </span>
                )}
              </div>

              {/* Last error */}
              {e.lastError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-red-500/20 bg-red-500/5">
                  <XCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-[10px] text-red-400 font-medium">{e.lastError.layer} layer error</span>
                    <span className="text-[10px] text-muted-foreground ml-2">{timeAgo(e.lastError.time)}</span>
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{e.lastError.message}</p>
                  </div>
                </div>
              )}

              {/* Diagnosis */}
              {e.diagnosis && (
                <div className="text-[10px] text-muted-foreground italic px-1">{e.diagnosis}</div>
              )}

              {/* Recent task logs from engine */}
              {logsLoading && (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading task logs...</span>
                </div>
              )}

              {!logsLoading && logs.length === 0 && (
                <p className="text-[10px] text-muted-foreground/60 py-2 text-center">
                  No engine task logs available for this entity
                </p>
              )}

              {!logsLoading && logs.length > 0 && (
                <div className="rounded-md border border-border overflow-hidden">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr className="bg-muted/40 border-b border-border">
                        <th className="px-2 py-1.5 text-left text-muted-foreground font-semibold uppercase tracking-wider">
                          Run
                        </th>
                        <th className="px-2 py-1.5 text-left text-muted-foreground font-semibold uppercase tracking-wider">
                          Layer
                        </th>
                        <th className="px-2 py-1.5 text-left text-muted-foreground font-semibold uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-2 py-1.5 text-right text-muted-foreground font-semibold uppercase tracking-wider">
                          Rows
                        </th>
                        <th className="px-2 py-1.5 text-right text-muted-foreground font-semibold uppercase tracking-wider">
                          Duration
                        </th>
                        <th className="px-2 py-1.5 text-right text-muted-foreground font-semibold uppercase tracking-wider">
                          Time
                        </th>
                        <th className="px-2 py-1.5 text-left text-muted-foreground font-semibold uppercase tracking-wider">
                          Error
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.log_id} className="border-b border-border/30">
                          <td className="px-2 py-1.5 font-mono text-muted-foreground">#{log.run_id}</td>
                          <td className="px-2 py-1.5 uppercase text-muted-foreground">{log.layer}</td>
                          <td className="px-2 py-1.5">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-medium",
                                log.status === "succeeded"
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                  : log.status === "failed"
                                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                                    : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                              )}
                            >
                              {log.status}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-foreground">
                            {log.rows_read > 0 ? fmt(log.rows_read) : "\u2014"}
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                            {humanDuration(log.duration_seconds)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-muted-foreground">
                            {formatTimestamp(log.ended_at || log.started_at)}
                          </td>
                          <td className="px-2 py-1.5 text-red-400/80 font-mono truncate max-w-[200px]">
                            {log.error_message || "\u2014"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default EntityTable;
