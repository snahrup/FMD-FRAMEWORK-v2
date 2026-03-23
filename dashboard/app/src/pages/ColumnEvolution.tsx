import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Loader2,
  Database,
  HardDrive,
  Table2,
  Sparkles,
  Crown,
  Columns3,
  ChevronDown,
  XCircle,
  Play,
  Pause,
  Check,
  Plus,
  Minus,
  ArrowRightLeft,
  RefreshCw,
  Hash,
  Calendar,
  ToggleLeft,
  Binary,
  Type,
  CircleDot,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// CONSTANTS
// ============================================================================

const API = import.meta.env.VITE_API_URL || "";

const LAYERS = [
  { key: "source",  label: "Source",       color: "#78716C", icon: Database },
  { key: "landing", label: "Landing Zone", color: "#B45624", icon: HardDrive },
  { key: "bronze",  label: "Bronze",       color: "#C27A1A", icon: Table2 },
  { key: "silver",  label: "Silver",       color: "#3D7C4F", icon: Sparkles },
  { key: "gold",    label: "Gold",         color: "#57534E", icon: Crown },
];

const SYSTEM_COLUMNS = new Set([
  "HashedPKColumn", "HashedNonKeyColumns", "RecordLoadDate",
  "IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "IsDeleted", "Action",
]);

