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
  { key: "source",  label: "Source",       color: "#64748b", activeClass: "bg-slate-500/20 border-slate-500/50 text-slate-400",   icon: Database },
  { key: "landing", label: "Landing Zone", color: "#3b82f6", activeClass: "bg-blue-500/20 border-blue-500/50 text-blue-400",     icon: HardDrive },
  { key: "bronze",  label: "Bronze",       color: "#f59e0b", activeClass: "bg-amber-500/20 border-amber-500/50 text-amber-400",  icon: Table2 },
  { key: "silver",  label: "Silver",       color: "#8b5cf6", activeClass: "bg-violet-500/20 border-violet-500/50 text-violet-400", icon: Sparkles },
  { key: "gold",    label: "Gold",         color: "#10b981", activeClass: "bg-emerald-500/20 border-emerald-500/50 text-emerald-400", icon: Crown },
];

const SYSTEM_COLUMNS = new Set([
  "HashedPKColumn", "HashedNonKeyColumns", "RecordLoadDate",
  "IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "IsDeleted", "Action",
]);

const BRONZE_SYSTEM_COLUMNS = new Set(["HashedPKColumn", "HashedNonKeyColumns", "RecordLoadDate"]);
const SILVER_SYSTEM_COLUMNS = new Set(["IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "IsDeleted", "Action"]);

/** Maps SQL data types to an icon + color for visual distinction in column cards */
const TYPE_ICON_MAP: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
  // String types
  string:    { icon: Type,       color: "text-blue-400",    bg: "bg-blue-500/10" },
  varchar:   { icon: Type,       color: "text-blue-400",    bg: "bg-blue-500/10" },
  nvarchar:  { icon: Type,       color: "text-blue-400",    bg: "bg-blue-500/10" },
  char:      { icon: Type,       color: "text-blue-400",    bg: "bg-blue-500/10" },
  nchar:     { icon: Type,       color: "text-blue-400",    bg: "bg-blue-500/10" },
  text:      { icon: Type,       color: "text-blue-400",    bg: "bg-blue-500/10" },
  ntext:     { icon: Type,       color: "text-blue-400",    bg: "bg-blue-500/10" },
  // Numeric types
  int:       { icon: Hash,       color: "text-emerald-400", bg: "bg-emerald-500/10" },
  bigint:    { icon: Hash,       color: "text-emerald-400", bg: "bg-emerald-500/10" },
  smallint:  { icon: Hash,       color: "text-emerald-400", bg: "bg-emerald-500/10" },
  tinyint:   { icon: Hash,       color: "text-emerald-400", bg: "bg-emerald-500/10" },
  long:      { icon: Hash,       color: "text-emerald-400", bg: "bg-emerald-500/10" },
  short:     { icon: Hash,       color: "text-emerald-400", bg: "bg-emerald-500/10" },
  // DateTime types
  datetime:  { icon: Calendar,   color: "text-purple-400",  bg: "bg-purple-500/10" },
  datetime2: { icon: Calendar,   color: "text-purple-400",  bg: "bg-purple-500/10" },
  date:      { icon: Calendar,   color: "text-purple-400",  bg: "bg-purple-500/10" },
  time:      { icon: Calendar,   color: "text-purple-400",  bg: "bg-purple-500/10" },
  timestamp: { icon: Calendar,   color: "text-purple-400",  bg: "bg-purple-500/10" },
  // Decimal / float types
  decimal:   { icon: CircleDot,  color: "text-orange-400",  bg: "bg-orange-500/10" },
  numeric:   { icon: CircleDot,  color: "text-orange-400",  bg: "bg-orange-500/10" },
  float:     { icon: CircleDot,  color: "text-orange-400",  bg: "bg-orange-500/10" },
  double:    { icon: CircleDot,  color: "text-orange-400",  bg: "bg-orange-500/10" },
  real:      { icon: CircleDot,  color: "text-orange-400",  bg: "bg-orange-500/10" },
  money:     { icon: CircleDot,  color: "text-orange-400",  bg: "bg-orange-500/10" },
  smallmoney:{ icon: CircleDot,  color: "text-orange-400",  bg: "bg-orange-500/10" },
  // Boolean
  bit:       { icon: ToggleLeft,  color: "text-pink-400",    bg: "bg-pink-500/10" },
  boolean:   { icon: ToggleLeft,  color: "text-pink-400",    bg: "bg-pink-500/10" },
  // Binary
  binary:    { icon: Binary,     color: "text-gray-400",    bg: "bg-gray-500/10" },
  varbinary: { icon: Binary,     color: "text-gray-400",    bg: "bg-gray-500/10" },
  image:     { icon: Binary,     color: "text-gray-400",    bg: "bg-gray-500/10" },
};

function getTypeStyle(dataType: string) {
  const key = dataType.toLowerCase().replace(/\(.*\)/, "").trim();
  return TYPE_ICON_MAP[key] || { icon: Type, color: "text-muted-foreground", bg: "bg-muted" };
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
        className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border cursor-pointer",
          autoPlaying
            ? "bg-primary/10 border-primary/30 text-primary"
            : "bg-card border-border/30 text-muted-foreground hover:text-foreground hover:border-border/50",
        )}
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
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border transition-all w-full cursor-pointer",
                  isActive && layer.activeClass,
                  isCompleted && "bg-card border-border/40 text-foreground",
                  !isActive && !isCompleted && isReachable && "bg-card border-border/20 text-muted-foreground hover:bg-card/50 hover:border-border/40",
                  isDisabled && "bg-card/10 border-border/10 text-muted-foreground/30 cursor-not-allowed",
                )}
              >
                <div className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border transition-all",
                  isActive && "border-current",
                  isCompleted && "bg-emerald-500/20 border-emerald-500/40",
                  !isActive && !isCompleted && "border-border/30",
                )}>
                  {isCompleted ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Icon className={cn("w-3.5 h-3.5", isActive ? "" : isDisabled ? "opacity-30" : "opacity-60")} />
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
                      : "rgba(128,128,128,0.15)",
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
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-lg)] border border-border/30 bg-card text-xs text-muted-foreground/60">
        <Info className="w-3.5 h-3.5" />
        No column changes at {layerLabel}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-lg)] border border-border/30 bg-card">
      {added > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
          <Plus className="w-3.5 h-3.5" />
          <span>{added} added</span>
        </div>
      )}
      {removed > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-red-400">
          <Minus className="w-3.5 h-3.5" />
          <span>{removed} removed</span>
        </div>
      )}
      {typeChanged > 0 && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
          <ArrowRightLeft className="w-3.5 h-3.5" />
          <span>{typeChanged} type changed</span>
        </div>
      )}
      <span className="text-[10px] text-muted-foreground/40 ml-auto">vs previous layer</span>
    </div>
  );
}

