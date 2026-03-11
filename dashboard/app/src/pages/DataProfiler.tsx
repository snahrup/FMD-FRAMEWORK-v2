import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import {
  Search,
  Loader2,
  Hash,
  Type,
  Calendar,
  ToggleLeft,
  Binary,
  AlertTriangle,
  Key,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  BarChart3,
  Eye,
  EyeOff,
  SortAsc,
  SortDesc,
  Info,
  CheckCircle2,
  XCircle,
  Fingerprint,
  Ruler,
  Sigma,
  Database,
  Table2,
  Layers3,
  Microscope,
  type LucideIcon,
} from "lucide-react";

// ============================================================================
// CONSTANTS
// ============================================================================

const API = "/api";

const TYPE_MAP: Record<string, { icon: LucideIcon; label: string; color: string }> = {
  int:       { icon: Hash, label: "Integer", color: "#3b82f6" },
  bigint:    { icon: Hash, label: "BigInt", color: "#3b82f6" },
  smallint:  { icon: Hash, label: "SmallInt", color: "#3b82f6" },
  tinyint:   { icon: Hash, label: "TinyInt", color: "#3b82f6" },
  decimal:   { icon: Hash, label: "Decimal", color: "#6366f1" },
  numeric:   { icon: Hash, label: "Numeric", color: "#6366f1" },
  float:     { icon: Hash, label: "Float", color: "#6366f1" },
  real:      { icon: Hash, label: "Real", color: "#6366f1" },
  money:     { icon: Hash, label: "Money", color: "#6366f1" },
  varchar:   { icon: Type, label: "Varchar", color: "#10b981" },
  nvarchar:  { icon: Type, label: "NVarchar", color: "#10b981" },
  char:      { icon: Type, label: "Char", color: "#10b981" },
  nchar:     { icon: Type, label: "NChar", color: "#10b981" },
  text:      { icon: Type, label: "Text", color: "#10b981" },
  ntext:     { icon: Type, label: "NText", color: "#10b981" },
  string:    { icon: Type, label: "String", color: "#10b981" },
  date:      { icon: Calendar, label: "Date", color: "#f59e0b" },
  datetime:  { icon: Calendar, label: "DateTime", color: "#f59e0b" },
  datetime2: { icon: Calendar, label: "DateTime2", color: "#f59e0b" },
  datetimeoffset: { icon: Calendar, label: "DateTimeOffset", color: "#f59e0b" },
  time:      { icon: Calendar, label: "Time", color: "#f59e0b" },
  timestamp: { icon: Calendar, label: "Timestamp", color: "#f59e0b" },
  bit:       { icon: ToggleLeft, label: "Boolean", color: "#ec4899" },
  boolean:   { icon: ToggleLeft, label: "Boolean", color: "#ec4899" },
  binary:    { icon: Binary, label: "Binary", color: "#64748b" },
  varbinary: { icon: Binary, label: "VarBinary", color: "#64748b" },
  image:     { icon: Binary, label: "Image", color: "#64748b" },
  uniqueidentifier: { icon: Fingerprint, label: "GUID", color: "#8b5cf6" },
};

const LAYER_COLORS: Record<string, string> = {
  bronze: "#f59e0b",
  silver: "#8b5cf6",
  gold: "#10b981",
  landing: "#3b82f6",
};

// ============================================================================
// TYPES
// ============================================================================

interface ProfileColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  maxLength: number | null;
  precision: number | null;
  scale: number | null;
  ordinal: number;
  distinctCount: number;
  nullCount: number;
  nullPercentage: number;
  minValue: string | null;
  maxValue: string | null;
  uniqueness: number;
  completeness: number;
}

interface ProfileData {
  lakehouse: string;
  schema: string;
  table: string;
  rowCount: number;
  columnCount: number;
  profiledColumns: number;
  columns: ProfileColumn[];
}

// ============================================================================
// HELPERS
// ============================================================================

function getTypeInfo(dataType: string) {
  const key = (dataType || "").toLowerCase().replace(/\(.*\)/, "").trim();
  return TYPE_MAP[key] || { icon: Database, label: dataType || "Unknown", color: "#64748b" };
}

