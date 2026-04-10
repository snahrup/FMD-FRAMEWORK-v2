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
import TableCardList from "@/components/ui/TableCardList";

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

function getLastLoadTime(entity: DigestEntity): string | null {
  const times = [entity.lzLastLoad, entity.bronzeLastLoad, entity.silverLastLoad].filter(
    Boolean
  ) as string[];
  if (!times.length) return null;
  return times.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
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
  if (SUCCESS_STATUSES.has(lower)) return "bp-badge-operational";
  if (PENDING_STATUSES.has(lower)) return "bp-badge-warning";
  if (lower === "failed" || lower === "error") return "bp-badge-critical";
  return "bp-badge-info";
}

function layerStatusIcon(s: LayerStatus) {
  const lower = s.toLowerCase();
  if (SUCCESS_STATUSES.has(lower)) return <CheckCircle2 className="w-3 h-3" />;
  if (PENDING_STATUSES.has(lower)) return <Clock className="w-3 h-3" />;
  if (lower === "failed" || lower === "error") return <XCircle className="w-3 h-3" style={{ color: "var(--bp-fault)" }} />;
  return <XCircle className="w-3 h-3 opacity-40" />;
}

function overallStatusCls(overall: string): string {
  if (overall === "complete") return "text-[var(--bp-operational)]";
  if (overall === "error") return "text-[var(--bp-fault)]";
  if (overall === "partial") return "text-[var(--bp-caution)]";
  if (overall === "pending") return "text-[var(--bp-copper)]";
  return "text-[var(--bp-ink-muted)]";
}

interface EntityDetailPanelProps {
  entity: DigestEntity;
  logs: EngineLog[];
  logsLoading: boolean;
  resetConfirm: number | null;
  setResetConfirm: (id: number | null) => void;
  onReset: (id: number) => void;
}

