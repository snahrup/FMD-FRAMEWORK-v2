import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";
import EntitySelector from "@/components/EntitySelector";
import { LAYER_MAP } from "@/lib/layers";
import { cn } from "@/lib/utils";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  Clapperboard,
  Download,
  Type,
  Hash,
  Copy,
  Sparkles,
  Fingerprint,
  Clock,
  GitMerge,
  RefreshCw,
  History,
  GitCompare,
  Layers,
  Loader2,
  AlertTriangle,
  ChevronRight,
  Microscope,
  type LucideIcon,
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

// ============================================================================
// CONSTANTS
// ============================================================================

const API = import.meta.env.VITE_API_URL || "";

const LAYER_COLORS: Record<string, { color: string; bg: string; border: string; hex: string }> = {
  source:  { color: "var(--bp-ink-tertiary)", bg: "var(--bp-surface-inset)", border: "var(--bp-border)",      hex: "#78716C" },
  landing: { color: "var(--bp-copper)",       bg: "var(--bp-copper-light)",  border: "var(--bp-copper)",       hex: "#B45624" },
  bronze:  { color: "var(--bp-caution)",      bg: "var(--bp-caution-light)", border: "var(--bp-caution)",      hex: "#C27A1A" },
  silver:  { color: "var(--bp-operational)",   bg: "var(--bp-operational-light)", border: "var(--bp-operational)", hex: "#3D7C4F" },
};

const IMPACT_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  none:      { label: "Pass-through",  color: "var(--bp-ink-tertiary)", bg: "var(--bp-surface-inset)" },
  rename:    { label: "Rename",        color: "var(--bp-copper)",       bg: "var(--bp-copper-light)" },
  add:       { label: "Add Columns",   color: "var(--bp-operational)",  bg: "var(--bp-operational-light)" },
  transform: { label: "Transform",     color: "var(--bp-caution)",      bg: "var(--bp-caution-light)" },
  remove:    { label: "Remove Rows",   color: "var(--bp-fault)",        bg: "var(--bp-fault-light)" },
  merge:     { label: "Delta Merge",   color: "var(--bp-copper-hover)", bg: "var(--bp-copper-light)" },
};

// ============================================================================
// TYPES
// ============================================================================

type LayerKey = "source" | "landing" | "bronze" | "silver";
type ImpactKey = "none" | "rename" | "add" | "transform" | "remove" | "merge";

interface ReplayStep {
  id: number;
  layer: LayerKey;
  title: string;
  notebook: string;
  operation: string;
  icon: LucideIcon;
  description: string;
  technicalDetail: string;
  beforeAfter?: { column: string; before: string; after: string }[];
  columnsAdded?: string[];
  rulesRun?: string[];
  impact: ImpactKey;
}

interface MicroscopeResponse {
  mode?: "onelake" | "metadata" | "demo";
  entity?: {
    id: number;
    source: string;
    tableName: string;
    sourceSchema: string;
    primaryKeys: string[];
    pkValue?: string | null;
    overall: string;
    layers?: Record<string, { status: string; lastLoad?: string; rowCount?: number | null; physicalTableMatched?: boolean }>;
  };
  snapshots?: DemoLayerSnapshot[];
  transformations?: {
    step: number;
    before?: Record<string, string>;
    after?: Record<string, string>;
    rulesRun?: string[];
  }[];
  warnings?: string[];
  error?: string;
}

interface DemoLayerSnapshot {
  layer: LayerKey;
  title: string;
  table: string;
  receipt: string;
  row: Record<string, string>;
  rules: string[];
  rowSource?: string;
}

const DEMO_ENTITY = {
  source: "M3 ERP",
  table: "OCUSMA",
  primaryKey: "C-00173",
  rowLabel: "Customer master row",
};

const DEMO_STEP_DIFFS: Record<number, { column: string; before: string; after: string }[]> = {
  1: [
    { column: "Customer ID", before: "SQL row C-00173", after: "landing parquet row C-00173" },
    { column: "Customer Name", before: "  ACME RESINS, INC.  ", after: "  ACME RESINS, INC.  " },
    { column: "Postal Code", before: "NULL", after: "NULL" },
  ],
  2: [
    { column: "Customer ID", before: "Customer ID", after: "CustomerID" },
    { column: "Customer Name", before: "Customer Name", after: "CustomerName" },
    { column: "Modified Date", before: "Modified Date", after: "ModifiedDate" },
  ],
  3: [
    { column: "HashedPKColumn", before: "missing", after: "sha256:8fb7c2a4..." },
    { column: "PK input", before: "C-00173", after: "C-00173" },
  ],
  4: [
    { column: "Row copies", before: "2 rows with PK C-00173", after: "1 canonical row" },
    { column: "Kept row", before: "latest source extract wins", after: "row sequence 42" },
  ],
  5: [
    { column: "CustomerName", before: "  ACME RESINS, INC.  ", after: "ACME RESINS, INC." },
    { column: "PostalCode", before: "NULL", after: "UNKNOWN" },
    { column: "ModifiedDate", before: "4/20/26 09:15 AM", after: "2026-04-20T09:15:00" },
  ],
  6: [
    { column: "HashedNonKeyColumns", before: "missing", after: "md5:a73d91e5..." },
    { column: "Hash input", before: "raw non-key values", after: "cleansed Bronze values" },
  ],
  7: [
    { column: "RecordLoadDate", before: "missing", after: "2026-04-24T09:42:18Z" },
  ],
  8: [
    { column: "Delta action", before: "staged row", after: "matched existing row and updated" },
    { column: "Bronze table", before: "old hash md5:64bb...", after: "new hash md5:a73d..." },
  ],
  9: [
    { column: "CustomerName", before: "ACME RESINS, INC.", after: "Acme Resins Inc" },
    { column: "CreditHold", before: "N", after: "false" },
    { column: "PostalCode", before: "UNKNOWN", after: "" },
  ],
  10: [
    { column: "HashedNonKeyColumns", before: "md5:a73d91e5...", after: "md5:ef092c41..." },
  ],
  11: [
    { column: "IsCurrent", before: "missing", after: "true" },
    { column: "RecordStartDate", before: "missing", after: "2026-04-24T09:42:18Z" },
    { column: "RecordEndDate", before: "missing", after: "9999-12-31T00:00:00Z" },
    { column: "IsDeleted", before: "missing", after: "false" },
  ],
  12: [
    { column: "Change category", before: "existing current record", after: "update detected" },
    { column: "Old version", before: "IsCurrent=true", after: "IsCurrent=false" },
    { column: "New version", before: "missing", after: "Action=UPDATE" },
  ],
  13: [
    { column: "Silver current row", before: "old version active", after: "new version active" },
    { column: "History", before: "1 active row", after: "1 closed row, 1 active row" },
  ],
};

