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
  int:       { icon: Hash, label: "Integer", color: "var(--bp-copper)" },
  bigint:    { icon: Hash, label: "BigInt", color: "var(--bp-copper)" },
  smallint:  { icon: Hash, label: "SmallInt", color: "var(--bp-copper)" },
  tinyint:   { icon: Hash, label: "TinyInt", color: "var(--bp-copper)" },
  decimal:   { icon: Hash, label: "Decimal", color: "var(--bp-copper-hover)" },
  numeric:   { icon: Hash, label: "Numeric", color: "var(--bp-copper-hover)" },
  float:     { icon: Hash, label: "Float", color: "var(--bp-copper-hover)" },
  real:      { icon: Hash, label: "Real", color: "var(--bp-copper-hover)" },
  money:     { icon: Hash, label: "Money", color: "var(--bp-copper-hover)" },
  varchar:   { icon: Type, label: "Varchar", color: "var(--bp-operational)" },
  nvarchar:  { icon: Type, label: "NVarchar", color: "var(--bp-operational)" },
  char:      { icon: Type, label: "Char", color: "var(--bp-operational)" },
  nchar:     { icon: Type, label: "NChar", color: "var(--bp-operational)" },
  text:      { icon: Type, label: "Text", color: "var(--bp-operational)" },
  ntext:     { icon: Type, label: "NText", color: "var(--bp-operational)" },
  string:    { icon: Type, label: "String", color: "var(--bp-operational)" },
  date:      { icon: Calendar, label: "Date", color: "var(--bp-caution)" },
  datetime:  { icon: Calendar, label: "DateTime", color: "var(--bp-caution)" },
  datetime2: { icon: Calendar, label: "DateTime2", color: "var(--bp-caution)" },
  datetimeoffset: { icon: Calendar, label: "DateTimeOffset", color: "var(--bp-caution)" },
  time:      { icon: Calendar, label: "Time", color: "var(--bp-caution)" },
  timestamp: { icon: Calendar, label: "Timestamp", color: "var(--bp-caution)" },
  bit:       { icon: ToggleLeft, label: "Boolean", color: "var(--bp-fault)" },
  boolean:   { icon: ToggleLeft, label: "Boolean", color: "var(--bp-fault)" },
  binary:    { icon: Binary, label: "Binary", color: "var(--bp-ink-muted)" },
  varbinary: { icon: Binary, label: "VarBinary", color: "var(--bp-ink-muted)" },
  image:     { icon: Binary, label: "Image", color: "var(--bp-ink-muted)" },
  uniqueidentifier: { icon: Fingerprint, label: "GUID", color: "var(--bp-silver)" },
};

const LAYER_COLORS: Record<string, string> = {
  bronze: "var(--bp-copper-hover)",
  silver: "var(--bp-silver)",
  gold: "var(--bp-operational)",
  landing: "var(--bp-ink-muted)",
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
  return TYPE_MAP[key] || { icon: Database, label: dataType || "Unknown", color: "var(--bp-ink-secondary)" };
}

function qualityColor(pct: number): string {
  if (pct >= 98) return "var(--bp-operational)";
  if (pct >= 90) return "var(--bp-operational)";
  if (pct >= 80) return "var(--bp-operational)";
  if (pct >= 60) return "var(--bp-caution)";
  if (pct >= 40) return "var(--bp-caution)";
  return "var(--bp-fault)";
}

