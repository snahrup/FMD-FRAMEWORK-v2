import { useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { GoldStudioLayout } from "@/components/gold/GoldStudioLayout";
import { StatsStrip } from "@/components/gold/StatsStrip";
import { SlideOver } from "@/components/gold/SlideOver";
import { ProvenanceThread } from "@/components/gold/ProvenanceThread";

const API = "/api/gold-studio";

/* ---------- types ---------- */
interface GoldSpec {
  id: string;
  name: string;
  type: string;
  domain: string;
  source_count: number;
  validation_status: "pass" | "pending" | "failed" | "needs_revalidation";
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  version: string;
  column_count: number;
  refresh_strategy: "Full" | "Incremental" | "Hybrid";
  status: "draft" | "validated" | "needs_revalidation" | "deprecated";
}

interface SpecDetail extends GoldSpec {
  target_name: string;
  object_type: string;
  description: string;
  grain: string;
  primary_keys: string[];
  lineage_chain: string[];
  last_validated?: string;
  sql: string;
  columns: SpecColumn[];
  transforms: SpecTransform[];
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
interface ImpactData { downstream_reports: string[]; semantic_models: string[]; affected_specs: string[]; }
interface VersionEntry { version: string; created: string; description: string; author: string; }
interface ValidationRun { date: string; status: "pass" | "fail" | "warning"; critical_fraction: string; warnings: number; }

interface Stats { total: number; ready: number; pending: number; needs_reval: number; deprecated: number; }

/* ---------- constants ---------- */
const STATUS_RAIL: Record<string, string> = {
  validated: "var(--bp-operational-green)", draft: "var(--bp-copper)",
  needs_revalidation: "var(--bp-caution-amber)", failed: "var(--bp-fault-red)", deprecated: "var(--bp-ink-muted)",
};

const VALIDATION_BADGE: Record<string, { label: string; bg: string; color: string; icon: string }> = {
  pass:                { label: "Pass",         bg: "rgba(61,124,79,0.12)",  color: "var(--bp-operational-green)", icon: "\u2713" },
  pending:             { label: "Pending",      bg: "rgba(194,122,26,0.12)", color: "var(--bp-caution-amber)",     icon: "\u25CC" },
  failed:              { label: "Failed",       bg: "rgba(185,58,42,0.12)",  color: "var(--bp-fault-red)",         icon: "\u2717" },
  needs_revalidation:  { label: "Needs Reval.", bg: "rgba(180,86,36,0.12)",  color: "var(--bp-copper)",            icon: "\u21BB" },
};

const DETAIL_TABS = [
  { id: "overview", label: "Overview" }, { id: "sql", label: "SQL" },
  { id: "columns", label: "Columns" }, { id: "transforms", label: "Transforms" },
  { id: "impact", label: "Impact" }, { id: "history", label: "History" },
];

const DOMAINS = ["All", "Finance", "Operations", "Supply Chain", "Quality", "Production"];
const STATUSES = ["All", "draft", "validated", "needs_revalidation"];

/* ---------- helpers ---------- */
const f = async <T,>(url: string): Promise<T> => { const r = await fetch(url); return r.json(); };
const mono = { fontFamily: "var(--bp-font-mono)", fontSize: 11 } as const;
const body = (sz: number) => ({ fontFamily: "var(--bp-font-body)", fontSize: sz } as const);
const display = (sz: number) => ({ fontFamily: "var(--bp-font-display)", fontSize: sz } as const);

/* ========== component ========== */
export default function GoldSpecs() {
  const [stats, setStats] = useState<Stats>({ total: 0, ready: 0, pending: 0, needs_reval: 0, deprecated: 0 });
  const [specs, setSpecs] = useState<GoldSpec[]>([]);
  const [domain, setDomain] = useState("All");
  const [status, setStatus] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SpecDetail | null>(null);
  const [tab, setTab] = useState("overview");
  const [impact, setImpact] = useState<ImpactData | null>(null);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [runs, setRuns] = useState<ValidationRun[]>([]);

  /* fetch list + stats */
  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (domain !== "All") qs.set("domain", domain);
    if (status !== "All") qs.set("status", status);
    f<GoldSpec[]>(`${API}/specs?${qs}`).then(setSpecs).catch(() => {});
    f<Stats>(`${API}/stats`).then(setStats).catch(() => {});
  }, [domain, status]);

  useEffect(load, [load]);

  /* fetch detail */
  const openDetail = useCallback((id: string) => {
    setTab("overview");
    f<SpecDetail>(`${API}/specs/${id}`).then(setSelected).catch(() => {});
    f<ImpactData>(`${API}/specs/${id}/impact`).then(setImpact).catch(() => {});
    f<VersionEntry[]>(`${API}/specs/${id}/versions`).then(setVersions).catch(() => {});
    f<ValidationRun[]>(`${API}/validation/specs/${id}/runs`).then(setRuns).catch(() => {});
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
      <div className="flex items-center gap-3 px-6 py-3" style={{ borderBottom: "1px solid var(--bp-border)" }}>
        <Select label="Domain" value={domain} options={DOMAINS} onChange={setDomain} />
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

      {/* Spec table */}
      <div className="px-6 py-4 space-y-1">
        {filtered.map((s) => {
          const badge = VALIDATION_BADGE[s.validation_status];
          return (
            <button key={s.id} type="button" onClick={() => openDetail(s.id)}
              className="w-full text-left flex items-center rounded-lg transition-colors hover:bg-black/[0.03] relative overflow-hidden"
              style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}>
              {/* status rail */}
              <span className="absolute left-0 top-0 bottom-0 rounded-l-lg" style={{ width: 3, background: STATUS_RAIL[s.status] ?? "var(--bp-ink-muted)" }} />

              <div className="flex-1 min-w-0 pl-4 pr-3 py-2.5">
                {/* line 1 */}
                <div className="flex items-center gap-3">
                  <span className="truncate" style={{ ...display(14) }}>{s.name}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5" style={{ ...mono, background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>{s.type}</span>
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
        {filtered.length === 0 && (
          <p className="text-center py-16" style={{ ...body(14), color: "var(--bp-ink-muted)" }}>No specs match your filters.</p>
        )}
      </div>

      {/* Detail SlideOver */}
      <SlideOver open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? ""}
        subtitle={selected ? `${selected.domain} / ${selected.object_type}` : ""}
        tabs={DETAIL_TABS} activeTab={tab} onTabChange={setTab}
        headerRight={selected ? <ProvenanceThread phase={selected.phase} size="md" /> : undefined}>
        {selected && (
          <>
            {tab === "overview" && <OverviewTab spec={selected} />}
            {tab === "sql" && <SqlTab sql={selected.sql} />}
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
        .needs-reval-spin { display: inline-block; animation: reval-spin 2s linear infinite; }
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
  const badge = VALIDATION_BADGE[spec.validation_status];
  return (
    <div className="space-y-5">
      <Field label="Target" value={spec.target_name} />
      <Field label="Object Type" value={spec.object_type} />
      <Field label="Description" value={spec.description} />
      <Field label="Grain" value={spec.grain} />
      <Field label="Primary Keys" value={spec.primary_keys.join(", ")} mono />
      <div>
        <Label>Source Lineage</Label>
        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          {spec.lineage_chain.map((step, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span className="rounded px-2 py-0.5" style={{ ...body(12), background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}>{step}</span>
              {i < spec.lineage_chain.length - 1 && <span style={{ color: "var(--bp-ink-muted)" }}>&rarr;</span>}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Label>Refresh</Label>
        <span className="rounded px-2 py-0.5" style={{ ...mono, background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>{spec.refresh_strategy}</span>
      </div>
      <div className="flex items-center gap-3">
        <Label>Validation</Label>
        <span className="rounded px-1.5 py-0.5 inline-flex items-center gap-1" style={{ ...body(12), background: badge.bg, color: badge.color }}>
          {badge.icon} {badge.label}
        </span>
        {spec.last_validated && <span style={{ ...body(12), color: "var(--bp-ink-muted)" }}>Last run {spec.last_validated}</span>}
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
            <td className="py-2 pr-3" style={{ ...mono, textDecoration: c.included ? "none" : "line-through" }} title={c.exclude_reason}>{c.name}</td>
            <td className="py-2 pr-3" style={mono}>{c.target_name}</td>
            <td className="py-2 pr-3" style={mono}>{c.data_type}</td>
            <td className="py-2 pr-3">{c.key_type && <span className="rounded px-1 py-0.5" style={{ ...mono, background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>{c.key_type}</span>}</td>
            <td className="py-2 pr-3" style={{ ...mono, color: "var(--bp-ink-secondary)" }}>{c.source_expression}</td>
            <td className="py-2">{c.included
              ? <span className="rounded px-1.5 py-0.5" style={{ fontSize: 10, background: "rgba(61,124,79,0.10)", color: "var(--bp-operational-green)" }}>Included</span>
              : <span className="rounded px-1.5 py-0.5" style={{ fontSize: 10, background: "rgba(185,58,42,0.08)", color: "var(--bp-fault-red)" }} title={c.exclude_reason}>Excluded</span>}
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
            <span className="rounded px-1.5 py-0.5" style={{ ...mono, background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>{t.type}</span>
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
  return <div className="space-y-5"><Section title="Downstream Reports" items={data.downstream_reports} /><Section title="Affected Semantic Models" items={data.semantic_models} /><Section title="Affected Gold Specs" items={data.affected_specs} /></div>;
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
              <span style={{ ...body(12), color: "var(--bp-ink-secondary)", flex: 1 }}>{v.description}</span>
              <span style={{ ...mono, color: "var(--bp-ink-muted)" }}>{v.created}</span>
              <span style={{ ...body(11), color: "var(--bp-ink-muted)" }}>{v.author}</span>
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
                <span style={{ ...mono, color: "var(--bp-ink-muted)" }}>{r.date}</span>
                <span style={{ ...body(12), color: "var(--bp-ink-secondary)" }}>Critical: {r.critical_fraction}</span>
                <span style={{ ...body(12), color: "var(--bp-ink-muted)" }}>{r.warnings} warning{r.warnings !== 1 ? "s" : ""}</span>
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
