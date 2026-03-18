// Gold Canonical Modeling — Domain Grid + Relationship Map for canonical entity management.

import { useState, useEffect, useMemo, useCallback } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GoldStudioLayout } from "@/components/gold/GoldStudioLayout";
import { StatsStrip } from "@/components/gold/StatsStrip";
import { SlideOver } from "@/components/gold/SlideOver";
import { ProvenanceThread } from "@/components/gold/ProvenanceThread";

/* ---------- Types ---------- */

interface CanonicalEntity {
  id: string;
  name: string;
  domain: string;
  type: "Fact" | "Dimension" | "Bridge" | "Reference";
  grain: string;
  columns: number;
  status: "approved" | "draft" | "pending_steward" | "deprecated";
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  description?: string;
  steward?: string;
  version?: number;
}

interface CanonicalDetail extends CanonicalEntity { columns_detail: ColumnDef[]; lineage: LineageStep[]; relationships: Relationship[] }
interface ColumnDef { name: string; business_name: string; data_type: string; nullable: boolean; key: "PK" | "BK" | "FK" | "None"; classification: "PII" | "Confidential" | "Internal" | "Public"; description: string }
interface LineageStep { label: string; type: string; id?: string }
interface Relationship { related_entity: string; fk_column: string; cardinality: string; direction: string }
interface Measure { name: string; expression: string; type: string; description: string }
interface Stats { canonical_entities: number; dimensions: number; facts: number; bridges: number; approved: number; draft: number; pending_steward: number }

const API = "/api/gold-studio";

/* ---------- Style helpers ---------- */

const TYPE_BG: Record<CanonicalEntity["type"], string> = {
  Fact: "rgba(180,86,36,0.1)",
  Dimension: "rgba(168,162,158,0.15)",
  Bridge: "rgba(91,127,163,0.1)",
  Reference: "rgba(168,162,158,0.12)",
};

const STATUS_CFG: Record<CanonicalEntity["status"], { icon: string; label: string; bg: string; color: string; strike?: boolean }> = {
  approved:        { icon: "\u2713", label: "Approved",        bg: "rgba(61,124,79,0.12)", color: "#3D7C4F" },
  draft:           { icon: "\u25CC", label: "Draft",           bg: "rgba(180,86,36,0.1)",  color: "#B45624" },
  pending_steward: { icon: "\u26A0", label: "Pending Steward", bg: "rgba(194,122,26,0.12)", color: "#C27A1A" },
  deprecated:      { icon: "\u2717", label: "Deprecated",      bg: "rgba(168,162,158,0.15)", color: "#A8A29E", strike: true },
};

const KEY_COLOR: Record<string, string> = { PK: "#B45624", BK: "#C2952B", FK: "#5B7FA3", None: "var(--bp-ink-muted)" };
const CLS_COLOR: Record<string, string> = { PII: "#B45624", Confidential: "#C27A1A", Internal: "#3D7C4F", Public: "var(--bp-ink-muted)" };

const font = (family: string, size: number, color: string, extra: React.CSSProperties = {}): React.CSSProperties => ({
  fontFamily: `var(--bp-font-${family})`, fontSize: size, color, ...extra,
});

function Badge({ label, bg, color, strike }: { label: string; bg: string; color: string; strike?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
      style={{ background: bg, ...font("mono", 11, color, { textDecoration: strike ? "line-through" : undefined }) }}
    >
      {label}
    </span>
  );
}

/* ---------- Fetchers ---------- */

async function fetchJson<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url); if (!r.ok) return null; return r.json(); } catch { return null; }
}

/* ---------- DETAIL SLIDE-OVER ---------- */

const DETAIL_TABS = [
  { id: "definition", label: "Definition" },
  { id: "columns", label: "Columns" },
  { id: "lineage", label: "Lineage" },
  { id: "relationships", label: "Relationships" },
  { id: "measures", label: "Measures" },
];

