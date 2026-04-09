// Gold Studio Layout — Shared wrapper with title bar, domain context, and tab navigation.

import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

/* ---------- types ---------- */
interface DomainWorkspace {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  readiness_state: string;
  source_coverage?: string; // JSON
  specimen_count?: number;
  canonical_count?: number;
  report_coverage?: { id: number; report_name: string; coverage_status: string }[];
}

/* ---------- context ---------- */
interface DomainCtx { domain: string | null; setDomain: (d: string | null) => void; domainNames: string[] }
const DomainContext = createContext<DomainCtx>({ domain: null, setDomain: () => {}, domainNames: [] });
export function useDomainContext() { return useContext(DomainContext); }

type ToastType = "success" | "error" | "info";
interface ToastCtx { showToast: (message: string, type?: ToastType) => void }
const ToastContext = createContext<ToastCtx>({ showToast: () => {} });
export function useGoldToast() { return useContext(ToastContext); }

/* ---------- constants ---------- */
interface GoldStudioLayoutProps {
  activeTab: "ledger" | "clusters" | "canonical" | "specs" | "validation" | "serve";
  children: ReactNode;
  actions?: ReactNode;
}

interface AuditItem {
  id: number;
  object_type: string;
  object_id: number;
  action: string;
  created_at: string;
}

const STAGES = [
  {
    id: "ledger",
    label: "Intake",
    path: "/gold/intake",
    hint: "Qualify source material",
    title: "Intake",
    purpose: "Import, inspect, and qualify source material before it enters gold design.",
    whatNext: "Move clean, review-ready items forward into clustering.",
  },
  {
    id: "clusters",
    label: "Cluster",
    path: "/gold/cluster",
    hint: "Review candidate groupings",
    title: "Cluster Review",
    purpose: "Group related items, discard noise, and identify concepts ready for promotion.",
    whatNext: "Promote stable concepts into canonical business objects.",
  },
  {
    id: "canonical",
    label: "Canonical",
    path: "/gold/canonical",
    hint: "Define shared business objects",
    title: "Canonical Definitions",
    purpose: "Define the shared business objects that downstream gold products should build from.",
    whatNext: "Generate or refine product specs once the definition is complete.",
  },
  {
    id: "specs",
    label: "Spec",
    path: "/gold/spec",
    hint: "Shape the product definition",
    title: "Product Specs",
    purpose: "Design and review the gold-layer product definition before release review.",
    whatNext: "Submit ready specs into the release gate for validation and publishing.",
  },
  {
    id: "validation",
    label: "Release",
    path: "/gold/release",
    hint: "Resolve blockers and publish",
    title: "Release Gate",
    purpose: "Resolve quality blockers, confirm release readiness, and publish approved products.",
    whatNext: "Move published products into live stewardship and governance.",
  },
  {
    id: "serve",
    label: "Serve",
    path: "/gold/serve",
    hint: "Monitor live products",
    title: "Serve and Governance",
    purpose: "Monitor live gold products, ownership, and governance after release.",
    whatNext: "Investigate live issues or open the product for downstream stewardship work.",
  },
] as const;

const API = "/api/gold-studio";
const bf: React.CSSProperties = { fontFamily: "var(--bp-font-body)" };
const mono: React.CSSProperties = { fontFamily: "var(--bp-font-mono)", fontSize: 9 };

const READINESS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  not_started:        { label: "Not Started",        color: "var(--bp-ink-muted)",         bg: "rgba(168,162,158,0.10)" },
  in_progress:        { label: "In Progress",        color: "var(--bp-copper)",            bg: "rgba(180,86,36,0.10)" },
  partially_covered:  { label: "Partially Covered",  color: "var(--bp-caution-amber)",     bg: "rgba(194,122,26,0.10)" },
  ready_for_recreation: { label: "Ready for Recreation", color: "#3B82F6",                 bg: "rgba(59,130,246,0.10)" },
  recreated:          { label: "Recreated",           color: "var(--bp-operational-green)", bg: "rgba(61,124,79,0.10)" },
  reconciled:         { label: "Reconciled",          color: "var(--bp-operational-green)", bg: "rgba(61,124,79,0.15)" },
};