function qualityColor(pct: number): string {
  if (pct >= 98) return "#10b981";
  if (pct >= 90) return "#22c55e";
  if (pct >= 80) return "#84cc16";
  if (pct >= 60) return "#f59e0b";
  if (pct >= 40) return "#f97316";
  return "#ef4444";
}

function nullBg(nullPct: number): string {
  if (nullPct <= 2) return "transparent";
  if (nullPct <= 10) return "rgba(245, 158, 11, 0.04)";
  if (nullPct <= 30) return "rgba(245, 158, 11, 0.08)";
  if (nullPct <= 50) return "rgba(239, 68, 68, 0.06)";
  return "rgba(239, 68, 68, 0.10)";
}

function fmt(n: number | null | undefined): string {
  if (n == null) return "\u2014";
  return n.toLocaleString("en-US");
}

function pctFmt(n: number): string {
  if (n >= 99.5) return "100%";
  if (n <= 0.5 && n > 0) return "<1%";
  return `${n.toFixed(1)}%`;
}

function qualityScore(col: ProfileColumn): number {
  return ((col.completeness ?? 0) * 0.6) + (Math.min(col.uniqueness || 0, 100) * 0.4);
}

type SortKey = "name" | "type" | "completeness" | "uniqueness" | "nulls" | "distinct" | "quality";

// ============================================================================
// ALERT BADGES
// ============================================================================