function nullBg(nullPct: number): string {
  if (nullPct <= 2) return "transparent";
  if (nullPct <= 10) return "rgba(194, 122, 26, 0.04)"; /* --bp-caution @ 4% */
  if (nullPct <= 30) return "rgba(194, 122, 26, 0.08)"; /* --bp-caution @ 8% */
  if (nullPct <= 50) return "rgba(185, 58, 42, 0.06)"; /* --bp-fault @ 6% */
  return "rgba(185, 58, 42, 0.10)"; /* --bp-fault @ 10% */
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
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--bp-border)] bg-[var(--bp-operational-light)]">
        <CheckCircle2 className="w-4 h-4 text-[var(--bp-operational)]" />
        <span className="text-xs text-[var(--bp-operational)] font-medium">All columns look healthy</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {allNull.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--bp-border)] bg-[var(--bp-fault-light)]">
          <XCircle className="w-3.5 h-3.5 text-[var(--bp-fault)]" />
          <span className="text-[11px] text-[var(--bp-fault)] font-medium">
            {allNull.length} column{allNull.length > 1 ? "s" : ""} 100% null
          </span>
        </div>
      )}
      {highNulls.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--bp-border)] bg-[var(--bp-caution-light)]">
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--bp-caution)]" />
          <span className="text-[11px] text-[var(--bp-caution)] font-medium">
            {highNulls.length} column{highNulls.length > 1 ? "s" : ""} &gt;50% nulls
          </span>
        </div>
      )}
      {potentialKeys.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--bp-border)] bg-[var(--bp-copper-light)]">
          <Key className="w-3.5 h-3.5 text-[var(--bp-copper)]" />
          <span className="text-[11px] text-[var(--bp-copper)] font-medium">
            {potentialKeys.length} potential key{potentialKeys.length > 1 ? "s" : ""}
          </span>
        </div>
      )}
      {lowCardinality.length > 0 && (
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[var(--bp-silver)]/30 bg-[var(--bp-silver-light)]/30">
          <Layers3 className="w-3.5 h-3.5 text-[var(--bp-silver)]" />
          <span className="text-[11px] text-[var(--bp-silver)] font-medium">
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
    { icon: Sigma, label: "Row Count", value: fmt(rowCount), hexColor: undefined as string | undefined },
    { icon: Fingerprint, label: "Distinct Values", value: fmt(col.distinctCount), hexColor: undefined as string | undefined },
    {
      icon: Eye,
      label: "Uniqueness",
      value: pctFmt(col.uniqueness || 0),
      hexColor: (col.uniqueness || 0) >= 99.9 ? "var(--bp-copper)" : undefined,
    },
    {
      icon: col.completeness >= 98 ? CheckCircle2 : AlertTriangle,
      label: "Completeness",
      value: pctFmt(col.completeness),
      hexColor: col.completeness >= 98 ? "var(--bp-operational)" : col.completeness >= 80 ? "var(--bp-caution)" : "var(--bp-fault)",
    },
    {
      icon: EyeOff,
      label: "Null Count",
      value: `${fmt(col.nullCount)} (${pctFmt(col.nullPercentage)})`,
      hexColor: col.nullPercentage > 50 ? "var(--bp-fault)" : undefined,
    },
    { icon: Ruler, label: "Max Length", value: col.maxLength ? fmt(col.maxLength) : "\u2014", hexColor: undefined as string | undefined },
  ];

  const typeInfo = getTypeInfo(col.dataType);

  return (
    <tr>
      <td colSpan={8} className="p-0">
        <div className="mx-3 my-2 rounded-lg p-4" style={{ border: "1px solid var(--bp-border-subtle)", backgroundColor: "var(--bp-canvas)" }}>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {stats.map((s) => (
              <div key={s.label} className="flex items-start gap-2">
                <s.icon className="w-3.5 h-3.5 mt-0.5" style={{ color: s.hexColor || "var(--bp-ink-muted)", opacity: s.hexColor ? undefined : 0.5 }} />
                <div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--bp-ink-muted)", opacity: 0.5 }}>{s.label}</div>
                  <div className="text-sm font-medium" style={{ color: s.hexColor || "var(--bp-ink-primary)" }}>{s.value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Type details */}
          <div className="mt-3 pt-3 flex items-center gap-6 text-xs" style={{ borderTop: "1px solid var(--bp-border-subtle)", color: "var(--bp-ink-muted)", opacity: 0.6 }}>
            <span className="flex items-center gap-1.5">
              <typeInfo.icon className="w-3 h-3" style={{ color: typeInfo.color }} />
              {col.dataType}
              {col.maxLength ? `(${col.maxLength})` : ""}
              {col.precision ? `(${col.precision},${col.scale || 0})` : ""}
            </span>
            <span>Nullable: {col.nullable ? "Yes" : "No"}</span>
            <span>Ordinal: {col.ordinal}</span>
            {col.minValue && <span>Min: <code className="font-mono" style={{ color: "var(--bp-ink-primary)", opacity: 0.6 }}>{col.minValue}</code></span>}
            {col.maxValue && <span>Max: <code className="font-mono" style={{ color: "var(--bp-ink-primary)", opacity: 0.6 }}>{col.maxValue}</code></span>}
          </div>

          {/* Visual quality meter */}
          <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--bp-border-subtle)" }}>
            <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: "var(--bp-ink-muted)", opacity: 0.5 }}>Quality Breakdown</div>
            <div className="flex gap-4 items-center">
              <div className="flex-1">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span style={{ color: "var(--bp-ink-muted)", opacity: 0.6 }}>Completeness</span>
                  <span style={{ color: qualityColor(col.completeness) }}>{pctFmt(col.completeness)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bp-canvas)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${col.completeness}%`, backgroundColor: qualityColor(col.completeness) }}
                  />
                </div>
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span style={{ color: "var(--bp-ink-muted)", opacity: 0.6 }}>Uniqueness</span>
                  <span style={{ color: qualityColor(col.uniqueness || 0) }}>{pctFmt(col.uniqueness || 0)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: "var(--bp-canvas)" }}>
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
      <div className="flex items-center justify-center gap-2 py-6 text-xs text-[var(--bp-operational)]">
        <CheckCircle2 className="w-4 h-4" />
        <span>Zero null values across all columns</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>
          Missing Value Density — {hasNulls.length} of {columns.length} columns have nulls
        </h3>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--bp-ink-muted)", opacity: 0.5 }}>
          <span className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm bg-[var(--bp-operational)]" /> Complete
          </span>
          <span className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm bg-[var(--bp-fault)]" /> Missing
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
                  backgroundColor: nullPct >= 80 ? "rgba(185,58,42,0.7)" : nullPct >= 50 ? "rgba(185,58,42,0.5)" : nullPct >= 20 ? "rgba(194,122,26,0.5)" : "rgba(194,122,26,0.3)", /* --bp-fault / --bp-caution with opacity gradients */
                }}
              />
              {/* Complete portion (bottom = filled) */}
              <div
                className="transition-all duration-300"
                style={{
                  height: `${completePct}%`,
                  backgroundColor: completePct >= 98 ? "rgba(61,124,79,0.5)" : completePct >= 80 ? "rgba(61,124,79,0.4)" : "rgba(61,124,79,0.3)", /* --bp-operational with opacity gradients */
                }}
              />
              {/* Hover tooltip via pseudo */}
              <div className="absolute inset-x-0 -bottom-6 hidden group-hover:block z-10">
                <div className="text-[9px] text-center rounded px-1 py-0.5 whitespace-nowrap" style={{ color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border-subtle)" }}>
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
            className="flex-1 min-w-[4px] max-w-[24px] text-[7px] overflow-hidden truncate text-center"
            style={{ color: "var(--bp-ink-muted)", opacity: 0.4 }}
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
      <h3 className="text-xs font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>
        Quality Ranking — Lowest 15 Columns
      </h3>
      <div className="space-y-1">
        {ranked.map((col) => (
          <div key={col.name} className="flex items-center gap-2 group">
            <div className="w-32 text-[10px] font-mono truncate text-right" style={{ color: "var(--bp-ink-muted)", opacity: 0.6 }} title={col.name}>
              {col.name}
            </div>
            <div className="flex-1 h-4 rounded overflow-hidden relative" style={{ backgroundColor: "var(--bp-canvas)" }}>
              <div
                className="h-full rounded transition-all duration-500"
                style={{
                  width: `${(col.score / maxScore) * 100}%`,
                  backgroundColor: qualityColor(col.score),
                }}
              />
              <span className="absolute inset-y-0 left-1 flex items-center text-[9px] font-medium" style={{ color: "var(--bp-ink-primary)", opacity: 0.7 }}>
                {col.score.toFixed(0)}
              </span>
            </div>
            <div className="w-16 text-[10px] flex items-center gap-1" style={{ color: "var(--bp-ink-muted)", opacity: 0.4 }}>
              {col.completeness < 50 && <AlertTriangle className="w-2.5 h-2.5 text-[var(--bp-fault)]" />}
              {col.uniqueness >= 99.9 && <Key className="w-2.5 h-2.5 text-[var(--bp-copper)]" />}
              <span>{pctFmt(col.completeness)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="text-[10px] italic" style={{ color: "var(--bp-ink-muted)", opacity: 0.4 }}>
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
        <Microscope className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--bp-ink-muted)" }} />
        <h1 style={{ fontFamily: "var(--bp-font-display)", fontSize: "32px", color: "var(--bp-ink-primary)", lineHeight: "1.1" }}>Data Profiler</h1>
        <p className="text-sm mt-1" style={{ color: "var(--bp-ink-secondary)" }}>
          Select a source, entity, and layer to profile
        </p>
      </div>

      {digestLoading ? (
        <div className="flex items-center justify-center py-12 gap-3">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--bp-ink-tertiary)" }} />
          <span className="text-sm" style={{ color: "var(--bp-ink-tertiary)" }}>Loading entities...</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Source selector */}
          <div>
            <label className="text-[10px] uppercase tracking-wider font-medium block mb-1.5" style={{ color: "var(--bp-ink-muted)", opacity: 0.6 }}>
              Data Source
            </label>
            <select
              value={selectedSource}
              onChange={(e) => {
                setSelectedSource(e.target.value);
                setSelectedEntity(null);
              }}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none"
              style={{ border: "1px solid var(--bp-border-subtle)", backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }}
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
            <label className="text-[10px] uppercase tracking-wider font-medium block mb-1.5" style={{ color: "var(--bp-ink-muted)", opacity: 0.6 }}>
              Table
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--bp-ink-muted)", opacity: 0.4 }} />
              <input
                type="text"
                value={entitySearch}
                onChange={(e) => setEntitySearch(e.target.value)}
                placeholder="Search tables..."
                className="w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none"
                style={{ border: "1px solid var(--bp-border-subtle)", backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }}
              />
            </div>
            <div className="rounded-lg max-h-60 overflow-y-auto" style={{ border: "1px solid var(--bp-border-subtle)" }}>
              {filteredEntities.length === 0 ? (
                <div className="py-6 text-center text-xs" style={{ color: "var(--bp-ink-muted)", opacity: 0.4 }}>
                  No tables match
                </div>
              ) : (
                filteredEntities.slice(0, 100).map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setSelectedEntity(e)}
                    className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors last:border-b-0"
                    style={{
                      borderBottom: "1px solid rgba(0,0,0,0.02)",
                      backgroundColor: selectedEntity?.id === e.id ? "var(--bp-canvas)" : undefined,
                    }}
                  >
                    <div>
                      <span className="text-xs font-mono" style={{ color: "var(--bp-ink-primary)" }}>{e.tableName}</span>
                      <span className="text-[10px] ml-2" style={{ color: "var(--bp-ink-muted)", opacity: 0.5 }}>{e.sourceSchema}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {e.lzStatus === "loaded" && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--bp-surface-inset)] text-[var(--bp-ink-muted)]">LZ</span>
                      )}
                      {e.bronzeStatus === "loaded" && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--bp-copper-light)]/30 text-[var(--bp-copper-hover)]">BZ</span>
                      )}
                      {e.silverStatus === "loaded" && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--bp-silver-light)]/30 text-[var(--bp-silver)]">SV</span>
                      )}
                    </div>
                  </button>
                ))
              )}
              {filteredEntities.length > 100 && (
                <div className="py-2 text-center text-[10px]" style={{ color: "var(--bp-ink-muted)", opacity: 0.4 }}>
                  Showing 100 of {filteredEntities.length} — refine search
                </div>
              )}
            </div>
          </div>

          {/* Layer selector */}
          {selectedEntity && (
            <div>
              <label className="text-[10px] uppercase tracking-wider font-medium block mb-1.5" style={{ color: "var(--bp-ink-muted)", opacity: 0.6 }}>
                Layer
              </label>
              <div className="flex gap-2">
                {([
                  { key: "bronze", label: "Bronze", color: "var(--bp-copper-hover)", loaded: selectedEntity.bronzeStatus === "loaded" },
                  { key: "silver", label: "Silver", color: "var(--bp-silver)", loaded: selectedEntity.silverStatus === "loaded" },
                ] as const).map((l) => (
                  <button
                    key={l.key}
                    onClick={() => setSelectedLayer(l.key)}
                    className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium transition-all"
                    style={
                      selectedLayer === l.key
                        ? { borderColor: l.color, color: l.color, backgroundColor: `${l.color}10`, border: `2px solid ${l.color}` }
                        : { border: "1px solid var(--bp-border-subtle)", color: "var(--bp-ink-tertiary)" }
                    }
                  >
                    {l.label}
                    {!l.loaded && (
                      <span className="text-[10px] ml-1" style={{ color: "var(--bp-ink-muted)", opacity: 0.5 }}>(not loaded)</span>
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
      className={`px-3 py-2 font-medium cursor-pointer transition-colors select-none ${className || ""}`}
      style={{ color: "var(--bp-ink-tertiary)" }}
      onClick={() => handleSort(sortId)}
    >
      <span className="flex items-center gap-1">
        {label}
        {sortKey === sortId && (
          sortAsc ? <SortAsc className="w-3 h-3" style={{ color: "var(--bp-ink-primary)", opacity: 0.5 }} /> : <SortDesc className="w-3 h-3" style={{ color: "var(--bp-ink-primary)", opacity: 0.5 }} />
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
            className="p-1.5 rounded-md transition-colors"
            style={{ border: "1px solid var(--bp-border-subtle)", color: "var(--bp-ink-tertiary)" }}
            title="Change table"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <Table2 className="w-5 h-5" style={{ color: layerColor }} />
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: "32px", color: "var(--bp-ink-primary)", lineHeight: "1.1" }}>
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
            <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: "var(--bp-ink-muted)", opacity: 0.6 }}>
              <Database className="w-3 h-3" />
              {paramLakehouse}
            </p>
          </div>
        </div>

        {/* View mode tabs */}
        <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ backgroundColor: "var(--bp-canvas)", border: "1px solid var(--bp-border-subtle)" }}>
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
              style={
                viewMode === tab.key
                  ? { backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-primary)", border: "1px solid var(--bp-border-subtle)" }
                  : { color: "var(--bp-ink-muted)", opacity: 0.6 }
              }
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
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--bp-ink-tertiary)" }} />
          <span className="text-sm" style={{ color: "var(--bp-ink-tertiary)" }}>Profiling {paramSchema}.{paramTable}...</span>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="rounded-lg border border-[var(--bp-border-subtle)] bg-[var(--bp-caution-light)] px-4 py-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[var(--bp-caution)] flex-shrink-0" />
          <span className="text-sm text-[var(--bp-caution)]">{error}</span>
        </div>
      )}

      {/* Profile data */}
      {profile && !loading && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Rows", value: fmt(profile.rowCount), color: layerColor },
              { label: "Columns", value: `${profile.columnCount}`, color: "var(--bp-ink-secondary)" },
              { label: "Profiled", value: `${profile.profiledColumns}`, color: "var(--bp-ink-secondary)" },
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
                color: "var(--bp-copper)",
              },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-lg px-3 py-2"
                style={{ border: "1px solid var(--bp-border-subtle)", backgroundColor: "var(--bp-surface-1)" }}
              >
                <div className="text-[10px] uppercase tracking-wider" style={{ color: "var(--bp-ink-muted)", opacity: 0.5 }}>
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--bp-ink-muted)", opacity: 0.4 }} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter columns..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg text-sm focus:outline-none"
                  style={{ border: "1px solid var(--bp-border-subtle)", backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }}
                />
              </div>

              {/* Profile table */}
              <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border-subtle)" }}>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr style={{ backgroundColor: "var(--bp-canvas)", borderBottom: "1px solid var(--bp-border-subtle)" }}>
                        <th className="w-8 px-2 py-2" />
                        <SortHeader label="Column" sortId="name" className="text-left" />
                        <SortHeader label="Type" sortId="type" className="text-left" />
                        <SortHeader label="Completeness" sortId="completeness" className="text-left" />
                        <SortHeader label="Uniqueness" sortId="uniqueness" className="text-left" />
                        <SortHeader label="Nulls" sortId="nulls" className="text-right" />
                        <SortHeader label="Distinct" sortId="distinct" className="text-right" />
                        <th className="text-left px-3 py-2 font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>Range</th>
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
                              className="cursor-pointer transition-colors"
                              style={{ borderBottom: "1px solid rgba(0,0,0,0.02)" }}
                              style={{ backgroundColor: nullBg(col.nullPercentage) }}
                              onClick={() => setExpandedCol(isExpanded ? null : col.name)}
                            >
                              {/* Expand chevron */}
                              <td className="px-2 py-2" style={{ color: "var(--bp-ink-muted)", opacity: 0.3 }}>
                                {isExpanded ? (
                                  <ChevronDown className="w-3 h-3" />
                                ) : (
                                  <ChevronRight className="w-3 h-3" />
                                )}
                              </td>

                              {/* Column name */}
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono" style={{ color: "var(--bp-ink-primary)" }}>{col.name}</span>
                                  {(col.uniqueness || 0) >= 99.9 && profile.rowCount > 0 && (
                                    <span title="Potential primary key"><Key className="w-3 h-3 text-[var(--bp-copper)]" /></span>
                                  )}
                                  {col.nullPercentage >= 100 && (
                                    <span title="100% null"><XCircle className="w-3 h-3 text-[var(--bp-fault)]" /></span>
                                  )}
                                </div>
                              </td>

                              {/* Type with icon */}
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-1.5">
                                  <TypeIcon className="w-3 h-3 flex-shrink-0" style={{ color: typeInfo.color }} />
                                  <span style={{ color: "var(--bp-ink-tertiary)" }} title={typeInfo.label}>
                                    {col.dataType}
                                    {col.maxLength ? `(${col.maxLength})` : ""}
                                  </span>
                                </div>
                              </td>

                              {/* Completeness bar */}
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <div className="w-24 h-[6px] rounded-full overflow-hidden relative" style={{ backgroundColor: "var(--bp-canvas)" }}>
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
                                  <div className="w-20 h-[6px] rounded-full overflow-hidden" style={{ backgroundColor: "var(--bp-canvas)" }}>
                                    <div
                                      className="h-full rounded-full transition-all duration-500"
                                      style={{
                                        width: `${Math.min(col.uniqueness || 0, 100)}%`,
                                        backgroundColor:
                                          (col.uniqueness || 0) >= 99.9
                                            ? "var(--bp-copper)"
                                            : (col.uniqueness || 0) >= 50
                                            ? "var(--bp-ink-secondary)"
                                            : "var(--bp-ink-muted)",
                                      }}
                                    />
                                  </div>
                                  <span className="text-[10px] min-w-[36px]" style={{ color: "var(--bp-ink-muted)", opacity: 0.6 }}>
                                    {pctFmt(col.uniqueness || 0)}
                                  </span>
                                </div>
                              </td>

                              {/* Null count */}
                              <td className="px-3 py-2 text-right">
                                <span
                                  style={{ color: col.nullPercentage >= 50 ? "var(--bp-fault)" : col.nullPercentage > 10 ? "var(--bp-caution)" : "var(--bp-ink-muted)", opacity: col.nullPercentage > 10 ? undefined : 0.6 }}
                                >
                                  {fmt(col.nullCount)}
                                </span>
                              </td>

                              {/* Distinct count */}
                              <td className="px-3 py-2 text-right" style={{ color: "var(--bp-ink-muted)", opacity: 0.6 }}>
                                {fmt(col.distinctCount)}
                              </td>

                              {/* Range (min-max) */}
                              <td className="px-3 py-2">
                                {col.minValue || col.maxValue ? (
                                  <div className="font-mono text-[10px] max-w-[140px]" style={{ color: "var(--bp-ink-muted)", opacity: 0.5 }}>
                                    <span className="truncate block" title={col.minValue || ""}>
                                      {col.minValue || "\u2014"}
                                    </span>
                                    <span style={{ color: "var(--bp-ink-muted)", opacity: 0.3 }}>\u2192</span>{" "}
                                    <span className="truncate block" title={col.maxValue || ""}>
                                      {col.maxValue || "\u2014"}
                                    </span>
                                  </div>
                                ) : (
                                  <span style={{ color: "var(--bp-ink-muted)", opacity: 0.3 }}>\u2014</span>
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

              <div className="text-[10px] text-right" style={{ color: "var(--bp-ink-muted)", opacity: 0.3 }}>
                Showing {filteredColumns.length} of {profile.columns.length} columns
                {search && ` (filtered by "${search}")`}
              </div>
            </>
          )}

          {/* View: Missing Value Matrix */}
          {viewMode === "matrix" && (
            <div className="rounded-lg p-5" style={{ border: "1px solid var(--bp-border-subtle)", backgroundColor: "var(--bp-surface-1)" }}>
              <MissingValueMatrix columns={profile.columns} />
            </div>
          )}

          {/* View: Quality Ranking */}
          {viewMode === "ranking" && (
            <div className="rounded-lg p-5" style={{ border: "1px solid var(--bp-border-subtle)", backgroundColor: "var(--bp-surface-1)" }}>
              <QualityRankingChart columns={profile.columns} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
