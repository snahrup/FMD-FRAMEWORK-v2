import { useNavigate } from "react-router-dom";
import { GovernanceScore } from "./GovernanceScore";

interface GovernancePanelProps {
  classification: {
    classifiedColumns: number;
    totalColumns: number;
    coveragePct: number;
    piiCount: number;
  };
  schemaValidation: {
    total: number;
    passed: number;
    failed: number;
  };
  purview: {
    mappingCount: number;
    lastSyncStatus: string | null;
    lastSyncAt: string | null;
    status: "synced" | "ready" | "pending";
  };
}

const PURVIEW_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  synced: { bg: "var(--bp-operational)", text: "#fff", label: "Synced" },
  ready: { bg: "var(--bp-copper-soft)", text: "var(--bp-copper)", label: "Ready" },
  pending: { bg: "var(--bp-border)", text: "var(--bp-ink-muted)", label: "Pending" },
};

export function GovernancePanel({
  classification,
  schemaValidation,
  purview,
}: GovernancePanelProps) {
  const navigate = useNavigate();
  const pvBadge = PURVIEW_BADGE[purview.status] || PURVIEW_BADGE.pending;

  return (
    <div
      className="estate-governance-panel rounded-xl border space-y-4"
      style={{
        background: "var(--bp-surface-1)",
        borderColor: "var(--bp-border-strong)",
        animationDelay: "600ms",
      }}
    >
      {/* Governance Score */}
      <div className="pt-4 px-4">
        <GovernanceScore
          classificationPct={classification.coveragePct}
          validationPassed={schemaValidation.passed}
          validationTotal={schemaValidation.total}
          purviewStatus={purview.status}
        />
      </div>

      {/* Classification section */}
      <button
        onClick={() => navigate("/classification")}
        className="w-full text-left px-4 py-2.5 border-t transition-colors hover:bg-[var(--bp-surface-inset)]"
        style={{ borderColor: "var(--bp-border-subtle)" }}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>
            Classification
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
            {classification.coveragePct}%
          </span>
        </div>
        {/* Mini progress bar */}
        <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--bp-border)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${classification.coveragePct}%`,
              background: "var(--bp-copper)",
              transition: "width 0.8s var(--ease-claude)",
            }}
          />
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-[10px]" style={{ color: "var(--bp-ink-tertiary)" }}>
          <span className="tabular-nums">{classification.classifiedColumns} columns</span>
          {classification.piiCount > 0 && (
            <span className="tabular-nums" style={{ color: "var(--bp-fault)" }}>
              {classification.piiCount} PII
            </span>
          )}
        </div>
      </button>

      {/* Schema Validation section */}
      <button
        onClick={() => navigate("/schema-validation")}
        className="w-full text-left px-4 py-2.5 border-t transition-colors hover:bg-[var(--bp-surface-inset)]"
        style={{ borderColor: "var(--bp-border-subtle)" }}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>
            Schema Validation
          </span>
        </div>
        <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--bp-ink-tertiary)" }}>
          {schemaValidation.total > 0 ? (
            <>
              <span className="tabular-nums">
                <strong style={{ color: "var(--bp-operational)" }}>{schemaValidation.passed}</strong> passed
              </span>
              {schemaValidation.failed > 0 && (
                <span className="tabular-nums">
                  <strong style={{ color: "var(--bp-fault)" }}>{schemaValidation.failed}</strong> failed
                </span>
              )}
            </>
          ) : (
            <span>No validations yet</span>
          )}
        </div>
      </button>

      {/* Purview section */}
      <div className="px-4 py-2.5 border-t" style={{ borderColor: "var(--bp-border-subtle)" }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>
            Microsoft Purview
          </span>
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{ background: pvBadge.bg, color: pvBadge.text }}
          >
            {pvBadge.label}
          </span>
        </div>
        <div className="text-[10px]" style={{ color: "var(--bp-ink-tertiary)" }}>
          {purview.mappingCount} type mappings configured
        </div>
        {purview.lastSyncAt && (
          <div className="text-[9px] mt-0.5 tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
            Last sync: {new Date(purview.lastSyncAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </div>
        )}
      </div>
    </div>
  );
}
