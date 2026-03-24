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
  activeTab: "ledger" | "clusters" | "canonical" | "specs" | "validation";
  children: ReactNode;
  actions?: ReactNode;
}

const TABS = [
  { id: "ledger", label: "Ledger", path: "/gold/ledger" },
  { id: "clusters", label: "Clusters", path: "/gold/clusters" },
  { id: "canonical", label: "Canonical", path: "/gold/canonical" },
  { id: "specs", label: "Specifications", path: "/gold/specs" },
  { id: "validation", label: "Validation", path: "/gold/validation" },
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

  return (
    <DomainContext.Provider value={{ domain: selectedDomain, setDomain: selectDomain, domainNames }}>
    <ToastContext.Provider value={{ showToast }}>
      <div className="min-h-screen" style={{ background: "var(--bp-canvas)" }}>
        {/* Sticky header */}
        <div className="sticky top-0 z-10" style={{ background: "var(--bp-canvas)" }}>
          {/* Title bar + domain selector */}
          <div className="flex items-center justify-between px-6 pt-4 pb-2">
            <div className="flex items-center gap-4">
              <h1 style={{ fontFamily: "var(--bp-font-display)", fontSize: 20, letterSpacing: "-0.02em", color: "var(--bp-ink-primary)" }}>
                GOLD STUDIO
              </h1>
              {/* Domain selector */}
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
            </div>
            {actions && <div className="flex items-center gap-2">{actions}</div>}
          </div>

          {/* Domain summary strip (when domain selected) */}
          {showPanel && domainDetail && <DomainSummaryStrip domain={domainDetail} onClose={() => setShowPanel(false)} />}

          {/* Tab strip — premium treatment */}
          <nav className="flex px-6 gap-1" style={{ borderBottom: "1px solid var(--bp-border)" }}>
            {TABS.map((tab) => {
              const isActive = tab.id === activeTab || location.pathname === tab.path;
              return (
                <Link
                  key={tab.id} to={tab.path}
                  className={cn("pb-2.5 px-3 text-center transition-all relative", isActive ? "text-[var(--bp-copper)]" : "text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-secondary)]")}
                  style={{ ...bf, fontWeight: isActive ? 700 : 500, fontSize: 14 }}
                >
                  {tab.label}
                  {isActive && <span className="absolute bottom-0 left-0 right-0" style={{ height: 2.5, background: "var(--bp-copper)", borderRadius: "1.5px 1.5px 0 0", transition: "all 200ms var(--ease-claude)" }} />}
                </Link>
              );
            })}
          </nav>
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
