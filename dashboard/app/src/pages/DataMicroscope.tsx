import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import {
  useMicroscope,
  useMicroscopePks,
  type MicroscopeData,
  type TransformationStep,
} from "@/hooks/useMicroscope";
import EntitySelector from "@/components/EntitySelector";
import {
  ScanSearch,
  Loader2,
  AlertTriangle,
  Search,
  Database,
  HardDrive,
  Table2,
  Sparkles,
  Plus,
  Minus,
  ArrowRight,
  ChevronDown,
  RefreshCw,
  Info,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// CONSTANTS
// ============================================================================

const LAYER_META = {
  source: {
    label: "Source",
    color: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    icon: Database,
  },
  landing: {
    label: "Landing Zone",
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    icon: HardDrive,
  },
  bronze: {
    label: "Bronze",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    icon: Table2,
  },
  silver: {
    label: "Silver",
    color: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    icon: Sparkles,
  },
} as const;

type LayerKey = keyof typeof LAYER_META;

// System columns added at each layer
const BRONZE_SYSTEM_COLS = new Set([
  "HashedPKColumn",
  "HashedNonKeyColumns",
  "RecordLoadDate",
]);
const SILVER_SYSTEM_COLS = new Set([
  "IsCurrent",
  "RecordStartDate",
  "RecordEndDate",
  "RecordModifiedDate",
  "IsDeleted",
  "Action",
]);
const ALL_SYSTEM_COLS = new Set([...BRONZE_SYSTEM_COLS, ...SILVER_SYSTEM_COLS]);

// ============================================================================
// HELPER: Determine cell diff status
// ============================================================================

type CellStatus =
  | "unchanged"
  | "changed"
  | "added"
  | "not_present"
  | "system";

function getCellStatus(
  colName: string,
  layer: LayerKey,
  sourceRow: Record<string, unknown> | null,
  bronzeRow: Record<string, unknown> | null,
  silverRow: Record<string, unknown> | null,
  sourceAvailable: boolean
): CellStatus {
  const isSystemCol = ALL_SYSTEM_COLS.has(colName);

  if (layer === "source") {
    if (!sourceAvailable) return "not_present";
    if (sourceRow && colName in sourceRow) return "unchanged";
    // Check sanitized name match
    if (sourceRow) {
      const match = Object.keys(sourceRow).find(
        (k) => k.replace(/[ .\-]/g, "") === colName
      );
      if (match) return "unchanged";
    }
    return "not_present";
  }

  if (layer === "landing") {
    // LZ mirrors source exactly
    if (!sourceAvailable) return "not_present";
    if (sourceRow && colName in sourceRow) return "unchanged";
    if (sourceRow) {
      const match = Object.keys(sourceRow).find(
        (k) => k.replace(/[ .\-]/g, "") === colName
      );
      if (match) return "unchanged";
    }
    return "not_present";
  }

  if (layer === "bronze") {
    if (!bronzeRow) return "not_present";
    if (!(colName in bronzeRow)) return "not_present";
    if (isSystemCol && BRONZE_SYSTEM_COLS.has(colName)) return "added";
    if (isSystemCol && SILVER_SYSTEM_COLS.has(colName)) return "not_present";
    // Check if value changed from source
    if (sourceRow && sourceAvailable) {
      // Find matching source column (may have spaces/dots)
      const srcKey = Object.keys(sourceRow).find(
        (k) => k.replace(/[ .\-]/g, "") === colName
      );
      if (srcKey) {
        const srcVal = String(sourceRow[srcKey] ?? "");
        const brnVal = String(bronzeRow[colName] ?? "");
        if (srcVal !== brnVal) return "changed";
        return "unchanged";
      }
      return "added"; // Column in bronze but not source = added
    }
    return "unchanged";
  }

  if (layer === "silver") {
    if (!silverRow) return "not_present";
    if (!(colName in silverRow)) return "not_present";
    if (isSystemCol && SILVER_SYSTEM_COLS.has(colName)) return "added";
    if (isSystemCol && BRONZE_SYSTEM_COLS.has(colName)) {
      // Bronze system cols carry through
      return "unchanged";
    }
    // Check if value changed from bronze
    if (bronzeRow && colName in bronzeRow) {
      const brnVal = String(bronzeRow[colName] ?? "");
      const slvVal = String(silverRow[colName] ?? "");
      if (brnVal !== slvVal) return "changed";
      return "unchanged";
    }
    return "unchanged";
  }

  return "unchanged";
}

function getCellClasses(status: CellStatus, isSystem: boolean): string {
  const base = "px-3 py-2 font-mono text-sm border-b border-border/30 ";
  if (isSystem) {
    switch (status) {
      case "added":
        return (
          base +
          "bg-violet-500/10 text-emerald-600 dark:text-emerald-400"
        );
      case "not_present":
        return base + "bg-muted text-muted-foreground/30";
      default:
        return base + "bg-violet-500/5 text-foreground/80";
    }
  }
  switch (status) {
    case "changed":
      return (
        base +
        "bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-inset ring-amber-500/20"
      );
    case "added":
      return base + "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    case "not_present":
      return base + "bg-muted text-muted-foreground/30";
    default:
      return base + "text-foreground";
  }
}

// ============================================================================
// COMPONENT: CellPopover
// ============================================================================

function CellPopover({
  colName,
  layer,
  status,
  sourceRow,
  bronzeRow,
  silverRow,
  transformations,
  onClose,
}: {
  colName: string;
  layer: LayerKey;
  status: CellStatus;
  sourceRow: Record<string, unknown> | null;
  bronzeRow: Record<string, unknown> | null;
  silverRow: Record<string, unknown> | null;
  transformations: TransformationStep[];
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Find before/after values
  let beforeValue: string | null = null;
  let afterValue: string | null = null;
  let operation = "";
  let notebook = "";

  if (layer === "bronze" && status === "changed" && sourceRow) {
    const srcKey = Object.keys(sourceRow).find(
      (k) => k.replace(/[ .\-]/g, "") === colName
    );
    if (srcKey) beforeValue = String(sourceRow[srcKey] ?? "NULL");
    afterValue = bronzeRow ? String(bronzeRow[colName] ?? "NULL") : null;
    operation = "Bronze transformation";
    notebook = "NB_FMD_LOAD_LANDING_BRONZE";
  } else if (layer === "silver" && status === "changed" && bronzeRow) {
    beforeValue = String(bronzeRow[colName] ?? "NULL");
    afterValue = silverRow ? String(silverRow[colName] ?? "NULL") : null;
    operation = "Silver SCD2 processing";
    notebook = "NB_FMD_LOAD_BRONZE_SILVER";
  } else if (status === "added") {
    operation =
      BRONZE_SYSTEM_COLS.has(colName)
        ? "Bronze system column"
        : SILVER_SYSTEM_COLS.has(colName)
        ? "Silver SCD2 column"
        : "Column added";
    notebook =
      layer === "bronze"
        ? "NB_FMD_LOAD_LANDING_BRONZE"
        : "NB_FMD_LOAD_BRONZE_SILVER";
  }

  // Find matching transformation step
  const matchingStep = transformations.find(
    (t) =>
      t.layer === layer &&
      (t.columns?.includes(colName) ||
        (status === "added" && t.operation === "system_columns") ||
        (status === "added" && t.operation === "scd2_columns"))
  );

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 mt-1 w-80 rounded-lg border border-border bg-popover shadow-2xl p-4 animate-in fade-in-0 zoom-in-95"
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-sm text-foreground">{colName}</h4>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2 text-xs">
        {operation && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Operation:</span>
            <span className="font-medium text-foreground">{operation}</span>
          </div>
        )}
        {notebook && (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Notebook:</span>
            <code className="text-[11px] px-1.5 py-0.5 rounded bg-muted font-mono">
              {notebook}
            </code>
          </div>
        )}

        {beforeValue !== null && afterValue !== null && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground shrink-0">Before:</span>
              <code className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 font-mono truncate max-w-48">
                {beforeValue}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <ArrowRight className="w-3 h-3 text-muted-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground shrink-0">After:</span>
              <code className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono truncate max-w-48">
                {afterValue}
              </code>
            </div>
          </div>
        )}

        {matchingStep && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <p className="text-muted-foreground">{matchingStep.description}</p>
            {matchingStep.details && (
              <p className="mt-1 text-muted-foreground/70 italic">
                {matchingStep.details}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: DiffGrid
// ============================================================================

function DiffGrid({ data }: { data: MicroscopeData }) {
  const [activePopover, setActivePopover] = useState<{
    col: string;
    layer: LayerKey;
  } | null>(null);
  const [silverVersionIdx, setSilverVersionIdx] = useState(0);

  const sourceRow = data.source.row;
  const bronzeRow = data.bronze.row;
  const silverRow =
    data.silver.versions.length > 0
      ? (data.silver.versions[silverVersionIdx] as Record<string, unknown>)
      : null;

  // Build unified column list
  const { originalCols, systemCols } = useMemo(() => {
    const allCols = new Set<string>();
    if (sourceRow) Object.keys(sourceRow).forEach((c) => allCols.add(c));
    if (bronzeRow) Object.keys(bronzeRow).forEach((c) => allCols.add(c));
    if (silverRow) Object.keys(silverRow).forEach((c) => allCols.add(c));

    const original: string[] = [];
    const system: string[] = [];
    allCols.forEach((c) => {
      if (ALL_SYSTEM_COLS.has(c)) system.push(c);
      else original.push(c);
    });
    original.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    system.sort();
    return { originalCols: original, systemCols: system };
  }, [sourceRow, bronzeRow, silverRow]);

  const layers: LayerKey[] = ["source", "landing", "bronze", "silver"];

  const getCellValue = (
    colName: string,
    layer: LayerKey
  ): string | null => {
    if (layer === "source" || layer === "landing") {
      if (!sourceRow) return null;
      if (colName in sourceRow) return String(sourceRow[colName] ?? "NULL");
      // Check sanitized name
      const match = Object.keys(sourceRow).find(
        (k) => k.replace(/[ .\-]/g, "") === colName
      );
      if (match) return String(sourceRow[match] ?? "NULL");
      return null;
    }
    if (layer === "bronze") {
      if (!bronzeRow || !(colName in bronzeRow)) return null;
      return String(bronzeRow[colName] ?? "NULL");
    }
    if (layer === "silver") {
      if (!silverRow || !(colName in silverRow)) return null;
      return String(silverRow[colName] ?? "NULL");
    }
    return null;
  };

  const handleCellClick = (col: string, layer: LayerKey, status: CellStatus) => {
    if (status === "changed" || status === "added") {
      setActivePopover(
        activePopover?.col === col && activePopover?.layer === layer
          ? null
          : { col, layer }
      );
    }
  };

  const renderRow = (colName: string, isSystem: boolean) => {
    return (
      <tr key={colName} className={cn(isSystem && "bg-violet-500/5")}>
        <td
          className={cn(
            "px-3 py-2 text-sm font-mono border-b border-border/30 sticky left-0 bg-card z-10 min-w-[200px]",
            isSystem && "bg-violet-500/5 text-violet-600 dark:text-violet-400"
          )}
        >
          <div className="flex items-center gap-1.5">
            {isSystem && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-violet-500/20 text-violet-500">
                SYS
              </span>
            )}
            {colName}
          </div>
        </td>
        {layers.map((layer) => {
          const status = getCellStatus(
            colName,
            layer,
            sourceRow,
            bronzeRow,
            silverRow,
            data.source.available
          );
          const value = getCellValue(colName, layer);
          const isClickable = status === "changed" || status === "added";

          return (
            <td
              key={layer}
              className={cn(
                getCellClasses(status, isSystem),
                isClickable &&
                  "cursor-pointer hover:ring-2 hover:ring-primary/30 transition-all relative"
              )}
              onClick={() => handleCellClick(colName, layer, status)}
            >
              <div className="flex items-center gap-1 max-w-[200px]">
                {status === "added" && (
                  <Plus className="w-3 h-3 text-emerald-500 shrink-0" />
                )}
                {status === "not_present" ? (
                  <span className="text-muted-foreground/30">&mdash;</span>
                ) : (
                  <span className="truncate" title={value ?? undefined}>
                    {value ?? "NULL"}
                  </span>
                )}
              </div>
              {activePopover?.col === colName &&
                activePopover?.layer === layer && (
                  <CellPopover
                    colName={colName}
                    layer={layer}
                    status={status}
                    sourceRow={sourceRow}
                    bronzeRow={bronzeRow}
                    silverRow={silverRow}
                    transformations={data.transformations}
                    onClose={() => setActivePopover(null)}
                  />
                )}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      {/* SCD2 version selector */}
      {data.silver.versions.length > 1 && (
        <div className="px-4 py-2 bg-violet-500/5 border-b border-border/30 flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-medium">
            Silver Version:
          </span>
          <select
            value={silverVersionIdx}
            onChange={(e) => setSilverVersionIdx(Number(e.target.value))}
            className="text-xs px-2 py-1 rounded border border-border bg-card text-foreground"
          >
            {data.silver.versions.map((v, i) => {
              const ver = v as Record<string, unknown>;
              const startDate = ver.RecordStartDate
                ? String(ver.RecordStartDate)
                : "";
              const isCurrent = ver.IsCurrent === "True" || ver.IsCurrent === "1";
              return (
                <option key={i} value={i}>
                  Version {i + 1}
                  {isCurrent ? " (current)" : ""}
                  {startDate ? ` - ${startDate}` : ""}
                </option>
              );
            })}
          </select>
          <span className="text-[10px] text-muted-foreground">
            {data.silver.versions.length} version(s)
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-muted/50">
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground sticky left-0 bg-muted/50 z-10 min-w-[200px]">
                Column Name
              </th>
              {layers.map((layer) => {
                const meta = LAYER_META[layer];
                const Icon = meta.icon;
                return (
                  <th
                    key={layer}
                    className={cn(
                      "px-3 py-2.5 text-xs font-semibold uppercase tracking-wider min-w-[200px]",
                      meta.color
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className="w-3.5 h-3.5" />
                      {meta.label}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {/* Original columns */}
            {originalCols.length > 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 bg-muted border-b border-border/30"
                >
                  Original Columns ({originalCols.length})
                </td>
              </tr>
            )}
            {originalCols.map((c) => renderRow(c, false))}

            {/* System columns */}
            {systemCols.length > 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-violet-500/60 bg-violet-500/5 border-b border-border/30"
                >
                  System Columns ({systemCols.length})
                </td>
              </tr>
            )}
            {systemCols.map((c) => renderRow(c, true))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: TransformationCards
// ============================================================================

function TransformationCards({
  steps,
}: {
  steps: TransformationStep[];
}) {
  if (!steps.length) return null;

  const layerBadge = (layer: string) => {
    const meta = LAYER_META[layer as LayerKey];
    if (!meta) return null;
    return (
      <span
        className={cn(
          "text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border",
          meta.bg,
          meta.border,
          meta.color
        )}
      >
        {meta.label}
      </span>
    );
  };

  const impactIcon = (impact: string) => {
    switch (impact) {
      case "add":
        return <Plus className="w-3.5 h-3.5 text-emerald-500" />;
      case "rename":
        return <ArrowRight className="w-3.5 h-3.5 text-blue-500" />;
      case "transform":
        return <Sparkles className="w-3.5 h-3.5 text-amber-500" />;
      case "none":
        return <Minus className="w-3.5 h-3.5 text-muted-foreground/40" />;
      default:
        return <Info className="w-3.5 h-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <ArrowRight className="w-4 h-4 text-primary" />
        Transformation Pipeline ({steps.length} steps)
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {steps.map((step) => (
          <div
            key={step.step}
            className="rounded-lg border border-border/50 bg-card p-3 hover:bg-card/80 transition-colors"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold text-muted-foreground/50 w-5 h-5 rounded-full bg-muted flex items-center justify-center">
                {step.step}
              </span>
              {impactIcon(step.impact)}
              {layerBadge(step.layer)}
            </div>
            <p className="text-sm font-medium text-foreground mb-1">
              {step.description}
            </p>
            {step.details && (
              <p className="text-xs text-muted-foreground line-clamp-2">
                {step.details}
              </p>
            )}
            {step.columns && step.columns.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {step.columns.slice(0, 5).map((col) => (
                  <code
                    key={col}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono text-muted-foreground"
                  >
                    {col}
                  </code>
                ))}
                {step.columns.length > 5 && (
                  <span className="text-[10px] text-muted-foreground/50">
                    +{step.columns.length - 5} more
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// COMPONENT: PkSearchInput
// ============================================================================

function PkSearchInput({
  entityId,
  selectedPk,
  onSelect,
}: {
  entityId: number;
  selectedPk: string;
  onSelect: (pk: string) => void;
}) {
  const [searchInput, setSearchInput] = useState(selectedPk);
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { pks, pkColumn, loading } = useMicroscopePks(
    entityId,
    searchInput
  );

  // Sync external selectedPk changes
  useEffect(() => {
    setSearchInput(selectedPk);
  }, [selectedPk]);

  // Close on click outside
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  const handleSelect = (pk: string) => {
    setSearchInput(pk);
    setShowDropdown(false);
    onSelect(pk);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && searchInput.trim()) {
      setShowDropdown(false);
      onSelect(searchInput.trim());
    }
  };

  return (
    <div ref={containerRef} className="relative max-w-md">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex-1 flex items-center border rounded-lg transition-colors",
            showDropdown
              ? "border-primary/50 bg-card/80 ring-1 ring-primary/20"
              : "border-border/50 bg-card hover:border-border"
          )}
        >
          <Search className="w-4 h-4 text-muted-foreground/50 ml-3 flex-shrink-0" />
          <input
            type="text"
            placeholder={
              pkColumn
                ? `Search by ${pkColumn}...`
                : "Enter primary key value..."
            }
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            onKeyDown={handleKeyDown}
            className="w-full px-3 py-2.5 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none font-mono"
          />
          {loading && (
            <Loader2 className="w-4 h-4 text-muted-foreground/50 mr-3 animate-spin" />
          )}
          {searchInput && !loading && (
            <button
              onClick={() => {
                setSearchInput("");
                setShowDropdown(false);
              }}
              className="mr-3 text-muted-foreground/40 hover:text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* PK dropdown */}
      {showDropdown && pks.length > 0 && (
        <div className="absolute z-[200] mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-border/50 bg-popover shadow-2xl">
          {pkColumn && (
            <div className="sticky top-0 px-3 py-2 bg-muted/80 backdrop-blur-sm border-b border-border/20">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
                {pkColumn}
              </span>
            </div>
          )}
          {pks.map((pk) => (
            <button
              key={pk}
              onClick={() => handleSelect(pk)}
              className={cn(
                "w-full text-left px-3 py-2 hover:bg-primary/5 transition-colors text-sm font-mono",
                selectedPk === pk && "bg-primary/10 border-l-2 border-primary"
              )}
            >
              {pk}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// PAGE: DataMicroscope
// ============================================================================

export default function DataMicroscope() {
  const [searchParams, setSearchParams] = useSearchParams();
  const entityIdParam = searchParams.get("entity");
  const pkParam = searchParams.get("pk") || "";

  const { allEntities, loading: digestLoading } = useEntityDigest();

  const entityId = entityIdParam ? parseInt(entityIdParam, 10) : null;
  const {
    data: microscopeData,
    loading: microscopeLoading,
    error: microscopeError,
    refresh,
  } = useMicroscope(entityId, pkParam);

  // Entity selection
  const handleEntitySelect = useCallback(
    (id: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("entity", id);
      params.delete("pk");
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  const handleEntityClear = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  // PK selection
  const handlePkSelect = useCallback(
    (pk: string) => {
      const params = new URLSearchParams(searchParams);
      params.set("pk", pk);
      setSearchParams(params);
    },
    [searchParams, setSearchParams]
  );

  // Find selected entity for display
  const selectedEntity = useMemo(
    () => allEntities.find((e) => String(e.id) === entityIdParam),
    [allEntities, entityIdParam]
  );

  // ── No entity selected state ──
  if (!entityId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <ScanSearch className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-display font-semibold tracking-tight">
                Data Microscope
              </h1>
              <p className="text-sm text-muted-foreground">
                Cross-layer row inspection
              </p>
            </div>
          </div>
        </div>

        <EntitySelector
          entities={allEntities}
          selectedId={null}
          onSelect={handleEntitySelect}
          onClear={handleEntityClear}
          loading={digestLoading}
          placeholder="Select an entity to inspect..."
        />

        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-20 w-20 rounded-2xl bg-muted/50 flex items-center justify-center mb-6">
            <ScanSearch className="h-10 w-10 text-muted-foreground/30" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">
            Select an entity and primary key
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Choose an entity from the selector above, then enter a primary key
            value to inspect data as it flows through Source, Landing Zone,
            Bronze, and Silver layers.
          </p>
        </div>
      </div>
    );
  }

  // ── Entity selected but no PK ──
  const showPkPrompt = entityId && !pkParam;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <ScanSearch className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-display font-semibold tracking-tight">
              Data Microscope
            </h1>
            <p className="text-sm text-muted-foreground">
              Cross-layer row inspection
            </p>
          </div>
        </div>
        {pkParam && (
          <button
            onClick={refresh}
            disabled={microscopeLoading}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 bg-card text-sm text-muted-foreground hover:text-foreground hover:bg-card transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={cn(
                "w-3.5 h-3.5",
                microscopeLoading && "animate-spin"
              )}
            />
            Refresh
          </button>
        )}
      </div>

      {/* Entity selector */}
      <EntitySelector
        entities={allEntities}
        selectedId={entityIdParam}
        onSelect={handleEntitySelect}
        onClear={handleEntityClear}
        loading={digestLoading}
      />

      {/* PK search input */}
      {entityId && (
        <div className="flex items-center gap-4">
          <PkSearchInput
            entityId={entityId}
            selectedPk={pkParam}
            onSelect={handlePkSelect}
          />
          {selectedEntity && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">
                {selectedEntity.source}.{selectedEntity.tableName}
              </span>
              {selectedEntity.bronzePKs && (
                <>
                  <span className="text-border">|</span>
                  <span>
                    PK: <code className="font-mono">{selectedEntity.bronzePKs}</code>
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Source unavailable banner */}
      {microscopeData && !microscopeData.source.available && pkParam && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 dark:text-amber-400">
            Source system unavailable (VPN required). Showing Landing Zone,
            Bronze, and Silver data only.
          </p>
        </div>
      )}

      {/* No PK prompt */}
      {showPkPrompt && !microscopeLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
            <Search className="h-8 w-8 text-muted-foreground/30" />
          </div>
          <h2 className="text-base font-semibold text-foreground mb-1">
            Enter a primary key value
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Search for a specific row by its primary key to inspect the data
            across all medallion layers.
          </p>
        </div>
      )}

      {/* Loading state */}
      {microscopeLoading && pkParam && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
          <p className="text-sm text-muted-foreground">
            Querying across layers...
          </p>
        </div>
      )}

      {/* Error state */}
      {microscopeError && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-destructive/30 bg-destructive/5">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{microscopeError}</p>
        </div>
      )}

      {/* Main content: Diff Grid + Transformations */}
      {microscopeData && pkParam && !microscopeLoading && (
        <div className="space-y-6">
          {/* Layer summary badges */}
          <div className="flex flex-wrap gap-3">
            {(["source", "landing", "bronze", "silver"] as LayerKey[]).map(
              (layer) => {
                const meta = LAYER_META[layer];
                const Icon = meta.icon;
                let available = false;
                let detail = "";

                if (layer === "source") {
                  available = microscopeData.source.available;
                  detail = available
                    ? `${microscopeData.source.server}/${microscopeData.source.database}`
                    : "VPN required";
                } else if (layer === "landing") {
                  available = microscopeData.landing.available;
                  detail = microscopeData.landing.note;
                } else if (layer === "bronze") {
                  available = microscopeData.bronze.available;
                  detail = microscopeData.bronze.lakehouse || "";
                } else if (layer === "silver") {
                  available = microscopeData.silver.available;
                  detail = `${microscopeData.silver.versions.length} version(s)`;
                }

                return (
                  <div
                    key={layer}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg border text-xs",
                      available ? meta.bg : "bg-muted",
                      available ? meta.border : "border-border/30"
                    )}
                  >
                    <Icon
                      className={cn(
                        "w-3.5 h-3.5",
                        available
                          ? meta.color
                          : "text-muted-foreground/30"
                      )}
                    />
                    <span
                      className={cn(
                        "font-medium",
                        available ? meta.color : "text-muted-foreground/30"
                      )}
                    >
                      {meta.label}
                    </span>
                    {detail && (
                      <span className="text-muted-foreground/50 truncate max-w-[150px]">
                        {detail}
                      </span>
                    )}
                    {!available && (
                      <span className="text-[10px] text-muted-foreground/40">
                        unavailable
                      </span>
                    )}
                  </div>
                );
              }
            )}
          </div>

          {/* The main diff grid */}
          {(microscopeData.bronze.row ||
            microscopeData.silver.versions.length > 0 ||
            microscopeData.source.row) ? (
            <DiffGrid data={microscopeData} />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-lg border border-border/30 bg-card">
              <AlertTriangle className="w-8 h-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                No row data found for PK value "{pkParam}" across any layer.
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                The value may not exist, or the entity may not have been loaded yet.
              </p>
            </div>
          )}

          {/* Transformation summary cards */}
          {microscopeData.transformations.length > 0 && (
            <TransformationCards steps={microscopeData.transformations} />
          )}
        </div>
      )}
    </div>
  );
}