function DetailSlideOver({ entityId, onClose }: { entityId: string | null; onClose: () => void }) {
  const [tab, setTab] = useState("definition");
  const [detail, setDetail] = useState<CanonicalDetail | null>(null);
  const [measures, setMeasures] = useState<Measure[]>([]);

  useEffect(() => {
    if (!entityId) return;
    setTab("definition");
    fetchJson<CanonicalDetail>(`${API}/canonical/${entityId}`).then(setDetail);
    fetchJson<Measure[]>(`${API}/semantic?canonical_root_id=${entityId}`).then((m) => setMeasures(m ?? []));
  }, [entityId]);

  if (!entityId || !detail) return null;
  const sc = STATUS_CFG[detail.status];

  const handleApprove = async () => {
    await fetch(`${API}/canonical/${detail.id}/approve`, { method: "POST" });
    const updated = await fetchJson<CanonicalDetail>(`${API}/canonical/${detail.id}`);
    if (updated) setDetail(updated);
  };

  const handleGenerateSpec = async () => {
    await fetch(`${API}/canonical/${detail.id}/generate-spec`, { method: "POST" });
  };

  return (
    <SlideOver
      open={!!entityId}
      onClose={onClose}
      title={detail.name}
      subtitle={`${detail.domain} / ${detail.type}`}
      tabs={DETAIL_TABS}
      activeTab={tab}
      onTabChange={setTab}
      headerRight={<Badge label={`${sc.icon} ${sc.label}`} bg={sc.bg} color={sc.color} strike={sc.strike} />}
      footer={
        <div className="flex gap-2">
          {detail.status === "draft" && (
            <button type="button" onClick={handleApprove} className="rounded-md px-4 py-2 text-sm font-medium text-white" style={{ background: "var(--bp-operational-green, #3D7C4F)" }}>
              Approve
            </button>
          )}
          {detail.status === "approved" && (
            <button type="button" onClick={handleGenerateSpec} className="rounded-md px-4 py-2 text-sm font-medium text-white" style={{ background: "var(--bp-copper)" }}>
              Generate Gold Spec
            </button>
          )}
        </div>
      }
    >
      {tab === "definition" && <DefinitionTab detail={detail} />}
      {tab === "columns" && <ColumnsTab columns={detail.columns_detail} />}
      {tab === "lineage" && <LineageTab steps={detail.lineage} />}
      {tab === "relationships" && <RelationshipsTab rows={detail.relationships} />}
      {tab === "measures" && <MeasuresTab rows={measures} />}
    </SlideOver>
  );
}

function DefinitionTab({ detail }: { detail: CanonicalDetail }) {
  const sc = STATUS_CFG[detail.status];
  return (
    <div className="space-y-4">
      {detail.description && <p style={font("body", 14, "var(--bp-ink-primary)", { lineHeight: 1.6 })}>{detail.description}</p>}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        {([
          ["Grain", detail.grain],
          ["Domain", detail.domain],
          ["Entity Type", detail.type],
          ["Steward", detail.steward ?? "Unassigned"],
          ["Version", String(detail.version ?? 1)],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k}>
            <dt style={font("body", 11, "var(--bp-ink-muted)", { textTransform: "uppercase", letterSpacing: "0.05em" })}>{k}</dt>
            <dd style={font("body", 14, "var(--bp-ink-primary)", { marginTop: 2 })}>{v}</dd>
          </div>
        ))}
        <div>
          <dt style={font("body", 11, "var(--bp-ink-muted)", { textTransform: "uppercase", letterSpacing: "0.05em" })}>Status</dt>
          <dd className="mt-1"><Badge label={`${sc.icon} ${sc.label}`} bg={sc.bg} color={sc.color} strike={sc.strike} /></dd>
        </div>
      </dl>
      <div className="pt-2">
        <span style={font("body", 11, "var(--bp-ink-muted)", { textTransform: "uppercase", letterSpacing: "0.05em" })}>Provenance</span>
        <div className="mt-2"><ProvenanceThread phase={detail.phase} size="md" /></div>
      </div>
    </div>
  );
}

