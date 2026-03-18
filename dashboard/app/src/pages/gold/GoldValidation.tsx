// Gold Validation & Catalog — Validation status for specs + published catalog registry.
import { useState, useEffect, useCallback, type ReactNode } from "react";
import { GoldStudioLayout, StatsStrip, SlideOver } from "@/components/gold";

/* ---------- types ---------- */
interface ValidationRun { id: string; rule_name: string; type: "Critical" | "Warning" | "Advisory"; expected: string; actual: string; status: "passed" | "failed" | "waiver" }
interface ReconciliationRow { metric: string; legacy_value: string | number; gold_value: string | number; delta: string; status: "within_tolerance" | "review" | "out_of_range" }
interface Waiver { reason: string; approver: string; timestamp: string; review_date: string }
interface SpecValidation { id: string; spec_name: string; status: "passed" | "failed" | "waiver" | "pending"; critical_passed: number; critical_total: number; warnings: number; last_run: string | null; runs?: ValidationRun[]; reconciliation?: ReconciliationRow[]; waiver?: Waiver | null }
interface CatalogEntry { id: string; display_name: string; technical_name: string; domain: string; owner: string; sensitivity: "Public" | "Internal" | "Confidential" | "Restricted"; endorsement: "None" | "Promoted" | "Certified"; published: string; description?: string; grain?: string; steward?: string; tags?: string[]; intended_audience?: string; usage_type?: string; certification_notes?: string; workspace?: string; lakehouse?: string; schema?: string; object_name?: string; deployment_env?: string; versions?: { version: number; date: string; note: string }[] }
interface Stats { validated: number; cataloged: number; pending: number; failed: number; reconciliation_warnings: number }

