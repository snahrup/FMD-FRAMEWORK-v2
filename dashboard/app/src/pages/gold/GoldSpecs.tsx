// Gold Specs — MLV design browser with detail slide-over.
// Spec: docs/superpowers/specs/2026-03-18-gold-studio-design.md § 8

import { useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { GoldStudioLayout, useGoldToast, useDomainContext } from "@/components/gold/GoldStudioLayout";
import { StatsStrip } from "@/components/gold/StatsStrip";
import { SlideOver } from "@/components/gold/SlideOver";
import { ProvenanceThread } from "@/components/gold/ProvenanceThread";
import { GoldLoading, GoldNoResults } from "@/components/gold";

const API = "/api/gold-studio";

/* ---------- types ---------- */
interface GoldSpec {
  id: number;
  root_id?: number;
  name: string;
  target_name: string;
  type: string;
  domain: string;
  canonical_name?: string;
  entity_type?: string;
  source_count: number;
  validation_status: "pass" | "pending" | "failed" | "needs_revalidation";
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  version: number;
  column_count: number;
  refresh_strategy: "Full" | "Incremental" | "Hybrid";
  status: "draft" | "validated" | "needs_revalidation" | "deprecated";
}

interface SpecDetail extends GoldSpec {
  object_type: string;
  description: string;
  business_description?: string;
  grain: string;
  primary_keys: string | string[];
  source_sql: string;
  sql?: string;
  included_columns?: string;
  excluded_columns?: string;
  transformation_rules?: string;
  downstream_reports?: string;
  last_validated?: string;
  columns: SpecColumn[];
  transforms: SpecTransform[];
  validation_runs?: Array<Record<string, unknown>>;
}

interface SpecColumn {
  name: string;
  target_name: string;
  data_type: string;
  key_type?: "PK" | "BK" | "FK";
  source_expression: string;
  included: boolean;
  exclude_reason?: string;
}

interface SpecTransform { name: string; description: string; type: string; }
interface ImpactData {
  catalog_entries: Array<Record<string, unknown>>;
  related_specs: Array<Record<string, unknown>>;
  downstream_reports: string[];
  impact_count: number;
}
interface VersionEntry { version: number; created_at?: string; created?: string; status?: string; target_name?: string; }
interface ValidationRun { id?: number; started_at?: string; date?: string; status: string; critical_count?: number; warning_count?: number; critical_fraction?: string; warnings?: number; }

interface Stats { total: number; ready: number; pending: number; needs_reval: number; deprecated: number; }

/* ---------- constants ---------- */
const STATUS_RAIL: Record<string, string> = {
  validated: "var(--bp-operational-green)", draft: "var(--bp-copper)",
  needs_revalidation: "var(--bp-caution-amber)", failed: "var(--bp-fault-red)", deprecated: "var(--bp-ink-muted)",
};

const VALIDATION_BADGE: Record<string, { label: string; bg: string; color: string; icon: string }> = {
  pass:                { label: "Pass",         bg: "var(--bp-operational-light)", color: "var(--bp-operational-green)", icon: "\u2713" },
  pending:             { label: "Pending",      bg: "var(--bp-caution-light)",     color: "var(--bp-caution-amber)",     icon: "\u25CC" },
  failed:              { label: "Failed",       bg: "var(--bp-fault-light)",       color: "var(--bp-fault-red)",         icon: "\u2717" },
  needs_revalidation:  { label: "Needs Reval.", bg: "var(--bp-copper-soft)",       color: "var(--bp-copper)",            icon: "\u21BB" },
};

const DETAIL_TABS = [
  { id: "overview", label: "Overview" }, { id: "sql", label: "SQL" },
  { id: "columns", label: "Columns" }, { id: "transforms", label: "Transforms" },
  { id: "impact", label: "Impact" }, { id: "history", label: "History" },
];

const FALLBACK_DOMAINS = ["All", "Finance", "Operations", "Supply Chain", "Quality", "Production"];
const STATUSES = ["All", "draft", "validated", "needs_revalidation"];

/* ---------- helpers ---------- */
const f = async <T,>(url: string): Promise<T> => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
const mono = { fontFamily: "var(--bp-font-mono)", fontSize: 11 } as const;
const body = (sz: number) => ({ fontFamily: "var(--bp-font-body)", fontSize: sz } as const);
const display = (sz: number) => ({ fontFamily: "var(--bp-font-display)", fontSize: sz } as const);

/* ========== component ========== */
export default function GoldSpecs() {
  const { showToast: _showToast } = useGoldToast();
  const { domainNames } = useDomainContext();
  const [stats, setStats] = useState<Stats>({ total: 0, ready: 0, pending: 0, needs_reval: 0, deprecated: 0 });
  const [specs, setSpecs] = useState<GoldSpec[]>([]);
  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState("All");
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SpecDetail | null>(null);
  const [tab, setTab] = useState("overview");
  const [impact, setImpact] = useState<ImpactData | null>(null);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [runs, setRuns] = useState<ValidationRun[]>([]);

  // Dynamic domain options: prefer context, fall back to data-derived or hardcoded
  const specDomains = [...new Set(specs.map((s) => s.domain).filter(Boolean))].sort();
  const domainOptions = domainNames.length > 0
    ? ["All", ...domainNames]
    : specDomains.length > 0
      ? ["All", ...specDomains]
      : FALLBACK_DOMAINS;

  /* fetch list + stats */
  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: "200" });
    if (domain !== "All") qs.set("domain", domain);
    if (status !== "All") qs.set("status", status);
    // List returns {items, total}
    f<{ items: GoldSpec[] }>(`${API}/specs?${qs}`).then((r) => {
      setSpecs((r?.items ?? []).map((s) => ({
        ...s,
        name: s.name ?? s.target_name ?? "Unnamed",
        type: s.type ?? s.entity_type ?? "MLV",
      })));
    }).catch(() => {}).finally(() => setLoading(false));
    f<Stats>(`${API}/stats`).then(setStats).catch(() => {});
  }, [domain, status]);

  useEffect(load, [load]);

  /* fetch detail */
  const openDetail = useCallback((id: number) => {
    setTab("overview");
    setSelected(null);
    setImpact(null);
    setVersions([]);
    setRuns([]);
    f<SpecDetail>(`${API}/specs/${id}`).then(setSelected).catch(() => {});
    // Impact returns {catalog_entries, related_specs, downstream_reports}
    f<ImpactData>(`${API}/specs/${id}/impact`).then(setImpact).catch(() => {});
    // Versions returns {items}
    f<{ items: VersionEntry[] }>(`${API}/specs/${id}/versions`).then((r) =>
      setVersions(r?.items ?? [])
    ).catch(() => {});
    // Validation runs returns {items}
    f<{ items: ValidationRun[] }>(`${API}/validation/specs/${id}/runs`).then((r) =>
      setRuns(r?.items ?? [])
    ).catch(() => {});
  }, []);

  const filtered = specs.filter((s) => !search || s.name.toLowerCase().includes(search.toLowerCase()));

  /* ---------- render ---------- */
  return (
    <GoldStudioLayout activeTab="specs">
      <StatsStrip items={[
        { label: "Gold Specs", value: stats.total },
        { label: "Ready to Deploy", value: stats.ready, highlight: true },
        { label: "Pending Validation", value: stats.pending },
        { label: "Needs Revalidation", value: stats.needs_reval },
        { label: "Deprecated", value: stats.deprecated },
      ]} />

      {/* Filter bar */}
      <div className="flex items-center gap-2.5 px-6 py-2.5" style={{ borderBottom: "1px solid var(--bp-border)" }}>
        <Select label="Domain" value={domain} options={domainOptions} onChange={setDomain} />
        <Select label="Status" value={status} options={STATUSES} onChange={setStatus} />
        <div className="relative ml-auto" style={{ width: 220 }}>
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--bp-ink-muted)" }} />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search specs..."
            className="w-full rounded-md pl-8 pr-3 py-1.5 outline-none"
            style={{ ...body(13), background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-primary)" }}
          />
        </div>
      </div>

      {/* Loading indicator */}
      {loading && specs.length === 0 && <GoldLoading />}

      {/* Spec table */}
      <div className="space-y-1" style={{ paddingBottom: 20 }}>
        {filtered.map((s) => {
          const badge = VALIDATION_BADGE[s.validation_status] ?? VALIDATION_BADGE.pending;
          return (
            <button key={s.id} type="button" onClick={() => openDetail(s.id)}
              className="w-full text-left flex items-center rounded-lg transition-colors hover:bg-black/[0.03] bp-row-interactive relative overflow-hidden"
              style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}>
              {/* status rail */}
              <span className="absolute left-0 top-0 bottom-0 rounded-l-lg" style={{ width: 3, background: STATUS_RAIL[s.status] ?? "var(--bp-ink-muted)" }} />

              <div className="flex-1 min-w-0 pl-4 pr-3 py-2">
                {/* line 1 */}
                <div className="flex items-center gap-3">
                  <span className="truncate" style={{ ...display(14) }}>{s.name}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5" style={{ ...mono, background: "var(--bp-copper-soft)", color: "var(--bp-copper)" }}>{s.type}</span>
                  <span className="shrink-0" style={{ ...body(12), color: "var(--bp-ink-secondary)" }}>{s.domain}</span>
                  <span className="shrink-0" style={{ ...body(12), color: "var(--bp-ink-muted)" }}>{s.source_count} source{s.source_count !== 1 ? "s" : ""}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 inline-flex items-center gap-1"
                    style={{ fontSize: 11, fontFamily: "var(--bp-font-body)", background: badge.bg, color: badge.color }}>
                    <span className={s.validation_status === "needs_revalidation" ? "needs-reval-spin" : ""}>{badge.icon}</span> {badge.label}
                  </span>
                  <div className="shrink-0 ml-auto"><ProvenanceThread phase={s.phase} size="sm" /></div>
                </div>
                {/* line 2 */}
                <div className="flex items-center gap-4 mt-0.5" style={{ ...mono, color: "var(--bp-ink-muted)" }}>
                  <span>v{s.version}</span>
                  <span>{s.column_count} cols</span>
                  <span>{s.refresh_strategy}</span>
                </div>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && !loading && <GoldNoResults message="No specs match your filters." />}
      </div>

      {/* Detail SlideOver */}
      <SlideOver open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ""}
        subtitle={selected ? `${selected.domain} / ${selected.object_type}` : ""}
        tabs={DETAIL_TABS} activeTab={tab} onTabChange={setTab}
        headerRight={selected ? <ProvenanceThread phase={selected.phase} size="md" /> : undefined}>
        {selected && (
          <>
            {tab === "overview" && <OverviewTab spec={selected} />}
            {tab === "sql" && <SqlTab sql={selected.source_sql ?? selected.sql ?? ""} />}
            {tab === "columns" && <ColumnsTab columns={selected.columns} />}
            {tab === "transforms" && <TransformsTab transforms={selected.transforms} />}
            {tab === "impact" && <ImpactTab data={impact} />}
            {tab === "history" && <HistoryTab versions={versions} runs={runs} />}
          </>
        )}
      </SlideOver>

      {/* rotation animation for needs-revalidation icon */}
      <style>{`
        @keyframes reval-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .needs-reval-spin { display: inline-block; animation: reval-spin 2.4s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
        .needs-reval-spin:hover { animation-play-state: paused; }
      `}</style>
    </GoldStudioLayout>
  );
}