function ColumnsTab({ columns }: { columns: ColumnDef[] }) {
  const TH = (h: string) => <th key={h} className="pb-2 pr-3 font-medium" style={font("body", 11, "var(--bp-ink-muted)", { textTransform: "uppercase", letterSpacing: "0.05em" })}>{h}</th>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" style={font("body", 13, "var(--bp-ink-primary)")}>
        <thead><tr style={{ borderBottom: "1px solid var(--bp-border)" }}>{["Column", "Business Name", "Type", "Null", "Key", "Classification", "Description"].map(TH)}</tr></thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name} style={{ borderBottom: "1px solid var(--bp-border)" }}>
              <td className="py-2 pr-3" style={font("mono", 12, "var(--bp-ink-primary)")}>{c.name}</td>
              <td className="py-2 pr-3">{c.business_name}</td>
              <td className="py-2 pr-3" style={font("mono", 11, "var(--bp-ink-secondary)")}>{c.data_type}</td>
              <td className="py-2 pr-3">{c.nullable ? "Yes" : "No"}</td>
              <td className="py-2 pr-3"><Badge label={c.key} bg={`${KEY_COLOR[c.key]}20`} color={KEY_COLOR[c.key]} /></td>
              <td className="py-2 pr-3"><Badge label={c.classification} bg={`${CLS_COLOR[c.classification]}18`} color={CLS_COLOR[c.classification]} /></td>
              <td className="py-2 pr-3 max-w-[200px] truncate" title={c.description}>{c.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineageTab({ steps }: { steps: LineageStep[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex items-center gap-3">
          <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 24, height: 24, background: "var(--bp-copper)", color: "#fff", fontSize: 12, fontWeight: 600 }}>{i + 1}</span>
          <div>
            <p style={font("body", 14, "var(--bp-ink-primary)", { fontWeight: 500 })}>{s.label}</p>
            <p style={font("mono", 11, "var(--bp-ink-muted)")}>{s.type}</p>
          </div>
          {i < steps.length - 1 && <span style={{ color: "var(--bp-ink-muted)", fontSize: 16, marginLeft: "auto" }}>&rarr;</span>}
        </li>
      ))}
    </ol>
  );
}