/** Individual column card with animation and diff badge */
function ColumnCard({ col }: { col: DisplayColumn }) {
  const typeStyle = getTypeStyle(col.dataType);
  const TypeIcon = typeStyle.icon;

  // Border glow for diff status
  let borderClass = "border-border/30";
  let glowStyle: React.CSSProperties = {};
  if (col.diffStatus === "new") {
    borderClass = "border-emerald-500/40";
    glowStyle = { boxShadow: "0 0 12px rgba(16, 185, 129, 0.15)" };
  } else if (col.diffStatus === "removed") {
    borderClass = "border-red-500/40";
    glowStyle = { boxShadow: "0 0 12px rgba(239, 68, 68, 0.15)" };
  } else if (col.diffStatus === "type_changed") {
    borderClass = "border-amber-500/40";
    glowStyle = { boxShadow: "0 0 12px rgba(245, 158, 11, 0.15)" };
  } else if (col.diffStatus === "system") {
    borderClass = "border-violet-500/30";
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
        "rounded-[var(--radius)] border p-3 bg-card transition-colors",
        borderClass,
        col.diffStatus === "removed" && "opacity-50",
      )}
      style={glowStyle}
    >
      {/* Column name */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span
          className={cn(
            "font-mono text-sm font-medium truncate",
            col.diffStatus === "removed" ? "line-through text-red-400/70" : "text-foreground",
          )}
          title={col.name}
        >
          {col.name}
        </span>

        {/* Nullable badge */}
        {col.nullable && col.diffStatus !== "removed" && (
          <span className="text-[9px] font-medium text-muted-foreground/40 bg-muted px-1.5 py-0.5 rounded flex-shrink-0">
            NULL
          </span>
        )}
      </div>

      {/* Data type with icon */}
      <div className="flex items-center gap-1.5 mb-2">
        <div className={cn("w-5 h-5 rounded flex items-center justify-center flex-shrink-0", typeStyle.bg)}>
          <TypeIcon className={cn("w-3 h-3", typeStyle.color)} />
        </div>
        <span className={cn("text-xs font-mono", typeStyle.color)}>{col.dataType}</span>
      </div>

      {/* Diff status badge */}
      {col.diffStatus === "new" && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <Plus className="w-2.5 h-2.5" />
          NEW
        </span>
      )}
      {col.diffStatus === "removed" && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
          <Minus className="w-2.5 h-2.5" />
          REMOVED
        </span>
      )}
      {col.diffStatus === "type_changed" && (
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <ArrowRightLeft className="w-2.5 h-2.5" />
            TYPE CHANGED
          </span>
          {col.previousType && (
            <div className="text-[10px] text-muted-foreground/50 font-mono">
              {col.previousType} <span className="text-amber-400/60">-&gt;</span> {col.dataType}
            </div>
          )}
        </div>
      )}
      {col.diffStatus === "system" && (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-500/10 text-violet-400 border border-violet-500/20">
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
        className={cn(
          "flex items-center border rounded-lg transition-colors cursor-pointer",
          open
            ? "border-primary/50 bg-card/80 ring-1 ring-primary/20"
            : "border-border/50 bg-card hover:border-border",
        )}
        onClick={() => !open && setOpen(true)}
      >
        <Search className="w-4 h-4 text-muted-foreground/50 ml-3 flex-shrink-0" />
        {open ? (
          <input
            type="text"
            autoFocus
            placeholder={listLoading ? "Loading entities..." : `Filter ${entities.length} entities...`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full px-3 py-2.5 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
          />
        ) : (
          <div className="w-full px-3 py-2.5 text-sm">
            {selected ? (
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                  {selected.source}
                </span>
                <span className="font-mono text-foreground">{selected.tableName}</span>
              </div>
            ) : (
              <span className="text-muted-foreground/40">Select an entity...</span>
            )}
          </div>
        )}
        {selectedId && !open && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelect("");
            }}
            className="mr-2 text-muted-foreground/40 hover:text-muted-foreground"
          >
            <XCircle className="w-4 h-4" />
          </button>
        )}
        <ChevronDown className={cn("w-4 h-4 text-muted-foreground/40 mr-3 flex-shrink-0 transition-transform", open && "rotate-180")} />
      </div>

      {open && !listLoading && (
        <div className="absolute z-[200] mt-1 w-full max-h-[60vh] overflow-y-auto rounded-lg border border-border/50 bg-popover shadow-2xl">
          {Object.entries(grouped).map(([source, items]) => (
            <div key={source}>
              <div className="sticky top-0 px-3 py-2 bg-muted/80 backdrop-blur-sm border-b border-border/20 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">{source}</span>
                <span className="text-[10px] text-muted-foreground/40">{items.length}</span>
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
                    className={cn(
                      "w-full text-left px-3 py-2 hover:bg-primary/5 transition-colors flex items-center justify-between gap-2",
                      selectedId === idStr && "bg-primary/10 border-l-2 border-primary",
                    )}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <span className="text-sm font-mono text-foreground truncate">{e.tableName}</span>
                      {e.sourceSchema !== "dbo" && (
                        <span className="text-[10px] text-muted-foreground/40 flex-shrink-0">{e.sourceSchema}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground/30 flex-shrink-0">#{idStr}</span>
                  </button>
                );
              })}
            </div>
          ))}
          {Object.keys(grouped).length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted-foreground/40">
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

  // ── Fetch journey data ──

  const loadJourney = useCallback(async (id: number) => {
    setLoading(true);
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
        return;
      }
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
    <div className="h-full flex flex-col bg-background">
      {/* ── Header ── */}
      <div className="flex-shrink-0 border-b border-border/50 bg-card px-6 py-4" style={{ zIndex: 100, position: "relative" }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <Columns3 className="w-5 h-5 text-primary" />
            <h1 className="font-display text-lg font-semibold">Column Evolution</h1>
            {journey && (
              <span className="text-muted-foreground text-sm">
                — {journey.source.namespace || journey.source.dataSourceName}: {journey.source.name}
              </span>
            )}
          </div>
          {journey && (
            <button
              onClick={() => loadJourney(journey.entityId)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border/50 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
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
          <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading column schema...</span>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="flex items-center justify-center h-64 gap-2 text-red-400">
            <XCircle className="w-5 h-5" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* No entity selected */}
        {!loading && !error && !journey && (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground/40">
            <Columns3 className="w-10 h-10" />
            <p className="text-sm">Select an entity to explore its column evolution</p>
            <p className="text-xs">Watch columns animate as they transform through Source, Bronze, Silver, and Gold</p>
          </div>
        )}

        {/* Main content with journey loaded */}
        {journey && !loading && (
          <div className="p-6 space-y-5 max-w-7xl mx-auto">
            {/* Layer Stepper */}
            <div className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-4">
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
              <div className="flex items-start gap-3 px-4 py-3 rounded-[var(--radius-lg)] border border-blue-500/20 bg-blue-500/5">
                <Info className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-400/80">
                  Source and Landing Zone columns are identical to Bronze (before system columns are added).
                  The columns below represent the original schema as extracted from{" "}
                  <span className="font-mono font-medium">{journey.source.schema}.{journey.source.name}</span>.
                </p>
              </div>
            )}

            {/* No column data at all */}
            {isSourceOrLanding && !hasColumnData && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground/40">
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
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground/40">
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
                  <span className="text-xs text-muted-foreground/50">
                    {currentColumns.filter((c) => c.diffStatus !== "removed").length} columns
                    {currentColumns.some((c) => c.isSystem) &&
                      ` (${currentColumns.filter((c) => c.isSystem).length} system)`}
                  </span>
                </div>
                {currentColumns.some((c) => c.diffStatus === "removed") && (
                  <span className="text-[10px] text-red-400/50">
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
