import { useEffect, useState, useCallback } from "react";
import {
  ClipboardCheck,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
  Shield,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================================================
// TYPES
// ============================================================================

interface ValidationSummary {
  total_validations: number;
  passed: number;
  failed: number;
  entities_validated: number;
  runs_validated: number;
  total_entities: number;
  coverage_pct: number;
}

interface ValidationResult {
  id: number;
  entity_id: number;
  layer: string;
  passed: boolean;
  schema_name: string | null;
  error_count: number;
  errors: { column: string; check: string; message: string }[];
  validated_at: string;
  source_name?: string;
  source_database?: string;
}

interface RunResults {
  run_id: string;
  results: ValidationResult[];
}

interface CoverageItem {
  entity_id: number;
  source_name: string;
  source_database: string;
  schema_name: string;
}

interface CoverageResponse {
  entities_with_schemas: number;
  total_active_entities: number;
  coverage_pct: number;
  covered: CoverageItem[];
}

// ============================================================================
// KPI CARD
// ============================================================================

function KpiCard({
  label,
  value,
  icon: Icon,
  color = "var(--bp-ink)",
  sub,
}: {
  label: string;
  value: string | number;
  icon: typeof ClipboardCheck;
  color?: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-xl border p-4 flex flex-col gap-1"
      style={{
        background: "var(--bp-surface, #fafaf8)",
        borderColor: "var(--bp-border, #e5e2dc)",
      }}
    >
      <div className="flex items-center gap-2 text-xs font-medium" style={{ color: "var(--bp-ink-muted)" }}>
        <Icon size={14} />
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE
// ============================================================================

export default function SchemaValidation() {
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [recentResults, setRecentResults] = useState<ValidationResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedEntity, setExpandedEntity] = useState<number | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sumRes, covRes] = await Promise.all([
        fetch("/api/schema-validation/summary"),
        fetch("/api/schema-validation/coverage"),
      ]);
      if (!sumRes.ok || !covRes.ok) throw new Error("Failed to fetch validation data");
      const sumData = await sumRes.json();
      const covData = await covRes.json();
      setSummary(sumData);
      setCoverage(covData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-2" style={{ color: "var(--bp-ink-muted)" }}>
        <Loader2 className="animate-spin" size={18} />
        Loading schema validation data…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 gap-2" style={{ color: "var(--bp-accent-red, #c0392b)" }}>
        <AlertTriangle size={18} />
        {error}
      </div>
    );
  }

  const s = summary!;
  const c = coverage!;

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "var(--bp-accent, #b8612b)", color: "#fff" }}
          >
            <ClipboardCheck size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--bp-ink)" }}>
              Schema Validation
            </h1>
            <p className="text-sm" style={{ color: "var(--bp-ink-muted)" }}>
              Pandera schema-as-code validation between extraction and loading
            </p>
          </div>
        </div>
        <button
          onClick={fetchData}
          className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border transition-colors hover:bg-[var(--bp-surface-hover)]"
          style={{ borderColor: "var(--bp-border)", color: "var(--bp-ink-muted)" }}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          label="Total Validations"
          value={s.total_validations}
          icon={ClipboardCheck}
        />
        <KpiCard
          label="Passed"
          value={s.passed}
          icon={CheckCircle}
          color="var(--bp-accent-green, #27ae60)"
        />
        <KpiCard
          label="Failed"
          value={s.failed}
          icon={XCircle}
          color={s.failed > 0 ? "var(--bp-accent-red, #c0392b)" : "var(--bp-ink-muted)"}
        />
        <KpiCard
          label="Entities Validated"
          value={s.entities_validated}
          icon={Database}
          sub={`of ${s.total_entities} total`}
        />
        <KpiCard
          label="Runs"
          value={s.runs_validated}
          icon={Shield}
        />
        <KpiCard
          label="Coverage"
          value={`${s.coverage_pct}%`}
          icon={Shield}
          color={s.coverage_pct > 50 ? "var(--bp-accent-green, #27ae60)" : "var(--bp-accent, #b8612b)"}
          sub={`${c.entities_with_schemas} schemas registered`}
        />
      </div>

      {/* Schema Coverage Table */}
      <div
        className="rounded-xl border overflow-hidden"
        style={{
          background: "var(--bp-surface, #fafaf8)",
          borderColor: "var(--bp-border, #e5e2dc)",
        }}
      >
        <div
          className="px-4 py-3 border-b flex items-center justify-between"
          style={{ borderColor: "var(--bp-border)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--bp-ink)" }}>
            Registered Schemas ({c.entities_with_schemas})
          </h2>
          <span className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>
            Tables without schemas pass validation with a warning
          </span>
        </div>

        {c.covered.length === 0 ? (
          <div className="p-8 text-center" style={{ color: "var(--bp-ink-muted)" }}>
            <Shield className="mx-auto mb-2 opacity-30" size={32} />
            <p className="text-sm">No schemas registered yet</p>
            <p className="text-xs mt-1">
              Schemas are defined in <code className="text-xs">engine/schemas/</code> and
              validated during extraction. Run a load to see results.
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--bp-border)" }}>
            {c.covered.map((item) => (
              <div
                key={item.entity_id}
                className="px-4 py-2.5 flex items-center gap-4 text-sm hover:bg-[var(--bp-surface-hover)] transition-colors cursor-pointer"
                onClick={() =>
                  setExpandedEntity(expandedEntity === item.entity_id ? null : item.entity_id)
                }
              >
                {expandedEntity === item.entity_id ? (
                  <ChevronDown size={14} style={{ color: "var(--bp-ink-muted)" }} />
                ) : (
                  <ChevronRight size={14} style={{ color: "var(--bp-ink-muted)" }} />
                )}
                <span className="font-medium" style={{ color: "var(--bp-ink)" }}>
                  {item.source_database}.{item.source_name}
                </span>
                <span
                  className="ml-auto text-xs px-2 py-0.5 rounded-full"
                  style={{
                    background: "var(--bp-accent-green, #27ae60)",
                    color: "#fff",
                    opacity: 0.85,
                  }}
                >
                  {item.schema_name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Empty State for No Validations */}
      {s.total_validations === 0 && (
        <div
          className="rounded-xl border p-8 text-center"
          style={{
            background: "var(--bp-surface, #fafaf8)",
            borderColor: "var(--bp-border, #e5e2dc)",
          }}
        >
          <ClipboardCheck className="mx-auto mb-3 opacity-20" size={48} />
          <h3 className="text-base font-semibold mb-1" style={{ color: "var(--bp-ink)" }}>
            No validation results yet
          </h3>
          <p className="text-sm max-w-md mx-auto" style={{ color: "var(--bp-ink-muted)" }}>
            Schema validation runs automatically during extraction when{" "}
            <code className="text-xs">validation_mode</code> is set to{" "}
            <code className="text-xs">"warn"</code> or{" "}
            <code className="text-xs">"enforce"</code> in the engine config.
            Run a load to see results here.
          </p>
        </div>
      )}
    </div>
  );
}
