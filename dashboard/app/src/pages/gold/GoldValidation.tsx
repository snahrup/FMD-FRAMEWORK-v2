// Gold Validation & Catalog — Validation status, catalog registry, and report recreation coverage.
// Spec: docs/superpowers/specs/2026-03-18-gold-studio-design.md § 9, 9.5
import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { GoldStudioLayout, StatsStrip, SlideOver, useDomainContext, useGoldToast, GoldLoading, GoldEmpty } from "@/components/gold";

/* ---------- types ---------- */

// A single rule result inside a validation run's `results` JSON
interface RuleResult { rule: string; type: "critical" | "warning" | "advisory"; expected: string; actual: string; status: "passed" | "failed" | "waiver" }

// A reconciliation metric row inside a run's `reconciliation` JSON
interface ReconciliationRow { metric: string; legacy_value: string | number; gold_value: string | number; delta: string; status: "within_tolerance" | "review" | "out_of_range" }

// Waiver stored as JSON on the validation run
interface Waiver { reason: string; approver: string; filed_at: string; checks_waived?: string[] }

// A full validation run row from backend
interface ValidationRunRow {
  id: number;
  spec_root_id: number;
  spec_version: number;
  started_at: string | null;
  completed_at: string | null;
  status: "queued" | "running" | "passed" | "failed" | "warning";
  results: string | RuleResult[] | null;  // JSON string or parsed
  reconciliation: string | ReconciliationRow[] | null;
  waiver: string | Waiver | null;
  superseded: boolean;
}

// Spec row from /specs list — used in validation table
interface SpecRow {
  id: number;
  root_id: number;
  name?: string;
  target_name: string;
  domain: string;
  status: "draft" | "validated" | "needs_revalidation" | "deprecated";
  version: number;
}

// Catalog entry from backend
interface CatalogEntry {
  id: number;
  root_id: number;
  version: number;
  display_name: string;
  technical_name: string;
  business_description: string;
  domain: string;
  grain: string;
  owner: string;
  steward: string;
  source_systems: string;  // JSON array
  sensitivity_label: string;  // lowercase: public, internal, confidential, restricted
  endorsement: string;  // lowercase: none, promoted, certified
  status: string;
  published_at: string;
  published_by: string;
  tags?: string;  // JSON array
  intended_audience?: string;
  usage_type?: string;
  glossary_terms?: string;
  certification_notes?: string;
  refresh_sla?: string;
  data_retention?: string;
  workspace?: string;
  lakehouse?: string;
  schema_name?: string;
  object_name?: string;
  deployment_env?: string;
}

// Stats from backend
interface Stats {
  gold_specs: number;
  specs_validated: number;
  catalog_published: number;
  catalog_certified: number;
  certification_rate: number;
}

// Report Recreation Coverage
interface ReportCoverage {
  id: number;
  domain: string;
  report_name: string;
  report_description?: string;
  report_type?: "power_bi" | "ssrs" | "excel" | "other";
  coverage_status: "not_analyzed" | "analyzed" | "partially_covered" | "fully_covered" | "recreated" | "reconciled";
  contributing_specimen_ids?: string; // JSON
  contributing_canonical_ids?: string; // JSON
  contributing_spec_ids?: string; // JSON
  unresolved_metrics?: string; // JSON
  notes?: string;
  assessed_by?: string;
  assessed_at?: string;
  created_at?: string;
  updated_at?: string;
}

/* ---------- constants ---------- */
// Spec status → validation display mapping (spec.status drives the table, not run.status)
const SPEC_STATUS_ORDER: Record<string, number> = { needs_revalidation: 0, draft: 1, deprecated: 2, validated: 3 };
const SPEC_STATUS_CFG: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  validated:            { icon: "\u2713", label: "Validated",      color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)" },
  draft:               { icon: "\u25CC", label: "Draft",          color: "var(--bp-ink-muted)",         bg: "var(--bp-dismissed-light)" },
  needs_revalidation:  { icon: "\u21BB", label: "Needs Reval.",   color: "var(--bp-caution-amber)",     bg: "var(--bp-caution-light)" },
  deprecated:          { icon: "\u2014", label: "Deprecated",     color: "var(--bp-ink-muted)",         bg: "var(--bp-dismissed-light)" },
};
// Run-level status for detail slide-over
const RUN_STATUS_CFG: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  passed:  { icon: "\u2713", label: "Passed",  color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)" },
  warning: { icon: "\u26A0", label: "Warning", color: "var(--bp-caution-amber)",     bg: "var(--bp-caution-light)" },
  failed:  { icon: "\u2717", label: "Failed",  color: "var(--bp-fault-red)",         bg: "var(--bp-fault-light)" },
  queued:  { icon: "\u25CC", label: "Queued",  color: "var(--bp-ink-muted)",         bg: "var(--bp-dismissed-light)" },
  running: { icon: "\u25F7", label: "Running", color: "var(--bp-copper)",            bg: "var(--bp-copper-soft)" },
};
const SENS_CFG: Record<string, { color: string; bg: string }> = {
  public:       { color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)" },
  internal:     { color: "var(--bp-info)",              bg: "var(--bp-info-light)" },
  confidential: { color: "var(--bp-caution-amber)",     bg: "var(--bp-caution-light)" },
  restricted:   { color: "var(--bp-fault-red)",         bg: "var(--bp-fault-light)" },
};
const ENDORSE_CFG: Record<string, { label: string; color: string; bg: string } | null> = {
  certified: { label: "\u2713 Certified", color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)" },
  promoted:  { label: "Promoted",         color: "var(--bp-copper)",            bg: "var(--bp-copper-soft)" },
  none: null,
};

