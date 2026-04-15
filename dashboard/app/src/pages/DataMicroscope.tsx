import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useEntityDigest } from "@/hooks/useEntityDigest";
import {
  useMicroscope,
  useMicroscopePks,
  type MicroscopeData,
  type TransformationStep,
} from "@/hooks/useMicroscope";
import EntitySelector from "@/components/EntitySelector";
import { ExploreWorkbenchHeader } from "@/components/explore/ExploreWorkbenchHeader";
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
  RefreshCw,
  Info,
  X,
  Eye,
  GitBranch,
  Library,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildEntityCatalogUrl,
  buildEntityJourneyUrl,
  buildEntityLineageUrl,
  buildEntityReplayUrl,
  findEntityById,
  getEntityRecommendedAction,
  getLoadedLayerCount,
} from "@/lib/exploreWorksurface";

// ============================================================================
// CONSTANTS
// ============================================================================

const LAYER_META = {
  source: {
    label: "Source",
    color: "text-[var(--bp-ink-muted)]",
    bg: "bg-[var(--bp-surface-inset)]",
    border: "border-[var(--bp-border)]",
    icon: Database,
  },
  landing: {
    label: "Landing Zone",
    color: "text-[var(--bp-ink-muted)]",
    bg: "bg-[var(--bp-surface-inset)]",
    border: "border-[var(--bp-border)]",
    icon: HardDrive,
  },
  bronze: {
    label: "Bronze",
    color: "text-[var(--bp-copper-hover)]",
    bg: "bg-[var(--bp-bronze-light)]/30",
    border: "border-[var(--bp-copper-hover)]/30",
    icon: Table2,
  },
  silver: {
    label: "Silver",
    color: "text-[var(--bp-silver)]",
    bg: "bg-[var(--bp-silver-light)]/50",
    border: "border-[var(--bp-silver)]/30",
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
        (k) => k.replace(/[ .-]/g, "") === colName
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
        (k) => k.replace(/[ .-]/g, "") === colName
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
        (k) => k.replace(/[ .-]/g, "") === colName
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
  const base = "px-3 py-2 text-sm ";
  const borderStyle = "border-b border-[var(--bp-border)] ";
  const mono = "font-[var(--bp-font-mono)] ";
  if (isSystem) {
    switch (status) {
      case "added":
        return base + borderStyle + mono + "bg-[var(--bp-silver-light)]/30 text-[var(--bp-operational)]";
      case "not_present":
        return base + borderStyle + mono + "bg-[var(--bp-surface-inset)] text-[var(--bp-ink-muted)] opacity-30";
      default:
        return base + borderStyle + mono + "bg-[var(--bp-silver-light)]/15 text-[var(--bp-ink-primary)]";
    }
  }
  switch (status) {
    case "changed":
      return base + borderStyle + mono + "bg-[var(--bp-caution-light)] text-[var(--bp-caution)] ring-1 ring-inset ring-[var(--bp-border)]";
    case "added":
      return base + borderStyle + mono + "bg-[var(--bp-operational-light)] text-[var(--bp-operational)]";
    case "not_present":
      return base + borderStyle + mono + "bg-[var(--bp-surface-inset)] text-[var(--bp-ink-muted)] opacity-30";
    default:
      return base + borderStyle + mono + "text-[var(--bp-ink-primary)]";
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
      (k) => k.replace(/[ .-]/g, "") === colName
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
      className="absolute z-50 mt-1 w-80 rounded-lg shadow-2xl p-4 animate-in fade-in-0 zoom-in-95"
      style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold text-sm" style={{ color: "var(--bp-ink-primary)" }}>{colName}</h4>
        <button
          onClick={onClose}
          aria-label="Close popover"
          style={{ color: "var(--bp-ink-tertiary)" }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2 text-xs">
        {operation && (
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--bp-ink-tertiary)" }}>Operation:</span>
            <span className="font-medium" style={{ color: "var(--bp-ink-primary)" }}>{operation}</span>
          </div>
        )}
        {notebook && (
          <div className="flex items-center gap-2">
            <span style={{ color: "var(--bp-ink-tertiary)" }}>Notebook:</span>
            <code className="text-[11px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: "var(--bg-muted)" }}>
              {notebook}
            </code>
          </div>
        )}

        {beforeValue !== null && afterValue !== null && (
          <div className="mt-2 space-y-1">
            <div className="flex items-center gap-2">
              <span className="shrink-0" style={{ color: "var(--bp-ink-tertiary)" }}>Before:</span>
              <code className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bp-fault-light)] text-[var(--bp-fault)] font-mono truncate max-w-48">
                {beforeValue}
              </code>
            </div>
            <div className="flex items-center gap-2">
              <ArrowRight className="w-3 h-3" style={{ color: "var(--bp-ink-tertiary)" }} />
            </div>
            <div className="flex items-center gap-2">
              <span className="shrink-0" style={{ color: "var(--bp-ink-tertiary)" }}>After:</span>
              <code className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bp-operational-light)] text-[var(--bp-operational)] font-mono truncate max-w-48">
                {afterValue}
              </code>
            </div>
          </div>
        )}

        {matchingStep && (
          <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--bp-border-subtle)" }}>
            <p style={{ color: "var(--bp-ink-tertiary)" }}>{matchingStep.description}</p>
            {matchingStep.details && (
              <p className="mt-1 italic" style={{ color: "var(--bp-ink-muted)" }}>
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

  // Reset silver version index when data changes (prevents out-of-bounds access)
  const versionCount = data.silver.versions.length;
  useEffect(() => {
    setSilverVersionIdx(0);
    setActivePopover(null);
  }, [data.entityId, data.pkValue]);

  const clampedIdx = versionCount > 0 ? Math.min(silverVersionIdx, versionCount - 1) : 0;

  const sourceRow = data.source.row;
  const bronzeRow = data.bronze.row;
  const silverRow =
    versionCount > 0
      ? (data.silver.versions[clampedIdx] as Record<string, unknown>)
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
        (k) => k.replace(/[ .-]/g, "") === colName
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

  const renderRow = (colName: string, isSystem: boolean, rowIndex: number = 0) => {
    return (
      <tr key={colName} className={cn("gs-stagger-row gs-row-hover", isSystem && "bg-[var(--bp-silver-light)]/20", !isSystem && rowIndex % 2 === 1 && "bg-[var(--bp-surface-inset)]/40")} style={{ '--i': Math.min(rowIndex, 15) } as React.CSSProperties}>
        <td
          className={cn(
            "px-3 py-2 text-sm font-mono sticky left-0 z-10 min-w-[200px]"
          )}
          style={{
            borderBottom: "1px solid var(--bp-border-subtle)",
            backgroundColor: isSystem ? "rgba(226,232,240,0.2)" : "var(--bp-surface-1)",
            color: isSystem ? "var(--bp-silver)" : undefined,
          }}
        >
          <div className="flex items-center gap-1.5">
            {isSystem && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-[var(--bp-silver-light)] text-[var(--bp-silver)]">
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
                  "cursor-pointer hover:ring-2 hover:ring-[var(--bp-border)] transition-all relative"
              )}
              onClick={() => handleCellClick(colName, layer, status)}
            >
              <div className="flex items-center gap-1 max-w-[200px]">
                {status === "added" && (
                  <Plus className="w-3 h-3 text-[var(--bp-operational)] shrink-0" />
                )}
                {status === "not_present" ? (
                  <span style={{ color: "rgba(168,162,158,0.3)" }}>&mdash;</span>
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
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border-subtle)" }}>
      {/* SCD2 version selector */}
      {data.silver.versions.length > 1 && (
        <div className="px-4 py-2 bg-[var(--bp-silver-light)]/20 flex items-center gap-3" style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}>
          <span className="text-xs font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>
            Silver Version:
          </span>
          <select
            value={clampedIdx}
            onChange={(e) => setSilverVersionIdx(Number(e.target.value))}
            aria-label="Select Silver SCD2 version"
            className="text-xs px-2 py-1 rounded"
            style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }}
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
          <span className="text-[10px]" style={{ color: "var(--bp-ink-tertiary)" }}>
            {data.silver.versions.length} version(s)
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr style={{ backgroundColor: "var(--bg-muted)" }}>
              <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider sticky left-0 z-10 min-w-[200px]" style={{ color: "var(--bp-ink-tertiary)", backgroundColor: "var(--bg-muted)" }}>
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
                  className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: "var(--bp-ink-muted)", backgroundColor: "var(--bg-muted)", borderBottom: "1px solid var(--bp-border-subtle)" }}
                >
                  Original Columns ({originalCols.length})
                </td>
              </tr>
            )}
            {originalCols.map((c, i) => renderRow(c, false, i))}

            {/* System columns */}
            {systemCols.length > 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: "rgba(71,85,105,0.6)", backgroundColor: "rgba(226,232,240,0.2)", borderBottom: "1px solid var(--bp-border-subtle)" }}
                >
                  System Columns ({systemCols.length})
                </td>
              </tr>
            )}
            {systemCols.map((c, i) => renderRow(c, true, originalCols.length + i))}
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
        return <Plus className="w-3.5 h-3.5 text-[var(--bp-operational)]" />;
      case "rename":
        return <ArrowRight className="w-3.5 h-3.5 text-[var(--bp-copper)]" />;
      case "transform":
        return <Sparkles className="w-3.5 h-3.5 text-[var(--bp-caution)]" />;
      case "none":
        return <Minus className="w-3.5 h-3.5" style={{ color: "rgba(168,162,158,0.4)" }} />;
      default:
        return <Info className="w-3.5 h-3.5" style={{ color: "var(--bp-ink-tertiary)" }} />;
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--bp-ink-primary)" }}>
        <ArrowRight className="w-4 h-4 text-[var(--bp-copper)]" />
        Transformation Pipeline ({steps.length} steps)
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {steps.map((step, i) => (
          <div
            key={step.step}
            className="rounded-lg p-3 transition-colors gs-stagger-card"
            style={{ '--i': Math.min(i, 15), border: "1px solid var(--bp-border-subtle)", backgroundColor: "var(--bp-surface-1)" } as React.CSSProperties}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center" style={{ color: "rgba(168,162,158,0.5)", backgroundColor: "var(--bg-muted)" }}>
                {step.step}
              </span>
              {impactIcon(step.impact)}
              {layerBadge(step.layer)}
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: "var(--bp-ink-primary)" }}>
              {step.description}
            </p>
            {step.details && (
              <p className="text-xs line-clamp-2" style={{ color: "var(--bp-ink-tertiary)" }}>
                {step.details}
              </p>
            )}
            {step.columns && step.columns.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {step.columns.slice(0, 5).map((col) => (
                  <code
                    key={col}
                    className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                    style={{ backgroundColor: "var(--bg-muted)", color: "var(--bp-ink-tertiary)" }}
                  >
                    {col}
                  </code>
                ))}
                {step.columns.length > 5 && (
                  <span className="text-[10px]" style={{ color: "rgba(168,162,158,0.5)" }}>
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
          className="flex-1 flex items-center rounded-lg transition-colors"
          style={{
            border: showDropdown ? "1px solid var(--bp-copper)" : "1px solid var(--bp-border-subtle)",
            backgroundColor: showDropdown ? "rgba(254,253,251,0.8)" : "var(--bp-surface-1)",
            ...(showDropdown ? { boxShadow: "0 0 0 1px var(--bp-border)" } : {}),
          }}
        >
          <Search className="w-4 h-4 ml-3 flex-shrink-0" style={{ color: "rgba(168,162,158,0.5)" }} />
          <input
            type="text"
            aria-label="Primary key search"
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
            className="w-full px-3 py-2.5 bg-transparent text-sm outline-none font-mono"
            style={{ color: "var(--bp-ink-primary)" }}
          />
          {loading && (
            <Loader2 className="w-4 h-4 mr-3 animate-spin" style={{ color: "rgba(168,162,158,0.5)" }} />
          )}
          {searchInput && !loading && (
            <button
              onClick={() => {
                setSearchInput("");
                setShowDropdown(false);
              }}
              aria-label="Clear search"
              className="mr-3"
              style={{ color: "rgba(168,162,158,0.4)" }}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* PK dropdown */}
      {showDropdown && pks.length > 0 && (
        <div className="absolute z-[200] mt-1 w-full max-h-60 overflow-y-auto rounded-lg shadow-2xl" style={{ border: "1px solid var(--bp-border-subtle)", backgroundColor: "var(--bp-surface-1)" }}>
          {pkColumn && (
            <div className="sticky top-0 px-3 py-2 backdrop-blur-sm" style={{ backgroundColor: "rgba(237,234,228,0.8)", borderBottom: "1px solid var(--bp-border-subtle)" }}>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--bp-copper)]">
                {pkColumn}
              </span>
            </div>
          )}
          {pks.map((pk) => (
            <button
              key={pk}
              onClick={() => handleSelect(pk)}
              className={cn(
                "w-full text-left px-3 py-2 hover:bg-[var(--bp-copper-light)] transition-colors text-sm font-mono",
                selectedPk === pk && "bg-[var(--bp-copper-light)] border-l-2 border-[var(--bp-copper)]"
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

  const parsedId = entityIdParam ? parseInt(entityIdParam, 10) : NaN;
  const entityId = Number.isNaN(parsedId) ? null : parsedId;
  const {
    data: microscopeData,
    loading: microscopeLoading,
    error: microscopeError,
    refresh,
  } = useMicroscope(entityId, pkParam);

  // Entity selection
  const handleEntitySelect = useCallback(
    (id: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set("entity", id);
        params.delete("pk");
        return params;
      });
    },
    [setSearchParams]
  );

  const handleEntityClear = useCallback(() => {
    setSearchParams({});
  }, [setSearchParams]);

  // PK selection
  const handlePkSelect = useCallback(
    (pk: string) => {
      setSearchParams((prev) => {
        const params = new URLSearchParams(prev);
        params.set("pk", pk);
        return params;
      });
    },
    [setSearchParams]
  );

  // Find selected entity for display
  const selectedEntity = useMemo(
    () => findEntityById(allEntities, entityIdParam),
    [allEntities, entityIdParam]
  );
  const recommendedAction = selectedEntity ? getEntityRecommendedAction(selectedEntity) : null;
  const headerFacts = selectedEntity
    ? [
        {
          label: "Active entity",
          value: selectedEntity.businessName || selectedEntity.tableName,
          detail: `${selectedEntity.source}.${selectedEntity.tableName}`,
          tone: "accent" as const,
        },
        {
          label: "Lifecycle coverage",
          value: `${getLoadedLayerCount(selectedEntity)} of 3 downstream layers loaded`,
          detail: selectedEntity.diagnosis || "Microscope works best when you want to inspect a single record across every available layer.",
          tone: selectedEntity.lastError ? "warning" as const : "neutral" as const,
        },
        {
          label: "Primary key",
          value: pkParam || "Enter a key to inspect",
          detail: selectedEntity.bronzePKs ? `Lookup uses ${selectedEntity.bronzePKs}.` : "Choose a specific record to compare values across layers.",
          tone: pkParam ? "positive" as const : "neutral" as const,
        },
      ]
    : [
        {
          label: "Purpose",
          value: "Record-level investigation",
          detail: "Pick one entity, then inspect a specific primary key as it moves across source, landing, bronze, and silver.",
          tone: "accent" as const,
        },
      ];
  const headerActions = selectedEntity
    ? [
        {
          label: recommendedAction?.label || "Review lineage",
          to: recommendedAction?.to || buildEntityLineageUrl(selectedEntity),
          tone: "primary" as const,
        },
        {
          label: "Journey",
          to: buildEntityJourneyUrl(selectedEntity),
          icon: GitBranch,
          tone: "secondary" as const,
        },
        {
          label: "Replay",
          to: buildEntityReplayUrl(selectedEntity, pkParam),
          icon: Eye,
          tone: "secondary" as const,
        },
        {
          label: "Catalog",
          to: buildEntityCatalogUrl(selectedEntity),
          icon: Library,
          tone: "quiet" as const,
        },
      ]
    : [];

  // ── No entity selected state ──
  if (!entityId) {
    return (
        <div className="space-y-6 gs-page-enter">
          <ExploreWorkbenchHeader
            eyebrow="Explore"
            meta={`${allEntities.length.toLocaleString("en-US")} tables available for record inspection`}
            title="Data Microscope"
          summary="Inspect one specific record across every available layer so you can see exactly where values changed, disappeared, or were generated by the platform."
          facts={headerFacts}
          guideItems={[
            {
              label: "What this page is",
              value: "Row-level cross-layer inspection",
              detail: "Microscope compares one primary-key record across source, landing, bronze, and silver in a single workspace.",
            },
            {
              label: "Why it matters",
              value: "This is where value drift becomes obvious",
              detail: "Use it when an issue is about a specific customer, batch, order, or other business record instead of an entire table.",
            },
            {
              label: "What happens next",
              value: "Select an entity and a primary key",
              detail: "Once you pick a record, the diff grid and transformation steps show what changed and which page should take over next.",
            },
          ]}
          actions={[]}
        />

        <EntitySelector
          entities={allEntities}
          selectedId={null}
          onSelect={handleEntitySelect}
          onClear={handleEntityClear}
          loading={digestLoading}
          placeholder="Select an entity to inspect..."
        />

        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-20 w-20 rounded-2xl flex items-center justify-center mb-6" style={{ backgroundColor: "var(--bp-surface-inset)" }}>
            <ScanSearch className="h-10 w-10 gs-float" style={{ color: "var(--bp-ink-muted)" }} />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: "var(--bp-ink-primary)" }}>
            Select an entity and primary key
          </h2>
          <p className="text-sm max-w-md" style={{ color: "var(--bp-ink-secondary)" }}>
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
    <div className="space-y-6 gs-page-enter">
      <ExploreWorkbenchHeader
        eyebrow="Explore"
        meta={selectedEntity ? `${selectedEntity.source}.${selectedEntity.tableName}` : null}
        title="Data Microscope"
        summary="Inspect one specific record across every available layer so you can see where values changed, which fields were generated by the platform, and what to investigate next."
        facts={headerFacts}
        guideItems={[
          {
            label: "What this page is",
            value: "A record-by-record comparison surface",
            detail: "Microscope is for inspecting one business record, not profiling an entire table.",
          },
          {
            label: "Why it matters",
            value: "It exposes value-level drift",
            detail: "When a user says a specific customer, order, or batch looks wrong, this is the fastest way to prove where the value changed.",
          },
          {
            label: "What happens next",
            value: pkParam ? "Compare values and review the transformation notes" : "Enter the primary key you want to inspect",
            detail: pkParam ? "Use the layer badges, diff grid, and transformation notes to isolate the layer that introduced the change." : "Choose the exact record so the page can pull the cross-layer comparison.",
          },
        ]}
        guideLinks={selectedEntity ? [
          { label: "Journey", to: buildEntityJourneyUrl(selectedEntity) },
          { label: "Lineage", to: buildEntityLineageUrl(selectedEntity) },
          { label: "Catalog", to: buildEntityCatalogUrl(selectedEntity) },
        ] : []}
        actions={headerActions}
        aside={pkParam ? (
          <button
            type="button"
            onClick={refresh}
            disabled={microscopeLoading}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 disabled:opacity-50"
            style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)", backgroundColor: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: 600 }}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", microscopeLoading && "animate-spin")} />
            Refresh
          </button>
        ) : null}
      />

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
            <div className="flex items-center gap-2 text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>
              <span className="font-mono">
                {selectedEntity.source}.{selectedEntity.tableName}
              </span>
              {selectedEntity.bronzePKs && (
                <>
                  <span style={{ color: "var(--bp-border)" }}>|</span>
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
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--bp-border)] bg-[var(--bp-caution-light)]">
          <AlertTriangle className="w-4 h-4 text-[var(--bp-caution)] shrink-0" />
          <p className="text-sm text-[var(--bp-caution)]">
            Source system unavailable (VPN required). Showing Landing Zone,
            Bronze, and Silver data only.
          </p>
        </div>
      )}

      {/* No PK prompt */}
      {showPkPrompt && !microscopeLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="h-16 w-16 rounded-2xl flex items-center justify-center mb-4" style={{ backgroundColor: "var(--bp-surface-inset)" }}>
            <Search className="h-8 w-8 gs-float" style={{ color: "var(--bp-ink-muted)" }} />
          </div>
          <h2 className="text-base font-semibold mb-1" style={{ color: "var(--bp-ink-primary)" }}>
            Enter a primary key value
          </h2>
          <p className="text-sm max-w-md" style={{ color: "var(--bp-ink-secondary)" }}>
            Search for a specific row by its primary key to inspect the data
            across all medallion layers.
          </p>
        </div>
      )}

      {/* Loading state */}
      {microscopeLoading && pkParam && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin mb-4" style={{ color: "var(--bp-copper)" }} />
          <p className="text-sm" style={{ color: "var(--bp-ink-tertiary)" }}>
            Querying across layers...
          </p>
        </div>
      )}

      {/* Error state */}
      {microscopeError && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg" style={{ border: "1px solid rgba(185,58,42,0.3)", backgroundColor: "var(--bp-fault-light)" }}>
          <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--bp-fault)" }} />
          <p className="text-sm" style={{ color: "var(--bp-fault)" }}>{microscopeError}</p>
        </div>
      )}

      {/* Main content: Diff Grid + Transformations */}
      {microscopeData && pkParam && !microscopeLoading && (
        <div className="space-y-6">
          {/* Layer summary badges */}
          <div className="flex flex-wrap gap-3">
            {(["source", "landing", "bronze", "silver"] as LayerKey[]).map(
              (layer, layerIdx) => {
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
                      "flex items-center gap-2 px-3 py-2 rounded-lg text-xs gs-stagger-card",
                      available ? meta.bg : "",
                      available ? meta.border : ""
                    )}
                    style={{ '--i': layerIdx, ...(!available ? { backgroundColor: "var(--bg-muted)", border: "1px solid var(--bp-border-subtle)" } : { border: "1px solid var(--bp-border-subtle)" }) } as unknown as React.CSSProperties}
                  >
                    <Icon
                      className={cn(
                        "w-3.5 h-3.5",
                        available ? meta.color : ""
                      )}
                      style={!available ? { color: "rgba(168,162,158,0.3)" } : undefined}
                    />
                    <span
                      className={cn(
                        "font-medium",
                        available ? meta.color : ""
                      )}
                      style={!available ? { color: "rgba(168,162,158,0.3)" } : undefined}
                    >
                      {meta.label}
                    </span>
                    {detail && (
                      <span className="truncate max-w-[150px]" style={{ color: "rgba(168,162,158,0.5)" }}>
                        {detail}
                      </span>
                    )}
                    {!available && (
                      <span className="text-[10px]" style={{ color: "rgba(168,162,158,0.4)" }}>
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
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-lg" style={{ border: "1px solid var(--bp-border-subtle)", backgroundColor: "var(--bp-surface-1)" }}>
              <AlertTriangle className="w-8 h-8 mb-3" style={{ color: "rgba(168,162,158,0.3)" }} />
              <p className="text-sm" style={{ color: "var(--bp-ink-tertiary)" }}>
                No row data found for PK value "{pkParam}" across any layer.
              </p>
              <p className="text-xs mt-1" style={{ color: "rgba(168,162,158,0.6)" }}>
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
