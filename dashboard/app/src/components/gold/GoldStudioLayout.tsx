// Gold Studio Layout — Shared wrapper with title bar, workflow context, and lifecycle rail.

import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { GoldActivityFeed } from "@/components/gold/GoldActivityFeed";
import { GoldContextBar } from "@/components/gold/GoldContextBar";
import { GoldStageRail } from "@/components/gold/GoldStageRail";
import { IntentGuidePopover } from "@/components/guidance/IntentGuide";

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
  object_label: string;
  action: string;
  created_at: string;
}

interface WorkflowStageSummary {
  id: "ledger" | "clusters" | "canonical" | "specs" | "validation" | "serve";
  status: "not_started" | "in_progress" | "needs_attention" | "ready" | "completed";
  summary: string;
  detail: string;
}

interface WorkflowContextSummary {
  domain_display_name: string;
  scope_note: string;
  focus_label: string;
  focus_kind: string;
  focus_note: string;
  owner_label: string;
  owner_note: string;
  unresolved_issues: number;
  last_updated: string;
}

interface WorkflowShellPayload {
  context: WorkflowContextSummary;
  stages: WorkflowStageSummary[];
  activity: AuditItem[];
}

const STAGES = [
  {
    id: "ledger",
    label: "Intake",
    path: "/gold/intake",
    hint: "Qualify source material",
    title: "Intake",
    purpose: "Import, inspect, and qualify source material before it enters gold design.",
    whyItMatters: "Weak intake creates blind spots and rework downstream. Clear intake makes the rest of the lifecycle trustworthy.",
    whatNext: "Move clean, review-ready items forward into clustering.",
  },
  {
    id: "clusters",
    label: "Cluster",
    path: "/gold/cluster",
    hint: "Review candidate groupings",
    title: "Cluster Review",
    purpose: "Group related items, discard noise, and identify concepts ready for promotion.",
    whyItMatters: "This is where the system's guesses become real stewardship decisions instead of hidden background logic.",
    whatNext: "Promote stable concepts into canonical business objects.",
  },
  {
    id: "canonical",
    label: "Canonical",
    path: "/gold/canonical",
    hint: "Define shared business objects",
    title: "Canonical Definitions",
    purpose: "Define the shared business objects that downstream gold products should build from.",
    whyItMatters: "Canonical definitions are the contract every spec, release review, and live product inherits.",
    whatNext: "Generate or refine product specs once the definition is complete.",
  },
  {
    id: "specs",
    label: "Spec",
    path: "/gold/spec",
    hint: "Shape the product definition",
    title: "Product Specs",
    purpose: "Design and review the gold-layer product definition before release review.",
    whyItMatters: "A spec is the implementation contract for the product. Ambiguity here becomes release risk later.",
    whatNext: "Submit ready specs into the release gate for validation and publishing.",
  },
  {
    id: "validation",
    label: "Release",
    path: "/gold/release",
    hint: "Resolve blockers and publish",
    title: "Release Gate",
    purpose: "Resolve quality blockers, confirm release readiness, and publish approved products.",
    whyItMatters: "Release is where coverage gaps, unresolved metrics, and missing validation become explicit instead of surprising live users.",
    whatNext: "Move published products into live stewardship and governance.",
  },
  {
    id: "serve",
    label: "Serve",
    path: "/gold/serve",
    hint: "Monitor live products",
    title: "Serve and Governance",
    purpose: "Monitor live gold products, ownership, and governance after release.",
    whyItMatters: "Publishing is not the finish line. Live ownership, certification, and issue routing all continue here.",
    whatNext: "Investigate live issues or open the product for downstream stewardship work.",
  },
] as const;

const API = "/api/gold-studio";
const bf: React.CSSProperties = { fontFamily: "var(--bp-font-body)" };
const mono: React.CSSProperties = { fontFamily: "var(--bp-font-mono)", fontSize: 9 };
const STAGE_STATUS_LABELS: Record<WorkflowStageSummary["status"], string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  needs_attention: "Needs Attention",
  ready: "Ready",
  completed: "Completed",
};