const BRONZE_SYSTEM_COLUMNS = new Set(["HashedPKColumn", "HashedNonKeyColumns", "RecordLoadDate"]);
const SILVER_SYSTEM_COLUMNS = new Set(["IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "IsDeleted", "Action"]);

/** Maps SQL data types to an icon + color for visual distinction in column cards */
/** BP-palette type icons: copper for strings, operational for numerics, caution for dates, ink for rest */
const TYPE_ICON_MAP: Record<string, { icon: React.ElementType; colorHex: string; bgHex: string }> = {
  // String types — copper
  string:    { icon: Type,       colorHex: "#B45624", bgHex: "#F4E8DF" },
  varchar:   { icon: Type,       colorHex: "#B45624", bgHex: "#F4E8DF" },
  nvarchar:  { icon: Type,       colorHex: "#B45624", bgHex: "#F4E8DF" },
  char:      { icon: Type,       colorHex: "#B45624", bgHex: "#F4E8DF" },
  nchar:     { icon: Type,       colorHex: "#B45624", bgHex: "#F4E8DF" },
  text:      { icon: Type,       colorHex: "#B45624", bgHex: "#F4E8DF" },
  ntext:     { icon: Type,       colorHex: "#B45624", bgHex: "#F4E8DF" },
  // Numeric types — operational
  int:       { icon: Hash,       colorHex: "#3D7C4F", bgHex: "#E7F3EB" },
  bigint:    { icon: Hash,       colorHex: "#3D7C4F", bgHex: "#E7F3EB" },
  smallint:  { icon: Hash,       colorHex: "#3D7C4F", bgHex: "#E7F3EB" },
  tinyint:   { icon: Hash,       colorHex: "#3D7C4F", bgHex: "#E7F3EB" },
  long:      { icon: Hash,       colorHex: "#3D7C4F", bgHex: "#E7F3EB" },
  short:     { icon: Hash,       colorHex: "#3D7C4F", bgHex: "#E7F3EB" },
  // DateTime types — caution
  datetime:  { icon: Calendar,   colorHex: "#C27A1A", bgHex: "#FDF3E3" },
  datetime2: { icon: Calendar,   colorHex: "#C27A1A", bgHex: "#FDF3E3" },
  date:      { icon: Calendar,   colorHex: "#C27A1A", bgHex: "#FDF3E3" },
  time:      { icon: Calendar,   colorHex: "#C27A1A", bgHex: "#FDF3E3" },
  timestamp: { icon: Calendar,   colorHex: "#C27A1A", bgHex: "#FDF3E3" },
  // Decimal / float types — copper-hover (darker)
  decimal:   { icon: CircleDot,  colorHex: "#9A4A1F", bgHex: "#F4E8DF" },
  numeric:   { icon: CircleDot,  colorHex: "#9A4A1F", bgHex: "#F4E8DF" },
  float:     { icon: CircleDot,  colorHex: "#9A4A1F", bgHex: "#F4E8DF" },
  double:    { icon: CircleDot,  colorHex: "#9A4A1F", bgHex: "#F4E8DF" },
  real:      { icon: CircleDot,  colorHex: "#9A4A1F", bgHex: "#F4E8DF" },
  money:     { icon: CircleDot,  colorHex: "#9A4A1F", bgHex: "#F4E8DF" },
  smallmoney:{ icon: CircleDot,  colorHex: "#9A4A1F", bgHex: "#F4E8DF" },
  // Boolean — fault
  bit:       { icon: ToggleLeft,  colorHex: "#B93A2A", bgHex: "#FBEAE8" },
  boolean:   { icon: ToggleLeft,  colorHex: "#B93A2A", bgHex: "#FBEAE8" },
  // Binary — ink-muted
  binary:    { icon: Binary,     colorHex: "#A8A29E", bgHex: "#EDEAE4" },
  varbinary: { icon: Binary,     colorHex: "#A8A29E", bgHex: "#EDEAE4" },
  image:     { icon: Binary,     colorHex: "#A8A29E", bgHex: "#EDEAE4" },
};

function getTypeStyle(dataType: string) {
  const key = (dataType || "").toLowerCase().replace(/\(.*\)/, "").trim();
  return TYPE_ICON_MAP[key] || { icon: Type, colorHex: "#A8A29E", bgHex: "#EDEAE4" };
}

// ============================================================================
// TYPES
// ============================================================================

interface ColumnInfo {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: string;
  CHARACTER_MAXIMUM_LENGTH: string | number | null;
  NUMERIC_PRECISION: string | number | null;
  NUMERIC_SCALE?: string | number | null;
  ORDINAL_POSITION: string | number;
}

interface SchemaDiffEntry {
  columnName?: string;
  column?: string;
  inBronze?: boolean;
  inSilver?: boolean;
  bronzeType: string | null;
  silverType: string | null;
  bronzeNullable: string | null;
  silverNullable: string | null;
  status: "unchanged" | "match" | "type_changed" | "added_in_silver" | "bronze_only";
}

interface JourneyData {
  entityId: number;
  error?: string;
  source: {
    schema: string;
    name: string;
    dataSourceName: string;
    dataSourceType?: string;
    namespace?: string;
    connectionName: string;
    connectionType?: string;
  };
  landing: {
    entityId: number;
    fileName: string;
    filePath: string;
    fileType: string;
    lakehouse: string;
    isIncremental: boolean;
    incrementalColumn: string | null;
    customSelect?: string | null;
    customNotebook?: string | null;
  };
  bronze: {
    entityId: number;
    schema: string;
    name: string;
    primaryKeys: string | null;
    fileType: string;
    lakehouse: string;
    rowCount: number | null;
    columns: ColumnInfo[];
    columnCount: number;
  } | null;
  silver: {
    entityId: number;
    schema: string;
    name: string;
    fileType: string;
    lakehouse: string;
    rowCount: number | null;
    columns: ColumnInfo[];
    columnCount: number;
  } | null;
  gold: null;
  schemaDiff: SchemaDiffEntry[];
}

/** Normalized column for display at any layer */
interface DisplayColumn {
  name: string;
  dataType: string;
  nullable: boolean;
  isSystem: boolean;
  /** What kind of diff badge to show relative to previous layer */
  diffStatus: "none" | "new" | "removed" | "type_changed" | "system";
  /** If type_changed, the old type from the previous layer */
  previousType?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function getMaxLayerIndex(data: JourneyData): number {
  if (data.silver) return 3;
  if (data.bronze) return 2;
  return 1; // landing always exists
}

function diffName(d: SchemaDiffEntry): string {
  return d.columnName || d.column || "";
}

/**
 * Build the column list for a given layer step.
 * For Source/LZ we show Bronze columns minus system columns.
 * For Bronze we show bronze.columns directly.
 * For Silver we show silver.columns with diff annotations.
 */
function buildDisplayColumns(
  data: JourneyData,
  layerIndex: number,
): DisplayColumn[] {
  const bronzeCols = data.bronze?.columns || [];
  const silverCols = data.silver?.columns || [];

  if (layerIndex <= 1) {
    // Source / Landing Zone: Bronze columns minus system columns (approximate source schema)
    return bronzeCols
      .filter((c) => !SYSTEM_COLUMNS.has(c.COLUMN_NAME))
      .map((c) => ({
        name: c.COLUMN_NAME,
        dataType: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === "YES",
        isSystem: false,
        diffStatus: "none" as const,
      }));
  }

  if (layerIndex === 2) {
    // Bronze: show all bronze columns, mark system columns
    const sourceColNames = new Set(
      bronzeCols
        .filter((c) => !SYSTEM_COLUMNS.has(c.COLUMN_NAME))
        .map((c) => c.COLUMN_NAME),
    );
    return bronzeCols.map((c) => {
      const isSys = BRONZE_SYSTEM_COLUMNS.has(c.COLUMN_NAME);
      return {
        name: c.COLUMN_NAME,
        dataType: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === "YES",
        isSystem: isSys,
        diffStatus: isSys ? ("system" as const) : sourceColNames.has(c.COLUMN_NAME) ? ("none" as const) : ("new" as const),
      };
    });
  }

  if (layerIndex === 3) {
    // Silver: annotate columns based on schemaDiff
    const diffMap = new Map<string, SchemaDiffEntry>();
    data.schemaDiff.forEach((d) => diffMap.set(diffName(d), d));

    const result: DisplayColumn[] = [];

    // First: columns that exist in Silver
    silverCols.forEach((c) => {
      const diff = diffMap.get(c.COLUMN_NAME);
      const isSilverSys = SILVER_SYSTEM_COLUMNS.has(c.COLUMN_NAME);
      const isBronzeSys = BRONZE_SYSTEM_COLUMNS.has(c.COLUMN_NAME);

      let diffStatus: DisplayColumn["diffStatus"] = "none";
      let previousType: string | undefined;

      if (isSilverSys) {
        diffStatus = "system";
      } else if (isBronzeSys) {
        diffStatus = "none"; // carried over from bronze
      } else if (diff) {
        const st = diff.status;
        if (st === "added_in_silver") diffStatus = "new";
        else if (st === "type_changed") {
          diffStatus = "type_changed";
          previousType = diff.bronzeType || undefined;
        }
      }

      result.push({
        name: c.COLUMN_NAME,
        dataType: c.DATA_TYPE,
        nullable: c.IS_NULLABLE === "YES",
        isSystem: isSilverSys || isBronzeSys,
        diffStatus,
        previousType,
      });
    });

    // Then: columns that were in Bronze but dropped (bronze_only)
    data.schemaDiff
      .filter((d) => d.status === "bronze_only")
      .forEach((d) => {
        const name = diffName(d);
        if (!result.find((r) => r.name === name)) {
          result.push({
            name,
            dataType: d.bronzeType || "unknown",
            nullable: d.bronzeNullable === "YES",
            isSystem: false,
            diffStatus: "removed",
          });
        }
      });

    return result;
  }

  // Gold: empty
  return [];
}

/** Compute transition summary stats between previous layer and current */
function computeDiffSummary(
  prevColumns: DisplayColumn[],
  currColumns: DisplayColumn[],
): { added: number; removed: number; typeChanged: number } {
  const prevNames = new Set(prevColumns.map((c) => c.name));
  const currNames = new Set(currColumns.map((c) => c.name));

  let added = 0;
  let removed = 0;
  let typeChanged = 0;

  currColumns.forEach((c) => {
    if (c.diffStatus === "new" || c.diffStatus === "system") added++;
    if (c.diffStatus === "type_changed") typeChanged++;
  });

  prevNames.forEach((name) => {
    if (!currNames.has(name)) removed++;
  });

  // Also count explicitly removed columns in current list
  currColumns.forEach((c) => {
    if (c.diffStatus === "removed") removed++;
  });

  return { added, removed, typeChanged };
}

// ============================================================================
// ANIMATION VARIANTS
// ============================================================================

const CARD_EASE = [0.25, 0.1, 0.25, 1] as const;

const cardVariants = {
  initial: { opacity: 0, scale: 0.85, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.85, y: -16 },
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Horizontal layer stepper bar */
function LayerStepper({
  activeIndex,
  maxIndex,
  onSelect,
  autoPlaying,
  onToggleAutoPlay,
}: {
  activeIndex: number;
  maxIndex: number;
  onSelect: (idx: number) => void;
  autoPlaying: boolean;
  onToggleAutoPlay: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {/* Auto-play toggle */}
      <button
        onClick={onToggleAutoPlay}
        aria-label={autoPlaying ? "Pause auto-play" : "Start auto-play through layers"}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all cursor-pointer"
        style={autoPlaying
          ? { background: 'var(--bp-copper-light)', border: '1px solid var(--bp-copper)', color: 'var(--bp-copper)' }
          : { background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)', color: 'var(--bp-ink-tertiary)' }
        }
      >
        {autoPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        {autoPlaying ? "Pause" : "Auto"}
      </button>

      {/* Steps */}
      <div className="flex items-center gap-1 flex-1">
        {LAYERS.map((layer, i) => {
          const Icon = layer.icon;
          const isActive = i === activeIndex;
          const isCompleted = i < activeIndex;
          const isReachable = i <= maxIndex;
          const isDisabled = i > maxIndex;

          return (
            <div key={layer.key} className="flex items-center flex-1">
              <button
                onClick={() => !isDisabled && onSelect(i)}
                disabled={isDisabled}
                aria-label={`View ${layer.label} layer`}
                aria-current={isActive ? "step" : undefined}
                className="flex items-center gap-2 px-3 py-2 rounded-md transition-all w-full cursor-pointer"
                style={{
                  background: isActive ? `${layer.color}12` : 'var(--bp-surface-1)',
                  border: isActive ? `1px solid ${layer.color}` : '1px solid var(--bp-border-subtle)',
                  color: isActive ? layer.color : isDisabled ? 'var(--bp-ink-muted)' : 'var(--bp-ink-secondary)',
                  opacity: isDisabled ? 0.3 : 1,
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                  style={{
                    border: isActive ? `1px solid ${layer.color}` : isCompleted ? '1px solid var(--bp-operational)' : '1px solid var(--bp-border)',
                    background: isCompleted ? 'var(--bp-operational-light)' : 'transparent',
                  }}
                >
                  {isCompleted ? (
                    <Check className="w-3.5 h-3.5" style={{ color: 'var(--bp-operational)' }} />
                  ) : (
                    <Icon className="w-3.5 h-3.5" style={{ opacity: isActive ? 1 : isDisabled ? 0.3 : 0.6 }} />
                  )}
                </div>
                <span className="text-[11px] font-medium truncate hidden sm:block">{layer.label}</span>
              </button>

              {/* Connector line between steps */}
              {i < LAYERS.length - 1 && (
                <div
                  className="w-4 h-[2px] flex-shrink-0 mx-0.5"
                  style={{
                    background: i < activeIndex
                      ? LAYERS[i + 1].color
                      : "var(--bp-border-subtle)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Summary bar showing diff stats */
function DiffSummaryBar({
  added,
  removed,
  typeChanged,
  layerLabel,
}: {
  added: number;
  removed: number;
  typeChanged: number;
  layerLabel: string;
}) {
  const hasChanges = added > 0 || removed > 0 || typeChanged > 0;

  if (!hasChanges) {
    return (
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-md text-xs" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)', color: 'var(--bp-ink-muted)' }}>
        <Info className="w-3.5 h-3.5" />
        No column changes at {layerLabel}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-md" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
      {added > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--bp-operational)' }}>
          <Plus className="w-3.5 h-3.5" />
          <span>{added} added</span>
        </div>
      )}
      {removed > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--bp-fault)' }}>
          <Minus className="w-3.5 h-3.5" />
          <span>{removed} removed</span>
        </div>
      )}
      {typeChanged > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--bp-caution)' }}>
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>{typeChanged} type changed</span>
        </div>
      )}
      <span className="text-[10px] ml-auto" style={{ color: 'var(--bp-ink-muted)' }}>vs previous layer</span>
    </div>
  );
}

/** Individual column card with animation and diff badge */
function ColumnCard({ col }: { col: DisplayColumn }) {
  const typeStyle = getTypeStyle(col.dataType);
  const TypeIcon = typeStyle.icon;

  // Border for diff status using BP tokens
  let borderColor = "var(--bp-border)";
  if (col.diffStatus === "new") {
    borderColor = "var(--bp-operational)";
  } else if (col.diffStatus === "removed") {
    borderColor = "var(--bp-fault)";
  } else if (col.diffStatus === "type_changed") {
    borderColor = "var(--bp-caution)";
  } else if (col.diffStatus === "system") {
    borderColor = "var(--bp-copper)";
  }

  return (
    <motion.div
      key={col.name}
      layoutId={col.name}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.35, ease: CARD_EASE as unknown as [number, number, number, number] }}
      className={cn(
        "rounded-md p-3 transition-colors",
        col.diffStatus === "removed" && "opacity-50",
      )}
      style={{ border: `1px solid ${borderColor}`, background: 'var(--bp-surface-1)' }}
    >
      {/* Column name */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span
          className={cn(
            "text-sm font-medium truncate",
            col.diffStatus === "removed" && "line-through",
          )}
          style={{
            fontFamily: 'var(--bp-font-mono)',
            color: col.diffStatus === "removed" ? 'var(--bp-fault)' : 'var(--bp-ink-primary)',
          }}
          title={col.name}
        >
          {col.name}
        </span>

        {/* Nullable badge */}
        {col.nullable && col.diffStatus !== "removed" && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded flex-shrink-0" style={{ color: 'var(--bp-ink-muted)', background: 'var(--bp-surface-inset)' }}>
            NULL
          </span>
        )}
      </div>

      {/* Data type with icon */}
      <div className="flex items-center gap-1.5 mb-2">
        <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ background: typeStyle.bgHex }}>
          <TypeIcon className="w-3 h-3" style={{ color: typeStyle.colorHex }} />
        </div>
        <span className="text-xs" style={{ fontFamily: 'var(--bp-font-mono)', color: typeStyle.colorHex }}>{col.dataType}</span>
      </div>

      {/* Diff status badge */}
      {col.diffStatus === "new" && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'var(--bp-operational-light)', color: 'var(--bp-operational)', border: '1px solid var(--bp-operational)' }}>
          <Plus className="w-2.5 h-2.5" />
          NEW
        </span>
      )}
      {col.diffStatus === "removed" && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'var(--bp-fault-light)', color: 'var(--bp-fault)', border: '1px solid var(--bp-fault)' }}>
          <Minus className="w-2.5 h-2.5" />
          REMOVED
        </span>
      )}
      {col.diffStatus === "type_changed" && (
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'var(--bp-caution-light)', color: 'var(--bp-caution)', border: '1px solid var(--bp-caution)' }}>
            <ArrowRightLeft className="w-2.5 h-2.5" />
            TYPE CHANGED
          </span>
          {col.previousType && (
            <div className="text-[10px]" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-muted)' }}>
              {col.previousType} <span style={{ color: 'var(--bp-caution)' }}>-&gt;</span> {col.dataType}
            </div>
          )}
        </div>
      )}
      {col.diffStatus === "system" && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'var(--bp-copper-light)', color: 'var(--bp-copper)', border: '1px solid var(--bp-copper)' }}>
          <Sparkles className="w-2.5 h-2.5" />
          SYSTEM
        </span>
      )}
    </motion.div>
  );
}

