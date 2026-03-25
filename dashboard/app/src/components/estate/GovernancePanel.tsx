import { useNavigate } from "react-router-dom";
import { ChevronRight, RefreshCw } from "lucide-react";
import { GovernanceScore } from "./GovernanceScore";

interface GovernancePanelProps {
  classification: {
    classifiedColumns: number;
    totalColumns: number;
    coveragePct: number;
    piiCount: number;
    breakdown?: Record<string, number>;  // sensitivity_level → percentage
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
  pending: { bg: "var(--bp-dismissed-light)", text: "var(--bp-ink-muted)", label: "Pending" },
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
      className="estate-governance-panel rounded-xl border overflow-hidden"
      style={{
        background: "var(--bp-surface-1)",
        borderColor: "var(--bp-border-strong)",
        animation: "fadeIn 400ms 500ms var(--ease-claude) both",
      }}
    >
      {/* Governance Score — padded header zone */}
      <div className="px-4 pt-4 pb-3">
        <GovernanceScore
          classificationPct={classification.coveragePct}
          validationPassed={schemaValidation.passed}
          validationTotal={schemaValidation.total}
          purviewStatus={purview.status}
        />
      </div>

      {/* Classification — clickable section */}
      <GovSection
        label="Classification"
        onClick={() => navigate("/classification")}
      >
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1">
            <span className="text-[10px] tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
              {classification.coveragePct}% coverage
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                fetch("/api/classification/scan", { method: "POST" });
              }}
              className="opacity-0 group-hover:opacity-60 transition-opacity"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--bp-ink-tertiary)", padding: 2 }}
              title="Rescan classifications"
            >
              <RefreshCw size={10} />
            </button>
          </div>
          {classification.piiCount > 0 && (
            <span
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full tabular-nums"
              style={{ background: "var(--bp-fault-light)", color: "var(--bp-fault)" }}
            >
              {classification.piiCount} PII
            </span>
          )}
        </div>
        <div className="h-1 rounded-full overflow-hidden" style={{ background: "var(--bp-border)" }}>
          <div
            className="h-full rounded-full"
            style={{
              width: `${classification.coveragePct}%`,
              background: "var(--bp-copper)",
              transition: "width 0.8s var(--ease-claude)",
            }}
          />
        </div>
        <div className="text-[9px] mt-1 tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
          {classification.classifiedColumns.toLocaleString()} of {classification.totalColumns.toLocaleString()} columns
        </div>
        {classification.breakdown && Object.keys(classification.breakdown).length > 0 && (
          <div className="flex h-1.5 rounded-full overflow-hidden mt-2" style={{ background: "var(--bp-border)" }}>
            {[
              { key: "public", color: "var(--bp-ink-muted)" },
              { key: "internal", color: "#5B8DEF" },
              { key: "confidential", color: "#E9A23B" },
              { key: "restricted", color: "#E07A3B" },
              { key: "pii", color: "var(--bp-fault)" },
            ].map(level => {
              const pct = classification.breakdown?.[level.key] || 0;
              return pct > 0 ? (
                <div
                  key={level.key}
                  style={{ width: `${pct}%`, background: level.color, transition: "width 0.8s var(--ease-claude)" }}
                  title={`${level.key}: ${pct}%`}
                />
              ) : null;
            })}
          </div>
        )}
      </GovSection>

      {/* Schema Validation — clickable section */}
      <GovSection
        label="Schema Validation"
        onClick={() => navigate("/schema-validation")}
      >
        {schemaValidation.total > 0 ? (
          <>
            <div className="flex items-center gap-4 text-[10px]">
              <span className="tabular-nums">
                <strong style={{ color: "var(--bp-operational)" }}>{schemaValidation.passed}</strong>
                <span style={{ color: "var(--bp-ink-muted)" }}> passed</span>
              </span>
              {schemaValidation.failed > 0 && (
                <span className="tabular-nums">
                  <strong style={{ color: "var(--bp-fault)" }}>{schemaValidation.failed}</strong>
                  <span style={{ color: "var(--bp-ink-muted)" }}> failed</span>
                </span>
              )}
            </div>
            <div className="flex h-1 rounded-full overflow-hidden mt-1.5" style={{ background: "var(--bp-border)" }}>
              <div style={{
                width: `${(schemaValidation.passed / schemaValidation.total) * 100}%`,
                background: "var(--bp-operational)",
                transition: "width 0.8s var(--ease-claude)",
              }} />
              {schemaValidation.failed > 0 && (
                <div style={{
                  width: `${(schemaValidation.failed / schemaValidation.total) * 100}%`,
                  background: "var(--bp-fault)",
                  transition: "width 0.8s var(--ease-claude)",
                }} />
              )}
            </div>
          </>
        ) : (
          <span className="text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>
            No validations yet
          </span>
        )}
      </GovSection>

      {/* Microsoft Purview — non-clickable info section */}
      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: "var(--bp-border-subtle)" }}
      >
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
        <div className="text-[10px] tabular-nums" style={{ color: "var(--bp-ink-tertiary)" }}>
          {purview.mappingCount} type mappings
        </div>
        <div className="flex gap-1 mt-2">
          {(["pending", "ready", "synced"] as const).map((step, i) => {
            const isActive = step === purview.status;
            const isPast = (["pending", "ready", "synced"] as const).indexOf(purview.status) >= i;
            return (
              <div
                key={step}
                className="flex-1 h-1 rounded-full"
                style={{
                  background: isPast
                    ? (isActive ? "var(--bp-copper)" : "var(--bp-operational)")
                    : "var(--bp-border)",
                  transition: "background 0.3s var(--ease-claude)",
                }}
              />
            );
          })}
        </div>
        <div className="text-[9px] mt-1 capitalize tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
          {purview.status}
          {purview.mappingCount > 0 && ` · ${purview.mappingCount} active`}
        </div>
        {purview.lastSyncAt && (
          <div className="text-[9px] mt-0.5 tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
            Synced {new Date(purview.lastSyncAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Reusable clickable governance section with hover state and chevron affordance */
function GovSection({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3 border-t transition-colors hover:bg-[var(--bp-surface-inset)] group"
      style={{ borderColor: "var(--bp-border-subtle)" }}
    >
      <div className="flex items-center justify-between mb-1">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: "var(--bp-ink-tertiary)" }}
        >
          {label}
        </span>
        <ChevronRight
          size={12}
          className="opacity-0 group-hover:opacity-60 transition-opacity"
          style={{ color: "var(--bp-ink-muted)" }}
        />
      </div>
      {children}
    </button>
  );
}
