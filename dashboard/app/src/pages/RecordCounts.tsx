import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Hash,
  RefreshCw,
  Loader2,
  XCircle,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Download,
  Route,
  ChevronDown,
  ChevronRight,
  Layers,
} from "lucide-react";
import { useEntityDigest } from "../hooks/useEntityDigest";
import { useSourceConfig } from "../hooks/useSourceConfig";
import StrataBar from "../components/data/StrataBar";
import LayerStatusDot, { normalizeStatus } from "../components/data/LayerStatusDot";

// ============================================================================
// TYPES
// ============================================================================

interface LakehouseCount {
  schema: string;
  table: string;
  rowCount: number;
  fileCount?: number;
  sizeBytes?: number;
}

interface CountsMeta {
  cachedAt: string | null;
  fromCache: boolean;
  cacheAgeSec: number;
  queryTimeSec?: number;
  cachedTables?: number;
  oldestScan?: string | null;
  newestScan?: string | null;
  scanRunning?: boolean;
  scanProgress?: { scanned: number; total: number; layer: string } | null;
  source?: string;
}

type CountsResponse = Record<string, LakehouseCount[] | CountsMeta> & { _meta?: CountsMeta };

interface CountRow {
  id: string;
  tableName: string;
  schema: string;
  dataSource: string;
  loadType: string;
  lzCount: number | null;
  bronzeCount: number | null;
  silverCount: number | null;
  status: "match" | "mismatch" | "bronze-only" | "silver-only" | "pending";
  delta: number;
  lzStatus: string;
  bronzeStatus: string;
  silverStatus: string;
}

// ============================================================================
// HELPERS
// ============================================================================

const API = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

type SortKey = "tableName" | "schema" | "dataSource" | "lzCount" | "bronzeCount" | "silverCount" | "delta" | "status";
type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<string, number> = { mismatch: 0, "bronze-only": 1, "silver-only": 2, match: 3, pending: 4 };

// ============================================================================
// MATCH RATE RING — SVG arc gauge
// ============================================================================

function MatchRateRing({ rate, total, matched }: { rate: number; total: number; matched: number }) {
  const r = 44;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - rate / 100);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      <div style={{ position: "relative", width: 96, height: 96, flexShrink: 0 }}>
        <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
          {/* Background track */}
          <circle cx="50" cy="50" r={r} fill="none" stroke="var(--bp-surface-inset)" strokeWidth="8" />
          {/* Filled arc */}
          <circle
            cx="50" cy="50" r={r}
            fill="none"
            stroke={rate >= 90 ? "var(--bp-operational)" : rate >= 70 ? "var(--bp-caution)" : "var(--bp-fault)"}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 600ms ease" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        }}>
          <span style={{
            fontFamily: "var(--bp-font-mono)",
            fontSize: 22, fontWeight: 700,
            color: "var(--bp-ink-primary)",
            fontFeatureSettings: "'tnum' 1",
            lineHeight: 1,
          }}>
            {rate}%
          </span>
          <span style={{ fontSize: 9, color: "var(--bp-ink-muted)", marginTop: 2 }}>match</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--bp-ink-secondary)" }}>
          <strong style={{ color: "var(--bp-operational)" }}>{fmt(matched)}</strong> matched of {fmt(total)}
        </span>
        <span style={{ fontSize: 10, color: "var(--bp-ink-muted)" }}>
          Bronze ↔ Silver row count agreement
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// SOURCE SUMMARY CARDS — proportional cards per source
// ============================================================================