const DEMO_STEP_RULES: Record<number, string[]> = {
  1: ["Copy source rows to landing parquet", "Preserve raw values", "Attach run and source receipt"],
  2: ["Remove spaces from column names", "Preserve original column order"],
  3: ["Hash primary key columns with SHA-256", "Treat NULL key fragments as empty strings"],
  4: ["Drop duplicate primary key hashes", "Keep latest extracted row"],
  5: ["Trim text", "Fill configured NULL defaults", "Parse source datetime formats"],
  6: ["Hash non-key columns after Bronze cleansing", "Use hash as change detector"],
  7: ["Stamp Bronze load time", "Record lakehouse write receipt"],
  8: ["Insert new rows", "Update changed rows", "Delete missing rows on full loads"],
  9: ["Apply Silver naming rules", "Map code flags to business booleans", "Blank placeholder values"],
  10: ["Recompute non-key hash after Silver rules"],
  11: ["Add SCD2 validity columns", "Set open-ended current record"],
  12: ["Compare PK hash and non-key hash", "Classify insert/update/delete/no-change"],
  13: ["Close old versions", "Insert new current versions", "Soft-delete removed rows"],
};

const DEMO_LAYER_SNAPSHOTS: DemoLayerSnapshot[] = [
  {
    layer: "source",
    title: "Source system",
    table: "M3 ERP.OCUSMA",
    receipt: "Operational SQL row before FMD touches it.",
    row: {
      "Customer ID": "C-00173",
      "Customer Name": "  ACME RESINS, INC.  ",
      "Postal Code": "NULL",
      "Credit Hold": "N",
      "Modified Date": "4/20/26 09:15 AM",
    },
    rules: ["No transformation", "Read scoped source/entity metadata"],
  },
  {
    layer: "landing",
    title: "Landing",
    table: "LH_DATA_LANDINGZONE/m3/ocusma/run=20260424",
    receipt: "Raw parquet copy. Values are intentionally unchanged.",
    row: {
      "Customer ID": "C-00173",
      "Customer Name": "  ACME RESINS, INC.  ",
      "Postal Code": "NULL",
      "_fmd_run_id": "demo-run-0424",
      "_source_file": "OCUSMA_20260424.parquet",
    },
    rules: ["Raw copy", "Partition by run/source/entity", "Capture rows, bytes, errors"],
  },
  {
    layer: "bronze",
    title: "Bronze",
    table: "LH_BRONZE_LAYER.m3.OCUSMA",
    receipt: "Lakehouse-safe table with cleaned columns and change hashes.",
    row: {
      CustomerID: "C-00173",
      CustomerName: "ACME RESINS, INC.",
      PostalCode: "UNKNOWN",
      ModifiedDate: "2026-04-20T09:15:00",
      HashedPKColumn: "sha256:8fb7c2a4...",
      HashedNonKeyColumns: "md5:a73d91e5...",
    },
    rules: ["Sanitize column names", "Hash keys", "Deduplicate", "Apply Bronze cleansing", "Delta merge"],
  },
  {
    layer: "silver",
    title: "Silver",
    table: "LH_SILVER_LAYER.m3.Customer",
    receipt: "Business-consumable, versioned record with SCD2 history.",
    row: {
      CustomerID: "C-00173",
      CustomerName: "Acme Resins Inc",
      PostalCode: "",
      CreditHold: "false",
      IsCurrent: "true",
      Action: "UPDATE",
      RecordEndDate: "9999-12-31T00:00:00Z",
    },
    rules: ["Apply Silver business rules", "Recompute hash", "Classify change", "Write SCD2 version"],
  },
];

// ============================================================================
// THE 13 TRANSFORMATION STEPS
// ============================================================================