function EntityDetailPanel({
  entity,
  logs,
  logsLoading,
  resetConfirm,
  setResetConfirm,
  onReset,
}: EntityDetailPanelProps) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>
          <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-2 py-1">
            Watermark:{" "}
            <strong
              className="text-[var(--bp-ink-primary)]"
              style={{ fontFamily: "var(--bp-font-mono)" }}
            >
              {entity.watermarkColumn || "none"}
            </strong>
          </span>
          <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-2 py-1">
            Incremental: <strong className="text-[var(--bp-ink-primary)]">{entity.isIncremental ? "Yes" : "No"}</strong>
          </span>
          <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-2 py-1">
            Bronze ID:{" "}
            <strong
              className="text-[var(--bp-ink-primary)]"
              style={{ fontFamily: "var(--bp-font-mono)" }}
            >
              {entity.bronzeId ?? "\u2014"}
            </strong>
          </span>
          <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-2 py-1">
            Silver ID:{" "}
            <strong
              className="text-[var(--bp-ink-primary)]"
              style={{ fontFamily: "var(--bp-font-mono)" }}
            >
              {entity.silverId ?? "\u2014"}
            </strong>
          </span>
          {entity.bronzePKs ? (
            <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-2 py-1">
              PKs:{" "}
              <strong
                className="text-[var(--bp-ink-primary)]"
                style={{ fontFamily: "var(--bp-font-mono)" }}
              >
                {entity.bronzePKs}
              </strong>
            </span>
          ) : null}
        </div>

        <div>
          {resetConfirm === entity.id ? (
            <div className="inline-flex items-center gap-1">
              <Button
                variant="destructive"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={() => onReset(entity.id)}
              >
                Confirm reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-[10px]"
                onClick={() => setResetConfirm(null)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[10px] text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-primary)]"
              onClick={() => setResetConfirm(entity.id)}
              title="Reset watermark"
            >
              <RotateCcw className="h-3 w-3" />
              Reset watermark
            </Button>
          )}
        </div>
      </div>

      {entity.lastError ? (
        <div className="flex items-start gap-2 rounded-md border border-[var(--bp-fault)]/20 bg-[var(--bp-fault-light)] px-3 py-2">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--bp-fault)]" />
          <div>
            <span className="text-[10px] font-medium text-[var(--bp-fault)]">
              {entity.lastError.layer} layer error
            </span>
            <span className="ml-2 text-[10px] text-[var(--bp-ink-muted)]">
              {timeAgo(entity.lastError.time)}
            </span>
            <p className="mt-0.5 text-[10px] text-[var(--bp-ink-muted)]" style={{ fontFamily: "var(--bp-font-mono)" }}>
              {entity.lastError.message}
            </p>
          </div>
        </div>
      ) : null}

      {entity.diagnosis ? (
        <div className="rounded-md border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-2 text-[10px] italic text-[var(--bp-ink-muted)]">
          {entity.diagnosis}
        </div>
      ) : null}

      {logsLoading ? (
        <div className="flex items-center justify-center gap-2 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--bp-ink-muted)]" />
          <span className="text-xs text-[var(--bp-ink-muted)]">Loading task logs...</span>
        </div>
      ) : logs.length === 0 ? (
        <p className="py-2 text-center text-[10px] text-[var(--bp-ink-muted)]/60">
          No engine task logs available for this entity
        </p>
      ) : (
        <div className="space-y-2">
          {logs.map((log, index) => (
            <div
              key={`${log.run_id || "run"}-${log.layer || "layer"}-${index}`}
              className="rounded-md border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn(
                      "bp-badge bp-badge-sm",
                      layerStatusCls(log.status || "not_started")
                    )}
                  >
                    {layerStatusIcon(log.status || "not_started")}
                    {layerStatusLabel(log.status || "not_started")}
                  </span>
                  {log.layer ? (
                    <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--bp-ink-tertiary)]">
                      {log.layer}
                    </span>
                  ) : null}
                  {log.run_id ? (
                    <span
                      className="text-[10px] text-[var(--bp-ink-muted)]"
                      style={{ fontFamily: "var(--bp-font-mono)" }}
                    >
                      #{log.run_id}
                    </span>
                  ) : null}
                </div>
                <span className="text-[10px] text-[var(--bp-ink-muted)]">
                  {formatTimestamp(log.ended_at || log.started_at)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--bp-ink-muted)]">
                <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-inset)] px-2 py-1">
                  Rows:{" "}
                  <strong className="text-[var(--bp-ink-primary)]">
                    {log.rows_read != null ? fmt(log.rows_read) : "\u2014"}
                  </strong>
                </span>
                <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-inset)] px-2 py-1">
                  Duration:{" "}
                  <strong className="text-[var(--bp-ink-primary)]">
                    {humanDuration(log.duration_seconds)}
                  </strong>
                </span>
              </div>
              {log.error_message ? (
                <p className="mt-2 text-[10px] text-[var(--bp-fault)]" style={{ fontFamily: "var(--bp-font-mono)" }}>
                  {log.error_message}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 text-[var(--bp-copper)]" /> : <ArrowDown className="w-3 h-3 text-[var(--bp-copper)]" />;
  };

  return (
    <div className={className} data-testid="entity-table">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-[var(--bp-ink-muted)]">
          Showing {fmt(pagedEntities.length)} of {fmt(sortedEntities.length)} entities
          {sortedEntities.length !== totalCount && ` (${fmt(totalCount)} total)`}
        </span>
        <div className="flex flex-wrap items-center gap-2">
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
              <span className="text-xs text-[var(--bp-ink-muted)] px-2" data-testid="page-indicator">
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

      <div className="lg:hidden">
        <TableCardList
          items={pagedEntities}
          getId={(entity) => String(entity.id)}
          getTitle={(entity) => entity.tableName}
          getSubtitle={(entity) => `${entity.sourceSchema} · ${entity.dataSourceName || entity.source}`}
          getStats={(entity) => [
            { label: "Landing", value: layerStatusLabel(entity.lzStatus) },
            { label: "Bronze", value: layerStatusLabel(entity.bronzeStatus) },
            { label: "Silver", value: layerStatusLabel(entity.silverStatus) },
            { label: "Last", value: timeAgo(getLastLoadTime(entity)) },
          ]}
          expandedItemId={expandedEntity != null ? String(expandedEntity) : null}
          onExpandedItemChange={(itemId) => {
            if (!itemId) {
              setExpandedEntity(null);
              setEntityLogs([]);
              return;
            }
            void toggleExpand(Number(itemId));
          }}
          renderExpanded={(entity) => (
            <EntityDetailPanel
              entity={entity}
              logs={expandedEntity === entity.id ? entityLogs : []}
              logsLoading={expandedEntity === entity.id && entityLogsLoading}
              resetConfirm={resetConfirm}
              setResetConfirm={setResetConfirm}
              onReset={handleReset}
            />
          )}
          emptyState={
            <div className="rounded-xl border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-4 py-10 text-center">
              <Database className="mx-auto mb-3 h-10 w-10 text-[var(--bp-ink-muted)]/20" />
              <p className="text-sm text-[var(--bp-ink-muted)]">No entities match your filters</p>
            </div>
          }
        />
      </div>

      <div
        className="hidden rounded-lg border border-[rgba(0,0,0,0.08)] overflow-hidden lg:block"
        style={{ background: "var(--bp-surface-1)" }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "var(--bp-surface-inset)", borderBottom: "1px solid var(--bp-border)" }}>
                <th className="w-8 px-3 py-2.5" />
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("id")}
                    className="inline-flex items-center gap-1 uppercase" style={{ fontSize: "11px", fontWeight: 600, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px" }}
                  >
                    ID <SortIcon col="id" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("tableName")}
                    className="inline-flex items-center gap-1 uppercase" style={{ fontSize: "11px", fontWeight: 600, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px" }}
                  >
                    Source Name <SortIcon col="tableName" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("source")}
                    className="inline-flex items-center gap-1 uppercase" style={{ fontSize: "11px", fontWeight: 600, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px" }}
                  >
                    Data Source <SortIcon col="source" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-left">
                  <button
                    onClick={() => toggleSort("targetSchema")}
                    className="inline-flex items-center gap-1 uppercase" style={{ fontSize: "11px", fontWeight: 600, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px" }}
                  >
                    Target Schema <SortIcon col="targetSchema" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleSort("lzStatus")}
                    className="inline-flex items-center gap-1 uppercase" style={{ fontSize: "11px", fontWeight: 600, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px" }}
                  >
                    Landing Zone <SortIcon col="lzStatus" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleSort("bronzeStatus")}
                    className="inline-flex items-center gap-1 uppercase" style={{ fontSize: "11px", fontWeight: 600, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px" }}
                  >
                    Bronze <SortIcon col="bronzeStatus" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <button
                    onClick={() => toggleSort("silverStatus")}
                    className="inline-flex items-center gap-1 uppercase" style={{ fontSize: "11px", fontWeight: 600, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px" }}
                  >
                    Silver <SortIcon col="silverStatus" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => toggleSort("lzLastLoad")}
                    className="inline-flex items-center gap-1 uppercase" style={{ fontSize: "11px", fontWeight: 600, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px" }}
                  >
                    Last Load <SortIcon col="lzLastLoad" />
                  </button>
                </th>
                <th className="px-3 py-2.5 text-center">
                  <span className="uppercase" style={{ fontSize: "11px", fontWeight: 600, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px" }}>
                    Actions
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {pagedEntities.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-12 text-center" data-testid="empty-state">
                    <Database className="w-10 h-10 text-[var(--bp-ink-muted)]/15 mx-auto mb-3" />
                    <p className="text-sm text-[var(--bp-ink-muted)]">No entities match your filters</p>
                    <p className="text-xs text-[var(--bp-ink-muted)]/60 mt-1">
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
        <div className="mt-3 flex items-center justify-center gap-1">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <span className="text-xs text-[var(--bp-ink-muted)] px-3">
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
  const lastLoadTime = useMemo(() => getLastLoadTime(e), [e]);

  return (
    <>
      <tr
        className={cn(
          "cursor-pointer transition-colors",
          isExpanded ? "bg-[var(--bp-surface-inset)]" : "hover:bg-[var(--bp-surface-inset)]/50"
        )}
        style={{ background: isExpanded ? "var(--bp-surface-inset)" : "var(--bp-surface-1)", borderBottom: "1px solid var(--bp-border-subtle, var(--bp-border))" }}
        onClick={onToggleExpand}
        data-testid={`entity-row-${e.id}`}
      >
        {/* Expand chevron */}
        <td className="px-3 py-2">
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--bp-ink-muted)]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[var(--bp-ink-muted)]" />
          )}
        </td>

        {/* Entity ID */}
        <td className="px-3 py-2">
          <span className="text-xs text-[var(--bp-ink-muted)]" style={{ fontFamily: "var(--bp-font-mono)" }}>{e.id}</span>
        </td>

        {/* Source Name (schema.table) */}
        <td className="px-3 py-2">
          <div className="flex flex-col">
            <span className="text-xs font-medium" style={{ color: "var(--bp-ink-primary)" }}>{e.tableName}</span>
            <span className="text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>{e.sourceSchema}</span>
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
          <span className="text-[10px]" style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-muted)" }}>{e.targetSchema}</span>
        </td>

        {/* Landing Zone */}
        <td className="px-3 py-2 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span className={cn("bp-badge bp-badge-sm", layerStatusCls(e.lzStatus))}>
              {layerStatusIcon(e.lzStatus)} {layerStatusLabel(e.lzStatus)}
            </span>
            {e.lzLastLoad && <span className="text-[9px]" style={{ color: "var(--bp-ink-muted)" }}>{timeAgo(e.lzLastLoad)}</span>}
          </div>
        </td>

        {/* Bronze */}
        <td className="px-3 py-2 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span className={cn("bp-badge bp-badge-sm", layerStatusCls(e.bronzeStatus))}>
              {layerStatusIcon(e.bronzeStatus)} {layerStatusLabel(e.bronzeStatus)}
            </span>
            {e.bronzeLastLoad && (
              <span className="text-[9px]" style={{ color: "var(--bp-ink-muted)" }}>{timeAgo(e.bronzeLastLoad)}</span>
            )}
          </div>
        </td>

        {/* Silver */}
        <td className="px-3 py-2 text-center">
          <div className="flex flex-col items-center gap-0.5">
            <span className={cn("bp-badge bp-badge-sm", layerStatusCls(e.silverStatus))}>
              {layerStatusIcon(e.silverStatus)} {layerStatusLabel(e.silverStatus)}
            </span>
            {e.silverLastLoad && (
              <span className="text-[9px]" style={{ color: "var(--bp-ink-muted)" }}>{timeAgo(e.silverLastLoad)}</span>
            )}
          </div>
        </td>

        {/* Last Load */}
        <td className="px-3 py-2 text-right">
          <span className="text-[10px]" style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)" }}>{formatTimestamp(lastLoadTime)}</span>
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
              className="h-6 text-[10px] px-2 text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-primary)]"
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
        <tr style={{ background: "var(--bp-surface-inset)" }} data-testid={`entity-detail-${e.id}`}>
          <td colSpan={10} className="px-6 py-3">
            <EntityDetailPanel
              entity={e}
              logs={logs}
              logsLoading={logsLoading}
              resetConfirm={resetConfirm}
              setResetConfirm={setResetConfirm}
              onReset={onReset}
            />
          </td>
        </tr>
      )}
    </>
  );
}

export default EntityTable;