/* ========== sub-components ========== */

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1.5">
      <span style={{ ...body(11), color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-md px-2 py-1.5 outline-none"
        style={{ ...body(13), background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-primary)" }}>
        {options.map((o) => <option key={o} value={o}>{o === "needs_revalidation" ? "Needs Reval." : o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
      </select>
    </label>
  );
}

/* --- Overview --- */
function OverviewTab({ spec }: { spec: SpecDetail }) {
  const badge = VALIDATION_BADGE[spec.validation_status] ?? VALIDATION_BADGE.pending;
  const desc = spec.business_description ?? spec.description ?? "";
  // Normalize primary_keys — backend may store as JSON string or array
  const pkeys = Array.isArray(spec.primary_keys) ? spec.primary_keys
    : typeof spec.primary_keys === "string" ? (() => { try { return JSON.parse(spec.primary_keys); } catch { return [spec.primary_keys]; } })()
    : [];
  return (
    <div className="space-y-5">
      <Field label="Target" value={spec.target_name ?? spec.name} />
      <Field label="Object Type" value={spec.object_type ?? "Materialized Lake View"} />
      {desc && <Field label="Description" value={desc} />}
      {spec.grain && <Field label="Grain" value={spec.grain} />}
      {pkeys.length > 0 && <Field label="Primary Keys" value={pkeys.join(", ")} mono />}
      {spec.canonical_name && (
        <div>
          <Label>Source Canonical</Label>
          <span className="mt-1 rounded px-2 py-0.5 inline-block" style={{ ...body(12), background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}>{spec.canonical_name}</span>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Label>Refresh</Label>
        <span className="rounded px-2 py-0.5" style={{ ...mono, background: "var(--bp-copper-soft)", color: "var(--bp-copper)" }}>{spec.refresh_strategy ?? "Full"}</span>
      </div>
      <div className="flex items-center gap-3">
        <Label>Validation</Label>
        <span className="rounded px-1.5 py-0.5 inline-flex items-center gap-1" style={{ ...body(12), background: badge.bg, color: badge.color }}>
          {badge.icon} {badge.label}
        </span>
        {spec.last_validated && <span style={{ ...body(12), color: "var(--bp-ink-muted)" }}>Last run {spec.last_validated}</span>}
      </div>
      <div className="flex items-center gap-3">
        <Label>Version</Label>
        <span style={{ ...mono, color: "var(--bp-ink-primary)" }}>v{spec.version ?? 1}</span>
      </div>
    </div>
  );
}

/* --- SQL --- */
function SqlTab({ sql }: { sql: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = sql.split("\n");
  return (
    <div className={expanded ? "fixed inset-0 z-[60] flex flex-col" : "space-y-3"}>
      {/* warning */}
      <div className="rounded-md px-3 py-2 flex items-center gap-2"
        style={{ background: "rgba(194,122,26,0.10)", border: "1px solid rgba(194,122,26,0.25)" }}>
        <span style={{ ...body(12), color: "var(--bp-caution-amber)" }}>Editing SQL will mark this spec as Needs Revalidation</span>
      </div>
      {/* code block */}
      <div className="relative rounded-lg overflow-hidden" style={{ background: "#2B2A27", flex: expanded ? 1 : undefined }}>
        <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
          <CopyBtn text={sql} />
          <button type="button" onClick={() => setExpanded(!expanded)}
            className="rounded px-1.5 py-1 text-xs transition-colors hover:bg-white/10" style={{ color: "#E8E6E3" }}>
            {expanded ? "\u2716" : "\u2922"}
          </button>
        </div>
        <pre className="overflow-auto p-4 pr-20" style={{ fontFamily: "var(--bp-font-mono)", fontSize: 13, color: "#E8E6E3", lineHeight: 1.6, maxHeight: expanded ? undefined : 480 }}>
          {lines.map((l, i) => (
            <div key={i} className="flex">
              <span className="select-none w-8 shrink-0 text-right mr-4" style={{ color: "rgba(232,230,227,0.3)" }}>{i + 1}</span>
              <span>{l}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

/* --- Columns --- */
function ColumnsTab({ columns }: { columns: SpecColumn[] }) {
  return (
    <table className="w-full text-left" style={{ ...body(12) }}>
      <thead>
        <tr style={{ color: "var(--bp-ink-muted)", borderBottom: "1px solid var(--bp-border)" }}>
          {["Column", "Target", "Type", "Key", "Source Expression", ""].map((h) => (
            <th key={h} className="pb-2 pr-3 font-medium" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {columns.map((c) => (
          <tr key={c.name} className={c.included ? "" : "opacity-50"} style={{ borderBottom: "1px solid var(--bp-border)" }}>
            <td className="py-1.5 pr-3" style={{ ...mono, textDecoration: c.included ? "none" : "line-through" }} title={c.exclude_reason}>{c.name}</td>
            <td className="py-1.5 pr-3" style={mono}>{c.target_name}</td>
            <td className="py-1.5 pr-3" style={mono}>{c.data_type}</td>
            <td className="py-1.5 pr-3">{c.key_type && <span className="rounded px-1 py-0.5" style={{ ...mono, background: "var(--bp-copper-soft)", color: "var(--bp-copper)" }}>{c.key_type}</span>}</td>
            <td className="py-1.5 pr-3" style={{ ...mono, color: "var(--bp-ink-secondary)" }}>{c.source_expression}</td>
            <td className="py-1.5">{c.included
              ? <span className="rounded px-1.5 py-0.5" style={{ fontSize: 10, background: "var(--bp-operational-light)", color: "var(--bp-operational-green)" }}>Included</span>
              : <span className="rounded px-1.5 py-0.5" style={{ fontSize: 10, background: "var(--bp-fault-light)", color: "var(--bp-fault-red)" }} title={c.exclude_reason}>Excluded</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* --- Transforms --- */
function TransformsTab({ transforms }: { transforms: SpecTransform[] }) {
  if (!transforms.length) return <p style={{ ...body(13), color: "var(--bp-ink-muted)" }}>No transformation rules defined.</p>;
  return (
    <div className="space-y-2">
      {transforms.map((t, i) => (
        <div key={i} className="rounded-lg p-3" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
          <div className="flex items-center gap-2">
            <span style={{ ...display(13), color: "var(--bp-ink-primary)" }}>{t.name}</span>
            <span className="rounded px-1.5 py-0.5" style={{ ...mono, background: "var(--bp-copper-soft)", color: "var(--bp-copper)" }}>{t.type}</span>
          </div>
          <p className="mt-1" style={{ ...body(12), color: "var(--bp-ink-secondary)" }}>{t.description}</p>
        </div>
      ))}
    </div>
  );
}

/* --- Impact --- */
function ImpactTab({ data }: { data: ImpactData | null }) {
  if (!data) return <p style={{ ...body(13), color: "var(--bp-ink-muted)" }}>Loading...</p>;
  const Section = ({ title, items }: { title: string; items: string[] }) => (
    <div>
      <h4 style={{ ...display(13), color: "var(--bp-ink-primary)" }} className="mb-2">{title}</h4>
      {items.length === 0
        ? <p style={{ ...body(12), color: "var(--bp-ink-muted)" }}>None</p>
        : <ul className="space-y-1">{items.map((it) => <li key={it} className="rounded px-2 py-1" style={{ ...body(12), background: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)" }}>{it}</li>)}</ul>}
    </div>
  );
  // Backend returns {catalog_entries, related_specs, downstream_reports, impact_count}
  const relatedNames = (data.related_specs ?? []).map((s: Record<string, unknown>) => String(s.name ?? s.target_name ?? s.id ?? ""));
  const catalogNames = (data.catalog_entries ?? []).map((c: Record<string, unknown>) => String(c.name ?? c.entry_name ?? c.id ?? ""));
  return (
    <div className="space-y-5">
      <Section title="Downstream Reports" items={data.downstream_reports ?? []} />
      <Section title="Related Gold Specs" items={relatedNames} />
      <Section title="Catalog Entries" items={catalogNames} />
      {data.impact_count != null && (
        <div>
          <Label>Total Impact Score</Label>
          <span className="mt-1 inline-block rounded px-2 py-0.5" style={{ ...mono, background: "var(--bp-copper-soft)", color: "var(--bp-copper)" }}>{data.impact_count}</span>
        </div>
      )}
    </div>
  );
}

/* --- History --- */
function HistoryTab({ versions, runs }: { versions: VersionEntry[]; runs: ValidationRun[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h4 style={{ ...display(13), color: "var(--bp-ink-primary)" }} className="mb-2">Version History</h4>
        <div className="space-y-1">
          {versions.map((v, i) => (
            <div key={i} className="flex items-center gap-3 rounded px-2 py-1.5" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
              <span style={{ ...mono, color: "var(--bp-copper)" }}>v{v.version}</span>
              {v.status && <span className="rounded px-1.5 py-0.5" style={{ ...body(11), background: "var(--bp-surface-inset)", color: "var(--bp-ink-secondary)" }}>{v.status}</span>}
              <span style={{ ...body(12), color: "var(--bp-ink-secondary)", flex: 1 }}>{v.target_name ?? ""}</span>
              <span style={{ ...mono, color: "var(--bp-ink-muted)" }}>{v.created_at ?? v.created ?? ""}</span>
            </div>
          ))}
          {!versions.length && <p style={{ ...body(12), color: "var(--bp-ink-muted)" }}>No version history.</p>}
        </div>
      </div>
      <div>
        <h4 style={{ ...display(13), color: "var(--bp-ink-primary)" }} className="mb-2">Validation Runs</h4>
        <div className="space-y-1">
          {runs.map((r, i) => {
            const c = r.status === "pass" ? "var(--bp-operational-green)" : r.status === "fail" ? "var(--bp-fault-red)" : "var(--bp-caution-amber)";
            return (
              <div key={i} className="flex items-center gap-3 rounded px-2 py-1.5" style={{ background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)" }}>
                <span className="rounded px-1.5 py-0.5" style={{ ...body(11), background: `color-mix(in srgb, ${c} 12%, transparent)`, color: c }}>{r.status.toUpperCase()}</span>
                <span style={{ ...mono, color: "var(--bp-ink-muted)" }}>{r.started_at ?? r.date ?? ""}</span>
                <span style={{ ...body(12), color: "var(--bp-ink-secondary)" }}>Critical: {r.critical_count ?? r.critical_fraction ?? 0}</span>
                <span style={{ ...body(12), color: "var(--bp-ink-muted)" }}>{r.warning_count ?? r.warnings ?? 0} warning{(r.warning_count ?? r.warnings ?? 0) !== 1 ? "s" : ""}</span>
              </div>
            );
          })}
          {!runs.length && <p style={{ ...body(12), color: "var(--bp-ink-muted)" }}>No validation runs recorded.</p>}
        </div>
      </div>
    </div>
  );
}

/* --- tiny helpers --- */
function Label({ children }: { children: string }) {
  return <span style={{ ...body(11), color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</span>;
}

function Field({ label, value, mono: useMono }: { label: string; value: string; mono?: boolean }) {
  return <div><Label>{label}</Label><p className="mt-0.5" style={useMono ? { ...mono, color: "var(--bp-ink-primary)" } : { ...body(13), color: "var(--bp-ink-primary)" }}>{value}</p></div>;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="rounded px-1.5 py-1 text-xs transition-colors hover:bg-white/10" style={{ color: "#E8E6E3" }}
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