/* ---------- component ---------- */
export function GoldStudioLayout({ activeTab, children, actions }: GoldStudioLayoutProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [domains, setDomains] = useState<DomainWorkspace[]>([]);
  const [shellData, setShellData] = useState<WorkflowShellPayload | null>(null);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const selectedDomain = searchParams.get("domain");

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
    const loadShell = () => {
      const qs = selectedDomain ? `?domain=${encodeURIComponent(selectedDomain)}` : "";
      fetch(`${API}/workflow-shell${qs}`)
        .then((r) => r.ok ? r.json() : null)
        .then((payload) => {
          if (!cancelled) setShellData((payload ?? null) as WorkflowShellPayload | null);
        })
        .catch(() => {
          if (!cancelled) setShellData(null);
        });
    };
    loadShell();
    const timer = window.setInterval(loadShell, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedDomain]);

  const selectDomain = useCallback((name: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (name) next.set("domain", name);
    else next.delete("domain");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const domainNames = domains.map(d => d.name);
  const currentStage = STAGES.find((stage) => stage.id === activeTab) ?? STAGES[0];
  const currentStageIndex = STAGES.findIndex((stage) => stage.id === currentStage.id);
  const currentStageSummary = shellData?.stages.find((stage) => stage.id === activeTab);
  const currentStatusLabel = currentStageSummary ? STAGE_STATUS_LABELS[currentStageSummary.status] : "Current Stage";
  const stageSearch = searchParams.toString() ? `?${searchParams.toString()}` : "";
  const stageGuideItems = [
    {
      label: "What This Page Is",
      value: currentStage.hint,
      detail: currentStage.purpose,
    },
    {
      label: "Why It Matters",
      value: currentStageSummary?.summary ?? currentStatusLabel,
      detail: currentStage.whyItMatters,
    },
    {
      label: "What Happens Next",
      value:
        currentStageIndex < STAGES.length - 1
          ? `Continue to ${STAGES[currentStageIndex + 1].label}`
          : "Stay with live stewardship",
      detail: currentStage.whatNext,
    },
  ];
  const stageItems = STAGES.map((stage) => {
    const summary = shellData?.stages.find((item) => item.id === stage.id);
    return {
      ...stage,
      summary: summary?.summary,
      detail: summary?.detail,
      status: summary?.status,
    };
  });

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
                <span
                  className="rounded-full px-2 py-0.5"
                  style={{
                    ...bf,
                    fontSize: 11,
                    color: currentStageSummary?.status === "needs_attention" ? "var(--bp-caution-amber)" : currentStageSummary?.status === "completed" ? "var(--bp-operational-green)" : currentStageSummary?.status === "ready" ? "var(--bp-info, #2563eb)" : "var(--bp-ink-secondary)",
                    background: currentStageSummary?.status === "needs_attention" ? "rgba(194,122,26,0.10)" : currentStageSummary?.status === "completed" ? "rgba(61,124,79,0.10)" : currentStageSummary?.status === "ready" ? "rgba(59,130,246,0.10)" : "var(--bp-surface-inset)",
                    border: "1px solid var(--bp-border)",
                  }}
                >
                  {currentStatusLabel}
                </span>
              </div>
              <h1 className="bp-display" style={{ fontSize: 32, color: "var(--bp-ink-primary)", lineHeight: 1.1, margin: 0 }}>
                {currentStage.title}
              </h1>
              <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--bp-ink-secondary)", lineHeight: 1.6, maxWidth: 860 }}>
                {currentStage.purpose}
              </p>
              <div className="flex flex-wrap gap-2" style={{ marginTop: 14 }}>
                <span
                  className="rounded-full px-3 py-2"
                  style={{
                    ...bf,
                    fontSize: 12,
                    color: "var(--bp-ink-primary)",
                    background: "rgba(180,86,36,0.08)",
                    border: "1px solid rgba(180,86,36,0.16)",
                  }}
                >
                  Focus: {currentStage.hint}
                </span>
                {shellData?.context?.focus_label ? (
                  <span
                    className="rounded-full px-3 py-2"
                    style={{
                      ...bf,
                      fontSize: 12,
                      color: "var(--bp-ink-primary)",
                      background: "var(--bp-surface-inset)",
                      border: "1px solid var(--bp-border)",
                    }}
                  >
                    In play: {shellData.context.focus_label}
                  </span>
                ) : null}
                {selectedDomain ? (
                  <span
                    className="rounded-full px-3 py-2"
                    style={{
                      ...bf,
                      fontSize: 12,
                      color: "var(--bp-ink-primary)",
                      background: "var(--bp-surface-inset)",
                      border: "1px solid var(--bp-border)",
                    }}
                  >
                    Domain: {shellData?.context?.domain_display_name ?? selectedDomain}
                  </span>
                ) : null}
              </div>
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
              <IntentGuidePopover title={currentStage.title} items={stageGuideItems} label="Stage Guide" />
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          </div>

          {/* Stage rail */}
          <GoldStageRail items={stageItems} activeId={activeTab} search={stageSearch} />
          <GoldContextBar context={shellData?.context ?? null} />
          <GoldActivityFeed items={shellData?.activity ?? []} />
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