const REPLAY_STEPS: ReplayStep[] = [
  {
    id: 1, layer: "landing",
    title: "Source Extraction",
    notebook: "PL_FMD_LDZ_COPY_SQL",
    operation: "Copy Activity",
    icon: Download,
    description: "Raw data extracted from on-premises SQL Server and written as Parquet files to the Landing Zone lakehouse.",
    technicalDetail: "Fabric Copy Activity performs a byte-level transfer. SQL data types map to Parquet equivalents. No transformations applied.",
    impact: "none",
  },
  {
    id: 2, layer: "bronze",
    title: "Column Name Sanitization",
    notebook: "NB_FMD_LOAD_LANDING_BRONZE",
    operation: "Space Removal",
    icon: Type,
    description: "All spaces are removed from column names to ensure compatibility with Delta Lake table format.",
    technicalDetail: "col.replace(' ', '') applied to every column name. 'Customer Name' \u2192 'CustomerName'",
    impact: "rename",
  },
  {
    id: 3, layer: "bronze",
    title: "Primary Key Hash",
    notebook: "NB_FMD_LOAD_LANDING_BRONZE",
    operation: "SHA-256 Hash",
    icon: Hash,
    description: "A SHA-256 hash is computed from all primary key column values, creating a unique fingerprint for each row.",
    technicalDetail: "sha2(concat_ws('||', *pk_columns), 256) \u2014 NULLs treated as empty strings",
    columnsAdded: ["HashedPKColumn"],
    impact: "add",
  },
  {
    id: 4, layer: "bronze",
    title: "Deduplication",
    notebook: "NB_FMD_LOAD_LANDING_BRONZE",
    operation: "dropDuplicates",
    icon: Copy,
    description: "Duplicate rows with the same primary key hash are removed. Only one row per unique key is kept.",
    technicalDetail: "df.dropDuplicates(['HashedPKColumn']) \u2014 keeps arbitrary row on collision",
    impact: "remove",
  },
  {
    id: 5, layer: "bronze",
    title: "Data Cleansing",
    notebook: "NB_FMD_DQ_CLEANSING",
    operation: "Cleansing Rules",
    icon: Sparkles,
    description: "Entity-specific cleansing rules are applied: text normalization, NULL filling, datetime parsing.",
    technicalDetail: "Rules configured per-entity in metadata DB. Functions: normalize_text, fill_nulls, parse_datetime",
    impact: "transform",
  },
  {
    id: 6, layer: "bronze",
    title: "Change Detection Hash",
    notebook: "NB_FMD_LOAD_LANDING_BRONZE",
    operation: "MD5 Hash",
    icon: Fingerprint,
    description: "An MD5 hash of all non-key columns creates a change fingerprint. If any value changes, this hash changes.",
    technicalDetail: "md5(concat_ws('||', *non_key_columns).cast(StringType()))",
    columnsAdded: ["HashedNonKeyColumns"],
    impact: "add",
  },
  {
    id: 7, layer: "bronze",
    title: "Load Timestamp",
    notebook: "NB_FMD_LOAD_LANDING_BRONZE",
    operation: "current_timestamp()",
    icon: Clock,
    description: "A timestamp recording when this row was loaded into the Bronze layer.",
    technicalDetail: "df.withColumn('RecordLoadDate', current_timestamp())",
    columnsAdded: ["RecordLoadDate"],
    impact: "add",
  },
  {
    id: 8, layer: "bronze",
    title: "Delta MERGE",
    notebook: "NB_FMD_LOAD_LANDING_BRONZE",
    operation: "Upsert + Delete",
    icon: GitMerge,
    description: "New rows are inserted, changed rows are updated, and missing rows are hard-deleted (full load) or left alone (incremental).",
    technicalDetail: "deltaTable.merge(...).whenNotMatchedInsertAll().whenMatchedUpdateAll(hash_changed).whenNotMatchedBySourceDelete()",
    impact: "merge",
  },
  {
    id: 9, layer: "silver",
    title: "Silver Cleansing",
    notebook: "NB_FMD_DQ_CLEANSING",
    operation: "Silver Rules",
    icon: Sparkles,
    description: "Additional cleansing rules specific to the Silver layer are applied. An entity can have different rules at Bronze vs Silver.",
    technicalDetail: "sp_GetSilverCleansingRule returns Silver-specific rules",
    impact: "transform",
  },
  {
    id: 10, layer: "silver",
    title: "Hash Recomputation",
    notebook: "NB_FMD_LOAD_BRONZE_SILVER",
    operation: "MD5 Refresh",
    icon: RefreshCw,
    description: "The non-key hash is recomputed after Silver cleansing, since values may have changed.",
    technicalDetail: "HashedNonKeyColumns recalculated with post-cleansing values",
    impact: "transform",
  },
  {
    id: 11, layer: "silver",
    title: "SCD Type 2 Columns",
    notebook: "NB_FMD_LOAD_BRONZE_SILVER",
    operation: "Version Tracking",
    icon: History,
    description: "Slowly Changing Dimension Type 2 columns are added to track the full history of every row.",
    technicalDetail: "IsCurrent=True, RecordStartDate=now(), RecordEndDate='9999-12-31', IsDeleted=False",
    columnsAdded: ["IsCurrent", "RecordStartDate", "RecordEndDate", "RecordModifiedDate", "IsDeleted", "Action"],
    impact: "add",
  },
  {
    id: 12, layer: "silver",
    title: "Change Detection",
    notebook: "NB_FMD_LOAD_BRONZE_SILVER",
    operation: "4-Way Compare",
    icon: GitCompare,
    description: "Four change categories are computed: new inserts, updated rows (new version), closed-out old versions, and soft-deleted rows.",
    technicalDetail: "df_inserts \u222a df_updates_new \u222a df_updates_old \u222a df_deletes \u2014 based on HashedPKColumn and HashedNonKeyColumns comparison",
    impact: "transform",
  },
  {
    id: 13, layer: "silver",
    title: "SCD2 Delta MERGE",
    notebook: "NB_FMD_LOAD_BRONZE_SILVER",
    operation: "Versioned Merge",
    icon: Layers,
    description: "The final merge applies SCD2 logic: new versions are inserted, old versions are closed with an end date, deleted rows are soft-deleted.",
    technicalDetail: "Match on HashedPKColumn + RecordStartDate. Soft delete (IsDeleted=True), close old (IsCurrent=False, RecordEndDate=now), insert new (IsCurrent=True)",
    impact: "merge",
  },
];

// ============================================================================
// HELPERS
// ============================================================================