const COVERAGE_STATUS_CFG: Record<string, { label: string; color: string; bg: string; order: number }> = {
  not_analyzed:       { label: "Not Analyzed",       color: "var(--bp-ink-muted)",         bg: "var(--bp-dismissed-light)", order: 0 },
  analyzed:           { label: "Analyzed",           color: "var(--bp-copper)",            bg: "var(--bp-copper-soft)",     order: 1 },
  partially_covered:  { label: "Partially Covered",  color: "var(--bp-caution-amber)",     bg: "var(--bp-caution-light)",  order: 2 },
  fully_covered:      { label: "Fully Covered",      color: "var(--bp-info)",              bg: "var(--bp-info-light)",     order: 3 },
  recreated:          { label: "Recreated",           color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)", order: 4 },
  reconciled:         { label: "Reconciled",          color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)", order: 5 },
};
const REPORT_TYPE_LABELS: Record<string, string> = { power_bi: "Power BI", ssrs: "SSRS", excel: "Excel", other: "Other" };

const API = "/api/gold-studio";
const bf: React.CSSProperties = { fontFamily: "var(--bp-font-body)" };
const df: React.CSSProperties = { fontFamily: "var(--bp-font-display)" };
const mono: React.CSSProperties = { fontFamily: "var(--bp-font-mono)", fontSize: 11 };
const th: React.CSSProperties = { ...bf, fontSize: 11, fontWeight: 600, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 12px", borderBottom: "1px solid var(--bp-border)", textAlign: "left" };
const td: React.CSSProperties = { ...bf, fontSize: 13, color: "var(--bp-ink-primary)", padding: "8px 12px", borderBottom: "1px solid var(--bp-border)" };

/* ---------- helpers ---------- */
function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ color, background: bg, ...bf }}>{label}</span>;
}
function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose}>
      <div className="rounded-lg w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
