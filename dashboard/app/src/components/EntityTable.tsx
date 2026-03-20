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
  if (SUCCESS_STATUSES.has(lower)) return "bg-[#E7F3EB] text-[#3D7C4F] border-[#3D7C4F]/20";
  if (PENDING_STATUSES.has(lower)) return "bg-[#FDF3E3] text-[#C27A1A] border-[#C27A1A]/20";
  if (lower === "failed" || lower === "error") return "bg-[#FBEAE8] text-[#B93A2A] border-[#B93A2A]/20";
  return "bg-[#EDEAE4] text-[#A8A29E] border-[#A8A29E]/20";
}

function layerStatusIcon(s: LayerStatus) {
  const lower = s.toLowerCase();
  if (SUCCESS_STATUSES.has(lower)) return <CheckCircle2 className="w-3 h-3" />;
  if (PENDING_STATUSES.has(lower)) return <Clock className="w-3 h-3" />;
  if (lower === "failed" || lower === "error") return <XCircle className="w-3 h-3 text-[#B93A2A]" />;
  return <XCircle className="w-3 h-3 opacity-40" />;
}

function overallStatusCls(overall: string): string {
  if (overall === "complete") return "text-[#3D7C4F]";
  if (overall === "error") return "text-[#B93A2A]";
  if (overall === "partial") return "text-[#C27A1A]";
  if (overall === "pending") return "text-[#B45624]";
  return "text-[#A8A29E]";
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
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 text-[#B45624]" /> : <ArrowDown className="w-3 h-3 text-[#B45624]" />;
  };

  return (
    <div className={className} data-testid="entity-table">
      {/* Table header bar */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[#A8A29E]">
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
              <span className="text-xs text-[#A8A29E] px-2" data-testid="page-indicator">
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
      <div className="rounded-lg border border-[rgba(0,0,0,0.08)] overflow-hidden" style={{ background: "#FEFDFB" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#F9F7F3", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("id")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#1C1917]" style={{ fontSize: "11px", fontWeight: 600, color: "#78716C", letterSpacing: "0.5px" }}
                  >
                    ID <SortIcon col="id" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("tableName")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#1C1917]" style={{ fontSize: "11px", fontWeight: 600, color: "#78716C", letterSpacing: "0.5px" }}
                  >
                    Source Name <SortIcon col="tableName" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("source")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#1C1917]" style={{ fontSize: "11px", fontWeight: 600, color: "#78716C", letterSpacing: "0.5px" }}
                  >
                    Data Source <SortIcon col="source" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("targetSchema")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#1C1917]" style={{ fontSize: "11px", fontWeight: 600, color: "#78716C", letterSpacing: "0.5px" }}
                  >
                    Target Schema <SortIcon col="targetSchema" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleSort("lzStatus")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#1C1917]" style={{ fontSize: "11px", fontWeight: 600, color: "#78716C", letterSpacing: "0.5px" }}
                  >
                    Landing Zone <SortIcon col="lzStatus" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleSort("bronzeStatus")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#1C1917]" style={{ fontSize: "11px", fontWeight: 600, color: "#78716C", letterSpacing: "0.5px" }}
                  >
                    Bronze <SortIcon col="bronzeStatus" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleSort("silverStatus")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#1C1917]" style={{ fontSize: "11px", fontWeight: 600, color: "#78716C", letterSpacing: "0.5px" }}
                  >
                    Silver <SortIcon col="silverStatus" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => toggleSort("lzLastLoad")}
                    className="inline-flex items-center gap-1 uppercase hover:text-[#1C1917]" style={{ fontSize: "11px", fontWeight: 600, color: "#78716C", letterSpacing: "0.5px" }}
                  >
                    Last Load <SortIcon col="lzLastLoad" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <span className="uppercase" style={{ fontSize: "11px", fontWeight: 600, color: "#78716C", letterSpacing: "0.5px" }}>
                    Actions
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedEntities.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center" data-testid="empty-state">
                    <Database className="w-10 h-10 text-[#A8A29E]/15 mx-auto mb-3" />
                    <p className="text-sm text-[#A8A29E]">No entities match your filters</p>
                    <p className="text-xs text-[#A8A29E]/60 mt-1">
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
          <span className="text-xs text-[#A8A29E] px-3">
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
          "cursor-pointer transition-colors",
          isExpanded ? "bg-[#F9F7F3]" : "hover:bg-[#F9F7F3]/50"
        )}
        style={{ background: isExpanded ? "#F9F7F3" : "#FEFDFB", borderBottom: "1px solid rgba(0,0,0,0.04)" }}
        onClick={onToggleExpand}
        data-testid={`entity-row-${e.id}`}
      >
        {/* Expand chevron */}
        <td className="px-3 py-2">
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#A8A29E]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#A8A29E]" />
          )}
        </td>

        {/* Entity ID */}
        <td className="px-3 py-2">
          <span className="text-xs text-[#A8A29E]" style={{ fontFamily: "var(--font-mono)" }}>{e.id}</span>
        </td>

        {/* Source Name (schema.table) */}
        <td className="px-3 py-2">
          <div className="flex flex-col">
            <span className="text-xs font-medium" style={{ color: "#1C1917" }}>{e.tableName}</span>
            <span className="text-[10px]" style={{ color: "#A8A29E" }}>{e.sourceSchema}</span>
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
          <span className="text-[10px]" style={{ fontFamily: "var(--font-mono)", color: "#A8A29E" }}>{e.targetSchema}</span>
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
            {e.lzLastLoad && <span className="text-[9px] text-[#A8A29E]">{timeAgo(e.lzLastLoad)}</span>}
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
              <span className="text-[9px] text-[#A8A29E]">{timeAgo(e.bronzeLastLoad)}</span>
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
              <span className="text-[9px] text-[#A8A29E]">{timeAgo(e.silverLastLoad)}</span>
            )}
          </div>
        </td>

        {/* Last Load */}
        <td className="px-3 py-2 text-right">
          <span className="text-[10px]" style={{ color: "#A8A29E", fontFamily: "var(--font-mono)" }}>{formatTimestamp(lastLoadTime)}</span>
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
              className="h-6 text-[10px] px-2 text-[#A8A29E] hover:text-[#1C1917]"
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
        <tr style={{ background: "#F9F7F3" }} data-testid={`entity-detail-${e.id}`}>
          <td colSpan={10} className="px-6 py-3">
            <div className="space-y-2">
              {/* Entity metadata summary */}
              <div className="flex items-center gap-4 text-[10px] mb-2 flex-wrap" style={{ color: "#A8A29E" }}>
                <span>
                  Watermark:{" "}
                  <strong className="text-[#1C1917]" style={{ fontFamily: "var(--font-mono)" }}>{e.watermarkColumn || "none"}</strong>
                </span>
                <span>
                  Incremental: <strong className="text-[#1C1917]">{e.isIncremental ? "Yes" : "No"}</strong>
                </span>
                <span>
                  Bronze ID: <strong className="text-[#1C1917]" style={{ fontFamily: "var(--font-mono)" }}>{e.bronzeId ?? "\u2014"}</strong>
                </span>
                <span>
                  Silver ID: <strong className="text-[#1C1917]" style={{ fontFamily: "var(--font-mono)" }}>{e.silverId ?? "\u2014"}</strong>
                </span>
                {e.bronzePKs && (
                  <span>
                    PKs: <strong className="text-[#1C1917]" style={{ fontFamily: "var(--font-mono)" }}>{e.bronzePKs}</strong>
                  </span>
                )}
              </div>

              {/* Last error */}
              {e.lastError && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-md border border-[#B93A2A]/20 bg-[#FBEAE8]">
                  <XCircle className="w-3.5 h-3.5 text-[#B93A2A] mt-0.5 flex-shrink-0" />
                  <div>
                    <span className="text-[10px] text-[#B93A2A] font-medium">{e.lastError.layer} layer error</span>
                    <span className="text-[10px] text-[#A8A29E] ml-2">{timeAgo(e.lastError.time)}</span>
                    <p className="text-[10px] text-[#A8A29E] font-mono mt-0.5">{e.lastError.message}</p>
                  </div>
                </div>
              )}

              {/* Diagnosis */}
              {e.diagnosis && (
                <div className="text-[10px] text-[#A8A29E] italic px-1">{e.diagnosis}</div>
              )}

              {/* Recent task logs from engine */}
              {logsLoading && (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin text-[#A8A29E]" />
                  <span className="text-xs text-[#A8A29E]">Loading task logs...</span>
                </div>
              )}

              {!logsLoading && logs.length === 0 && (
                <p className="text-[10px] text-[#A8A29E]/60 py-2 text-center">
                  No engine task logs available for this entity
                </p>
              )}

              {!logsLoading && logs.length > 0 && (
                <div className="rounded-md border border-[rgba(0,0,0,0.08)] overflow-hidden">
                  <table className="w-full text-[10px]">
                    <thead>
                      <tr style={{ background: "#F9F7F3", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                        <th className="px-2 py-1.5 text-left text-[#A8A29E] font-semibold uppercase tracking-wider">
                          Run
                        </th>
                        <th className="px-2 py-1.5 text-left text-[#A8A29E] font-semibold uppercase tracking-wider">
                          Layer
                        </th>
                        <th className="px-2 py-1.5 text-left text-[#A8A29E] font-semibold uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-2 py-1.5 text-right text-[#A8A29E] font-semibold uppercase tracking-wider">
                          Rows
                        </th>
                        <th className="px-2 py-1.5 text-right text-[#A8A29E] font-semibold uppercase tracking-wider">
                          Duration
                        </th>
                        <th className="px-2 py-1.5 text-right text-[#A8A29E] font-semibold uppercase tracking-wider">
                          Time
                        </th>
                        <th className="px-2 py-1.5 text-left text-[#A8A29E] font-semibold uppercase tracking-wider">
                          Error
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map((log) => (
                        <tr key={log.log_id} className="border-b border-[rgba(0,0,0,0.08)]/30">
                          <td className="px-2 py-1.5 text-[#A8A29E]" style={{ fontFamily: "var(--font-mono)" }}>#{log.run_id}</td>
                          <td className="px-2 py-1.5 uppercase text-[#A8A29E]">{log.layer}</td>
                          <td className="px-2 py-1.5">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-medium",
                                log.status === "succeeded"
                                  ? "bg-[#E7F3EB] text-[#3D7C4F] border-[#3D7C4F]/20"
                                  : log.status === "failed"
                                    ? "bg-[#FBEAE8] text-[#B93A2A] border-[#B93A2A]/20"
                                    : "bg-[#F4E8DF] text-[#B45624] border-[#B45624]/20"
                              )}
                            >
                              {log.status}
                            </span>
                          </td>
                          <td className="px-2 py-1.5 text-right text-[#1C1917]" style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "'tnum'" }}>
                            {log.rows_read > 0 ? fmt(log.rows_read) : "\u2014"}
                          </td>
                          <td className="px-2 py-1.5 text-right text-[#A8A29E]" style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: "'tnum'" }}>
                            {humanDuration(log.duration_seconds)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-[#A8A29E]">
                            {formatTimestamp(log.ended_at || log.started_at)}
                          </td>
                          <td className="px-2 py-1.5 text-[#B93A2A] truncate max-w-[200px]" style={{ fontFamily: "var(--font-mono)" }}>
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