/** Build a gradient string that transitions through layer colors */
function progressGradient(pct: number): string {
  // Copper (landing) -> Caution (bronze) -> Operational (silver)
  return `linear-gradient(90deg, var(--bp-copper) 0%, var(--bp-caution) 40%, var(--bp-operational) 70%, color-mix(in srgb, var(--bp-operational) 30%, transparent) ${pct * 100}%, transparent ${pct * 100 + 0.1}%)`;
}

/** Return the raw hex color for a layer — needed for gradient stops and opacity suffixes */
function layerColorHex(layer: LayerKey): string {
  return LAYER_COLORS[layer]?.hex || "#64748b";
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Floating data particles between step cards */
function ParticleConnector({ color }: { color: string }) {
  return (
    <div className="relative h-16 w-8 flex items-center justify-center overflow-hidden ml-[15px]" aria-hidden="true">
      <svg width="8" height="60" viewBox="0 0 8 60" className="absolute">
        {[0, 1, 2].map((i) => (
          <circle
            key={i}
            cx="4"
            cy="4"
            r="2.5"
            fill={color}
            opacity="0"
            className="particle-dot"
            style={{
              animation: `particleFall 2s ${i * 0.6}s linear infinite`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}

/** Individual step card */
function StepCard({
  step,
  microscopeData,
  isLast,
}: {
  step: ReplayStep;
  microscopeData?: { column: string; before: string; after: string }[];
  isLast: boolean;
}) {
  const layerStyle = LAYER_COLORS[step.layer];
  const impactStyle = IMPACT_STYLES[step.impact];
  const Icon = step.icon;
  const layerDef = LAYER_MAP[step.layer];
  const [expanded, setExpanded] = useState(false);

  const beforeAfter = microscopeData || step.beforeAfter;

  return (
    <article className="replay-step-card gs-stagger-card flex gap-4 md:gap-6" style={{ '--i': step.id - 1 } as React.CSSProperties} aria-label={`Step ${step.id}: ${step.title}`}>
      {/* Left: timeline connector */}
      <div className="flex flex-col items-center flex-shrink-0 w-10">
        {/* Step number circle */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center border-2 text-xs font-bold z-10 transition-all duration-300"
          style={{
            borderColor: layerStyle.color,
            backgroundColor: `${layerStyle.hex}15`,
            color: layerStyle.color,
          }}
          aria-hidden="true"
        >
          {step.id}
        </div>
        {/* Vertical connector line */}
        {!isLast && (
          <div
            className="w-0.5 flex-1 mt-1"
            style={{ backgroundColor: `${layerStyle.hex}30` }}
            aria-hidden="true"
          />
        )}
      </div>

      {/* Right: card body */}
      <div
        className="flex-1 rounded-lg p-5 mb-2 transition-all duration-300"
        style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}
      >
        {/* Top row: layer badge + title + impact badge */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Layer color badge */}
            <div
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider flex-shrink-0"
              style={{ color: layerStyle.color, background: layerStyle.bg, border: `1px solid ${layerStyle.border}` }}
            >
              {layerDef && <layerDef.icon className="w-3 h-3" />}
              {step.layer}
            </div>

            {/* Title + icon */}
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="w-4 h-4 flex-shrink-0" style={{ color: layerStyle.color }} />
              <h3 className="text-sm truncate" style={{ fontFamily: 'var(--bp-font-body)', fontWeight: 600, color: 'var(--bp-ink-primary)' }}>
                {step.title}
              </h3>
            </div>
          </div>

          {/* Impact badge */}
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold flex-shrink-0"
            style={{ color: impactStyle.color, background: impactStyle.bg, border: `1px solid ${impactStyle.color}` }}
          >
            {impactStyle.label}
          </span>
        </div>

        {/* Description */}
        <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--bp-ink-secondary)' }}>
          {step.description}
        </p>

        {step.rulesRun && step.rulesRun.length > 0 && (
          <div className="mb-3 rounded-md p-3" style={{ border: '1px solid var(--bp-border-subtle)', background: 'var(--bp-surface-inset)' }}>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--bp-ink-tertiary)' }}>
              Transformations run
            </div>
            <div className="flex flex-wrap gap-1.5">
              {step.rulesRun.map((rule) => (
                <span
                  key={rule}
                  className="rounded-full px-2 py-1 text-[10px] font-semibold"
                  style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)', color: 'var(--bp-ink-secondary)' }}
                >
                  {rule}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Technical detail (expandable) */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[11px] transition-colors mb-3 cursor-pointer"
          style={{ color: 'var(--bp-ink-muted)' }}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} technical detail for step ${step.id}: ${step.title}`}
        >
          <ChevronRight
            className={cn("w-3 h-3 transition-transform duration-200", expanded && "rotate-90")}
          />
          <span className="font-medium">Technical Detail</span>
        </button>
        {expanded && (
          <div className="mb-3 px-3 py-2 rounded-md" style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border-subtle)' }}>
            <code className="text-[11px] leading-relaxed break-all" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-secondary)' }}>
              {step.technicalDetail}
            </code>
          </div>
        )}

        {/* Columns added */}
        {step.columnsAdded && step.columnsAdded.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {step.columnsAdded.map((col) => (
              <span
                key={col}
                className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium"
                style={{ background: 'var(--bp-operational-light)', color: 'var(--bp-operational)', border: '1px solid var(--bp-operational)', fontFamily: 'var(--bp-font-mono)' }}
              >
                + {col}
              </span>
            ))}
          </div>
        )}

        {/* Before/After comparison (from microscope API or step definition) */}
        {beforeAfter && beforeAfter.length > 0 && (
          <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--bp-border)' }} role="table" aria-label={`Before/after comparison for step ${step.id}`}>
            <div className="grid grid-cols-3 px-3 py-1.5" style={{ background: 'var(--bp-surface-inset)', borderBottom: '1px solid var(--bp-border-subtle)' }} role="row">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--bp-ink-muted)' }} role="columnheader">Column</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--bp-fault)' }} role="columnheader">Before</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--bp-operational)' }} role="columnheader">After</span>
            </div>
            {beforeAfter.slice(0, 5).map((row, i) => (
              <div
                key={i}
                className="gs-stagger-row gs-row-hover grid grid-cols-3 px-3 py-1.5"
                style={{ '--i': i, borderBottom: '1px solid var(--bp-border-subtle)', background: i % 2 === 1 ? 'var(--bp-surface-inset)' : 'transparent' } as React.CSSProperties}
                role="row"
              >
                <span className="text-xs truncate" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-primary)' }} role="cell">{row.column}</span>
                <span className="text-xs truncate" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-fault)' }} role="cell">{row.before}</span>
                <span className="text-xs truncate" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-operational)' }} role="cell">{row.after}</span>
              </div>
            ))}
            {beforeAfter.length > 5 && (
              <div className="px-3 py-1 text-[10px] text-center" style={{ color: 'var(--bp-ink-muted)' }}>
                + {beforeAfter.length - 5} more columns
              </div>
            )}
          </div>
        )}

        {/* Notebook reference */}
        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: '1px solid var(--bp-border-subtle)' }}>
          <div className="flex items-center gap-2" style={{ color: 'var(--bp-ink-muted)' }}>
            <span className="text-[10px]">Notebook:</span>
            <code className="text-[10px]" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-tertiary)' }}>
              {step.notebook}
            </code>
          </div>
          <span className="text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>
            Step {step.id} of {REPLAY_STEPS.length}
          </span>
        </div>
      </div>
    </article>
  );
}

/** Shimmer skeleton for loading state */
function StepSkeleton({ index }: { index: number }) {
  return (
    <div className="flex gap-4 md:gap-6 animate-pulse" style={{ animationDelay: `${index * 80}ms` }}>
      <div className="flex flex-col items-center flex-shrink-0 w-10">
        <div className="w-9 h-9 rounded-full" style={{ background: 'var(--bp-surface-inset)' }} />
        <div className="w-0.5 flex-1 mt-1" style={{ background: 'var(--bp-surface-inset)' }} />
      </div>
      <div className="flex-1 rounded-lg p-5 mb-2" style={{ border: '1px solid var(--bp-border-subtle)', background: 'var(--bp-surface-1)' }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-16 h-5 rounded" style={{ background: 'var(--bp-surface-inset)' }} />
          <div className="w-32 h-5 rounded" style={{ background: 'var(--bp-surface-inset)' }} />
        </div>
        <div className="space-y-2">
          <div className="w-full h-3 rounded" style={{ background: 'var(--bp-surface-inset)' }} />
          <div className="w-3/4 h-3 rounded" style={{ background: 'var(--bp-surface-inset)', opacity: 0.5 }} />
        </div>
        <div className="flex gap-1.5 mt-3">
          <div className="w-20 h-4 rounded" style={{ background: 'var(--bp-surface-inset)', opacity: 0.5 }} />
        </div>
      </div>
    </div>
  );
}

function DemoReplayPanel({
  snapshots,
  entity,
  mode,
  warnings = [],
}: {
  snapshots?: DemoLayerSnapshot[];
  entity?: MicroscopeResponse["entity"];
  mode?: MicroscopeResponse["mode"];
  warnings?: string[];
}) {
  const displaySnapshots = snapshots?.length ? snapshots : DEMO_LAYER_SNAPSHOTS;
  const isBackendReplay = Boolean(snapshots?.length && entity);

  return (
    <section className="bp-card gs-stagger-card" style={{ padding: 18, border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
      <div className="bp-rail bp-rail-operational" style={{ top: 14, bottom: 14 }} />
      <div className="flex flex-wrap items-start justify-between gap-4" style={{ paddingLeft: 6 }}>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--bp-copper)' }}>
            1. Layer snapshots at a glance
          </div>
          <h2 className="mt-1 text-xl font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-display)' }}>
            {entity ? `${entity.source} ${entity.tableName} row ${entity.pkValue || "sample"}` : `${DEMO_ENTITY.source} ${DEMO_ENTITY.table} row ${DEMO_ENTITY.primaryKey}`}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--bp-ink-secondary)' }}>
            These four cards summarize what the same record looks like after each major layer.
            The detailed transformation steps underneath explain how the row got from one snapshot to the next.
          </p>
        </div>
        <div className="rounded-full px-3 py-2 text-xs font-semibold" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-inset)', color: 'var(--bp-ink-secondary)' }}>
          {isBackendReplay
            ? mode === "onelake"
              ? "Backend-fed from local OneLake"
              : "Backend-fed from local metadata"
            : "Static fallback until API is available"}
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mt-4 rounded-lg p-3 text-xs" style={{ border: '1px solid var(--bp-caution)', background: 'var(--bp-caution-light)', color: 'var(--bp-ink-secondary)' }}>
          {warnings[0]}
        </div>
      )}

      <div className="mt-5 grid gap-3 lg:grid-cols-4">
        {displaySnapshots.map((snapshot, index) => {
          const layerStyle = LAYER_COLORS[snapshot.layer];
          return (
            <article
              key={snapshot.layer}
              className="gs-stagger-card rounded-xl p-4"
              style={{
                '--i': index,
                border: '1px solid var(--bp-border)',
                background: index % 2 === 0 ? 'var(--bp-surface-1)' : 'var(--bp-surface-inset)',
              } as React.CSSProperties}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: layerStyle.color, background: layerStyle.bg, border: `1px solid ${layerStyle.border}` }}>
                  {snapshot.title}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>
                  {snapshot.rowSource ? snapshot.rowSource : `${index + 1}/4`}
                </span>
              </div>
              <div className="mt-3 truncate text-xs font-semibold" title={snapshot.table} style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-mono)' }}>
                {snapshot.table}
              </div>
              <p className="mt-2 min-h-[38px] text-xs leading-relaxed" style={{ color: 'var(--bp-ink-tertiary)' }}>
                {snapshot.receipt}
              </p>
              <div className="mt-3 rounded-lg" style={{ border: '1px solid var(--bp-border-subtle)', background: 'var(--bp-surface-1)' }}>
                {Object.entries(snapshot.row).slice(0, 6).map(([key, value], rowIndex) => (
                  <div
                    key={key}
                    className="grid grid-cols-[0.9fr_1.1fr] gap-2 px-3 py-1.5 text-[10px]"
                    style={{ borderTop: rowIndex === 0 ? 'none' : '1px solid var(--bp-border-subtle)' }}
                  >
                    <span className="truncate" title={key} style={{ color: 'var(--bp-ink-muted)' }}>{key}</span>
                    <span className="truncate font-semibold" title={value} style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-mono)' }}>{value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {snapshot.rules.slice(0, 3).map((rule) => (
                  <span key={rule} className="rounded-full px-2 py-0.5 text-[9px] font-semibold" style={{ border: '1px solid var(--bp-border-subtle)', color: 'var(--bp-ink-tertiary)' }}>
                    {rule}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function TransformationReplay() {
  const [searchParams, setSearchParams] = useSearchParams();
  const entityIdParam = searchParams.get("entity");
  const pkParam = searchParams.get("pk");

  const { allEntities, loading: digestLoading } = useEntityDigest();

  const [microscopeData, setMicroscopeData] = useState<MicroscopeResponse | null>(null);
  const [microscopeLoading, setMicroscopeLoading] = useState(false);
  const [microscopeError, setMicroscopeError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(1);

  const timelineRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  // Anti-flash: suppress loading skeleton until first data arrives
  const hasLoadedOnce = useRef(false);
  if (!digestLoading && allEntities.length > 0) hasLoadedOnce.current = true;
  const showDigestLoading = digestLoading && !hasLoadedOnce.current;

  const replayReadyEntities = useMemo(
    () =>
      allEntities.filter((entity) => {
        const overall = (entity.overall || "").toLowerCase();
        const layerStatuses = [entity.lzStatus, entity.bronzeStatus, entity.silverStatus].map((status) =>
          (status || "").toLowerCase(),
        );
        return overall === "complete" || layerStatuses.every((status) => ["loaded", "complete", "succeeded", "success"].includes(status));
      }),
    [allEntities],
  );

  // ── Derive selected entity ──
  const selectedEntity = useMemo<DigestEntity | undefined>(() => {
    if (!entityIdParam) return undefined;
    return replayReadyEntities.find((e) => String(e.id) === entityIdParam) || allEntities.find((e) => String(e.id) === entityIdParam);
  }, [entityIdParam, replayReadyEntities, allEntities]);

  // ── Fetch backend-fed replay data. This only needs local SQLite/OneLake state. ──
  const fetchReplay = useCallback(async (entityId?: string | null, pk?: string | null) => {
    setMicroscopeLoading(true);
    setMicroscopeError(null);
    try {
      const params = new URLSearchParams();
      if (entityId) params.set("entity", entityId);
      if (pk) params.set("pk", pk);
      const res = await fetch(`${API}/api/transformation-replay?${params.toString()}`);
      if (!res.ok) {
        const message = await res.text().catch(() => "");
        throw new Error(message || `HTTP ${res.status}`);
      }
      const data: MicroscopeResponse = await res.json();
      if (data.error) {
        setMicroscopeError(data.error);
        setMicroscopeData(null);
      } else {
        setMicroscopeData(data);
      }
    } catch (e) {
      setMicroscopeError(e instanceof Error ? e.message : "Failed to load transformation replay data");
      setMicroscopeData(null);
    } finally {
      setMicroscopeLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReplay(entityIdParam, pkParam);
  }, [entityIdParam, pkParam, fetchReplay]);

  // ── Merge steps with microscope transformations ──
  const enrichedSteps = useMemo<ReplayStep[]>(() => {
    if (!microscopeData?.transformations?.length) {
      return REPLAY_STEPS.map((step) => ({
        ...step,
        beforeAfter: DEMO_STEP_DIFFS[step.id] || step.beforeAfter,
        rulesRun: DEMO_STEP_RULES[step.id] || step.rulesRun,
      }));
    }
    return REPLAY_STEPS.map((step) => {
      const txn = microscopeData.transformations!.find((t) => t.step === step.id);
      if (!txn || !txn.before || !txn.after) {
        return { ...step, rulesRun: txn?.rulesRun || DEMO_STEP_RULES[step.id] || step.rulesRun };
      }
      const beforeAfter = Object.keys(txn.after).map((col) => ({
        column: col,
        before: txn.before?.[col] ?? "",
        after: txn.after![col] ?? "",
      }));
      return { ...step, beforeAfter, rulesRun: txn.rulesRun || DEMO_STEP_RULES[step.id] || step.rulesRun };
    });
  }, [microscopeData]);

  // ── GSAP ScrollTrigger animations ──
  useEffect(() => {
    const localTriggers: ScrollTrigger[] = [];

    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      const cards = document.querySelectorAll(".replay-step-card");
      if (!cards.length) return;

      cards.forEach((card, i) => {
        const tween = gsap.from(card, {
          scrollTrigger: {
            trigger: card,
            start: "top 85%",
            end: "top 50%",
            toggleActions: "play none none reverse",
          },
          opacity: 0,
          x: -40,
          duration: 0.6,
          ease: "power2.out",
          delay: 0.05 * (i % 3),
        });
        if (tween.scrollTrigger) localTriggers.push(tween.scrollTrigger);
      });

      // Progress bar tied to timeline scroll
      if (timelineRef.current) {
        const st = ScrollTrigger.create({
          trigger: timelineRef.current,
          start: "top top",
          end: "bottom bottom",
          onUpdate: (self) => {
            setProgress(self.progress);
            // Compute current step based on progress
            const stepIdx = Math.min(
              Math.floor(self.progress * REPLAY_STEPS.length),
              REPLAY_STEPS.length - 1,
            );
            setCurrentStep(stepIdx + 1);
          },
        });
        localTriggers.push(st);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      localTriggers.forEach((t) => t.kill());
    };
  }, [enrichedSteps]);

  // ── Entity selection handler ──
  const handleEntitySelect = useCallback(
    (entityId: string) => {
      const params: Record<string, string> = { entity: entityId };
      if (pkParam) params.pk = pkParam;
      setSearchParams(params, { replace: true });
    },
    [pkParam, setSearchParams],
  );

  const handleEntityClear = useCallback(() => {
    setSearchParams({}, { replace: true });
    setMicroscopeData(null);
    setMicroscopeError(null);
  }, [setSearchParams]);

  // ── Determine header subtitle ──
  const replayEntity = microscopeData?.entity;
  const activeEntityId = entityIdParam || (replayEntity?.id ? String(replayEntity.id) : null);
  const activePk = pkParam || replayEntity?.pkValue || "";

  const subtitle = replayEntity
    ? `${replayEntity.source}: ${replayEntity.tableName}${replayEntity.pkValue ? ` (PK: ${replayEntity.pkValue})` : ""}`
    : selectedEntity
    ? pkParam
      ? `${selectedEntity.source}: ${selectedEntity.tableName} (PK: ${pkParam})`
      : `${selectedEntity.source}: ${selectedEntity.tableName}`
    : `${DEMO_ENTITY.source}: ${DEMO_ENTITY.table} (${DEMO_ENTITY.rowLabel} ${DEMO_ENTITY.primaryKey})`;
  // ── Layer summary counts ──
  const layerSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    REPLAY_STEPS.forEach((s) => {
      counts[s.layer] = (counts[s.layer] || 0) + 1;
    });
    return counts;
  }, []);

  return (
    <div className="gs-page-enter space-y-6 pb-12" style={{ padding: 32, maxWidth: 1280, margin: '0 auto' }} role="main" aria-label="Transformation Replay">
      {/* ── Progress bar (fixed at top of content) ── */}
      <div
        ref={progressBarRef}
        className="sticky top-0 z-30 -mx-6 md:-mx-8 -mt-6 md:-mt-8 px-0"
      >
        <div className="h-1 w-full overflow-hidden" style={{ background: 'var(--bp-surface-inset)' }} role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Transformation progress: step ${currentStep} of ${REPLAY_STEPS.length}`}>
          <div
            className="h-full transition-all duration-100 ease-linear rounded-r-full"
            style={{
              width: `${progress * 100}%`,
              background: progressGradient(progress),
            }}
          />
        </div>
      </div>

      {/* ── Hero section ── */}
      <div className="space-y-5">
        {/* Title row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clapperboard className="w-5 h-5" style={{ color: 'var(--bp-copper)' }} />
            <div>
              <h1 style={{ fontFamily: 'var(--bp-font-display)', fontSize: 36, color: 'var(--bp-ink-primary)', fontWeight: 400, lineHeight: 1.2 }}>
                Transformation Replay
              </h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--bp-ink-tertiary)' }}>
                {subtitle}
              </p>
            </div>
          </div>

          {/* Progress indicator */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs" style={{ color: 'var(--bp-ink-muted)' }}>
              <span style={{ fontFamily: 'var(--bp-font-mono)', fontWeight: 500, color: 'var(--bp-ink-primary)' }}>
                {currentStep}
              </span>
              <span>/</span>
              <span style={{ fontFamily: 'var(--bp-font-mono)' }}>{REPLAY_STEPS.length}</span>
              <span>steps</span>
            </div>
            {/* Layer mini-legend */}
            <div className="hidden md:flex items-center gap-1.5">
              {(["landing", "bronze", "silver"] as const).map((layer) => (
                <div
                  key={layer}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider"
                  style={{ color: LAYER_COLORS[layer].color, background: LAYER_COLORS[layer].bg }}
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: LAYER_COLORS[layer].color }}
                  />
                  {layer}
                  <span className="ml-0.5" style={{ color: 'var(--bp-ink-muted)' }}>({layerSummary[layer] || 0})</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DemoReplayPanel
          snapshots={microscopeData?.snapshots}
          entity={microscopeData?.entity}
          mode={microscopeData?.mode}
          warnings={microscopeData?.warnings}
        />

        {/* Entity selector (optional) */}
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <EntitySelector
              entities={replayReadyEntities}
              selectedId={activeEntityId}
              onSelect={handleEntitySelect}
              onClear={handleEntityClear}
              loading={showDigestLoading}
              placeholder={`Select one of ${replayReadyEntities.length.toLocaleString()} completed entities...`}
            />
          </div>
          {activeEntityId && (
            <div className="flex-shrink-0">
              <input
                key={activePk || ""}
                type="text"
                placeholder="Primary Key..."
                defaultValue={activePk || ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      setSearchParams({ entity: activeEntityId, pk: val }, { replace: true });
                    }
                  }
                }}
                className="h-[42px] px-3 w-36 rounded-md text-sm outline-none transition-colors"
                style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)', color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}
                aria-label="Primary key value for microscope lookup"
              />
            </div>
          )}
        </div>

        {/* Microscope error banner */}
        {microscopeError && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-md" style={{ border: '1px solid var(--bp-fault)', background: 'var(--bp-fault-light)', color: 'var(--bp-fault)' }} role="alert">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            <span className="text-xs">{microscopeError}</span>
          </div>
        )}
      </div>

      {/* ── Timeline ── */}
      <div ref={timelineRef} className="replay-timeline relative" aria-label="Transformation steps timeline">
        <div className="mb-4 rounded-xl p-4" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--bp-copper)' }}>
            2. Step-by-step transformation receipts
          </div>
          <h2 className="mt-1 text-lg font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-display)' }}>
            Every card below is one operation in the pipeline.
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed" style={{ color: 'var(--bp-ink-secondary)' }}>
            Read these from top to bottom. Each step shows what ran, which notebook or operation owns it,
            and the before/after values when that step changes the selected row.
          </p>
        </div>

        {/* Loading skeleton overlay when fetching microscope data */}
        {microscopeLoading && (
          <div className="space-y-2" role="status" aria-label="Loading transformation data">
            {Array.from({ length: 5 }).map((_, i) => (
              <StepSkeleton key={i} index={i} />
            ))}
            <div className="flex items-center justify-center gap-2 py-8" style={{ color: 'var(--bp-ink-secondary)' }} aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--bp-copper)' }} aria-hidden="true" />
              <span className="text-xs">Loading transformation data...</span>
            </div>
          </div>
        )}

        {/* Actual step cards */}
        {!microscopeLoading && (
          <div className="space-y-0">
            {enrichedSteps.map((step, idx) => {
              const nextStep = enrichedSteps[idx + 1];
              const isLast = idx === enrichedSteps.length - 1;
              const showParticles = !isLast && nextStep && nextStep.layer === step.layer;

              return (
                <div key={step.id}>
                  <StepCard
                    step={step}
                    microscopeData={step.beforeAfter}
                    isLast={isLast}
                  />
                  {/* Particle connector between same-layer steps */}
                  {showParticles && (
                    <ParticleConnector color={layerColorHex(step.layer)} />
                  )}
                  {/* Layer transition divider */}
                  {!isLast && nextStep && nextStep.layer !== step.layer && (
                    <div className="gs-stagger-card flex items-center gap-3 py-4 ml-[15px]" style={{ '--i': idx } as React.CSSProperties}>
                      <div className="flex flex-col items-center">
                        <div
                          className="w-3 h-3 rounded-full border-2"
                          style={{
                            borderColor: layerColorHex(step.layer),
                            backgroundColor: `${layerColorHex(step.layer)}30`,
                          }}
                        />
                        <div
                          className="w-0.5 h-6"
                          style={{
                            background: `linear-gradient(to bottom, ${layerColorHex(step.layer)}, ${layerColorHex(nextStep.layer)})`,
                          }}
                        />
                        <div
                          className="w-3 h-3 rounded-full border-2"
                          style={{
                            borderColor: layerColorHex(nextStep.layer),
                            backgroundColor: `${layerColorHex(nextStep.layer)}30`,
                          }}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wider"
                          style={{ color: layerColorHex(step.layer) }}
                        >
                          {step.layer}
                        </span>
                        <ChevronRight className="w-3 h-3" style={{ color: 'var(--bp-ink-muted)' }} />
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wider"
                          style={{ color: layerColorHex(nextStep.layer) }}
                        >
                          {nextStep.layer}
                        </span>
                        <span className="text-[10px] ml-2" style={{ color: 'var(--bp-ink-muted)' }}>
                          Layer transition
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* End marker */}
        {!microscopeLoading && (
          <div className="flex gap-4 md:gap-6 mt-2">
            <div className="flex flex-col items-center flex-shrink-0 w-10">
              <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ border: '2px solid var(--bp-operational)', background: 'var(--bp-operational-light)' }}>
                <span className="text-[10px] font-bold" style={{ color: 'var(--bp-operational)' }}>FIN</span>
              </div>
            </div>
            <div className="flex-1 rounded-lg p-5" style={{ border: '1px solid var(--bp-operational)', background: 'var(--bp-operational-light)' }}>
              <h3 className="text-sm mb-1" style={{ fontFamily: 'var(--bp-font-body)', fontWeight: 600, color: 'var(--bp-operational)' }}>
                Transformation Complete
              </h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--bp-ink-secondary)' }}>
                Data has passed through all {REPLAY_STEPS.length} transformation steps across the
                Landing Zone, Bronze, and Silver layers. The Silver table now contains clean,
                deduplicated, versioned data with full SCD2 history tracking.
                {(selectedEntity || replayEntity) && (
                  <span>
                    {" "}Entity <code style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-primary)' }}>{selectedEntity?.tableName || replayEntity?.tableName}</code> is
                    ready for Gold layer materialization.
                  </span>
                )}
              </p>
              {/* Cross-page link to Data Microscope */}
              {(selectedEntity || replayEntity) && activeEntityId && (
                <Link
                  to={`/microscope?entity=${activeEntityId}${activePk ? `&pk=${encodeURIComponent(activePk)}` : ""}`}
                  className="inline-flex items-center gap-1.5 mt-3 text-xs transition-colors"
                  style={{ color: 'var(--bp-copper)' }}
                  aria-label={`View ${selectedEntity?.tableName || replayEntity?.tableName} in Data Microscope`}
                >
                  <Microscope className="w-3.5 h-3.5" />
                  <span>Inspect in Data Microscope</span>
                  <ChevronRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── CSS for particle animation ── */}
      <style>{`
        @keyframes particleFall {
          0% { transform: translateY(0); opacity: 0; }
          15% { opacity: 0.8; }
          85% { opacity: 0.6; }
          100% { transform: translateY(52px); opacity: 0; }
        }
        .particle-dot {
          animation-fill-mode: both;
        }
      `}</style>
    </div>
  );
}