function RelationshipsTab({ rows }: { rows: Relationship[] }) {
  const TH = (h: string) => <th key={h} className="pb-2 pr-3 font-medium" style={font("body", 11, "var(--bp-ink-muted)", { textTransform: "uppercase", letterSpacing: "0.05em" })}>{h}</th>;
  return (
    <table className="w-full text-left" style={font("body", 13, "var(--bp-ink-primary)")}>
      <thead><tr style={{ borderBottom: "1px solid var(--bp-border)" }}>{["Related Entity", "FK Column", "Cardinality", "Direction"].map(TH)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: "1px solid var(--bp-border)" }}>
            <td className="py-2 pr-3" style={{ fontWeight: 500 }}>{r.related_entity}</td>
            <td className="py-2 pr-3" style={font("mono", 12, "var(--bp-ink-secondary)")}>{r.fk_column}</td>
            <td className="py-2 pr-3"><Badge label={r.cardinality} bg="rgba(91,127,163,0.1)" color="#5B7FA3" /></td>
            <td className="py-2 pr-3">{r.direction}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MeasuresTab({ rows }: { rows: Measure[] }) {
  if (!rows.length) return <p style={font("body", 13, "var(--bp-ink-muted)")}>No measures defined for this entity.</p>;
  return (
    <div className="space-y-4">
      {rows.map((m) => (
        <div key={m.name} className="rounded-lg p-4" style={{ border: "1px solid var(--bp-border)" }}>
          <div className="flex items-center justify-between mb-2">
            <span style={font("body", 14, "var(--bp-ink-primary)", { fontWeight: 600 })}>{m.name}</span>
            <Badge label={m.type} bg="rgba(180,86,36,0.1)" color="#B45624" />
          </div>
          {m.description && <p className="mb-2" style={font("body", 13, "var(--bp-ink-secondary)")}>{m.description}</p>}
          <pre className="rounded-md p-3 overflow-x-auto" style={{ background: "rgba(0,0,0,0.04)", ...font("mono", 12, "var(--bp-ink-primary)") }}>{m.expression}</pre>
        </div>
      ))}
    </div>
  );
}

/* ---------- DOMAIN GRID VIEW ---------- */

function DomainGrid({ entities, domains, onSelect }: { entities: CanonicalEntity[]; domains: string[]; onSelect: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => {
    const map: Record<string, CanonicalEntity[]> = {};
    for (const d of domains) map[d] = [];
    for (const e of entities) (map[e.domain] ??= []).push(e);
    return map;
  }, [entities, domains]);

  const toggle = (d: string) => setCollapsed((p) => ({ ...p, [d]: !p[d] }));

  return (
    <div className="space-y-1 px-6 pb-8">
      {Object.entries(grouped).map(([domain, items]) => (
        <div key={domain}>
          <button
            type="button"
            className="flex items-center gap-2 w-full py-3 group"
            onClick={() => toggle(domain)}
          >
            <span style={{ fontSize: 12, color: "var(--bp-ink-muted)", transition: "transform 150ms", transform: collapsed[domain] ? "rotate(-90deg)" : "rotate(0)" }}>{"\u25BC"}</span>
            <span style={font("display", 15, "var(--bp-ink-primary)", { letterSpacing: "-0.01em" })}>{domain}</span>
            <span className="rounded-full px-2 py-0.5" style={{ background: "var(--bp-border)", ...font("mono", 11, "var(--bp-ink-muted)") }}>{items.length}</span>
          </button>
          {!collapsed[domain] && (
            <div className="rounded-lg overflow-hidden mb-3" style={{ border: "1px solid var(--bp-border)" }}>
              <table className="w-full text-left">
                <thead>
                  <tr style={{ background: "var(--bp-surface-1)", borderBottom: "1px solid var(--bp-border)" }}>
                    {["Entity", "Type", "Grain", "Cols", "Status", "Provenance"].map((h) => (
                      <th key={h} className="px-4 py-2 font-medium" style={font("body", 11, "var(--bp-ink-muted)", { textTransform: "uppercase", letterSpacing: "0.05em" })}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => {
                    const sc = STATUS_CFG[e.status];
                    return (
                      <tr
                        key={e.id}
                        className="cursor-pointer transition-colors hover:bg-black/[0.02]"
                        style={{ borderBottom: "1px solid var(--bp-border)" }}
                        onClick={() => onSelect(e.id)}
                      >
                        <td className="px-4 py-2.5" style={font("body", 13, "var(--bp-ink-primary)", { fontWeight: 500, textDecoration: sc.strike ? "line-through" : undefined })}>{e.name}</td>
                        <td className="px-4 py-2.5"><Badge label={e.type} bg={TYPE_BG[e.type]} color="var(--bp-ink-secondary)" /></td>
                        <td className="px-4 py-2.5 max-w-[180px] truncate" title={e.grain} style={font("mono", 12, "var(--bp-ink-secondary)")}>{e.grain}</td>
                        <td className="px-4 py-2.5" style={font("mono", 12, "var(--bp-ink-secondary)")}>{e.columns}</td>
                        <td className="px-4 py-2.5"><Badge label={`${sc.icon} ${sc.label}`} bg={sc.bg} color={sc.color} strike={sc.strike} /></td>
                        <td className="px-4 py-2.5"><ProvenanceThread phase={e.phase} size="sm" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ---------- RELATIONSHIP MAP VIEW ---------- */

function RelationshipMap({ entities, onSelect }: { entities: CanonicalEntity[]; domainFilter: string; onSelect: (id: string) => void }) {
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    fetchJson<{ source: string; target: string; cardinality: string }[]>(`${API}/canonical/relationships`).then((rels) => {
      if (!rels) return;
      setEdges(rels.map((r, i) => ({ id: `e-${i}`, source: r.source, target: r.target, label: r.cardinality, type: "default", style: { stroke: "var(--bp-ink-muted)" }, labelStyle: { fontSize: 11, fill: "var(--bp-ink-secondary)" } })));
    });
  }, []);

  const nodes: Node[] = useMemo(() => {
    const facts = entities.filter((e) => e.type === "Fact");
    const dims = entities.filter((e) => e.type !== "Fact");
    const all: Node[] = [];
    // Facts in a central column
    facts.forEach((e, i) => {
      all.push({
        id: e.id,
        position: { x: 400, y: i * 120 },
        data: { label: e.name, entity: e },
        style: { width: 280, background: "#FEFDFB", border: "2px solid #B45624", borderRadius: 8, padding: 12, cursor: "pointer", fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-primary)", fontWeight: 500 },
      });
    });
    // Dims surrounding
    dims.forEach((e, i) => {
      const col = i % 2 === 0 ? 0 : 800;
      const row = Math.floor(i / 2);
      all.push({
        id: e.id,
        position: { x: col, y: row * 100 },
        data: { label: e.name, entity: e },
        style: { width: 200, background: "#FEFDFB", border: `1px solid ${TYPE_BG[e.type] === "rgba(168,162,158,0.15)" ? "#A8A29E" : "#5B7FA3"}`, borderRadius: 8, padding: 10, cursor: "pointer", fontFamily: "var(--bp-font-body)", fontSize: 12, color: "var(--bp-ink-primary)" },
      });
    });
    return all;
  }, [entities]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => onSelect(node.id), [onSelect]);

  return (
    <div className="mx-6 mb-8 rounded-lg overflow-hidden" style={{ height: "calc(100vh - 280px)", border: "1px solid var(--bp-border)" }}>
      <ReactFlow nodes={nodes} edges={edges} onNodeClick={onNodeClick} fitView proOptions={{ hideAttribution: true }}>
        <Background color="rgba(0,0,0,0.04)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

/* ---------- MAIN PAGE ---------- */

type View = "grid" | "map";

export default function GoldCanonical() {
  const [view, setView] = useState<View>("grid");
  const [stats, setStats] = useState<Stats | null>(null);
  const [entities, setEntities] = useState<CanonicalEntity[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Filters
  const [filterDomain, setFilterDomain] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => { fetchJson<Stats>(`${API}/stats`).then((s) => s && setStats(s)); fetchJson<string[]>(`${API}/canonical/domains`).then((d) => d && setDomains(d)); }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    if (filterDomain) p.set("domain", filterDomain);
    if (filterType) p.set("type", filterType);
    if (filterStatus) p.set("status", filterStatus);
    fetchJson<CanonicalEntity[]>(`${API}/canonical?${p}`).then((e) => e && setEntities(e));
  }, [filterDomain, filterType, filterStatus]);

  const filtered = useMemo(() => {
    if (!search) return entities;
    const q = search.toLowerCase();
    return entities.filter((e) => e.name.toLowerCase().includes(q) || e.domain.toLowerCase().includes(q) || e.grain.toLowerCase().includes(q));
  }, [entities, search]);

  const statsItems = stats
    ? [
        { label: "Canonical Entities", value: stats.canonical_entities },
        { label: "Dimensions", value: stats.dimensions },
        { label: "Facts", value: stats.facts, highlight: true },
        { label: "Bridges", value: stats.bridges },
        { label: "Approved", value: stats.approved },
        { label: "Draft", value: stats.draft },
        { label: "Pending Steward", value: stats.pending_steward, highlight: true },
      ]
    : [];

  return (
    <GoldStudioLayout activeTab="canonical">
      {stats && <StatsStrip items={statsItems} />}

      {/* Toolbar: view toggle + filters */}
      <div className="flex items-center justify-between px-6 py-4 gap-4 flex-wrap">
        {/* View toggle */}
        <div className="inline-flex rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)" }}>
          {(["grid", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className="px-4 py-1.5 transition-colors"
              style={{
                background: view === v ? "var(--bp-copper)" : "var(--bp-surface-1)",
                color: view === v ? "#fff" : "var(--bp-ink-secondary)",
                ...font("body", 12, view === v ? "#fff" : "var(--bp-ink-secondary)", { fontWeight: 500 }),
              }}
            >
              {v === "grid" ? "Domain Grid" : "Relationship Map"}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={filterDomain}
            onChange={(e) => setFilterDomain(e.target.value)}
            className="rounded-md px-3 py-1.5"
            style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)", ...font("body", 12, "var(--bp-ink-primary)") }}
          >
            <option value="">All Domains</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="rounded-md px-3 py-1.5"
            style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)", ...font("body", 12, "var(--bp-ink-primary)") }}
          >
            <option value="">All Types</option>
            {["Fact", "Dimension", "Bridge", "Reference"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-md px-3 py-1.5"
            style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)", ...font("body", 12, "var(--bp-ink-primary)") }}
          >
            <option value="">All Statuses</option>
            <option value="approved">Approved</option>
            <option value="draft">Draft</option>
            <option value="pending_steward">Pending Steward</option>
            <option value="deprecated">Deprecated</option>
          </select>

          <input
            type="text"
            placeholder="Search entities..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md px-3 py-1.5 w-52"
            style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)", ...font("body", 12, "var(--bp-ink-primary)") }}
          />
        </div>
      </div>

      {/* Content */}
      {view === "grid" ? (
        <DomainGrid entities={filtered} domains={domains} onSelect={setSelectedId} />
      ) : (
        <RelationshipMap entities={filtered} domainFilter={filterDomain} onSelect={setSelectedId} />
      )}

      {/* Detail slide-over */}
      <DetailSlideOver entityId={selectedId} onClose={() => setSelectedId(null)} />
    </GoldStudioLayout>
  );
}
