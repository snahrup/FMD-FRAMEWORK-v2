import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
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
  type LucideIcon,
} from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

// ============================================================================
// CONSTANTS
// ============================================================================

const API = import.meta.env.VITE_API_URL || "";

const LAYER_COLORS: Record<string, { color: string; bg: string; border: string; glow: string }> = {
  source:  { color: "#64748b", bg: "bg-slate-500/10",  border: "border-slate-500/30",  glow: "shadow-slate-500/20" },
  landing: { color: "#3b82f6", bg: "bg-blue-500/10",   border: "border-blue-500/30",   glow: "shadow-blue-500/20" },
  bronze:  { color: "#f59e0b", bg: "bg-amber-500/10",  border: "border-amber-500/30",  glow: "shadow-amber-500/20" },
  silver:  { color: "#8b5cf6", bg: "bg-violet-500/10", border: "border-violet-500/30",  glow: "shadow-violet-500/20" },
};

const IMPACT_STYLES: Record<string, { label: string; cls: string }> = {
  none:      { label: "Pass-through",  cls: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
  rename:    { label: "Rename",        cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  add:       { label: "Add Columns",   cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  transform: { label: "Transform",     cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  remove:    { label: "Remove Rows",   cls: "bg-red-500/10 text-red-400 border-red-500/20" },
  merge:     { label: "Delta Merge",   cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
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
  impact: ImpactKey;
}

interface MicroscopeResponse {
  transformations?: {
    step: number;
    before?: Record<string, string>;
    after?: Record<string, string>;
  }[];
  error?: string;
}

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
  // Blue (landing) -> Amber (bronze) -> Violet (silver)
  return `linear-gradient(90deg, #3b82f6 0%, #f59e0b 40%, #8b5cf6 70%, rgba(139,92,246,0.3) ${pct * 100}%, transparent ${pct * 100 + 0.1}%)`;
}

/** Determine which layer segment a step falls in for the timeline connector color */
function layerColorHex(layer: LayerKey): string {
  return LAYER_COLORS[layer]?.color || "#64748b";
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

/** Floating data particles between step cards */
function ParticleConnector({ color }: { color: string }) {
  return (
    <div className="relative h-16 w-8 flex items-center justify-center overflow-hidden ml-[15px]">
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
    <div className="replay-step-card flex gap-4 md:gap-6">
      {/* Left: timeline connector */}
      <div className="flex flex-col items-center flex-shrink-0 w-10">
        {/* Step number circle */}
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center border-2 text-xs font-bold z-10 transition-all duration-300"
          style={{
            borderColor: layerStyle.color,
            backgroundColor: `${layerStyle.color}15`,
            color: layerStyle.color,
          }}
        >
          {step.id}
        </div>
        {/* Vertical connector line */}
        {!isLast && (
          <div
            className="w-0.5 flex-1 mt-1"
            style={{ backgroundColor: `${layerStyle.color}30` }}
          />
        )}
      </div>

      {/* Right: card body */}
      <div
        className={cn(
          "flex-1 rounded-xl border p-5 mb-2 backdrop-blur-sm transition-all duration-300",
          "bg-card hover:bg-card/80",
          "border-border/30 hover:border-border/50",
          "hover:shadow-lg",
          layerStyle.glow,
        )}
      >
        {/* Top row: layer badge + title + impact badge */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Layer color badge */}
            <div
              className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider flex-shrink-0",
                layerStyle.bg,
                layerStyle.border,
              )}
              style={{ color: layerStyle.color }}
            >
              {layerDef && <layerDef.icon className="w-3 h-3" />}
              {step.layer}
            </div>

            {/* Title + icon */}
            <div className="flex items-center gap-2 min-w-0">
              <Icon className="w-4 h-4 flex-shrink-0" style={{ color: layerStyle.color }} />
              <h3 className="font-display font-semibold text-sm text-foreground truncate">
                {step.title}
              </h3>
            </div>
          </div>

          {/* Impact badge */}
          <span
            className={cn(
              "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border flex-shrink-0",
              impactStyle.cls,
            )}
          >
            {impactStyle.label}
          </span>
        </div>

        {/* Description */}
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">
          {step.description}
        </p>

        {/* Technical detail (expandable) */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors mb-3 cursor-pointer"
        >
          <ChevronRight
            className={cn("w-3 h-3 transition-transform duration-200", expanded && "rotate-90")}
          />
          <span className="font-medium">Technical Detail</span>
        </button>
        {expanded && (
          <div className="mb-3 px-3 py-2 rounded-md bg-muted border border-border/20">
            <code className="text-[11px] font-mono text-muted-foreground leading-relaxed break-all">
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
                className="inline-flex items-center px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-mono font-medium"
              >
                + {col}
              </span>
            ))}
          </div>
        )}

        {/* Before/After comparison (from microscope API or step definition) */}
        {beforeAfter && beforeAfter.length > 0 && (
          <div className="rounded-lg border border-border/20 overflow-hidden">
            <div className="grid grid-cols-3 bg-muted border-b border-border/20 px-3 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Column</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400/60">Before</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60">After</span>
            </div>
            {beforeAfter.slice(0, 5).map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-3 px-3 py-1.5 border-b border-border/10 last:border-b-0 hover:bg-muted/50"
              >
                <span className="text-xs font-mono text-foreground/80 truncate">{row.column}</span>
                <span className="text-xs font-mono text-red-400/70 truncate">{row.before}</span>
                <span className="text-xs font-mono text-emerald-400/70 truncate">{row.after}</span>
              </div>
            ))}
            {beforeAfter.length > 5 && (
              <div className="px-3 py-1 text-[10px] text-muted-foreground/40 text-center">
                + {beforeAfter.length - 5} more columns
              </div>
            )}
          </div>
        )}

        {/* Notebook reference */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/10">
          <div className="flex items-center gap-2 text-muted-foreground/40">
            <span className="text-[10px]">Notebook:</span>
            <code className="text-[10px] font-mono text-muted-foreground/60">
              {step.notebook}
            </code>
          </div>
          <span className="text-[10px] text-muted-foreground/30">
            Step {step.id} of {REPLAY_STEPS.length}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Shimmer skeleton for loading state */
function StepSkeleton({ index }: { index: number }) {
  return (
    <div className="flex gap-4 md:gap-6 animate-pulse" style={{ animationDelay: `${index * 80}ms` }}>
      <div className="flex flex-col items-center flex-shrink-0 w-10">
        <div className="w-9 h-9 rounded-full bg-muted" />
        <div className="w-0.5 flex-1 mt-1 bg-muted" />
      </div>
      <div className="flex-1 rounded-xl border border-border/20 bg-card p-5 mb-2">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-16 h-5 rounded bg-muted" />
          <div className="w-32 h-5 rounded bg-muted" />
        </div>
        <div className="space-y-2">
          <div className="w-full h-3 rounded bg-muted" />
          <div className="w-3/4 h-3 rounded bg-muted/15" />
        </div>
        <div className="flex gap-1.5 mt-3">
          <div className="w-20 h-4 rounded bg-muted/15" />
        </div>
      </div>
    </div>
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

  // ── Derive selected entity ──
  const selectedEntity = useMemo<DigestEntity | undefined>(() => {
    if (!entityIdParam) return undefined;
    return allEntities.find((e) => String(e.id) === entityIdParam);
  }, [entityIdParam, allEntities]);

  // ── Fetch microscope data when entity + PK are both set ──
  const fetchMicroscope = useCallback(async (entityId: string, pk: string) => {
    setMicroscopeLoading(true);
    setMicroscopeError(null);
    try {
      const res = await fetch(`${API}/api/microscope?entity=${entityId}&pk=${encodeURIComponent(pk)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: MicroscopeResponse = await res.json();
      if (data.error) {
        setMicroscopeError(data.error);
        setMicroscopeData(null);
      } else {
        setMicroscopeData(data);
      }
    } catch (e) {
      setMicroscopeError(e instanceof Error ? e.message : "Failed to load microscope data");
      setMicroscopeData(null);
    } finally {
      setMicroscopeLoading(false);
    }
  }, []);

  useEffect(() => {
    if (entityIdParam && pkParam) {
      fetchMicroscope(entityIdParam, pkParam);
    } else {
      setMicroscopeData(null);
      setMicroscopeError(null);
    }
  }, [entityIdParam, pkParam, fetchMicroscope]);

  // ── Merge steps with microscope transformations ──
  const enrichedSteps = useMemo<ReplayStep[]>(() => {
    if (!microscopeData?.transformations) return REPLAY_STEPS;
    return REPLAY_STEPS.map((step) => {
      const txn = microscopeData.transformations!.find((t) => t.step === step.id);
      if (!txn || !txn.before || !txn.after) return step;
      const beforeAfter = Object.keys(txn.after).map((col) => ({
        column: col,
        before: txn.before?.[col] ?? "",
        after: txn.after![col] ?? "",
      }));
      return { ...step, beforeAfter };
    });
  }, [microscopeData]);

  // ── GSAP ScrollTrigger animations ──
  useEffect(() => {
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      const cards = document.querySelectorAll(".replay-step-card");
      if (!cards.length) return;

      cards.forEach((card, i) => {
        gsap.from(card, {
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
      });

      // Progress bar tied to timeline scroll
      if (timelineRef.current) {
        ScrollTrigger.create({
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
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      ScrollTrigger.getAll().forEach((t) => t.kill());
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
  const subtitle = selectedEntity
    ? pkParam
      ? `${selectedEntity.source}: ${selectedEntity.tableName} (PK: ${pkParam})`
      : `${selectedEntity.source}: ${selectedEntity.tableName}`
    : "How Your Data Transforms \u2014 A Visual Walkthrough";

  // ── Layer summary counts ──
  const layerSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    REPLAY_STEPS.forEach((s) => {
      counts[s.layer] = (counts[s.layer] || 0) + 1;
    });
    return counts;
  }, []);

  return (
    <div className="space-y-6 pb-12">
      {/* ── Progress bar (fixed at top of content) ── */}
      <div
        ref={progressBarRef}
        className="sticky top-0 z-30 -mx-6 md:-mx-8 -mt-6 md:-mt-8 px-0"
      >
        <div className="h-1 bg-muted w-full overflow-hidden">
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
            <Clapperboard className="w-5 h-5 text-primary" />
            <div>
              <h1 className="font-display text-lg font-semibold text-foreground">
                Transformation Replay
              </h1>
              <p className="text-xs text-muted-foreground/60 mt-0.5">
                {subtitle}
              </p>
            </div>
          </div>

          {/* Progress indicator */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground/50">
              <span className="font-mono font-medium text-foreground">
                {currentStep}
              </span>
              <span>/</span>
              <span className="font-mono">{REPLAY_STEPS.length}</span>
              <span>steps</span>
            </div>
            {/* Layer mini-legend */}
            <div className="hidden md:flex items-center gap-1.5">
              {(["landing", "bronze", "silver"] as const).map((layer) => (
                <div
                  key={layer}
                  className={cn(
                    "flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider",
                    LAYER_COLORS[layer].bg,
                  )}
                  style={{ color: LAYER_COLORS[layer].color }}
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: LAYER_COLORS[layer].color }}
                  />
                  {layer}
                  <span className="text-muted-foreground/40 ml-0.5">({layerSummary[layer] || 0})</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Entity selector (optional) */}
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <EntitySelector
              entities={allEntities}
              selectedId={entityIdParam}
              onSelect={handleEntitySelect}
              onClear={handleEntityClear}
              loading={digestLoading}
              placeholder="Select an entity to see real transformation data..."
            />
          </div>
          {entityIdParam && (
            <div className="flex-shrink-0">
              <input
                type="text"
                placeholder="Primary Key..."
                defaultValue={pkParam || ""}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      setSearchParams({ entity: entityIdParam, pk: val }, { replace: true });
                    }
                  }
                }}
                className="h-[42px] px-3 w-36 rounded-lg border border-border/50 bg-card text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors"
              />
            </div>
          )}
        </div>

        {/* Microscope error banner */}
        {microscopeError && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-red-500/20 bg-red-500/5 text-red-400">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs">{microscopeError}</span>
          </div>
        )}
      </div>

      {/* ── Timeline ── */}
      <div ref={timelineRef} className="replay-timeline relative">
        {/* Loading skeleton overlay when fetching microscope data */}
        {microscopeLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <StepSkeleton key={i} index={i} />
            ))}
            <div className="flex items-center justify-center gap-2 text-muted-foreground py-8">
              <Loader2 className="w-4 h-4 animate-spin" />
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
                    <div className="flex items-center gap-3 py-4 ml-[15px]">
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
                        <ChevronRight className="w-3 h-3 text-muted-foreground/30" />
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wider"
                          style={{ color: layerColorHex(nextStep.layer) }}
                        >
                          {nextStep.layer}
                        </span>
                        <span className="text-[10px] text-muted-foreground/30 ml-2">
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
              <div className="w-9 h-9 rounded-full flex items-center justify-center border-2 border-emerald-500/50 bg-emerald-500/10">
                <span className="text-emerald-400 text-[10px] font-bold">FIN</span>
              </div>
            </div>
            <div className="flex-1 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <h3 className="font-display font-semibold text-sm text-emerald-400 mb-1">
                Transformation Complete
              </h3>
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                Data has passed through all {REPLAY_STEPS.length} transformation steps across the
                Landing Zone, Bronze, and Silver layers. The Silver table now contains clean,
                deduplicated, versioned data with full SCD2 history tracking.
                {selectedEntity && (
                  <span>
                    {" "}Entity <code className="text-foreground/80 font-mono">{selectedEntity.tableName}</code> is
                    ready for Gold layer materialization.
                  </span>
                )}
              </p>
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