function SourceCards({
  rows,
  resolveLabel,
  getColor,
  activeSource,
  onSourceClick,
}: {
  rows: CountRow[];
  resolveLabel: (s: string) => string;
  getColor: (s: string) => { hex: string };
  activeSource: string | null;
  onSourceClick: (source: string | null) => void;
}) {
  // Group by source
  const sourceGroups = useMemo(() => {
    const groups: Record<string, CountRow[]> = {};
    for (const r of rows) {
      const src = r.dataSource || "Unlinked";
      if (!groups[src]) groups[src] = [];
      groups[src].push(r);
    }
    return Object.entries(groups)
      .sort((a, b) => b[1].length - a[1].length);
  }, [rows]);

  const maxCount = sourceGroups[0]?.[1].length || 1;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {sourceGroups.map(([source, srcRows], cardIndex) => {
        const matched = srcRows.filter(r => r.status === "match").length;
        const errors = srcRows.filter(r => r.status === "mismatch").length;
        const isActive = activeSource === source;
        const color = source !== "Unlinked" ? getColor(source) : { hex: "var(--bp-ink-muted)" };

        return (
          <button
            key={source}
            onClick={() => onSourceClick(isActive ? null : source)}
            aria-label={`Filter by source: ${resolveLabel(source)}`}
            aria-pressed={isActive}
            className="bp-card gs-stagger-card"
            style={{
              '--i': cardIndex,
              padding: "12px 16px",
              minWidth: Math.max(120, (srcRows.length / maxCount) * 200),
              flex: `${srcRows.length} 0 120px`,
              maxWidth: 260,
              cursor: "pointer",
              borderColor: isActive ? color.hex : undefined,
              borderWidth: isActive ? 2 : 1,
              textAlign: "left",
              position: "relative",
              overflow: "hidden",
            } as React.CSSProperties}
          >
            {/* Top color strip */}
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0,
              height: 3, background: color.hex,
            }} />

            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: color.hex, flexShrink: 0,
              }} />
              <span style={{
                fontSize: 12, fontWeight: 600,
                color: "var(--bp-ink-primary)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {resolveLabel(source)}
              </span>
            </div>

            <div style={{
              fontFamily: "var(--bp-font-mono)", fontSize: 20, fontWeight: 700,
              fontFeatureSettings: "'tnum' 1",
              color: "var(--bp-ink-primary)", lineHeight: 1,
              marginBottom: 8,
            }}>
              {fmt(srcRows.length)}
              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--bp-ink-muted)", marginLeft: 4 }}>tables</span>
            </div>

            {/* Mini strata summary */}
            <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
              {matched > 0 && (
                <span style={{ color: "var(--bp-operational)" }}>{matched} matched</span>
              )}
              {errors > 0 && (
                <span style={{ color: "var(--bp-caution)" }}>{errors} mismatched</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function RecordCounts() {
  const [searchParams] = useSearchParams();
  const { allEntities, loading: metaLoading } = useEntityDigest();
  const { resolveLabel, getColor } = useSourceConfig();

  const [counts, setCounts] = useState<Record<string, LakehouseCount[]> | null>(null);
  const [countsMeta, setCountsMeta] = useState<CountsMeta | null>(null);
  const [countsLoading, setCountsLoading] = useState(true);
  const [countsError, setCountsError] = useState<string | null>(null);

  // UI state — initialize search from URL param (e.g., /record-counts?search=WORK_ORDER)
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get("search") || "");
  const [sortKey, setSortKey] = useState<SortKey>("tableName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [activeSource, setActiveSource] = useState<string | null>(null);
  const [groupBySource, setGroupBySource] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);

  // Load counts from SQLite cache
  const loadCounts = useCallback(async () => {
    setCountsLoading(true);
    setCountsError(null);
    try {
      const data = await fetchJson<CountsResponse>("/lakehouse-counts");
      const meta = data._meta as CountsMeta | undefined;
      const countData: Record<string, LakehouseCount[]> = {};
      for (const [key, val] of Object.entries(data)) {
        if (key !== "_meta" && Array.isArray(val)) {
          countData[key] = val;
        }
      }
      setCounts(countData);
      setCountsMeta(meta || null);
      if (meta?.scanRunning) setScanning(true);
      else setScanning(false);
    } catch {
      setCounts(null);
      setCountsMeta(null);
      setCountsError("API server not reachable");
    } finally {
      setCountsLoading(false);
    }
  }, []);

  const triggerScan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch(`${API}/lakehouse-counts/scan`, { method: "POST" });
      if (!res.ok) {
        setCountsError(`Scan request failed: ${res.status}`);
        setScanning(false);
      }
    } catch {
      setCountsError("Failed to start scan — API server not reachable");
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  useEffect(() => {
    if (!scanning) return;
    const interval = setInterval(() => loadCounts(), 3000);
    return () => clearInterval(interval);
  }, [scanning, loadCounts]);

  // Build the matrix rows
  const rows: CountRow[] = useMemo(() => {
    if (!counts) return [];

    const lzCounts = counts["LH_DATA_LANDINGZONE"] || [];
    const bronzeCounts = counts["LH_BRONZE_LAYER"] || [];
    const silverCounts = counts["LH_SILVER_LAYER"] || [];

    const lzMap = new Map<string, number>();
    for (const c of lzCounts) lzMap.set(`${c.schema}.${c.table}`.toLowerCase(), c.rowCount);
    const bronzeMap = new Map<string, number>();
    for (const c of bronzeCounts) bronzeMap.set(`${c.schema}.${c.table}`.toLowerCase(), c.rowCount);
    const silverMap = new Map<string, number>();
    for (const c of silverCounts) silverMap.set(`${c.schema}.${c.table}`.toLowerCase(), c.rowCount);

    // Entity metadata lookup
    const entityMeta = new Map<string, { dataSource: string; loadType: string; lzStatus: string; bronzeStatus: string; silverStatus: string }>();
    for (const ent of allEntities) {
      entityMeta.set(`${ent.source}.${ent.tableName}`.toLowerCase(), {
        dataSource: ent.source,
        loadType: ent.isIncremental ? "Incremental" : "Full",
        lzStatus: ent.lzStatus,
        bronzeStatus: ent.bronzeStatus,
        silverStatus: ent.silverStatus,
      });
    }

    const allKeys = new Set<string>();
    for (const c of lzCounts) allKeys.add(`${c.schema}.${c.table}`.toLowerCase());
    for (const c of bronzeCounts) allKeys.add(`${c.schema}.${c.table}`.toLowerCase());
    for (const c of silverCounts) allKeys.add(`${c.schema}.${c.table}`.toLowerCase());

    const result: CountRow[] = [];
    for (const key of allKeys) {
      const [schema, ...rest] = key.split(".");
      const tableName = rest.join(".");
      const lc = lzMap.has(key) ? (lzMap.get(key)! >= 0 ? lzMap.get(key)! : null) : null;
      const bc = bronzeMap.has(key) ? (bronzeMap.get(key)! >= 0 ? bronzeMap.get(key)! : null) : null;
      const sc = silverMap.has(key) ? (silverMap.get(key)! >= 0 ? silverMap.get(key)! : null) : null;

      let status: CountRow["status"] = "pending";
      let delta = 0;
      if (bc !== null && sc !== null) {
        if (bc === sc) { status = "match"; delta = 0; }
        else { status = "mismatch"; delta = Math.abs(bc - sc); }
      } else if (bc !== null && sc === null) {
        status = "bronze-only";
      } else if (bc === null && sc !== null) {
        status = "silver-only";
      }

      const meta = entityMeta.get(key);
      result.push({
        id: key,
        tableName,
        schema,
        dataSource: meta?.dataSource || "",
        loadType: meta?.loadType || "",
        lzCount: lc,
        bronzeCount: bc,
        silverCount: sc,
        status,
        delta,
        lzStatus: meta?.lzStatus || "",
        bronzeStatus: meta?.bronzeStatus || "",
        silverStatus: meta?.silverStatus || "",
      });
    }

    return result;
  }, [counts, allEntities]);

  // Filter and sort
  const displayed = useMemo(() => {
    let filtered = rows;

    if (filterStatus !== "all") {
      filtered = filtered.filter(r => r.status === filterStatus);
    }

    if (activeSource) {
      const src = activeSource === "Unlinked" ? "" : activeSource;
      filtered = filtered.filter(r => r.dataSource === src || (activeSource === "Unlinked" && !r.dataSource));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.tableName.toLowerCase().includes(q) ||
        r.schema.toLowerCase().includes(q) ||
        r.dataSource.toLowerCase().includes(q) ||
        resolveLabel(r.dataSource).toLowerCase().includes(q)
      );
    }

    const dir = sortDir === "asc" ? 1 : -1;
    filtered = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "tableName": return dir * a.tableName.localeCompare(b.tableName);
        case "schema": return dir * a.schema.localeCompare(b.schema);
        case "dataSource": return dir * a.dataSource.localeCompare(b.dataSource);
        case "lzCount": return dir * ((a.lzCount ?? -1) - (b.lzCount ?? -1));
        case "bronzeCount": return dir * ((a.bronzeCount ?? -1) - (b.bronzeCount ?? -1));
        case "silverCount": return dir * ((a.silverCount ?? -1) - (b.silverCount ?? -1));
        case "delta": return dir * (a.delta - b.delta);
        case "status": return dir * ((STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
        default: return 0;
      }
    });

    return filtered;
  }, [rows, searchQuery, sortKey, sortDir, filterStatus, activeSource, resolveLabel]);

  // Stats
  const stats = useMemo(() => {
    const total = rows.length;
    const matched = rows.filter(r => r.status === "match").length;
    const mismatched = rows.filter(r => r.status === "mismatch").length;
    const bronzeOnly = rows.filter(r => r.status === "bronze-only").length;
    const silverOnly = rows.filter(r => r.status === "silver-only").length;
    const totalLzRows = rows.reduce((s, r) => s + (r.lzCount ?? 0), 0);
    const totalBronzeRows = rows.reduce((s, r) => s + (r.bronzeCount ?? 0), 0);
    const totalSilverRows = rows.reduce((s, r) => s + (r.silverCount ?? 0), 0);
    // Only count entities where BOTH bronze and silver have real (non-null, non-negative) counts
    const matchable = rows.filter(
      (r) => r.bronzeCount != null && r.bronzeCount >= 0
           && r.silverCount != null && r.silverCount >= 0
    );
    const matchRate = matchable.length > 0 ? Math.floor((matched / matchable.length) * 100) : 0;
    return { total, matched, mismatched, bronzeOnly, silverOnly, totalLzRows, totalBronzeRows, totalSilverRows, matchRate, matchableTotal: matchable.length };
  }, [rows]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  const toggleGroup = (group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  // Export CSV
  const exportCsv = () => {
    if (!displayed.length) return;
    const header = "Table,Schema,Data Source,Load Type,LZ Rows,Bronze Rows,Silver Rows,Delta,Status";
    const csvRows = displayed.map(r =>
      `"${r.tableName}","${r.schema}","${r.dataSource}","${r.loadType}",${r.lzCount ?? ""},${r.bronzeCount ?? ""},${r.silverCount ?? ""},${r.delta},"${r.status}"`
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `record-counts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Grouped rows for source-grouped view
  const groupedRows = useMemo(() => {
    if (!groupBySource) return null;
    const groups: Record<string, CountRow[]> = {};
    for (const r of displayed) {
      const src = r.dataSource || "Unlinked";
      if (!groups[src]) groups[src] = [];
      groups[src].push(r);
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  }, [displayed, groupBySource]);

  // ── Table row renderer (shared between flat and grouped views)
  const renderRow = (row: CountRow, index: number) => {
    const railColor = row.status === "match" ? "var(--bp-operational-green, var(--bp-operational))"
      : row.status === "mismatch" ? "var(--bp-fault-red, var(--bp-fault))"
      : "var(--bp-ink-muted, #A8A29E)";

    return (
    <tr
      key={row.id}
      className="gs-stagger-row gs-row-hover border-b transition-colors"
      style={{
        '--i': Math.min(index, 15),
        borderColor: "var(--bp-border-subtle)",
        borderLeft: `3px solid ${railColor}`,
        background: index % 2 === 1 ? "var(--bp-surface-2)" : undefined,
      } as React.CSSProperties}
    >
      <td style={{ padding: "8px 12px", maxWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontSize: 13, fontWeight: 500,
            color: "var(--bp-ink-primary)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={row.tableName}>
            {row.tableName}
          </span>
        </div>
      </td>
      <td style={{ padding: "8px 12px" }}>
        <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 11, color: "var(--bp-ink-tertiary)" }}>
          {row.schema}
        </span>
      </td>
      {!groupBySource && (
        <td style={{ padding: "8px 12px" }}>
          <span style={{ fontSize: 12, color: "var(--bp-ink-secondary)" }}>
            {row.dataSource ? resolveLabel(row.dataSource) : <span style={{ color: "var(--bp-ink-muted)", fontStyle: "italic" }}>unlinked</span>}
          </span>
        </td>
      )}
      {/* Layer strata bar */}
      <td style={{ padding: "8px 12px", minWidth: 80 }}>
        <StrataBar
          lz={row.lzCount}
          bronze={row.bronzeCount}
          silver={row.silverCount}
          mode="count"
          size="sm"
        />
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right" }}>
        <span style={{
          fontFamily: "var(--bp-font-mono)", fontSize: 12,
          fontFeatureSettings: "'tnum' 1",
          color: row.lzCount !== null ? "var(--bp-lz)" : "var(--bp-ink-muted)",
          opacity: row.lzCount !== null ? 1 : 0.3,
        }}>
          {row.lzCount !== null ? fmt(row.lzCount) : "—"}
        </span>
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right" }}>
        <span style={{
          fontFamily: "var(--bp-font-mono)", fontSize: 12,
          fontFeatureSettings: "'tnum' 1",
          color: row.bronzeCount !== null ? "var(--bp-bronze)" : "var(--bp-ink-muted)",
          opacity: row.bronzeCount !== null ? 1 : 0.3,
        }}>
          {row.bronzeCount !== null ? fmt(row.bronzeCount) : "—"}
        </span>
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right" }}>
        <span style={{
          fontFamily: "var(--bp-font-mono)", fontSize: 12,
          fontFeatureSettings: "'tnum' 1",
          color: row.silverCount !== null ? "var(--bp-silver)" : "var(--bp-ink-muted)",
          opacity: row.silverCount !== null ? 1 : 0.3,
        }}>
          {row.silverCount !== null ? fmt(row.silverCount) : "—"}
        </span>
      </td>
      <td style={{ padding: "8px 12px", textAlign: "right" }}>
        <span style={{
          fontFamily: "var(--bp-font-mono)", fontSize: 12,
          fontFeatureSettings: "'tnum' 1",
          color: row.delta > 0 ? "var(--bp-caution)" : "var(--bp-ink-muted)",
          fontWeight: row.delta > 0 ? 600 : 400,
          opacity: row.delta > 0 ? 1 : 0.3,
        }}>
          {row.delta > 0 ? fmt(row.delta) : row.status === "match" ? "0" : "—"}
        </span>
      </td>
      <td style={{ padding: "8px 12px", textAlign: "center" }}>
        {row.status === "match" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--bp-operational)", fontSize: 10, fontWeight: 600 }}>
            <CheckCircle2 style={{ width: 12, height: 12 }} /> Match
          </span>
        )}
        {row.status === "mismatch" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--bp-caution)", fontSize: 10, fontWeight: 600 }}>
            <AlertTriangle style={{ width: 12, height: 12 }} /> Mismatch
          </span>
        )}
        {row.status === "bronze-only" && (
          <span style={{ fontSize: 10, fontWeight: 500, color: "var(--bp-ink-muted)" }}>Bronze only</span>
        )}
        {row.status === "silver-only" && (
          <span style={{ fontSize: 10, fontWeight: 500, color: "var(--bp-ink-muted)" }}>Silver only</span>
        )}
        {row.status === "pending" && (
          <span style={{ fontSize: 10, color: "var(--bp-ink-muted)", opacity: 0.5 }}>—</span>
        )}
      </td>
      <td style={{ padding: "8px 6px", textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <LayerStatusDot status={normalizeStatus(row.lzStatus)} size="sm" />
          <LayerStatusDot status={normalizeStatus(row.bronzeStatus)} size="sm" />
          <LayerStatusDot status={normalizeStatus(row.silverStatus)} size="sm" />
        </div>
      </td>
      <td style={{ padding: "8px 6px", textAlign: "center" }}>
        <Link
          to={`/journey?table=${encodeURIComponent(row.tableName)}&schema=${encodeURIComponent(row.schema)}`}
          style={{ color: "var(--bp-ink-muted)", opacity: 0.4 }}
          className="hover:opacity-100 transition-opacity"
          title="View data journey"
          aria-label={`View data journey for ${row.schema}.${row.tableName}`}
        >
          <Route style={{ width: 14, height: 14 }} />
        </Link>
      </td>
    </tr>
  ); };

  // ── Table header
  const tableHeaders = (
    <tr style={{ background: "var(--bp-surface-2)", borderBottom: "1px solid var(--bp-border)" }}>
      {([
        ["tableName", "Table", "left"],
        ["schema", "Schema", "left"],
        ...(!groupBySource ? [["dataSource", "Source", "left"] as const] : []),
        [null, "Layers", "center"],
        ["lzCount", "LZ", "right"],
        ["bronzeCount", "Bronze", "right"],
        ["silverCount", "Silver", "right"],
        ["delta", "Delta", "right"],
        ["status", "Status", "center"],
        [null, "Pipeline", "center"],
        [null, "", "center"],
      ] as const).map(([key, label, align], i) => (
        <th
          key={i}
          onClick={key ? () => toggleSort(key as SortKey) : undefined}
          aria-sort={key && sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
          aria-label={key && label ? `Sort by ${label}` : undefined}
          role={key ? "columnheader" : undefined}
          tabIndex={key ? 0 : undefined}
          onKeyDown={key ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(key as SortKey); } } : undefined}
          style={{
            padding: "10px 12px",
            textAlign: align as "left" | "right" | "center",
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--bp-ink-muted)",
            cursor: key ? "pointer" : "default",
            userSelect: "none",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {label}
            {key && <SortIcon col={key as SortKey} />}
          </span>
        </th>
      ))}
    </tr>
  );

  return (
    <div className="gs-page-enter" style={{ padding: 32, maxWidth: 1400 }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 className="bp-display" style={{ fontSize: 32, color: "var(--bp-ink-primary)", lineHeight: 1.1, margin: 0 }}>
          Record Counts
        </h1>
        <p style={{ fontSize: 13, color: "var(--bp-ink-tertiary)", marginTop: 4 }}>
          Cross-layer row count comparison — spot-check data migration accuracy across the medallion architecture
        </p>
      </div>

      {/* ── Action Bar ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => loadCounts()} disabled={countsLoading} className="bp-btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {countsLoading ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Hash style={{ width: 14, height: 14 }} />}
            {counts ? "Reload" : "Load Counts"}
          </button>
          <button onClick={triggerScan} disabled={scanning} className="bp-btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {scanning ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <RefreshCw style={{ width: 14, height: 14 }} />}
            {scanning ? "Scanning..." : "Scan Files"}
          </button>
          {scanning && countsMeta?.scanProgress && (
            <span style={{ fontSize: 10, color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)" }}>
              {countsMeta.scanProgress.scanned} scanned &middot; {countsMeta.scanProgress.layer}
            </span>
          )}
          {!scanning && countsMeta?.newestScan && (
            <span style={{ fontSize: 10, color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)" }}>
              Last scan: {new Date(countsMeta.newestScan).toLocaleTimeString()}
            </span>
          )}
        </div>

        {counts && displayed.length > 0 && (
          <button onClick={exportCsv} className="bp-btn-secondary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Download style={{ width: 14, height: 14 }} />
            Export CSV
          </button>
        )}
      </div>

      {/* ── Error ── */}
      {countsError && (
        <div className="bp-card" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderColor: "var(--bp-fault)", marginBottom: 20 }}>
          <XCircle style={{ width: 20, height: 20, color: "var(--bp-fault)", flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--bp-fault)" }}>Failed to load counts</div>
            <div style={{ fontSize: 11, color: "var(--bp-ink-tertiary)", marginTop: 2 }}>{countsError}</div>
          </div>
        </div>
      )}

      {/* ── Empty State ── */}
      {!counts && !countsLoading && !countsError && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0", textAlign: "center" }}>
          <Layers className="gs-float" style={{ width: 56, height: 56, color: "var(--bp-ink-muted)", opacity: 0.15, marginBottom: 16 }} />
          <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--bp-ink-secondary)", marginBottom: 8 }}>No counts loaded</h2>
          <p style={{ fontSize: 13, color: "var(--bp-ink-tertiary)", maxWidth: 360 }}>
            Click <strong>Scan Files</strong> to read row counts from OneLake parquet files across all three layers.
          </p>
        </div>
      )}

      {/* ── Loading ── */}
      {countsLoading && !counts && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 0" }}>
          <Loader2 style={{ width: 36, height: 36, color: "var(--bp-copper)" }} className="animate-spin" />
          <p style={{ fontSize: 13, color: "var(--bp-ink-tertiary)", marginTop: 12 }}>Querying lakehouse SQL endpoints...</p>
        </div>
      )}

      {/* ── Dashboard Content ── */}
      {counts && (
        <>
          {/* Hero row: Match Rate Ring + Source Cards */}
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start", marginBottom: 24 }}>
            {/* Match Rate Ring */}
            <div className="bp-card gs-hero-enter" style={{ '--i': 0, padding: "20px 24px", flexShrink: 0 } as React.CSSProperties}>
              <MatchRateRing rate={stats.matchRate} total={stats.matchableTotal} matched={stats.matched} />
            </div>

            {/* Source proportion cards */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <SourceCards
                rows={rows}
                resolveLabel={resolveLabel}
                getColor={getColor}
                activeSource={activeSource}
                onSourceClick={setActiveSource}
              />
            </div>
          </div>

          {/* Layer summary strip */}
          <div className="bp-card" style={{ display: "flex", alignItems: "center", padding: "10px 20px", gap: 24, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--bp-lz)" }} />
              <span style={{ fontSize: 11, color: "var(--bp-ink-secondary)" }}>
                LZ: <strong style={{ fontFamily: "var(--bp-font-mono)", fontFeatureSettings: "'tnum' 1" }}>{fmt(stats.totalLzRows)}</strong>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--bp-bronze)" }} />
              <span style={{ fontSize: 11, color: "var(--bp-ink-secondary)" }}>
                Bronze: <strong style={{ fontFamily: "var(--bp-font-mono)", fontFeatureSettings: "'tnum' 1" }}>{fmt(stats.totalBronzeRows)}</strong>
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "var(--bp-silver)" }} />
              <span style={{ fontSize: 11, color: "var(--bp-ink-secondary)" }}>
                Silver: <strong style={{ fontFamily: "var(--bp-font-mono)", fontFeatureSettings: "'tnum' 1" }}>{fmt(stats.totalSilverRows)}</strong>
              </span>
            </div>
            {stats.totalBronzeRows !== stats.totalSilverRows && (
              <span style={{ fontSize: 11, color: "var(--bp-caution)", fontWeight: 600, marginLeft: "auto" }}>
                Δ {fmt(Math.abs(stats.totalBronzeRows - stats.totalSilverRows))} row difference
              </span>
            )}
            <div style={{ marginLeft: stats.totalBronzeRows === stats.totalSilverRows ? "auto" : 0 }}>
              <StrataBar
                lz={stats.totalLzRows}
                bronze={stats.totalBronzeRows}
                silver={stats.totalSilverRows}
                mode="count"
                size="lg"
                className="w-32"
              />
            </div>
          </div>

          {/* Search, filters, and group toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ position: "relative", flex: 1, maxWidth: 320 }}>
              <Search style={{
                position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                width: 14, height: 14, color: "var(--bp-ink-muted)",
              }} />
              <input
                type="text"
                aria-label="Search tables, schemas, or sources"
                className="bp-inset"
                style={{
                  width: "100%", paddingLeft: 32, paddingRight: 12, paddingTop: 7, paddingBottom: 7,
                  fontSize: 13, color: "var(--bp-ink-primary)", outline: "none",
                }}
                placeholder="Search tables, schemas, sources..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Filter style={{ width: 14, height: 14, color: "var(--bp-ink-muted)" }} />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                aria-label="Filter by match status"
                className="bp-inset"
                style={{
                  padding: "6px 10px", fontSize: 12,
                  color: "var(--bp-ink-primary)", cursor: "pointer", outline: "none",
                }}
              >
                <option value="all">All ({fmt(rows.length)})</option>
                <option value="match">Matched ({fmt(stats.matched)})</option>
                <option value="mismatch">Mismatched ({fmt(stats.mismatched)})</option>
                <option value="bronze-only">Bronze only ({fmt(stats.bronzeOnly)})</option>
                <option value="silver-only">Silver only ({fmt(stats.silverOnly)})</option>
              </select>
            </div>

            <button
              onClick={() => setGroupBySource(g => !g)}
              className="bp-btn-secondary"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: groupBySource ? "var(--bp-copper-light)" : undefined,
                color: groupBySource ? "var(--bp-copper)" : undefined,
                borderColor: groupBySource ? "var(--bp-copper)" : undefined,
              }}
            >
              <Layers style={{ width: 14, height: 14 }} />
              Group by Source
            </button>

            {activeSource && (
              <button
                onClick={() => setActiveSource(null)}
                className="bp-btn-secondary"
                style={{ fontSize: 11 }}
              >
                Clear filter: {resolveLabel(activeSource)}
                <span style={{ marginLeft: 6, opacity: 0.5 }}>&times;</span>
              </button>
            )}

            <span style={{ fontSize: 10, color: "var(--bp-ink-muted)", marginLeft: "auto" }}>
              {fmt(displayed.length)} of {fmt(rows.length)}
            </span>
          </div>

          {/* ── Data Table ── */}
          <div className="bp-card" style={{ overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>{tableHeaders}</thead>
                <tbody>
                  {displayed.length === 0 ? (
                    <tr>
                      <td colSpan={groupBySource ? 10 : 11} style={{ padding: "48px 12px", textAlign: "center", color: "var(--bp-ink-muted)", fontSize: 13 }}>
                        No tables match your search or filter.
                      </td>
                    </tr>
                  ) : groupedRows ? (
                    // Grouped view
                    groupedRows.map(([source, srcRows]) => {
                      const isCollapsed = collapsedGroups.has(source);
                      const srcMatched = srcRows.filter(r => r.status === "match").length;
                      const srcColor = source !== "Unlinked" ? getColor(source) : { hex: "var(--bp-ink-muted)" };

                      return (
                        <Fragment key={source}>
                          <tr
                            onClick={() => toggleGroup(source)}
                            style={{
                              cursor: "pointer",
                              background: "var(--bp-surface-2)",
                              borderBottom: "1px solid var(--bp-border)",
                            }}
                          >
                            <td colSpan={groupBySource ? 10 : 11} style={{ padding: "8px 12px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                {isCollapsed ? <ChevronRight style={{ width: 14, height: 14, color: "var(--bp-ink-muted)" }} /> : <ChevronDown style={{ width: 14, height: 14, color: "var(--bp-ink-muted)" }} />}
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: srcColor.hex }} />
                                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
                                  {resolveLabel(source)}
                                </span>
                                <span style={{ fontSize: 11, color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)", fontFeatureSettings: "'tnum' 1" }}>
                                  {srcRows.length} tables
                                </span>
                                <span style={{ fontSize: 10, color: "var(--bp-operational)", marginLeft: 8 }}>
                                  {srcMatched}/{srcRows.length} matched
                                </span>
                              </div>
                            </td>
                          </tr>
                          {!isCollapsed && srcRows.map(renderRow)}
                        </Fragment>
                      );
                    })
                  ) : (
                    // Flat view
                    displayed.map(renderRow)
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 4px", fontSize: 10, color: "var(--bp-ink-muted)" }}>
            <span>
              {fmt(stats.total)} tables across {Object.keys(counts).filter(k => k !== "_meta").length} layers
              {countsMeta?.source && <> &middot; Source: {countsMeta.source}</>}
            </span>
            <span style={{ fontFamily: "var(--bp-font-mono)", fontFeatureSettings: "'tnum' 1" }}>
              LZ: {fmt(stats.totalLzRows)} &middot; Bronze: {fmt(stats.totalBronzeRows)} &middot; Silver: {fmt(stats.totalSilverRows)}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