/* ---------- constants ---------- */
const STATUS_ORDER: Record<string, number> = { failed: 0, waiver: 1, pending: 2, passed: 3 };
const STATUS_CFG: Record<string, { icon: string; label: string; color: string; bg: string }> = {
  passed: { icon: "\u2713", label: "Passed", color: "var(--bp-operational-green)", bg: "rgba(61,124,79,0.10)" },
  waiver: { icon: "\u26A0", label: "Waiver\u2020", color: "var(--bp-caution-amber)", bg: "rgba(194,122,26,0.10)" },
  pending: { icon: "\u25CC", label: "Pending", color: "var(--bp-ink-muted)", bg: "rgba(168,162,158,0.10)" },
  failed: { icon: "\u2717", label: "Failed", color: "var(--bp-fault-red)", bg: "rgba(185,58,42,0.10)" },
};
const SENS_CFG: Record<string, { color: string; bg: string }> = {
  Public: { color: "var(--bp-operational-green)", bg: "rgba(61,124,79,0.10)" },
  Internal: { color: "#3B82F6", bg: "rgba(59,130,246,0.10)" },
  Confidential: { color: "var(--bp-caution-amber)", bg: "rgba(194,122,26,0.10)" },
  Restricted: { color: "var(--bp-fault-red)", bg: "rgba(185,58,42,0.10)" },
};
const API = "/api/gold-studio";
const bf: React.CSSProperties = { fontFamily: "var(--bp-font-body)" };
const df: React.CSSProperties = { fontFamily: "var(--bp-font-display)" };
const th: React.CSSProperties = { ...bf, fontSize: 11, fontWeight: 600, color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", padding: "8px 12px", borderBottom: "1px solid var(--bp-border)", textAlign: "left" };
const td: React.CSSProperties = { ...bf, fontSize: 13, color: "var(--bp-ink-primary)", padding: "10px 12px", borderBottom: "1px solid var(--bp-border)" };

/* ---------- helpers ---------- */
function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ color, background: bg, ...bf }}>{label}</span>;
}
function StatusIcon({ s }: { s: string }) {
  const c = STATUS_CFG[s] ?? STATUS_CFG.pending;
  return <span style={{ color: c.color, fontWeight: 600 }}>{c.icon}</span>;
}
function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose}>
      <div className="rounded-lg shadow-xl w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto" style={{ background: "var(--bp-surface-1)" }} onClick={(e) => e.stopPropagation()}>{children}</div>
    </div>
  );
}
function Field({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) {
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

/* ---------- main ---------- */
export default function GoldValidation() {
  const [tab, setTab] = useState<"validation" | "catalog">("validation");
  const [stats, setStats] = useState<Stats | null>(null);
  const [specs, setSpecs] = useState<SpecValidation[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [selSpec, setSelSpec] = useState<SpecValidation | null>(null);
  const [selCat, setSelCat] = useState<CatalogEntry | null>(null);
  const [showPublish, setShowPublish] = useState(false);
  const [showWaiver, setShowWaiver] = useState(false);
  const [wf, setWf] = useState({ reason: "", approver: "", review_date: "" });
  const [pf, setPf] = useState({ spec_id: "", display_name: "", technical_name: "", description: "", grain: "", domain: "", owner: "", steward: "", sensitivity: "Internal" as CatalogEntry["sensitivity"], endorsement: "None" as CatalogEntry["endorsement"], tags: "", intended_audience: "", usage_type: "", certification_notes: "" });

  const load = useCallback(async () => {
    try {
      const [s, sp, c] = await Promise.all([fetch(`${API}/stats`).then(r => r.json()), fetch(`${API}/specs?status=validated`).then(r => r.json()), fetch(`${API}/catalog`).then(r => r.json())]);
      setStats(s);
      setSpecs(((sp.specs ?? sp) as SpecValidation[]).sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)));
      setCatalog((c.entries ?? c) as CatalogEntry[]);
    } catch { /* API not wired */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openSpec = async (spec: SpecValidation) => {
    try {
      const r = await fetch(`${API}/validation/specs/${spec.id}/runs`).then(r => r.json());
      setSelSpec({ ...spec, runs: r.results ?? r.runs ?? [], reconciliation: r.reconciliation ?? [], waiver: r.waiver ?? null });
    } catch { setSelSpec(spec); }
  };
  const openCat = async (entry: CatalogEntry) => {
    try { setSelCat(await fetch(`${API}/catalog/${entry.id}`).then(r => r.json())); } catch { setSelCat(entry); }
  };
  const runValidation = async (id: string) => { await fetch(`${API}/validation/specs/${id}/validate`, { method: "POST" }); load(); };
  const submitWaiver = async () => {
    if (!selSpec?.runs?.[0]) return;
    await fetch(`${API}/validation/runs/${selSpec.runs[0].id}/waiver`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(wf) });
    setShowWaiver(false); setWf({ reason: "", approver: "", review_date: "" }); load();
  };
  const submitPublish = async () => {
    await fetch(`${API}/catalog/specs/${pf.spec_id}/publish`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...pf, tags: pf.tags.split(",").map(t => t.trim()).filter(Boolean) }) });
    setShowPublish(false); load();
  };
  const updateEndorsement = async (id: string, e: string) => {
    await fetch(`${API}/catalog/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endorsement: e }) }); load();
  };

  const strip = [
    { label: "Validated", value: stats?.validated ?? 0 },
    { label: "Cataloged", value: stats?.cataloged ?? 0 },
    { label: "Pending Validation", value: stats?.pending ?? 0, highlight: (stats?.pending ?? 0) > 0 },
    { label: "Failed", value: stats?.failed ?? 0, highlight: (stats?.failed ?? 0) > 0 },
    { label: "Reconciliation Warnings", value: stats?.reconciliation_warnings ?? 0 },
  ];

  const typeBadge = (t: string) => {
    const [c, b] = t === "Critical" ? ["var(--bp-fault-red)", "rgba(185,58,42,0.10)"] : t === "Warning" ? ["var(--bp-caution-amber)", "rgba(194,122,26,0.10)"] : ["var(--bp-ink-muted)", "rgba(168,162,158,0.10)"];
    return <Badge label={t} color={c} bg={b} />;
  };

  return (
    <GoldStudioLayout activeTab="validation">
      <StatsStrip items={strip} />
      {/* Sub-tabs */}
      <div className="flex gap-1 px-6 pt-4" style={{ borderBottom: "1px solid var(--bp-border)" }}>
        {(["validation", "catalog"] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)} className="pb-2.5 px-3 text-center transition-colors relative" style={{ ...bf, fontWeight: 500, fontSize: 13, color: tab === t ? "var(--bp-copper)" : "var(--bp-ink-muted)" }}>
            {t === "validation" ? "Validation Status" : "Catalog Registry"}
            {tab === t && <span className="absolute bottom-0 left-0 right-0" style={{ height: 2, background: "var(--bp-copper)", borderRadius: "1px 1px 0 0" }} />}
          </button>
        ))}
      </div>

      <div className="px-6 py-5">
        {/* TAB 1: Validation Status */}
        {tab === "validation" && (
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
            <table className="w-full">
              <thead><tr><th style={th}>Spec Name</th><th style={th}>Status</th><th style={th}>Critical</th><th style={th}>Warnings</th><th style={th}>Last Run</th></tr></thead>
              <tbody>
                {specs.length === 0 && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "var(--bp-ink-muted)" }}>No specs available</td></tr>}
                {specs.map(s => { const c = STATUS_CFG[s.status] ?? STATUS_CFG.pending; return (
                  <tr key={s.id} className="cursor-pointer hover:bg-black/[0.02] transition-colors" onClick={() => openSpec(s)}>
                    <td style={{ ...td, fontWeight: 500 }}>{s.spec_name}</td>
                    <td style={td}><Badge label={`${c.icon} ${c.label}`} color={c.color} bg={c.bg} /></td>
                    <td style={td}>{s.critical_passed}/{s.critical_total}</td>
                    <td style={td}>{s.warnings}</td>
                    <td style={{ ...td, color: "var(--bp-ink-secondary)", fontSize: 12 }}>{s.last_run ?? "\u2014"}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: Catalog Registry */}
        {tab === "catalog" && (<>
          <div className="flex justify-end mb-4">
            <button type="button" onClick={() => setShowPublish(true)} className="rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90" style={{ background: "var(--bp-copper)", ...bf }}>Publish New</button>
          </div>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
            <table className="w-full">
              <thead><tr><th style={th}>Display Name</th><th style={th}>Technical Name</th><th style={th}>Domain</th><th style={th}>Owner</th><th style={th}>Sensitivity</th><th style={th}>Endorsement</th><th style={th}>Published</th></tr></thead>
              <tbody>
                {catalog.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: "center", color: "var(--bp-ink-muted)" }}>No catalog entries</td></tr>}
                {catalog.map(c => {
                  const sens = SENS_CFG[c.sensitivity] ?? SENS_CFG.Internal;
                  const ec = c.endorsement === "Certified" ? { label: "\u2713 Certified", color: "var(--bp-operational-green)", bg: "rgba(61,124,79,0.10)" } : c.endorsement === "Promoted" ? { label: "Promoted", color: "var(--bp-copper)", bg: "rgba(180,86,36,0.10)" } : null;
                  return (
                    <tr key={c.id} className="cursor-pointer hover:bg-black/[0.02] transition-colors" onClick={() => openCat(c)}>
                      <td style={{ ...td, fontWeight: 500 }}>{c.display_name}</td>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{c.technical_name}</td>
                      <td style={td}>{c.domain}</td><td style={td}>{c.owner}</td>
                      <td style={td}><Badge label={c.sensitivity} color={sens.color} bg={sens.bg} /></td>
                      <td style={td}>{ec ? <Badge label={ec.label} color={ec.color} bg={ec.bg} /> : <span style={{ color: "var(--bp-ink-muted)", fontSize: 12 }}>Unendorsed</span>}</td>
                      <td style={{ ...td, color: "var(--bp-ink-secondary)", fontSize: 12 }}>{c.published}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>)}
      </div>

      {/* SLIDE-OVER: Validation Detail */}
      <SlideOver open={!!selSpec} onClose={() => setSelSpec(null)} title={selSpec?.spec_name ?? ""} subtitle="Validation Detail" footer={
        <div className="flex gap-2">
          <button type="button" onClick={() => selSpec && runValidation(selSpec.id)} className="rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90" style={{ background: "var(--bp-copper)", ...bf }}>Run Validation</button>
          {selSpec?.status === "failed" && <button type="button" onClick={() => setShowWaiver(true)} className="rounded-md px-4 py-2 text-sm font-medium text-white hover:opacity-90" style={{ background: "var(--bp-caution-amber)", ...bf }}>File Waiver</button>}
        </div>
      }>
        <h3 className="mb-3" style={{ ...df, fontSize: 15, color: "var(--bp-ink-primary)" }}>Validation Results</h3>
        <div className="rounded-lg overflow-hidden mb-6" style={{ border: "1px solid var(--bp-border)" }}>
          <table className="w-full">
            <thead><tr><th style={th}>Rule Name</th><th style={th}>Type</th><th style={th}>Expected</th><th style={th}>Actual</th><th style={th}>Status</th></tr></thead>
            <tbody>
              {(selSpec?.runs ?? []).map((r, i) => (
                <tr key={i}><td style={{ ...td, fontWeight: 500 }}>{r.rule_name}</td><td style={td}>{typeBadge(r.type)}</td><td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.expected}</td><td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.actual}</td><td style={td}><StatusIcon s={r.status} /></td></tr>
              ))}
              {(!selSpec?.runs || selSpec.runs.length === 0) && <tr><td colSpan={5} style={{ ...td, textAlign: "center", color: "var(--bp-ink-muted)" }}>No validation runs yet</td></tr>}
            </tbody>
          </table>
        </div>
        {selSpec?.waiver && (
          <div className="rounded-lg p-4 mb-6" style={{ background: "rgba(194,122,26,0.06)", border: "1px solid rgba(194,122,26,0.15)" }}>
            <h4 className="mb-2" style={{ ...df, fontSize: 14, color: "var(--bp-caution-amber)" }}>Active Waiver</h4>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2" style={{ ...bf, fontSize: 13 }}>
              <dt style={{ color: "var(--bp-ink-muted)" }}>Reason</dt><dd>{selSpec.waiver.reason}</dd>
              <dt style={{ color: "var(--bp-ink-muted)" }}>Approver</dt><dd>{selSpec.waiver.approver}</dd>
              <dt style={{ color: "var(--bp-ink-muted)" }}>Filed</dt><dd>{selSpec.waiver.timestamp}</dd>
              <dt style={{ color: "var(--bp-ink-muted)" }}>Review Date</dt><dd>{selSpec.waiver.review_date}</dd>
            </dl>
          </div>
        )}
        {selSpec?.reconciliation && selSpec.reconciliation.length > 0 && (<>
          <h3 className="mb-3" style={{ ...df, fontSize: 15, color: "var(--bp-ink-primary)" }}>Reconciliation</h3>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)" }}>
            <table className="w-full">
              <thead><tr><th style={th}>Metric</th><th style={th}>Legacy Value</th><th style={th}>Gold Value</th><th style={th}>Delta</th><th style={th}>Status</th></tr></thead>
              <tbody>{selSpec.reconciliation.map((r, i) => {
                const rc = r.status === "within_tolerance" ? { i: "\u2713", c: "var(--bp-operational-green)" } : r.status === "review" ? { i: "\u26A0", c: "var(--bp-caution-amber)" } : { i: "\u2717", c: "var(--bp-fault-red)" };
                return <tr key={i}><td style={{ ...td, fontWeight: 500 }}>{r.metric}</td><td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.legacy_value}</td><td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.gold_value}</td><td style={{ ...td, fontFamily: "monospace", fontSize: 12 }}>{r.delta}</td><td style={td}><span style={{ color: rc.c, fontWeight: 600 }}>{rc.i}</span></td></tr>;
              })}</tbody>
            </table>
          </div>
        </>)}
      </SlideOver>

      {/* SLIDE-OVER: Catalog Detail */}
      <SlideOver open={!!selCat} onClose={() => setSelCat(null)} title={selCat?.display_name ?? ""} subtitle={selCat?.technical_name} footer={
        <div className="flex items-center gap-3">
          <label style={{ ...bf, fontSize: 13, color: "var(--bp-ink-secondary)" }}>Endorsement</label>
          <select value={selCat?.endorsement ?? "None"} onChange={e => selCat && updateEndorsement(selCat.id, e.target.value)} className="rounded-md border px-3 py-1.5 text-sm" style={inputSt}>
            <option>None</option><option>Promoted</option><option>Certified</option>
          </select>
        </div>
      }>
        {selCat && (<>
          <DL items={[["Domain", selCat.domain], ["Owner", selCat.owner], ["Steward", selCat.steward], ["Grain", selCat.grain], ["Sensitivity", selCat.sensitivity], ["Endorsement", selCat.endorsement], ["Description", selCat.description], ["Intended Audience", selCat.intended_audience], ["Usage Type", selCat.usage_type], ["Certification Notes", selCat.certification_notes]]} />
          {selCat.tags && selCat.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-4 mb-6">{selCat.tags.map(t => <span key={t} className="rounded-full px-2.5 py-0.5 text-xs" style={{ background: "rgba(0,0,0,0.05)", color: "var(--bp-ink-secondary)", ...bf }}>{t}</span>)}</div>
          )}
          {(selCat.workspace || selCat.lakehouse || selCat.schema || selCat.object_name) && (<>
            <h4 className="mb-2 mt-6" style={{ ...df, fontSize: 14, color: "var(--bp-ink-primary)" }}>Implementation</h4>
            <dl className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2" style={{ ...bf, fontSize: 13 }}>
              {([["Workspace", selCat.workspace], ["Lakehouse", selCat.lakehouse], ["Schema", selCat.schema], ["Object Name", selCat.object_name], ["Environment", selCat.deployment_env]] as [string, string | undefined][]).filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="contents"><dt style={{ color: "var(--bp-ink-muted)", fontWeight: 500 }}>{k}</dt><dd style={{ color: "var(--bp-ink-primary)", fontFamily: "monospace", fontSize: 12 }}>{v}</dd></div>
              ))}
            </dl>
          </>)}
          {selCat.versions && selCat.versions.length > 0 && (<>
            <h4 className="mb-2 mt-6" style={{ ...df, fontSize: 14, color: "var(--bp-ink-primary)" }}>Version History</h4>
            <div className="space-y-2">{selCat.versions.map(v => (
              <div key={v.version} className="flex items-baseline gap-3" style={{ ...bf, fontSize: 13 }}>
                <span className="font-medium" style={{ color: "var(--bp-copper)" }}>v{v.version}</span>
                <span style={{ color: "var(--bp-ink-muted)", fontSize: 12 }}>{v.date}</span>
                <span style={{ color: "var(--bp-ink-secondary)" }}>{v.note}</span>
              </div>
            ))}</div>
          </>)}
        </>)}
      </SlideOver>

      {/* MODAL: File Waiver */}
      <Modal open={showWaiver} onClose={() => setShowWaiver(false)}>
        <h3 className="mb-4" style={{ ...df, fontSize: 18, color: "var(--bp-ink-primary)" }}>File Waiver</h3>
        <div className="space-y-3">
          <Field label="Reason" req><textarea rows={3} value={wf.reason} onChange={e => setWf(f => ({ ...f, reason: e.target.value }))} className={inputCls} style={inputSt} /></Field>
          <Field label="Approver" req><input value={wf.approver} onChange={e => setWf(f => ({ ...f, approver: e.target.value }))} className={inputCls} style={inputSt} /></Field>
          <Field label="Review Date" req><input type="date" value={wf.review_date} onChange={e => setWf(f => ({ ...f, review_date: e.target.value }))} className={inputCls} style={inputSt} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={() => setShowWaiver(false)} className="rounded-md px-4 py-2 text-sm" style={{ color: "var(--bp-ink-secondary)", ...bf }}>Cancel</button>
          <button type="button" onClick={submitWaiver} disabled={!wf.reason || !wf.approver || !wf.review_date} className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--bp-caution-amber)", ...bf }}>Submit Waiver</button>
        </div>
      </Modal>

      {/* MODAL: Publish New */}
      <Modal open={showPublish} onClose={() => setShowPublish(false)}>
        <h3 className="mb-4" style={{ ...df, fontSize: 18, color: "var(--bp-ink-primary)" }}>Publish to Catalog</h3>
        <div className="space-y-3">
          <Field label="Validated Spec" req>
            <select value={pf.spec_id} onChange={e => { const sp = specs.find(s => s.id === e.target.value); setPf(f => ({ ...f, spec_id: e.target.value, display_name: sp?.spec_name ?? f.display_name, technical_name: sp?.spec_name?.toLowerCase().replace(/\s+/g, "_") ?? f.technical_name })); }} className={inputCls} style={inputSt}>
              <option value="">Select spec...</option>
              {specs.filter(s => s.status === "passed" || s.status === "waiver").map(s => <option key={s.id} value={s.id}>{s.spec_name}</option>)}
            </select>
          </Field>
          {([["display_name", "Display Name", true], ["technical_name", "Technical Name", true], ["description", "Business Description", false], ["grain", "Grain", false], ["domain", "Domain", false], ["owner", "Owner", false], ["steward", "Steward", false]] as [string, string, boolean][]).map(([k, l, r]) => (
            <Field key={k} label={l} req={r}><input value={(pf as Record<string, string>)[k]} onChange={e => setPf(f => ({ ...f, [k]: e.target.value }))} className={inputCls} style={inputSt} /></Field>
          ))}
          <Field label="Sensitivity" req>
            <select value={pf.sensitivity} onChange={e => setPf(f => ({ ...f, sensitivity: e.target.value as CatalogEntry["sensitivity"] }))} className={inputCls} style={inputSt}>
              <option>Public</option><option>Internal</option><option>Confidential</option><option>Restricted</option>
            </select>
          </Field>
          <Field label="Endorsement">
            <select value={pf.endorsement} onChange={e => setPf(f => ({ ...f, endorsement: e.target.value as CatalogEntry["endorsement"] }))} className={inputCls} style={inputSt}>
              <option>None</option><option>Promoted</option><option>Certified</option>
            </select>
          </Field>
          {([["tags", "Tags (comma-separated)"], ["intended_audience", "Intended Audience"], ["usage_type", "Usage Type"], ["certification_notes", "Certification Notes"]] as [string, string][]).map(([k, l]) => (
            <Field key={k} label={l}><input value={(pf as Record<string, string>)[k]} onChange={e => setPf(f => ({ ...f, [k]: e.target.value }))} className={inputCls} style={inputSt} /></Field>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={() => setShowPublish(false)} className="rounded-md px-4 py-2 text-sm" style={{ color: "var(--bp-ink-secondary)", ...bf }}>Cancel</button>
          <button type="button" onClick={submitPublish} disabled={!pf.spec_id || !pf.display_name || !pf.sensitivity} className="rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50" style={{ background: "var(--bp-copper)", ...bf }}>Publish</button>
        </div>
      </Modal>
    </GoldStudioLayout>
  );
}