// ============================================================================
// ENTITY SELECTOR (inline, matches DataJourney pattern)
// ============================================================================

function EntitySelector({
  entities,
  selectedId,
  onSelect,
  loading: listLoading,
}: {
  entities: DigestEntity[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return entities;
    const q = query.toLowerCase();
    return entities.filter(
      (e) =>
        e.tableName.toLowerCase().includes(q) ||
        e.sourceSchema.toLowerCase().includes(q) ||
        e.source.toLowerCase().includes(q),
    );
  }, [entities, query]);

  const grouped = useMemo(() => {
    const groups: Record<string, DigestEntity[]> = {};
    filtered.forEach((e) => {
      const key = e.source || "Unknown";
      (groups[key] ||= []).push(e);
    });
    return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
  }, [filtered]);

  const selected = entities.find((e) => String(e.id) === selectedId);

  return (
    <div ref={ref} className="relative max-w-xl">
      <div
        className="flex items-center rounded-lg transition-colors cursor-pointer"
        style={{
          border: open ? '1px solid var(--bp-copper)' : '1px solid var(--bp-border)',
          background: open ? 'var(--bp-surface-2)' : 'var(--bp-surface-1)',
        }}
        onClick={() => !open && setOpen(true)}
      >
        <Search className="w-4 h-4 ml-3 flex-shrink-0" style={{ color: 'var(--bp-ink-muted)' }} />
        {open ? (
          <input
            type="text"
            autoFocus
            aria-label="Filter entities by name, schema, or source"
            placeholder={listLoading ? "Loading entities..." : `Filter ${entities.length} entities...`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2.5 bg-transparent text-sm outline-none"
            style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}
          />
        ) : (
          <div className="w-full px-3 py-2.5 text-sm">
            {selected ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ background: 'var(--bp-copper-light)', color: 'var(--bp-copper)', border: '1px solid var(--bp-copper)' }}>
                  {selected.source}
                </span>
                <span style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-primary)' }}>{selected.tableName}</span>
              </div>
            ) : (
              <span style={{ color: 'var(--bp-ink-muted)' }}>Select an entity...</span>
            )}
          </div>
        )}
        {selectedId && !open && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect("");
            }}
            aria-label="Clear entity selection"
            className="mr-2"
            style={{ color: 'var(--bp-ink-muted)' }}
          >
            <XCircle className="w-4 h-4" />
          </button>
        )}
        <ChevronDown className={cn("w-4 h-4 mr-3 flex-shrink-0 transition-transform", open && "rotate-180")} style={{ color: 'var(--bp-ink-muted)' }} />
      </div>

      {open && !listLoading && (
        <div className="absolute z-[200] mt-1 w-full max-h-[60vh] overflow-y-auto rounded-lg shadow-2xl" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
          {Object.entries(grouped).map(([source, items]) => (
            <div key={source}>
              <div className="sticky top-0 px-3 py-2 backdrop-blur-sm flex items-center justify-between" style={{ background: 'var(--bp-surface-inset)', borderBottom: '1px solid var(--bp-border-subtle)' }}>
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--bp-copper)' }}>{source}</span>
                <span className="text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>{items.length}</span>
              </div>
              {items.map((e) => {
                const idStr = String(e.id);
                return (
                  <button
                    key={idStr}
                    onClick={() => {
                      onSelect(idStr);
                      setOpen(false);
                      setQuery("");
                    }}
                    className="w-full text-left px-3 py-2 transition-colors flex items-center justify-between gap-2"
                    style={{
                      background: selectedId === idStr ? 'var(--bp-copper-light)' : 'transparent',
                      borderLeft: selectedId === idStr ? '2px solid var(--bp-copper)' : '2px solid transparent',
                    }}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-sm truncate" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-primary)' }}>{e.tableName}</span>
                      {e.sourceSchema !== "dbo" && (
                        <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--bp-ink-muted)' }}>{e.sourceSchema}</span>
                      )}
                    </div>
                    <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--bp-ink-muted)' }}>#{idStr}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {Object.keys(grouped).length === 0 && (
            <div className="px-3 py-6 text-center text-sm" style={{ color: 'var(--bp-ink-muted)' }}>
              No entities match "{query}"
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function ColumnEvolution() {
  const [searchParams, setSearchParams] = useSearchParams();
  const entityIdParam = searchParams.get("entity");

  const { allEntities: entities, loading: listLoading } = useEntityDigest();

  const [journey, setJourney] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLayer, setActiveLayer] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasLoadedOnce = useRef(false);

  // ── Fetch journey data ──

  const loadJourney = useCallback(async (id: number) => {
    if (isNaN(id) || id <= 0) return;
    if (!hasLoadedOnce.current) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/journey?entity=${id}`);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data: JourneyData = await res.json();
      if (data.error) {
        setError(data.error);
        setJourney(null);
      } else {
        setJourney(data);
        hasLoadedOnce.current = true;
        setActiveLayer(0); // reset to Source
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load journey");
      setJourney(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Entity selection via URL param ──

  useEffect(() => {
    if (entityIdParam) {
      loadJourney(parseInt(entityIdParam, 10));
    }
  }, [entityIdParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEntitySelect = useCallback(
    (id: string) => {
      if (!id) {
        setSearchParams({}, { replace: true });
        setJourney(null);
        setActiveLayer(0);
        setAutoPlay(false);
        hasLoadedOnce.current = false;
        return;
      }
      hasLoadedOnce.current = false;
      setSearchParams({ entity: id }, { replace: true });
      loadJourney(parseInt(id, 10));
    },
    [setSearchParams, loadJourney],
  );

  // ── Auto-play timer ──

  const maxLayerIdx = journey ? getMaxLayerIndex(journey) : 0;

  useEffect(() => {
    if (autoPlayRef.current) {
      clearInterval(autoPlayRef.current);
      autoPlayRef.current = null;
    }
    if (autoPlay && journey) {
      autoPlayRef.current = setInterval(() => {
        setActiveLayer((prev) => {
          const next = prev + 1;
          if (next > maxLayerIdx) {
            // Loop back to start
            return 0;
          }
          return next;
        });
      }, 2000);
    }
    return () => {
      if (autoPlayRef.current) clearInterval(autoPlayRef.current);
    };
  }, [autoPlay, journey, maxLayerIdx]);

  const toggleAutoPlay = useCallback(() => {
    setAutoPlay((prev) => !prev);
  }, []);

  // ── Build display data for active layer ──

  const currentColumns = useMemo(() => {
    if (!journey) return [];
    return buildDisplayColumns(journey, activeLayer);
  }, [journey, activeLayer]);

  const previousColumns = useMemo(() => {
    if (!journey || activeLayer === 0) return [];
    return buildDisplayColumns(journey, activeLayer - 1);
  }, [journey, activeLayer]);

  const diffSummary = useMemo(() => {
    if (activeLayer === 0) return { added: 0, removed: 0, typeChanged: 0 };
    return computeDiffSummary(previousColumns, currentColumns);
  }, [previousColumns, currentColumns, activeLayer]);

  // ── Determine if Source/LZ has any columns to show ──

  const hasColumnData = journey?.bronze?.columns && journey.bronze.columns.length > 0;
  const isSourceOrLanding = activeLayer <= 1;
  const isGold = activeLayer === 4;

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bp-canvas)' }}>
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-6 py-4" style={{ zIndex: 100, position: "relative", borderBottom: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Columns3 className="w-5 h-5" style={{ color: 'var(--bp-copper)' }} />
            <h1 style={{ fontFamily: 'var(--bp-font-display)', fontSize: 32, color: 'var(--bp-ink-primary)', fontWeight: 400 }}>Column Evolution</h1>
            {journey && (
              <span className="text-sm" style={{ color: 'var(--bp-ink-secondary)' }}>
                — {journey.source.namespace || journey.source.dataSourceName}: {journey.source.name}
              </span>
            )}
          </div>
          {journey && (
            <button
              onClick={() => loadJourney(journey.entityId)}
              aria-label="Refresh column schema data"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer"
              style={{ border: '1px solid var(--bp-border)', color: 'var(--bp-ink-tertiary)' }}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
              Refresh
            </button>
          )}
        </div>

        <EntitySelector
          entities={entities}
          selectedId={entityIdParam}
          onSelect={handleEntitySelect}
          loading={listLoading}
        />
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center h-64 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--bp-copper)' }} />
            <span className="text-sm" style={{ color: 'var(--bp-ink-secondary)' }}>Loading column schema...</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <XCircle className="w-8 h-8" style={{ color: 'var(--bp-fault)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--bp-fault)' }}>Failed to load column schema</span>
            <span className="text-xs max-w-md text-center" style={{ color: 'var(--bp-ink-muted)' }}>{error}</span>
            {entityIdParam && (
              <button
                onClick={() => loadJourney(parseInt(entityIdParam, 10))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer mt-1"
                style={{ border: '1px solid var(--bp-border)', color: 'var(--bp-ink-tertiary)' }}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            )}
          </div>
        )}

        {/* No entity selected */}
        {!loading && !error && !journey && (
          <div className="flex flex-col items-center justify-center h-64 gap-3" style={{ color: 'var(--bp-ink-muted)' }}>
            <Columns3 className="w-10 h-10" />
            <p className="text-sm">Select an entity to explore its column evolution</p>
            <p className="text-xs">Watch columns animate as they transform through Source, Bronze, Silver, and Gold</p>
          </div>
        )}

        {/* Main content with journey loaded */}
        {journey && !loading && (
          <div className="p-6 space-y-5 max-w-7xl mx-auto">
            {/* Layer Stepper */}
            <div className="rounded-lg p-4" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
              <LayerStepper
                activeIndex={activeLayer}
                maxIndex={maxLayerIdx}
                onSelect={(idx) => {
                  setActiveLayer(idx);
                  setAutoPlay(false);
                }}
                autoPlaying={autoPlay}
                onToggleAutoPlay={toggleAutoPlay}
              />
            </div>

            {/* Diff summary bar (not shown at Source or Gold) */}
            {activeLayer > 0 && activeLayer <= 3 && (
              <DiffSummaryBar
                added={diffSummary.added}
                removed={diffSummary.removed}
                typeChanged={diffSummary.typeChanged}
                layerLabel={LAYERS[activeLayer].label}
              />
            )}

            {/* Note for Source/LZ layers */}
            {isSourceOrLanding && hasColumnData && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-md" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-2)' }}>
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--bp-ink-tertiary)' }} />
                <p className="text-xs" style={{ color: 'var(--bp-ink-secondary)' }}>
                  Source and Landing Zone columns are identical to Bronze (before system columns are added).
                  The columns below represent the original schema as extracted from{" "}
                  <span className="font-mono font-medium">{journey.source.schema}.{journey.source.name}</span>.
                </p>
              </div>
            )}

            {/* No column data at all */}
            {isSourceOrLanding && !hasColumnData && (
              <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: 'var(--bp-ink-muted)' }}>
                <Database className="w-10 h-10" />
                <p className="text-sm">No column schema available yet</p>
                <p className="text-xs text-center max-w-md">
                  Column schemas are discovered when the entity is loaded to the Bronze layer.
                  Run the Landing Zone and Bronze pipelines to populate schema data.
                </p>
              </div>
            )}

            {/* Gold placeholder */}
            {isGold && (
              <div className="flex flex-col items-center justify-center py-16 gap-3" style={{ color: 'var(--bp-ink-muted)' }}>
                <Crown className="w-10 h-10" />
                <p className="text-sm">Gold layer coming soon</p>
                <p className="text-xs">Materialized Lakehouse Views will appear here once configured</p>
              </div>
            )}

            {/* Column count header */}
            {!isGold && currentColumns.length > 0 && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: LAYERS[activeLayer].color }}
                  >
                    {LAYERS[activeLayer].label}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--bp-ink-muted)' }}>
                    {currentColumns.filter((c) => c.diffStatus !== "removed").length} columns
                    {currentColumns.some((c) => c.isSystem) &&
                      ` (${currentColumns.filter((c) => c.isSystem).length} system)`}
                  </span>
                </div>
                {currentColumns.some((c) => c.diffStatus === "removed") && (
                  <span className="text-[10px]" style={{ color: 'var(--bp-fault)' }}>
                    +{currentColumns.filter((c) => c.diffStatus === "removed").length} removed shown
                  </span>
                )}
              </div>
            )}

            {/* ── Column Grid (animated) ── */}
            {!isGold && currentColumns.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                <AnimatePresence mode="popLayout">
                  {currentColumns.map((col) => (
                    <ColumnCard key={col.name} col={col} />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