/* ---------- component ---------- */
export function GoldStudioLayout({ activeTab, children, actions }: GoldStudioLayoutProps) {
  const location = useLocation();
  const [domains, setDomains] = useState<DomainWorkspace[]>([]);
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [domainDetail, setDomainDetail] = useState<DomainWorkspace | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [recentActivity, setRecentActivity] = useState<AuditItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Fetch domain list once
  useEffect(() => {
    fetch(`${API}/domains`)
      .then(r => r.json())
      .then(d => setDomains(d.domains ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadActivity = () => {
      fetch(`${API}/audit/log?limit=4`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => {
          if (!cancelled) setRecentActivity((d?.items ?? []) as AuditItem[]);
        })
        .catch(() => {
          if (!cancelled) setRecentActivity([]);
        });
    };
    loadActivity();
    const timer = window.setInterval(loadActivity, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  // Fetch domain detail when selected
  const selectDomain = useCallback((name: string | null) => {
    setSelectedDomain(name);
    if (!name) { setDomainDetail(null); setShowPanel(false); return; }
    const d = domains.find(d => d.name === name);
    if (d) {
      fetch(`${API}/domains/${d.id}`)
        .then(r => r.json())
        .then(detail => { setDomainDetail(detail); setShowPanel(true); })
        .catch(() => { setDomainDetail(null); setShowPanel(true); });
    }
  }, [domains]);

  const domainNames = domains.map(d => d.name);
  const currentStage = STAGES.find((stage) => stage.id === activeTab) ?? STAGES[0];
  const currentStageIndex = STAGES.findIndex((stage) => stage.id === currentStage.id);

  return (
    <DomainContext.Provider value={{ domain: selectedDomain, setDomain: selectDomain, domainNames }}>
    <ToastContext.Provider value={{ showToast }}>
      <div className="min-h-screen" style={{ background: "var(--bp-canvas)" }}>
        {/* Sticky header */}
        <div className="sticky top-0 z-10" style={{ background: "var(--bp-canvas)" }}>
          {/* Page identity + controls */}
          <div className="flex flex-col gap-4 px-6 pt-4 pb-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span style={{ ...mono, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  Gold Studio Workflow
                </span>
                <span
                  className="rounded-full px-2 py-0.5"
                  style={{
                    ...bf,
                    fontSize: 11,
                    color: "var(--bp-copper)",
                    background: "rgba(180,86,36,0.08)",
                    border: "1px solid rgba(180,86,36,0.16)",
                  }}
                >
                  Stage {currentStageIndex + 1} of {STAGES.length}
                </span>
              </div>
              <h1 className="bp-display" style={{ fontSize: 32, color: "var(--bp-ink-primary)", lineHeight: 1.1, margin: 0 }}>
                {currentStage.title}
              </h1>
              <p style={{ fontSize: 13, color: "var(--bp-ink-secondary)", marginTop: 6, maxWidth: 760 }}>
                {currentStage.purpose}
              </p>
              <p style={{ fontSize: 12, color: "var(--bp-ink-tertiary)", marginTop: 6 }}>
                <span style={{ ...mono, color: "var(--bp-copper)", marginRight: 6 }}>NEXT</span>
                {currentStage.whatNext}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {domains.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Domain</span>
                  <select
                    value={selectedDomain ?? ""}
                    onChange={e => selectDomain(e.target.value || null)}
                    className="rounded-md px-2.5 py-1 outline-none"
                    style={{ ...bf, fontSize: 13, background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-primary)", minWidth: 140 }}
                  >
                    <option value="">All domains</option>
                    {domains.map(d => <option key={d.name} value={d.name}>{d.display_name}</option>)}
                  </select>
                </div>
              )}
              <span
                className="rounded-full px-2 py-1"
                style={{
                  ...bf,
                  fontSize: 11,
                  color: "var(--bp-ink-secondary)",
                  background: "var(--bp-surface-inset)",
                  border: "1px solid var(--bp-border)",
                }}
              >
                Current stage
              </span>
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          </div>

          {/* Domain summary strip (when domain selected) */}
          {showPanel && domainDetail && <DomainSummaryStrip domain={domainDetail} onClose={() => setShowPanel(false)} />}

          {/* Stage rail */}
          <nav className="grid gap-2 px-6 pb-3 sm:grid-cols-2 xl:grid-cols-6" style={{ borderBottom: "1px solid var(--bp-border)" }}>
            {STAGES.map((tab, index) => {
              const isActive = tab.id === activeTab || location.pathname === tab.path || location.pathname.startsWith(`${tab.path}/`);
              return (
                <Link
                  key={tab.id} to={tab.path}
                  className={cn("rounded-lg px-3 py-3 transition-all relative", isActive ? "text-[var(--bp-copper)]" : "text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-secondary)]")}
                  style={{
                    ...bf,
                    border: `1px solid ${isActive ? "rgba(180,86,36,0.22)" : "var(--bp-border)"}`,
                    background: isActive ? "rgba(180,86,36,0.05)" : "var(--bp-surface-1)",
                  }}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span style={{ ...mono, color: isActive ? "var(--bp-copper)" : "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5"
                      style={{
                        ...bf,
                        fontSize: 10,
                        color: isActive ? "var(--bp-copper)" : "var(--bp-ink-tertiary)",
                        background: isActive ? "rgba(180,86,36,0.10)" : "var(--bp-surface-inset)",
                      }}
                    >
                      {isActive ? "Current" : "Stage"}
                    </span>
                  </div>
                  <div style={{ fontWeight: isActive ? 700 : 600, fontSize: 14, color: isActive ? "var(--bp-ink-primary)" : "var(--bp-ink-secondary)" }}>
                    {tab.label}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--bp-ink-tertiary)", marginTop: 4, lineHeight: 1.35 }}>
                    {tab.hint}
                  </div>
                </Link>
              );
            })}
          </nav>
          {recentActivity.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-6 py-3" style={{ borderBottom: "1px solid var(--bp-border)" }}>
              <span style={{ ...mono, color: "var(--bp-ink-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                Recent Activity
              </span>
              {recentActivity.map((item) => (
                <span
                  key={item.id}
                  className="rounded-full px-2.5 py-1"
                  style={{
                    ...bf,
                    fontSize: 11,
                    color: "var(--bp-ink-secondary)",
                    background: "var(--bp-surface-1)",
                    border: "1px solid var(--bp-border)",
                  }}
                >
                  {formatAuditActivity(item)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Page content */}
        <div className="gs-page-enter px-6 pt-4">{children}</div>

        {/* Toast */}
        {toast && <GoldToast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
      </div>
    </ToastContext.Provider>
    </DomainContext.Provider>
  );
}

/* ---------- Domain Summary Strip ---------- */
function DomainSummaryStrip({ domain, onClose }: { domain: DomainWorkspace; onClose: () => void }) {
  const readiness = READINESS_CFG[domain.readiness_state] ?? READINESS_CFG.not_started;
  const reports = domain.report_coverage ?? [];
  const coveredReports = reports.filter(r => ["fully_covered", "recreated", "reconciled"].includes(r.coverage_status)).length;

  return (
    <div className="mx-6 mb-1.5 rounded-md px-3 py-2 flex items-center gap-5" style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}>
      {/* Domain name + description */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span style={{ fontFamily: "var(--bp-font-display)", fontSize: 13, color: "var(--bp-ink-primary)" }}>{domain.display_name}</span>
          <span className="rounded-full px-2 py-0.5" style={{ fontSize: 10, color: readiness.color, background: readiness.bg, ...bf }}>{readiness.label}</span>
        </div>
        {domain.description && <p className="mt-0.5 truncate" style={{ ...bf, fontSize: 11, color: "var(--bp-ink-muted)", maxWidth: 320 }}>{domain.description}</p>}
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 ml-auto shrink-0">
        <Stat label="Specimens" value={domain.specimen_count ?? 0} />
        <Stat label="Canonical" value={domain.canonical_count ?? 0} />
        <Stat label="Reports" value={`${coveredReports}/${reports.length}`} />
      </div>

      {/* Close */}
      <button type="button" onClick={onClose} className="shrink-0 rounded p-1 hover:bg-black/[0.05] transition-colors" style={{ color: "var(--bp-ink-muted)" }}>
        <span style={{ fontSize: 14 }}>{"\u2715"}</span>
      </button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <div style={{ ...mono, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontFamily: "var(--bp-font-display)", fontSize: 14, color: "var(--bp-ink-primary)", marginTop: 1 }}>{value}</div>
    </div>
  );
}

function formatAuditActivity(item: AuditItem) {
  const object = item.object_type.replace(/_/g, " ");
  const action = item.action.replace(/[:_]/g, " ");
  const when = Number.isNaN(new Date(item.created_at).getTime())
    ? item.created_at
    : new Date(item.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${object} #${item.object_id} ${action} at ${when}`;
}

/* ---------- Toast ---------- */
const TOAST_COLORS: Record<ToastType, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: "rgba(61,124,79,0.08)", border: "rgba(61,124,79,0.25)", color: "var(--bp-operational-green)", icon: "\u2713" },
  error:   { bg: "rgba(185,58,42,0.08)", border: "rgba(185,58,42,0.25)", color: "var(--bp-fault-red)",         icon: "\u2717" },
  info:    { bg: "rgba(180,86,36,0.08)", border: "rgba(180,86,36,0.25)", color: "var(--bp-copper)",            icon: "\u2139" },
};

function GoldToast({ message, type, onDismiss }: { message: string; type: ToastType; onDismiss: () => void }) {
  const c = TOAST_COLORS[type];
  return (
    <div className="fixed bottom-6 right-6 z-[70] flex items-center gap-2 rounded-lg px-4 py-3"
      style={{ background: c.bg, border: `1px solid ${c.border}`, maxWidth: 400, ...bf, transition: "opacity 0.2s ease" }}>
      <span style={{ color: c.color, fontSize: 14, fontWeight: 600 }}>{c.icon}</span>
      <span style={{ ...bf, fontSize: 12, color: "var(--bp-ink-primary)" }}>{message}</span>
      <button type="button" onClick={onDismiss} className="ml-2 shrink-0" style={{ color: "var(--bp-ink-muted)", fontSize: 12 }}>{"\u2715"}</button>
    </div>
  );
}