function AlertBadges({ columns, rowCount }: { columns: ProfileColumn[]; rowCount: number }) {
  const highNulls = columns.filter((c) => c.nullPercentage > 50);
  const potentialKeys = columns.filter((c) => c.uniqueness >= 99.9 && rowCount > 0);
  const allNull = columns.filter((c) => c.nullPercentage >= 100);
  const lowCardinality = columns.filter(
    (c) => c.distinctCount <= 5 && c.distinctCount > 0 && rowCount > 100
  );

  if (!highNulls.length && !potentialKeys.length && !allNull.length && !lowCardinality.length) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        <span className="text-xs text-emerald-400 font-medium">All columns look healthy</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {allNull.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-red-500/30 bg-red-500/10">
          <XCircle className="w-3.5 h-3.5 text-red-400" />
          <span className="text-[11px] text-red-400 font-medium">
            {allNull.length} column{allNull.length > 1 ? "s" : ""} 100% null
          </span>
        </div>
      )}
      {highNulls.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-amber-500/30 bg-amber-500/10">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-[11px] text-amber-400 font-medium">
            {highNulls.length} column{highNulls.length > 1 ? "s" : ""} &gt;50% nulls
          </span>
        </div>
      )}
      {potentialKeys.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-blue-500/30 bg-blue-500/10">
          <Key className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-[11px] text-blue-400 font-medium">
            {potentialKeys.length} potential key{potentialKeys.length > 1 ? "s" : ""}
          </span>
        </div>
      )}
      {lowCardinality.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-violet-500/30 bg-violet-500/10">
          <Layers3 className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-[11px] text-violet-400 font-medium">
            {lowCardinality.length} low-cardinality column{lowCardinality.length > 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COLUMN DETAIL PANEL (Phase 2 — expandable row)
// ============================================================================

function ColumnDetailPanel({ col, rowCount }: { col: ProfileColumn; rowCount: number }) {
  const stats = [
    { icon: Sigma, label: "Row Count", value: fmt(rowCount) },
    { icon: Fingerprint, label: "Distinct Values", value: fmt(col.distinctCount) },
    {
      icon: Eye,
      label: "Uniqueness",
      value: pctFmt(col.uniqueness || 0),
      color: (col.uniqueness || 0) >= 99.9 ? "text-blue-400" : undefined,
    },
    {
      icon: col.completeness >= 98 ? CheckCircle2 : AlertTriangle,
      label: "Completeness",
      value: pctFmt(col.completeness),
      color: col.completeness >= 98 ? "text-emerald-400" : col.completeness >= 80 ? "text-amber-400" : "text-red-400",
    },
    {
      icon: EyeOff,
      label: "Null Count",
      value: `${fmt(col.nullCount)} (${pctFmt(col.nullPercentage)})`,
      color: col.nullPercentage > 50 ? "text-red-400" : undefined,
    },
    { icon: Ruler, label: "Max Length", value: col.maxLength ? fmt(col.maxLength) : "\u2014" },
  ];

  const typeInfo = getTypeInfo(col.dataType);

  return (
    <tr>
      <td colSpan={8} className="p-0">
        <div className="mx-3 my-2 rounded-lg border border-border/30 bg-muted p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {stats.map((s) => (
              <div key={s.label} className="flex items-start gap-2">
                <s.icon className={`w-3.5 h-3.5 mt-0.5 ${s.color || "text-muted-foreground/50"}`} />
                <div>
                  <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">{s.label}</div>
                  <div className={`text-sm font-medium ${s.color || "text-foreground"}`}>{s.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Type details */}
          <div className="mt-3 pt-3 border-t border-border/20 flex items-center gap-6 text-xs text-muted-foreground/60">
            <span className="flex items-center gap-1.5">
              <typeInfo.icon className="w-3 h-3" style={{ color: typeInfo.color }} />
              {col.dataType}
              {col.maxLength ? `(${col.maxLength})` : ""}
              {col.precision ? `(${col.precision},${col.scale || 0})` : ""}
            </span>
            <span>Nullable: {col.nullable ? "Yes" : "No"}</span>
            <span>Ordinal: {col.ordinal}</span>
            {col.minValue && <span>Min: <code className="font-mono text-foreground/60">{col.minValue}</code></span>}
            {col.maxValue && <span>Max: <code className="font-mono text-foreground/60">{col.maxValue}</code></span>}
          </div>

          {/* Visual quality meter */}
          <div className="mt-3 pt-3 border-t border-border/20">
            <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mb-1.5">Quality Breakdown</div>
            <div className="flex gap-4 items-center">
              <div className="flex-1">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-muted-foreground/60">Completeness</span>
                  <span style={{ color: qualityColor(col.completeness) }}>{pctFmt(col.completeness)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${col.completeness}%`, backgroundColor: qualityColor(col.completeness) }}
                  />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-muted-foreground/60">Uniqueness</span>
                  <span style={{ color: qualityColor(col.uniqueness || 0) }}>{pctFmt(col.uniqueness || 0)}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(col.uniqueness || 0, 100)}%`,
                      backgroundColor: qualityColor(col.uniqueness || 0),
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ============================================================================
// MISSING VALUE MATRIX (Phase 3)
// ============================================================================

function MissingValueMatrix({ columns }: { columns: ProfileColumn[] }) {
  // Sort columns by null percentage descending for the matrix
  const sorted = [...columns].sort((a, b) => b.nullPercentage - a.nullPercentage);
  const hasNulls = sorted.filter((c) => c.nullPercentage > 0);

  if (hasNulls.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-emerald-400/60">
        <CheckCircle2 className="w-4 h-4" />
        <span>Zero null values across all columns</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground">
          Missing Value Density — {hasNulls.length} of {columns.length} columns have nulls
        </h3>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
          <span className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm bg-emerald-500/60" /> Complete
          </span>
          <span className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm bg-red-500/60" /> Missing
          </span>
        </div>
      </div>

      <div className="flex gap-[2px] items-end" style={{ height: 120 }}>
        {sorted.map((col) => {
          const nullPct = col.nullPercentage;
          const completePct = 100 - nullPct;
          return (
            <div
              key={col.name}
              className="flex-1 min-w-[4px] max-w-[24px] flex flex-col rounded-sm overflow-hidden group relative cursor-pointer"
              style={{ height: "100%" }}
              title={`${col.name}: ${pctFmt(completePct)} complete, ${pctFmt(nullPct)} null`}
            >
              {/* Null portion (top = missing) */}
              <div
                className="transition-all duration-300"
                style={{
                  height: `${nullPct}%`,
                  backgroundColor: nullPct >= 80 ? "rgba(239,68,68,0.7)" : nullPct >= 50 ? "rgba(239,68,68,0.5)" : nullPct >= 20 ? "rgba(245,158,11,0.5)" : "rgba(245,158,11,0.3)",
                }}
              />
              {/* Complete portion (bottom = filled) */}
              <div
                className="transition-all duration-300"
                style={{
                  height: `${completePct}%`,
                  backgroundColor: completePct >= 98 ? "rgba(16,185,129,0.5)" : completePct >= 80 ? "rgba(34,197,94,0.4)" : "rgba(132,204,22,0.3)",
                }}
              />
              {/* Hover tooltip via pseudo */}
              <div className="absolute inset-x-0 -bottom-6 hidden group-hover:block z-10">
                <div className="text-[9px] text-center text-foreground bg-card border border-border/30 rounded px-1 py-0.5 shadow-lg whitespace-nowrap">
                  {col.name.length > 12 ? col.name.slice(0, 10) + "\u2026" : col.name}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Column labels for first few */}
      <div className="flex gap-[2px]">
        {sorted.slice(0, Math.min(sorted.length, 20)).map((col) => (
          <div
            key={col.name}
            className="flex-1 min-w-[4px] max-w-[24px] text-[7px] text-muted-foreground/40 overflow-hidden truncate text-center"
            style={{ writingMode: "vertical-rl", height: 50, transform: "rotate(180deg)" }}
          >
            {col.name}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// QUALITY RANKING CHART (Phase 3)
// ============================================================================

function QualityRankingChart({ columns }: { columns: ProfileColumn[] }) {
  const ranked = [...columns]
    .map((c) => ({ ...c, score: qualityScore(c) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 15); // Show worst 15

  if (ranked.length === 0) return null;

  const maxScore = 100;

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-muted-foreground">
        Quality Ranking — Lowest 15 Columns
      </h3>
      <div className="space-y-1">
        {ranked.map((col) => (
          <div key={col.name} className="flex items-center gap-2 group">
            <div className="w-32 text-[10px] font-mono text-muted-foreground/60 truncate text-right" title={col.name}>
              {col.name}
            </div>
            <div className="flex-1 h-4 rounded bg-muted overflow-hidden relative">
              <div
                className="h-full rounded transition-all duration-500"
                style={{
                  width: `${(col.score / maxScore) * 100}%`,
                  backgroundColor: qualityColor(col.score),
                }}
              />
              <span className="absolute inset-y-0 left-1 flex items-center text-[9px] font-medium text-foreground/70">
                {col.score.toFixed(0)}
              </span>
            </div>
            <div className="w-16 text-[10px] text-muted-foreground/40 flex items-center gap-1">
              {col.completeness < 50 && <AlertTriangle className="w-2.5 h-2.5 text-red-400" />}
              {col.uniqueness >= 99.9 && <Key className="w-2.5 h-2.5 text-blue-400" />}
              <span>{pctFmt(col.completeness)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-muted-foreground/40 italic">
        Score = 60% completeness + 40% uniqueness
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

// ============================================================================
// LAKEHOUSE MAP — maps layer to lakehouse name
// ============================================================================

const LAYER_LAKEHOUSE: Record<string, string> = {
  landing: "LH_DATA_LANDINGZONE",
  bronze: "LH_BRONZE_LAYER",
  silver: "LH_SILVER_LAYER",
};

// ============================================================================
// ENTITY PICKER — standalone table selection
// ============================================================================

function EntityPicker({
  onSelect,
}: {
  onSelect: (lakehouse: string, schema: string, table: string, layer: string) => void;
}) {
  const { allEntities, sourceList, loading: digestLoading } = useEntityDigest();

  const [selectedSource, setSelectedSource] = useState<string>("");
  const [selectedEntity, setSelectedEntity] = useState<DigestEntity | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<"bronze" | "silver">("bronze");
  const [entitySearch, setEntitySearch] = useState("");

  const sourceEntities = useMemo(() => {
    if (!selectedSource) return allEntities;
    return allEntities.filter((e) => e.source === selectedSource);
  }, [allEntities, selectedSource]);

  const filteredEntities = useMemo(() => {
    if (!entitySearch.trim()) return sourceEntities;
    const q = entitySearch.toLowerCase();
    return sourceEntities.filter(
      (e) => e.tableName.toLowerCase().includes(q) || e.sourceSchema.toLowerCase().includes(q)
    );
  }, [sourceEntities, entitySearch]);

  const handleProfile = () => {
    if (!selectedEntity) return;
    const lakehouse = LAYER_LAKEHOUSE[selectedLayer] || LAYER_LAKEHOUSE.bronze;
    onSelect(lakehouse, selectedEntity.source || selectedEntity.sourceSchema, selectedEntity.tableName, selectedLayer);
  };

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto space-y-6">
      <div className="text-center">
        <Microscope className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
        <h1 className="text-xl font-semibold text-foreground">Data Profiler</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select a source, entity, and layer to profile
        </p>
      </div>

      {digestLoading ? (
        <div className="flex items-center justify-center py-12 gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Loading entities...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Source selector */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium block mb-1.5">
              Data Source
            </label>
            <select
              value={selectedSource}
              onChange={(e) => {
                setSelectedSource(e.target.value);
                setSelectedEntity(null);
              }}
              className="w-full px-3 py-2 rounded-lg border border-border/50 bg-card text-sm text-foreground outline-none focus:border-ring/50"
            >
              <option value="">All Sources ({allEntities.length} entities)</option>
              {sourceList.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name} ({s.summary.total} entities)
                </option>
              ))}
            </select>
          </div>

          {/* Entity search + list */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium block mb-1.5">
              Table
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
              <input
                type="text"
                value={entitySearch}
                onChange={(e) => setEntitySearch(e.target.value)}
                placeholder="Search tables..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border/50 bg-card text-sm text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-ring/50"
              />
            </div>
            <div className="rounded-lg border border-border/30 max-h-60 overflow-y-auto">
              {filteredEntities.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground/40">
                  No tables match
                </div>
              ) : (
                filteredEntities.slice(0, 100).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedEntity(e)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/50 transition-colors border-b border-border/10 last:border-b-0 ${
                      selectedEntity?.id === e.id ? "bg-muted" : ""
                    }`}
                  >
                    <div>
                      <span className="text-xs font-mono text-foreground">{e.tableName}</span>
                      <span className="text-[10px] text-muted-foreground/50 ml-2">{e.sourceSchema}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {e.lzStatus === "loaded" && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">LZ</span>
                      )}
                      {e.bronzeStatus === "loaded" && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/10 text-amber-400">BZ</span>
                      )}
                      {e.silverStatus === "loaded" && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-violet-500/10 text-violet-400">SV</span>
                      )}
                    </div>
                  </button>
                ))
              )}
              {filteredEntities.length > 100 && (
                <div className="py-2 text-center text-[10px] text-muted-foreground/40">
                  Showing 100 of {filteredEntities.length} — refine search
                </div>
              )}
            </div>
          </div>

          {/* Layer selector */}
          {selectedEntity && (
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium block mb-1.5">
                Layer
              </label>
              <div className="flex gap-2">
                {([
                  { key: "bronze", label: "Bronze", color: "#f59e0b", loaded: selectedEntity.bronzeStatus === "loaded" },
                  { key: "silver", label: "Silver", color: "#8b5cf6", loaded: selectedEntity.silverStatus === "loaded" },
                ] as const).map((l) => (
                  <button
                    key={l.key}
                    onClick={() => setSelectedLayer(l.key)}
                    className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                      selectedLayer === l.key
                        ? "border-2 shadow-sm"
                        : "border-border/30 text-muted-foreground hover:border-border"
                    }`}
                    style={
                      selectedLayer === l.key
                        ? { borderColor: l.color, color: l.color, backgroundColor: `${l.color}10` }
                        : undefined
                    }
                  >
                    {l.label}
                    {!l.loaded && (
                      <span className="text-[10px] text-muted-foreground/50 ml-1">(not loaded)</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Profile button */}
          {selectedEntity && (
            <button
              onClick={handleProfile}
              className="w-full py-2.5 rounded-lg font-medium text-sm transition-all"
              style={{
                backgroundColor: LAYER_COLORS[selectedLayer],
                color: "white",
              }}
            >
              Profile {selectedEntity.tableName} ({selectedLayer})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function DataProfiler() {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramLakehouse = searchParams.get("lakehouse") || "";
  const paramSchema = searchParams.get("schema") || "";
  const paramTable = searchParams.get("table") || "";
  const paramLayer = searchParams.get("layer") || "bronze";

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expandedCol, setExpandedCol] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("quality");
  const [sortAsc, setSortAsc] = useState(true);
  const [viewMode, setViewMode] = useState<"table" | "matrix" | "ranking">("table");

  const hasSelection = !!(paramLakehouse && paramSchema && paramTable);
  const layerColor = LAYER_COLORS[paramLayer] || LAYER_COLORS.bronze;

  const loadProfile = useCallback(async () => {
    if (!paramLakehouse || !paramSchema || !paramTable) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/blender/profile?lakehouse=${encodeURIComponent(paramLakehouse)}&schema=${encodeURIComponent(paramSchema)}&table=${encodeURIComponent(paramTable)}`
      );
      if (!res.ok) throw new Error(`API ${res.status}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.columns && data.columns.length > 0) {
        // Ensure completeness/uniqueness are always numbers (backend omits them when rowCount=0)
        const cols = data.columns.map((c: ProfileColumn) => ({
          ...c,
          completeness: c.completeness ?? 0,
          uniqueness: c.uniqueness ?? 0,
          nullPercentage: c.nullPercentage ?? 0,
          nullCount: c.nullCount ?? 0,
          distinctCount: c.distinctCount ?? 0,
        }));
        setProfile({ ...data, columns: cols } as ProfileData);
      } else {
        setError("No column data available. Table may not have been loaded yet.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to profile table.");
    } finally {
      setLoading(false);
    }
  }, [paramLakehouse, paramSchema, paramTable]);

  useEffect(() => {
    if (hasSelection) loadProfile();
  }, [loadProfile, hasSelection]);

  // Handle picker selection → update URL params
  const handleEntitySelect = useCallback(
    (lakehouse: string, schema: string, table: string, layer: string) => {
      setProfile(null);
      setSearch("");
      setExpandedCol(null);
      setSearchParams({ lakehouse, schema, table, layer });
    },
    [setSearchParams]
  );

  // Filtering + sorting
  const filteredColumns = useMemo(() => {
    if (!profile) return [];
    let cols = profile.columns;

    if (search.trim()) {
      const q = search.toLowerCase();
      cols = cols.filter(
        (c) => c.name.toLowerCase().includes(q) || c.dataType.toLowerCase().includes(q)
      );
    }

    cols = [...cols].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "type":
          cmp = a.dataType.localeCompare(b.dataType);
          break;
        case "completeness":
          cmp = a.completeness - b.completeness;
          break;
        case "uniqueness":
          cmp = (a.uniqueness || 0) - (b.uniqueness || 0);
          break;
        case "nulls":
          cmp = a.nullCount - b.nullCount;
          break;
        case "distinct":
          cmp = a.distinctCount - b.distinctCount;
          break;
        case "quality":
          cmp = qualityScore(a) - qualityScore(b);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return cols;
  }, [profile, search, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "name" || key === "type");
    }
  }

  const SortHeader = ({ label, sortId, className }: { label: string; sortId: SortKey; className?: string }) => (
    <th
      className={`px-3 py-2 font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none ${className || ""}`}
      onClick={() => handleSort(sortId)}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortKey === sortId && (
          sortAsc ? <SortAsc className="w-3 h-3 text-foreground/50" /> : <SortDesc className="w-3 h-3 text-foreground/50" />
        )}
      </span>
    </th>
  );

  // ==================== RENDER ====================

  // No table selected → show entity picker
  if (!hasSelection) {
    return <EntityPicker onSelect={handleEntitySelect} />;
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSearchParams({})}
            className="p-1.5 rounded-md border border-border/30 text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            title="Change table"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <Table2 className="w-5 h-5" style={{ color: layerColor }} />
              <h1 className="text-lg font-semibold text-foreground">
                {paramSchema}.{paramTable}
              </h1>
              <span
                className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                style={{
                  color: layerColor,
                  backgroundColor: `${layerColor}15`,
                  border: `1px solid ${layerColor}30`,
                }}
              >
                {paramLayer}
              </span>
            </div>
            <p className="text-xs text-muted-foreground/60 mt-0.5 flex items-center gap-1.5">
              <Database className="w-3 h-3" />
              {paramLakehouse}
            </p>
          </div>
        </div>

        {/* View mode tabs */}
        <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted border border-border/30">
          {(
            [
              { key: "table", label: "Table", icon: Table2 },
              { key: "matrix", label: "Missing Matrix", icon: BarChart3 },
              { key: "ranking", label: "Quality Rank", icon: SortAsc },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setViewMode(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                viewMode === tab.key
                  ? "bg-card text-foreground shadow-sm border border-border/30"
                  : "text-muted-foreground/60 hover:text-muted-foreground"
              }`}
            >
              <tab.icon className="w-3 h-3" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20 gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Profiling {paramSchema}.{paramTable}...</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="text-sm text-amber-400">{error}</span>
        </div>
      )}

      {/* Profile data */}
      {profile && !loading && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Rows", value: fmt(profile.rowCount), color: layerColor },
              { label: "Columns", value: `${profile.columnCount}`, color: "#64748b" },
              { label: "Profiled", value: `${profile.profiledColumns}`, color: "#64748b" },
              {
                label: "Avg Completeness",
                value: pctFmt(
                  profile.columns.length > 0
                    ? profile.columns.reduce((s, c) => s + c.completeness, 0) / profile.columns.length
                    : 0
                ),
                color: qualityColor(
                  profile.columns.length > 0
                    ? profile.columns.reduce((s, c) => s + c.completeness, 0) / profile.columns.length
                    : 0
                ),
              },
              {
                label: "Avg Uniqueness",
                value: pctFmt(
                  profile.columns.length > 0
                    ? profile.columns.reduce((s, c) => s + (c.uniqueness || 0), 0) / profile.columns.length
                    : 0
                ),
                color: "#6366f1",
              },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-lg border border-border/20 bg-card px-3 py-2"
              >
                <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
                  {kpi.label}
                </div>
                <div className="text-xl font-semibold mt-0.5" style={{ color: kpi.color }}>
                  {kpi.value}
                </div>
              </div>
            ))}
          </div>

          {/* Alert badges */}
          <AlertBadges columns={profile.columns} rowCount={profile.rowCount} />

          {/* View: Table */}
          {viewMode === "table" && (
            <>
              {/* Search bar */}
              <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter columns..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-border/30 bg-card text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-ring/30"
                />
              </div>

              {/* Profile table */}
              <div className="rounded-lg border border-border/30 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted border-b border-border/30">
                        <th className="w-8 px-2 py-2" />
                        <SortHeader label="Column" sortId="name" className="text-left" />
                        <SortHeader label="Type" sortId="type" className="text-left" />
                        <SortHeader label="Completeness" sortId="completeness" className="text-left" />
                        <SortHeader label="Uniqueness" sortId="uniqueness" className="text-left" />
                        <SortHeader label="Nulls" sortId="nulls" className="text-right" />
                        <SortHeader label="Distinct" sortId="distinct" className="text-right" />
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredColumns.map((col) => {
                        const typeInfo = getTypeInfo(col.dataType);
                        const isExpanded = expandedCol === col.name;
                        const TypeIcon = typeInfo.icon;

                        return (
                          <Fragment key={col.name}>
                            <tr
                              className="border-b border-border/10 hover:bg-muted/50 cursor-pointer transition-colors"
                              style={{ backgroundColor: nullBg(col.nullPercentage) }}
                              onClick={() => setExpandedCol(isExpanded ? null : col.name)}
                            >
                              {/* Expand chevron */}
                              <td className="px-2 py-2 text-muted-foreground/30">
                                {isExpanded ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                              </td>

                              {/* Column name */}
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-foreground">{col.name}</span>
                                  {(col.uniqueness || 0) >= 99.9 && profile.rowCount > 0 && (
                                    <span title="Potential primary key"><Key className="w-3 h-3 text-blue-400" /></span>
                                  )}
                                  {col.nullPercentage >= 100 && (
                                    <span title="100% null"><XCircle className="w-3 h-3 text-red-400" /></span>
                                  )}
                                </div>
                              </td>

                              {/* Type with icon */}
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <TypeIcon className="w-3 h-3 flex-shrink-0" style={{ color: typeInfo.color }} />
                                  <span className="text-muted-foreground" title={typeInfo.label}>
                                    {col.dataType}
                                    {col.maxLength ? `(${col.maxLength})` : ""}
                                  </span>
                                </div>
                              </td>

                              {/* Completeness bar */}
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-[6px] rounded-full bg-muted overflow-hidden relative">
                                    <div
                                      className="h-full rounded-full transition-all duration-500"
                                      style={{
                                        width: `${col.completeness}%`,
                                        backgroundColor: qualityColor(col.completeness),
                                      }}
                                    />
                                  </div>
                                  <span
                                    className="text-[10px] font-medium min-w-[36px]"
                                    style={{ color: qualityColor(col.completeness) }}
                                  >
                                    {pctFmt(col.completeness)}
                                  </span>
                                </div>
                              </td>

                              {/* Uniqueness / Cardinality bar */}
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-20 h-[6px] rounded-full bg-muted overflow-hidden">
                                    <div
                                      className="h-full rounded-full transition-all duration-500"
                                      style={{
                                        width: `${Math.min(col.uniqueness || 0, 100)}%`,
                                        backgroundColor:
                                          (col.uniqueness || 0) >= 99.9
                                            ? "#3b82f6"
                                            : (col.uniqueness || 0) >= 50
                                            ? "#8b5cf6"
                                            : "#64748b",
                                      }}
                                    />
                                  </div>
                                  <span className="text-[10px] text-muted-foreground/60 min-w-[36px]">
                                    {pctFmt(col.uniqueness || 0)}
                                  </span>
                                </div>
                              </td>

                              {/* Null count */}
                              <td className="px-3 py-2 text-right">
                                <span
                                  className={`${
                                    col.nullPercentage >= 50
                                      ? "text-red-400"
                                      : col.nullPercentage > 10
                                      ? "text-amber-400/80"
                                      : "text-muted-foreground/60"
                                  }`}
                                >
                                  {fmt(col.nullCount)}
                                </span>
                              </td>

                              {/* Distinct count */}
                              <td className="px-3 py-2 text-right text-muted-foreground/60">
                                {fmt(col.distinctCount)}
                              </td>

                              {/* Range (min-max) */}
                              <td className="px-3 py-2">
                                {col.minValue || col.maxValue ? (
                                  <div className="font-mono text-[10px] text-muted-foreground/50 max-w-[140px]">
                                    <span className="truncate block" title={col.minValue || ""}>
                                      {col.minValue || "\u2014"}
                                    </span>
                                    <span className="text-muted-foreground/30">\u2192</span>{" "}
                                    <span className="truncate block" title={col.maxValue || ""}>
                                      {col.maxValue || "\u2014"}
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground/30">\u2014</span>
                                )}
                              </td>
                            </tr>

                            {/* Expandable detail panel */}
                            {isExpanded && (
                              <ColumnDetailPanel
                                key={`${col.name}_detail`}
                                col={col}
                                rowCount={profile.rowCount}
                              />
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="text-[10px] text-muted-foreground/30 text-right">
                Showing {filteredColumns.length} of {profile.columns.length} columns
                {search && ` (filtered by "${search}")`}
              </div>
            </>
          )}

          {/* View: Missing Value Matrix */}
          {viewMode === "matrix" && (
            <div className="rounded-lg border border-border/30 bg-card p-5">
              <MissingValueMatrix columns={profile.columns} />
            </div>
          )}

          {/* View: Quality Ranking */}
          {viewMode === "ranking" && (
            <div className="rounded-lg border border-border/30 bg-card p-5">
              <QualityRankingChart columns={profile.columns} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