function FormField({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) {
  return <div><label className="block mb-1 text-xs font-medium" style={{ color: "var(--bp-ink-muted)", ...bf }}>{label}{req ? " *" : ""}</label>{children}</div>;
}
const inputCls = "w-full rounded-md border px-3 py-2 text-sm";
const inputSt = { borderColor: "var(--bp-border)", ...bf };
function DL({ items }: { items: [string, string | undefined][] }) {
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-3" style={{ ...bf, fontSize: 13 }}>
      {items.filter(([, v]) => v).map(([k, v]) => (
        <div key={k} className="contents">
          <dt style={{ color: "var(--bp-ink-muted)", fontWeight: 500 }}>{k}</dt>
          <dd style={{ color: "var(--bp-ink-primary)" }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Safely parse a JSON field that may be a string or already parsed */
function parseJsonField<T>(val: string | T | null | undefined): T | null {
  if (val == null) return null;
  if (typeof val === "string") { try { return JSON.parse(val); } catch { return null; } }
  return val as T;
}

/** Capitalize first letter for display */
const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* ---------- main ---------- */
export default function GoldValidation() {
  const { domain: activeDomain } = useDomainContext();
  const { showToast } = useGoldToast();
  const [activeTab, setActiveTab] = useState<"validation" | "catalog" | "recreation">("validation");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [specs, setSpecs] = useState<SpecRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);

  // Validation detail slide-over state
  const [selSpec, setSelSpec] = useState<SpecRow | null>(null);
  const [latestRun, setLatestRun] = useState<ValidationRunRow | null>(null);
  const [ruleResults, setRuleResults] = useState<RuleResult[]>([]);
  const [reconciliation, setReconciliation] = useState<ReconciliationRow[]>([]);
  const [activeWaiver, setActiveWaiver] = useState<Waiver | null>(null);

  // Catalog detail slide-over state
  const [selCat, setSelCat] = useState<CatalogEntry | null>(null);
  const [catVersions, setCatVersions] = useState<CatalogEntry[]>([]);

  // Report Recreation state
  const [reports, setReports] = useState<ReportCoverage[]>([]);
  const [selReport, setSelReport] = useState<ReportCoverage | null>(null);
  const [showAddReport, setShowAddReport] = useState(false);
  const [newReport, setNewReport] = useState({ domain: "", report_name: "", report_description: "", report_type: "power_bi" as string });
  const [covFilter, setCovFilter] = useState("All");

  // Modal state
  const [showPublish, setShowPublish] = useState(false);
  const [showWaiver, setShowWaiver] = useState(false);
  const [wf, setWf] = useState({ reason: "", approver: "", review_date: "" });
  const [pf, setPf] = useState({ spec_id: 0, display_name: "", technical_name: "", business_description: "", grain: "", domain: "", owner: "", steward: "", sensitivity_label: "internal", endorsement: "none", tags: "", intended_audience: "", usage_type: "", certification_notes: "" });

  /* Load all data */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const covQs = activeDomain ? `?domain=${encodeURIComponent(activeDomain)}&limit=500` : "?limit=500";
      const ok = (r: Response) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
      const [statsRes, specsRes, catRes, covRes] = await Promise.all([
        fetch(`${API}/stats`).then(ok),
        fetch(`${API}/specs?limit=500`).then(ok),
        fetch(`${API}/catalog?limit=500`).then(ok),
        fetch(`${API}/report-coverage${covQs}`).then(ok),
      ]);
      setStats(statsRes);
      const specItems = (specsRes.items ?? specsRes) as SpecRow[];
      setSpecs(specItems.sort((a, b) =>
        (SPEC_STATUS_ORDER[a.status] ?? 9) - (SPEC_STATUS_ORDER[b.status] ?? 9)
      ));
      setCatalog((catRes.items ?? catRes) as CatalogEntry[]);
      setReports((covRes.items ?? []) as ReportCoverage[]);
    } catch { /* API not wired */ } finally { setLoading(false); }
  }, [activeDomain]);
  useEffect(() => { load(); }, [load]);

  /* Open validation detail — fetch latest run for this spec */
  const openSpec = async (spec: SpecRow) => {
    setSelSpec(spec);
    setLatestRun(null);
    setRuleResults([]);
    setReconciliation([]);
    setActiveWaiver(null);
    try {
      const runsRes = await fetch(`${API}/validation/specs/${spec.id}/runs?limit=1`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
      const runs = (runsRes.items ?? []) as ValidationRunRow[];
      if (runs.length > 0) {
        const run = runs[0];
        setLatestRun(run);
        setRuleResults(parseJsonField<RuleResult[]>(run.results) ?? []);
        setReconciliation(parseJsonField<ReconciliationRow[]>(run.reconciliation) ?? []);
        setActiveWaiver(parseJsonField<Waiver>(run.waiver));
      }
    } catch { /* detail fetch failed, show empty */ }
  };

  /* Open catalog detail */
  const openCat = async (entry: CatalogEntry) => {
    try {
      const [detail, versionsRes] = await Promise.all([
        fetch(`${API}/catalog/${entry.id}`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
        fetch(`${API}/catalog/${entry.id}/versions`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      ]);
      setSelCat(detail);
      setCatVersions((versionsRes.items ?? []) as CatalogEntry[]);
    } catch {
      setSelCat(entry);
      setCatVersions([]);
    }
  };

  /* Actions */
  const runValidation = async (id: number) => {
    try {
      const res = await fetch(`${API}/validation/specs/${id}/validate`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("Validation queued", "success");
      load();
      if (selSpec?.id === id) openSpec(selSpec);
    } catch { showToast("Failed to run validation", "error"); }
  };

  const submitWaiver = async () => {
    if (!latestRun) return;
    try {
      const res = await fetch(`${API}/validation/runs/${latestRun.id}/waiver`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...wf, spec_version: latestRun.spec_version }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("Waiver filed", "success");
      setShowWaiver(false);
      setWf({ reason: "", approver: "", review_date: "" });
      load();
    } catch { showToast("Failed to file waiver", "error"); }
  };

  const submitPublish = async () => {
    if (!pf.spec_id) return;
    try {
      const payload = {
        ...pf,
        tags: pf.tags.split(",").map(t => t.trim()).filter(Boolean),
      };
      const res = await fetch(`${API}/catalog/specs/${pf.spec_id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("Published to catalog", "success");
      setShowPublish(false);
      load();
    } catch { showToast("Failed to publish", "error"); }
  };

  const updateEndorsement = async (id: number, endorsement: string) => {
    try {
      const res = await fetch(`${API}/catalog/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endorsement: endorsement.toLowerCase() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("Endorsement updated", "success");
      load();
    } catch { showToast("Failed to update endorsement", "error"); }
  };

  /* Report recreation actions */
  const openReport = async (report: ReportCoverage) => {
    try {
      const detail = await fetch(`${API}/report-coverage/${report.id}`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });
      setSelReport(detail);
    } catch { setSelReport(report); }
  };

  const addReport = async () => {
    if (!newReport.domain || !newReport.report_name) return;
    try {
      const res = await fetch(`${API}/report-coverage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newReport),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("Report registered", "success");
      setShowAddReport(false);
      setNewReport({ domain: "", report_name: "", report_description: "", report_type: "power_bi" });
      load();
    } catch { showToast("Failed to register report", "error"); }
  };

  const updateCoverageStatus = async (id: number, newStatus: string) => {
    try {
      const res = await fetch(`${API}/report-coverage/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coverage_status: newStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast("Status updated", "success");
      setSelReport(null);
      load();
    } catch { showToast("Failed to update status", "error"); }
  };

  // Filtered reports by coverage status
  const filteredReports = useMemo(() => {
    let r = reports;
    if (covFilter !== "All") r = r.filter(rep => rep.coverage_status === covFilter);
    return r.sort((a, b) => (COVERAGE_STATUS_CFG[a.coverage_status]?.order ?? 9) - (COVERAGE_STATUS_CFG[b.coverage_status]?.order ?? 9));
  }, [reports, covFilter]);

  /* Stats strip — map backend field names */
  const pendingCount = (stats?.gold_specs ?? 0) - (stats?.specs_validated ?? 0);
  const strip = [
    { label: "Validated", value: stats?.specs_validated ?? 0 },
    { label: "Cataloged", value: stats?.catalog_published ?? 0 },
    { label: "Pending", value: pendingCount > 0 ? pendingCount : 0, highlight: pendingCount > 0 },
    { label: "Certified", value: stats?.catalog_certified ?? 0 },
    { label: "Total Specs", value: stats?.gold_specs ?? 0 },
  ];

  const ruleBadge = (t: string) => {
    const tl = t.toLowerCase();
    const [c, b] = tl === "critical" ? ["var(--bp-fault-red)", "var(--bp-fault-light)"] : tl === "warning" ? ["var(--bp-caution-amber)", "var(--bp-caution-light)"] : ["var(--bp-ink-muted)", "var(--bp-dismissed-light)"];
    return <Badge label={cap(tl)} color={c} bg={b} />;
  };

  const ruleStatusIcon = (s: string) => {
    const c = s === "passed" ? "var(--bp-operational-green)" : s === "waiver" ? "var(--bp-caution-amber)" : "var(--bp-fault-red)";
    const i = s === "passed" ? "\u2713" : s === "waiver" ? "\u26A0" : "\u2717";
    return <span style={{ color: c, fontWeight: 600 }}>{i}</span>;
  };

  return (
    <GoldStudioLayout activeTab="validation">
      <StatsStrip items={strip} />
      {/* Sub-tabs */}
      <div className="flex gap-1 pt-3" style={{ borderBottom: "1px solid var(--bp-border)" }}>
        {(["validation", "catalog", "recreation"] as const).map(t => (
          <button key={t} type="button" onClick={() => setActiveTab(t)} className="pb-2.5 px-3 text-center transition-colors relative" style={{ ...bf, fontWeight: 500, fontSize: 13, color: activeTab === t ? "var(--bp-copper)" : "var(--bp-ink-muted)" }}>
            {t === "validation" ? "Validation Status" : t === "catalog" ? "Catalog Registry" : "Report Recreation"}
            {activeTab === t && <span className="absolute bottom-0 left-0 right-0" style={{ height: 2, background: "var(--bp-copper)", borderRadius: "1px 1px 0 0" }} />}
          </button>
        ))}
      </div>

      <div style={{ paddingTop: 16, paddingBottom: 20 }}>
        {/* TAB 1: Validation Status */}
        {activeTab === "validation" && (loading ? <GoldLoading /> : (
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
            <table className="w-full">
              <thead><tr><th style={th}>Spec Name</th><th style={th}>Status</th><th style={th}>Version</th><th style={th}>Domain</th></tr></thead>
              <tbody>
                {specs.length === 0 && <tr><td colSpan={4} style={{ ...td, textAlign: "center", color: "var(--bp-ink-muted)" }}>No specs available</td></tr>}
                {specs.map(s => {
                  const c = SPEC_STATUS_CFG[s.status] ?? SPEC_STATUS_CFG.draft;
                  return (
                    <tr key={s.id} className="cursor-pointer hover:bg-black/[0.02] transition-colors bp-row-interactive" onClick={() => openSpec(s)}>
                      <td style={{ ...td, fontWeight: 500 }}>{s.name ?? s.target_name}</td>
                      <td style={td}><Badge label={`${c.icon} ${c.label}`} color={c.color} bg={c.bg} /></td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>v{s.version}</td>
                      <td style={{ ...td, color: "var(--bp-ink-secondary)" }}>{s.domain}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        {/* TAB 2: Catalog Registry */}
        {activeTab === "catalog" && (loading ? <GoldLoading /> : (<>
          <div className="flex justify-end mb-4">
            <button type="button" onClick={() => setShowPublish(true)} className="rounded-md px-4 py-2 text-sm font-medium hover:opacity-90" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)", ...bf }}>Publish New</button>
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
            <table className="w-full">
              <thead><tr><th style={th}>Display Name</th><th style={th}>Technical Name</th><th style={th}>Domain</th><th style={th}>Owner</th><th style={th}>Sensitivity</th><th style={th}>Endorsement</th><th style={th}>Published</th></tr></thead>
              <tbody>
                {catalog.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--bp-ink-muted)" }}>No catalog entries</td></tr>}
                {catalog.map(c => {
                  const sens = SENS_CFG[c.sensitivity_label] ?? SENS_CFG.internal;
                  const ec = ENDORSE_CFG[c.endorsement] ?? null;
                  return (
                    <tr key={c.id} className="cursor-pointer hover:bg-black/[0.02] transition-colors bp-row-interactive" onClick={() => openCat(c)}>
                      <td style={{ ...td, fontWeight: 500 }}>
                        {c.display_name}
                        {c.status === "source_updated" && <span className="ml-1.5" title="Source spec has been updated — catalog may need re-publishing" style={{ color: "var(--bp-caution-amber)", fontSize: 11 }}>{"\u21BB"}</span>}
                      </td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{c.technical_name}</td>
                      <td style={td}>{c.domain}</td>
                      <td style={td}>{c.owner}</td>
                      <td style={td}><Badge label={cap(c.sensitivity_label)} color={sens.color} bg={sens.bg} /></td>
                      <td style={td}>{ec ? <Badge label={ec.label} color={ec.color} bg={ec.bg} /> : <span style={{ color: "var(--bp-ink-muted)", fontSize: 12 }}>Unendorsed</span>}</td>
                      <td style={{ ...td, color: "var(--bp-ink-secondary)", fontSize: 12 }}>{c.published_at ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>))}

        {/* TAB 3: Report Recreation Coverage */}
        {activeTab === "recreation" && (loading ? <GoldLoading /> : (<>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <label style={{ ...bf, fontSize: 11, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</label>
              <select value={covFilter} onChange={e => setCovFilter(e.target.value)} className="rounded-md px-2 py-1.5 outline-none" style={{ ...bf, fontSize: 13, background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-primary)" }}>
                <option>All</option>
                {Object.entries(COVERAGE_STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <button type="button" onClick={() => { setNewReport(r => ({ ...r, domain: activeDomain ?? "" })); setShowAddReport(true); }} className="rounded-md px-4 py-2 text-sm font-medium hover:opacity-90" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)", ...bf }}>Register Report</button>
          </div>

          {/* Coverage progress bar */}
          {reports.length > 0 && (() => {
            const total = reports.length;
            const covered = reports.filter(r => ["fully_covered", "recreated", "reconciled"].includes(r.coverage_status)).length;
            const partial = reports.filter(r => r.coverage_status === "partially_covered").length;
            const pctCovered = Math.round((covered / total) * 100);
            const pctPartial = Math.round((partial / total) * 100);
            return (
              <div className="rounded-lg p-4 mb-4" style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ ...bf, fontSize: 13, fontWeight: 500, color: "var(--bp-ink-primary)" }}>Recreation Readiness</span>
                  <span style={{ ...bf, fontSize: 13, color: "var(--bp-ink-secondary)" }}>{covered}/{total} reports covered ({pctCovered}%)</span>
                </div>
                <div className="flex rounded-full overflow-hidden h-2" style={{ background: "var(--bp-surface-inset)" }}>
                  <div style={{ width: `${pctCovered}%`, background: "var(--bp-operational-green)", transition: "width 0.3s" }} />
                  <div style={{ width: `${pctPartial}%`, background: "var(--bp-caution-amber)", transition: "width 0.3s" }} />
                </div>
              </div>
            );
          })()}

          {/* Report list */}
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
            <table className="w-full">
              <thead><tr><th style={th}>Report</th><th style={th}>Domain</th><th style={th}>Type</th><th style={th}>Coverage Status</th><th style={th}>Assessed</th></tr></thead>
              <tbody>
                {filteredReports.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "var(--bp-ink-muted)" }}>No reports registered{covFilter !== "All" ? ` with status "${COVERAGE_STATUS_CFG[covFilter]?.label ?? covFilter}"` : ""}</td></tr>}
                {filteredReports.map(r => {
                  const sc = COVERAGE_STATUS_CFG[r.coverage_status] ?? COVERAGE_STATUS_CFG.not_analyzed;
                  return (
                    <tr key={r.id} className="cursor-pointer hover:bg-black/[0.02] transition-colors bp-row-interactive" onClick={() => openReport(r)}>
                      <td style={{ ...td, fontWeight: 500 }}>
                        {r.report_name}
                        {r.report_description && <span className="block mt-0.5" style={{ fontSize: 11, color: "var(--bp-ink-muted)", fontWeight: 400 }}>{r.report_description.slice(0, 80)}{r.report_description.length > 80 ? "..." : ""}</span>}
                      </td>
                      <td style={{ ...td, color: "var(--bp-ink-secondary)" }}>{r.domain}</td>
                      <td style={td}>{r.report_type ? <span style={{ ...bf, fontSize: 12 }}>{REPORT_TYPE_LABELS[r.report_type] ?? r.report_type}</span> : "\u2014"}</td>
                      <td style={td}><Badge label={sc.label} color={sc.color} bg={sc.bg} /></td>
                      <td style={{ ...td, color: "var(--bp-ink-muted)", fontSize: 12 }}>{r.assessed_at ?? r.updated_at ?? "\u2014"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>))}
      </div>

      {/* SLIDE-OVER: Validation Detail */}
      <SlideOver open={!!selSpec} onClose={() => { setSelSpec(null); setLatestRun(null); }} title={selSpec?.name ?? selSpec?.target_name ?? ""} subtitle="Validation Detail" footer={
        <div className="flex gap-2">
          <button type="button" onClick={() => selSpec && runValidation(selSpec.id)} className="rounded-md px-4 py-2 text-sm font-medium hover:opacity-90" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)", ...bf }}>Run Structure Check</button>
          {latestRun?.status === "failed" && <button type="button" onClick={() => setShowWaiver(true)} className="rounded-md px-4 py-2 text-sm font-medium hover:opacity-90" style={{ background: "var(--bp-caution-amber)", color: "var(--bp-surface-1)", ...bf }}>File Waiver</button>}
        </div>
      }>
        {/* Latest run summary */}
        {latestRun && (() => {
          const rc = RUN_STATUS_CFG[latestRun.status] ?? RUN_STATUS_CFG.queued;
          return (
            <div className="flex items-center gap-3 mb-4 rounded-lg px-3 py-2" style={{ background: rc.bg, border: `1px solid color-mix(in srgb, ${rc.color} 25%, transparent)` }}>
              <Badge label={`${rc.icon} ${rc.label}`} color={rc.color} bg="transparent" />
              <span style={{ ...bf, fontSize: 12, color: "var(--bp-ink-secondary)" }}>Run #{latestRun.id}</span>
              {latestRun.started_at && <span style={{ ...bf, fontSize: 12, color: "var(--bp-ink-muted)" }}>{latestRun.started_at}</span>}
              <span style={{ ...bf, fontSize: 12, color: "var(--bp-ink-muted)" }}>Spec v{latestRun.spec_version}</span>
            </div>
          );
        })()}

        <h3 className="mb-1" style={{ ...df, fontSize: 15, color: "var(--bp-ink-primary)" }}>Validation Checks</h3>
        <p style={{ ...bf, fontSize: 11, color: "var(--bp-ink-muted)", marginBottom: 12 }}>Structure only — checks SQL, columns, and target name. Data validation and reconciliation are planned.</p>
        <div className="rounded-lg overflow-hidden mb-6" style={{ border: "1px solid var(--bp-border)" }}>
          <table className="w-full">
            <thead><tr><th style={th}>Rule</th><th style={th}>Type</th><th style={th}>Expected</th><th style={th}>Actual</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {ruleResults.map((r, i) => (
                <tr key={i}>
                  <td style={{ ...td, fontWeight: 500 }}>{r.rule}</td>
                  <td style={td}>{ruleBadge(r.type)}</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.expected}</td>
                  <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.actual}</td>
                  <td style={td}>{ruleStatusIcon(r.status)}</td>
                </tr>
              ))}
              {ruleResults.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "var(--bp-ink-muted)" }}>No validation runs yet</td></tr>}
            </tbody>
          </table>
        </div>

        {/* Active waiver */}
        {activeWaiver && (
          <div className="rounded-lg p-4 mb-6" style={{ background: "var(--bp-caution-light)", border: "1px solid var(--bp-caution-amber)", borderColor: "color-mix(in srgb, var(--bp-caution-amber) 20%, transparent)" }}>
            <h4 className="mb-2" style={{ ...df, fontSize: 14, color: "var(--bp-caution-amber)" }}>Active Waiver</h4>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2" style={{ ...bf, fontSize: 13 }}>
              <dt style={{ color: "var(--bp-ink-muted)" }}>Reason</dt><dd>{activeWaiver.reason}</dd>
              <dt style={{ color: "var(--bp-ink-muted)" }}>Approver</dt><dd>{activeWaiver.approver}</dd>
              <dt style={{ color: "var(--bp-ink-muted)" }}>Filed</dt><dd>{activeWaiver.filed_at}</dd>
              {activeWaiver.checks_waived && activeWaiver.checks_waived.length > 0 && (
                <><dt style={{ color: "var(--bp-ink-muted)" }}>Checks Waived</dt><dd>{activeWaiver.checks_waived.join(", ")}</dd></>
              )}
            </dl>
          </div>
        )}

        {/* Reconciliation */}
        {reconciliation.length > 0 && (<>
          <h3 className="mb-1" style={{ ...df, fontSize: 15, color: "var(--bp-ink-primary)" }}>Reconciliation</h3>
          <p style={{ ...bf, fontSize: 11, color: "var(--bp-ink-muted)", marginBottom: 12 }}>Manual entry only — automatic legacy-vs-gold comparison is planned.</p>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)" }}>
            <table className="w-full">
              <thead><tr><th style={th}>Metric</th><th style={th}>Legacy Value</th><th style={th}>Gold Value</th><th style={th}>Delta</th><th style={th}>Status</th></tr></thead>
              <tbody>{reconciliation.map((r, i) => {
                const rc = r.status === "within_tolerance" ? { i: "\u2713", c: "var(--bp-operational-green)" } : r.status === "review" ? { i: "\u26A0", c: "var(--bp-caution-amber)" } : { i: "\u2717", c: "var(--bp-fault-red)" };
                return <tr key={i}><td style={{ ...td, fontWeight: 500 }}>{r.metric}</td><td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.legacy_value}</td><td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.gold_value}</td><td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.delta}</td><td style={td}><span style={{ color: rc.c, fontWeight: 600 }}>{rc.i}</span></td></tr>;
              })}</tbody>
            </table>
          </div>
        </>)}
      </SlideOver>

      {/* SLIDE-OVER: Catalog Detail */}
      <SlideOver open={!!selCat} onClose={() => { setSelCat(null); setCatVersions([]); }} title={selCat?.display_name ?? ""} subtitle={selCat?.technical_name} footer={
        <div className="flex items-center gap-3">
          <label style={{ ...bf, fontSize: 13, color: "var(--bp-ink-secondary)" }}>Endorsement</label>
          <select value={selCat?.endorsement ?? "none"} onChange={e => selCat && updateEndorsement(selCat.id, e.target.value)} className="rounded-md border px-3 py-1.5 text-sm" style={inputSt}>
            <option value="none">None</option><option value="promoted">Promoted</option><option value="certified">Certified</option>
          </select>
        </div>
      }>
        {selCat && (<>
          <DL items={[
            ["Domain", selCat.domain],
            ["Owner", selCat.owner],
            ["Steward", selCat.steward],
            ["Grain", selCat.grain],
            ["Sensitivity", cap(selCat.sensitivity_label)],
            ["Endorsement", cap(selCat.endorsement)],
            ["Description", selCat.business_description],
            ["Intended Audience", selCat.intended_audience],
            ["Usage Type", selCat.usage_type],
            ["Certification Notes", selCat.certification_notes],
            ["Refresh SLA", selCat.refresh_sla],
            ["Data Retention", selCat.data_retention],
          ]} />
          {/* Tags */}
          {(() => {
            const tags = parseJsonField<string[]>(selCat.tags) ?? [];
            return tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mt-4 mb-6">{tags.map(t => <span key={t} className="rounded-full px-2.5 py-0.5 text-xs" style={{ background: "var(--bp-dismissed-light)", color: "var(--bp-ink-secondary)", ...bf }}>{t}</span>)}</div>
            ) : null;
          })()}
          {/* Implementation metadata */}
          {(selCat.workspace || selCat.lakehouse || selCat.schema_name || selCat.object_name) && (<>
            <h4 className="mb-2 mt-6" style={{ ...df, fontSize: 14, color: "var(--bp-ink-primary)" }}>Implementation</h4>
            <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2" style={{ ...bf, fontSize: 13 }}>
              {([["Workspace", selCat.workspace], ["Lakehouse", selCat.lakehouse], ["Schema", selCat.schema_name], ["Object Name", selCat.object_name], ["Environment", selCat.deployment_env]] as [string, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="contents"><dt style={{ color: "var(--bp-ink-muted)", fontWeight: 500 }}>{k}</dt><dd style={{ color: "var(--bp-ink-primary)", fontFamily: "monospace", fontSize: 12 }}>{v}</dd></div>
              ))}
            </dl>
          </>)}
          {/* Version History (from catalog versions endpoint) */}
          {catVersions.length > 1 && (<>
            <h4 className="mb-2 mt-6" style={{ ...df, fontSize: 14, color: "var(--bp-ink-primary)" }}>Version History</h4>
            <div className="space-y-2">{catVersions.map(v => (
              <div key={v.version} className="flex items-baseline gap-3" style={{ ...bf, fontSize: 13 }}>
                <span className="font-medium" style={{ color: "var(--bp-copper)" }}>v{v.version}</span>
                <span style={{ color: "var(--bp-ink-muted)", fontSize: 12 }}>{v.published_at ?? ""}</span>
                <span style={{ color: "var(--bp-ink-secondary)" }}>{v.status === "superseded" ? "(superseded)" : v.status === "source_updated" ? "(source updated)" : "(current)"}</span>
              </div>
            ))}</div>
          </>)}
        </>)}
      </SlideOver>

      {/* MODAL: File Waiver */}
      <Modal open={showWaiver} onClose={() => setShowWaiver(false)}>
        <h3 className="mb-4" style={{ ...df, fontSize: 18, color: "var(--bp-ink-primary)" }}>File Waiver</h3>
        <p className="mb-3" style={{ ...bf, fontSize: 12, color: "var(--bp-caution-amber)" }}>
          Waivers are version-scoped. A new spec version requires a new waiver if the same critical rule fails.
        </p>
        <div className="space-y-3">
          <FormField label="Reason" req><textarea rows={3} value={wf.reason} onChange={e => setWf(f => ({ ...f, reason: e.target.value }))} className={inputCls} style={inputSt} /></FormField>
          <FormField label="Approver" req><input value={wf.approver} onChange={e => setWf(f => ({ ...f, approver: e.target.value }))} className={inputCls} style={inputSt} /></FormField>
          <FormField label="Review Date" req><input type="date" value={wf.review_date} onChange={e => setWf(f => ({ ...f, review_date: e.target.value }))} className={inputCls} style={inputSt} /></FormField>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={() => setShowWaiver(false)} className="rounded-md px-4 py-2 text-sm" style={{ color: "var(--bp-ink-secondary)", ...bf }}>Cancel</button>
          <button type="button" onClick={submitWaiver} disabled={!wf.reason || !wf.approver || !wf.review_date} className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--bp-caution-amber)", color: "var(--bp-surface-1)", ...bf }}>Submit Waiver</button>
        </div>
      </Modal>

      {/* MODAL: Publish New */}
      <Modal open={showPublish} onClose={() => setShowPublish(false)}>
        <h3 className="mb-4" style={{ ...df, fontSize: 18, color: "var(--bp-ink-primary)" }}>Publish to Catalog</h3>
        <div className="space-y-3">
          <FormField label="Validated Spec" req>
            <select value={pf.spec_id || ""} onChange={e => {
              const sid = Number(e.target.value);
              const sp = specs.find(s => s.id === sid);
              setPf(f => ({
                ...f,
                spec_id: sid,
                display_name: sp?.name ?? sp?.target_name ?? f.display_name,
                technical_name: sp?.target_name ?? f.technical_name,
                domain: sp?.domain ?? f.domain,
              }));
            }} className={inputCls} style={inputSt}>
              <option value="">Select spec...</option>
              {specs.filter(s => s.status === "validated").map(s => <option key={s.id} value={s.id}>{s.name ?? s.target_name}</option>)}
            </select>
          </FormField>
          {([["display_name", "Display Name", true], ["technical_name", "Technical Name", true], ["business_description", "Business Description", true], ["grain", "Grain", true], ["domain", "Domain", true], ["owner", "Owner", true], ["steward", "Steward", true]] as [string, string, boolean][]).map(([k, l, r]) => (
            <FormField key={k} label={l} req={r}><input value={(pf as Record<string, string>)[k]} onChange={e => setPf(f => ({ ...f, [k]: e.target.value }))} className={inputCls} style={inputSt} /></FormField>
          ))}
          <FormField label="Sensitivity" req>
            <select value={pf.sensitivity_label} onChange={e => setPf(f => ({ ...f, sensitivity_label: e.target.value }))} className={inputCls} style={inputSt}>
              <option value="public">Public</option><option value="internal">Internal</option><option value="confidential">Confidential</option><option value="restricted">Restricted</option>
            </select>
          </FormField>
          <FormField label="Endorsement">
            <select value={pf.endorsement} onChange={e => setPf(f => ({ ...f, endorsement: e.target.value }))} className={inputCls} style={inputSt}>
              <option value="none">None</option><option value="promoted">Promoted</option><option value="certified">Certified</option>
            </select>
          </FormField>
          {([["tags", "Tags (comma-separated)"], ["intended_audience", "Intended Audience"], ["usage_type", "Usage Type"], ["certification_notes", "Certification Notes"]] as [string, string][]).map(([k, l]) => (
            <FormField key={k} label={l}><input value={(pf as Record<string, string>)[k]} onChange={e => setPf(f => ({ ...f, [k]: e.target.value }))} className={inputCls} style={inputSt} /></FormField>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={() => setShowPublish(false)} className="rounded-md px-4 py-2 text-sm" style={{ color: "var(--bp-ink-secondary)", ...bf }}>Cancel</button>
          <button type="button" onClick={submitPublish} disabled={!pf.spec_id || !pf.display_name || !pf.sensitivity_label} className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)", ...bf }}>Publish</button>
        </div>
      </Modal>

      {/* SLIDE-OVER: Report Recreation Detail */}
      <SlideOver open={!!selReport} onClose={() => setSelReport(null)} title={selReport?.report_name ?? ""} subtitle={selReport ? `${selReport.domain} / ${REPORT_TYPE_LABELS[selReport.report_type ?? ""] ?? "Report"}` : ""} footer={
        selReport ? (
          <div className="flex items-center gap-3">
            <label style={{ ...bf, fontSize: 13, color: "var(--bp-ink-secondary)" }}>Coverage Status</label>
            <select value={selReport.coverage_status} onChange={e => updateCoverageStatus(selReport.id, e.target.value)} className="rounded-md border px-3 py-1.5 text-sm" style={inputSt}>
              {Object.entries(COVERAGE_STATUS_CFG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
        ) : undefined
      }>
        {selReport && (() => {
          const sc = COVERAGE_STATUS_CFG[selReport.coverage_status] ?? COVERAGE_STATUS_CFG.not_analyzed;
          const unresolvedMetrics = parseJsonField<string[]>(selReport.unresolved_metrics) ?? [];
          const contribSpecs = parseJsonField<number[]>(selReport.contributing_spec_ids) ?? [];
          const contribCanon = parseJsonField<number[]>(selReport.contributing_canonical_ids) ?? [];
          const contribSpecimens = parseJsonField<number[]>(selReport.contributing_specimen_ids) ?? [];
          return (<>
            {/* Status banner */}
            <div className="flex items-center gap-3 mb-4 rounded-lg px-3 py-2" style={{ background: sc.bg, border: `1px solid color-mix(in srgb, ${sc.color} 25%, transparent)` }}>
              <Badge label={sc.label} color={sc.color} bg="transparent" />
              {selReport.assessed_by && <span style={{ ...bf, fontSize: 12, color: "var(--bp-ink-muted)" }}>Assessed by {selReport.assessed_by}</span>}
              {selReport.assessed_at && <span style={{ ...bf, fontSize: 12, color: "var(--bp-ink-muted)" }}>{selReport.assessed_at}</span>}
            </div>

            {/* Description */}
            {selReport.report_description && (
              <div className="mb-4">
                <h4 className="mb-1" style={{ ...bf, fontSize: 11, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Description</h4>
                <p style={{ ...bf, fontSize: 13, color: "var(--bp-ink-primary)" }}>{selReport.report_description}</p>
              </div>
            )}

            {/* Notes */}
            {selReport.notes && (
              <div className="mb-4">
                <h4 className="mb-1" style={{ ...bf, fontSize: 11, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Notes</h4>
                <p style={{ ...bf, fontSize: 13, color: "var(--bp-ink-secondary)" }}>{selReport.notes}</p>
              </div>
            )}

            {/* Contributing evidence */}
            {(contribSpecimens.length > 0 || contribCanon.length > 0 || contribSpecs.length > 0) && (
              <div className="mb-4">
                <h4 className="mb-2" style={{ ...df, fontSize: 14, color: "var(--bp-ink-primary)" }}>Contributing Evidence</h4>
                <div className="space-y-2">
                  {contribSpecimens.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span style={{ ...bf, fontSize: 11, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", width: 80 }}>Specimens</span>
                      <div className="flex flex-wrap gap-1">{contribSpecimens.map(id => <span key={id} className="rounded px-1.5 py-0.5" style={{ ...mono, fontSize: 11, background: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)" }}>#{id}</span>)}</div>
                    </div>
                  )}
                  {contribCanon.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span style={{ ...bf, fontSize: 11, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", width: 80 }}>Canonical</span>
                      <div className="flex flex-wrap gap-1">{contribCanon.map(id => <span key={id} className="rounded px-1.5 py-0.5" style={{ ...mono, fontSize: 11, background: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)" }}>#{id}</span>)}</div>
                    </div>
                  )}
                  {contribSpecs.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span style={{ ...bf, fontSize: 11, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", width: 80 }}>Gold Specs</span>
                      <div className="flex flex-wrap gap-1">{contribSpecs.map(id => <span key={id} className="rounded px-1.5 py-0.5" style={{ ...mono, fontSize: 11, background: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)" }}>#{id}</span>)}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Unresolved metrics */}
            {unresolvedMetrics.length > 0 && (
              <div className="mb-4">
                <h4 className="mb-2" style={{ ...df, fontSize: 14, color: "var(--bp-fault-red)" }}>Unresolved Metrics ({unresolvedMetrics.length})</h4>
                <ul className="space-y-1">
                  {unresolvedMetrics.map((m, i) => (
                    <li key={i} className="flex items-center gap-2 rounded px-2 py-1.5" style={{ background: "var(--bp-fault-light)", border: "1px solid color-mix(in srgb, var(--bp-fault-red) 15%, transparent)" }}>
                      <span style={{ color: "var(--bp-fault-red)", fontSize: 12 }}>{"\u2717"}</span>
                      <span style={{ ...bf, fontSize: 13, color: "var(--bp-ink-primary)" }}>{m}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Coverage assessment checklist (spec § 9.5) */}
            <div className="mb-4">
              <h4 className="mb-2" style={{ ...df, fontSize: 14, color: "var(--bp-ink-primary)" }}>Recreation Checklist</h4>
              <div className="space-y-1">
                {[
                  { label: "Referenced tables have canonical entities", done: contribCanon.length > 0, provisional: false },
                  { label: "Measures/KPIs linked to canonical entities", done: false, provisional: true },
                  { label: "Gold specs exist for required entities", done: contribSpecs.length > 0, provisional: false },
                  { label: "Validation passed (or has approved waivers)", done: ["fully_covered", "recreated", "reconciled"].includes(selReport.coverage_status), provisional: true },
                  { label: "No unresolved metrics remain", done: unresolvedMetrics.length === 0, provisional: false },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 rounded px-2 py-1.5" style={{ background: "var(--bp-surface-inset)" }}>
                    <span style={{ color: item.done ? "var(--bp-operational-green)" : "var(--bp-ink-muted)", fontSize: 13 }}>{item.done ? "\u2713" : "\u25CB"}</span>
                    <span style={{ ...bf, fontSize: 13, color: item.done ? "var(--bp-ink-primary)" : "var(--bp-ink-muted)" }}>{item.label}</span>
                    {item.provisional && <span className="rounded-full px-1.5 py-0.5" style={{ ...bf, fontSize: 9, color: "var(--bp-caution-amber)", background: "var(--bp-caution-light)", letterSpacing: "0.03em" }}>HEURISTIC</span>}
                  </div>
                ))}
              </div>
            </div>
          </>);
        })()}
      </SlideOver>

      {/* MODAL: Register Report */}
      <Modal open={showAddReport} onClose={() => setShowAddReport(false)}>
        <h3 className="mb-4" style={{ ...df, fontSize: 18, color: "var(--bp-ink-primary)" }}>Register Legacy Report</h3>
        <div className="space-y-3">
          <FormField label="Domain" req><input value={newReport.domain} onChange={e => setNewReport(r => ({ ...r, domain: e.target.value }))} className={inputCls} style={inputSt} placeholder="e.g. Finance, Operations" /></FormField>
          <FormField label="Report Name" req><input value={newReport.report_name} onChange={e => setNewReport(r => ({ ...r, report_name: e.target.value }))} className={inputCls} style={inputSt} /></FormField>
          <FormField label="Description"><textarea rows={2} value={newReport.report_description} onChange={e => setNewReport(r => ({ ...r, report_description: e.target.value }))} className={inputCls} style={inputSt} /></FormField>
          <FormField label="Report Type">
            <select value={newReport.report_type} onChange={e => setNewReport(r => ({ ...r, report_type: e.target.value }))} className={inputCls} style={inputSt}>
              <option value="power_bi">Power BI</option><option value="ssrs">SSRS</option><option value="excel">Excel</option><option value="other">Other</option>
            </select>
          </FormField>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={() => setShowAddReport(false)} className="rounded-md px-4 py-2 text-sm" style={{ color: "var(--bp-ink-secondary)", ...bf }}>Cancel</button>
          <button type="button" onClick={addReport} disabled={!newReport.domain || !newReport.report_name} className="rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)", ...bf }}>Register</button>
        </div>
      </Modal>
    </GoldStudioLayout>
  );
}
