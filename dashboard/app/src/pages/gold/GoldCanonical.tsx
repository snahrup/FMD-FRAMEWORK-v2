// Gold Canonical Modeling — Domain Grid + Relationship Map for canonical entity management.

import { useState, useEffect, useMemo, useCallback } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GoldStudioLayout, useGoldToast, useDomainContext } from "@/components/gold/GoldStudioLayout";

import { SlideOver } from "@/components/gold/SlideOver";
import { ProvenanceThread } from "@/components/gold/ProvenanceThread";
import { GoldLoading, GoldEmpty, GoldNoResults } from "@/components/gold/GoldStates";

/* ---------- Types ---------- */

interface CanonicalEntity {
  id: number;
  root_id: number;
  name: string;
  domain: string;
  entity_type: string;
  type: "Fact" | "Dimension" | "Bridge" | "Reference" | "Aggregate";
  grain: string;
  column_count?: number;
  columns: number;
  status: "approved" | "draft" | "pending_steward" | "deprecated";
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  description?: string;
  business_description?: string;
  steward?: string;
  version?: number;
  source_systems?: string;
  source_cluster_ids?: string;
  business_keys?: string;
}

interface CanonicalDetail extends CanonicalEntity { columns: ColumnDef[] | number; lineage: LineageNode[]; relationships: Relationship[] }
interface ColumnDef { name: string; business_name: string; data_type: string; nullable: boolean; key: "PK" | "BK" | "FK" | "None"; classification: "PII" | "Confidential" | "Internal" | "Public"; description: string }
interface LineageNode { id?: number; entity_name?: string; specimen_name?: string; label?: string; type?: string }
interface Relationship { related_entity: string; fk_column: string; cardinality: string; direction: string }
interface Measure { name: string; expression: string; type: string; description: string }
interface AuditEntry { action: string; created_at: string; notes?: string; object_type?: string; object_id?: number; new_value?: string }
interface Stats {
  canonical_total: number;
  canonical_approved: number;
  specimens: number;
  tables_extracted: number;
  columns_cataloged: number;
  clusters_total: number;
  unresolved_clusters: number;
  clusters_resolved: number;
  gold_specs: number;
  specs_validated: number;
  catalog_published: number;
  catalog_certified: number;
  certification_rate: number;
}

const API = "/api/gold-studio";

/* ---------- Style helpers ---------- */

const TYPE_BG: Record<string, string> = {
  Fact: "var(--bp-copper-soft)",
  Dimension: "var(--bp-dismissed-light)",
  Bridge: "var(--bp-lz-light)",
  Reference: "var(--bp-dismissed-light)",
  Aggregate: "var(--bp-copper-soft)",
};

const STATUS_CFG: Record<CanonicalEntity["status"], { icon: string; label: string; bg: string; color: string; strike?: boolean }> = {
  approved:        { icon: "\u2713", label: "Approved",        bg: "var(--bp-operational-light)", color: "var(--bp-operational-green)" },
  draft:           { icon: "\u25CC", label: "Draft",           bg: "var(--bp-copper-soft)",  color: "var(--bp-copper)" },
  pending_steward: { icon: "\u26A0", label: "Pending Steward", bg: "var(--bp-caution-light)", color: "var(--bp-caution-amber)" },
  deprecated:      { icon: "\u2717", label: "Deprecated",      bg: "var(--bp-dismissed-light)", color: "var(--bp-dismissed)", strike: true },
};

const KEY_CFG: Record<string, { color: string; bg: string }> = {
  PK: { color: "var(--bp-copper)", bg: "var(--bp-copper-soft)" },
  BK: { color: "var(--bp-warm-gold)", bg: "var(--bp-caution-light)" },
  FK: { color: "var(--bp-lz)", bg: "var(--bp-lz-light)" },
  None: { color: "var(--bp-ink-muted)", bg: "var(--bp-dismissed-light)" },
};
const CLS_CFG: Record<string, { color: string; bg: string }> = {
  PII: { color: "var(--bp-copper)", bg: "var(--bp-copper-soft)" },
  Confidential: { color: "var(--bp-caution-amber)", bg: "var(--bp-caution-light)" },
  Internal: { color: "var(--bp-operational-green)", bg: "var(--bp-operational-light)" },
  Public: { color: "var(--bp-ink-muted)", bg: "var(--bp-dismissed-light)" },
};

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
  { id: "cluster_history", label: "Cluster History" },
  { id: "phase_history", label: "Phase History" },
];

function DetailSlideOver({ entityId, onClose }: { entityId: number | null; onClose: () => void }) {
  const { showToast } = useGoldToast();
  const [tab, setTab] = useState("definition");
  const [detail, setDetail] = useState<CanonicalDetail | null>(null);
  const [measures, setMeasures] = useState<Measure[]>([]);
  const [canonicalAudit, setCanonicalAudit] = useState<AuditEntry[]>([]);
  const [clusterAudit, setClusterAudit] = useState<AuditEntry[]>([]);

  useEffect(() => {
    if (!entityId) return;
    const ctrl = new AbortController();
    setTab("definition");
    setDetail(null);
    setClusterAudit([]);
    fetch(`${API}/canonical/${entityId}`, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() as Promise<CanonicalDetail> : null)
      .then((d) => {
        if (!d || ctrl.signal.aborted) return;
        setDetail(d);
        // Fetch cluster audit for upstream clusters found in lineage
        const lineageEntities = Array.isArray(d.lineage) ? d.lineage : [];
        const clusterIds = [...new Set(
          lineageEntities.map((e: Record<string, unknown>) => e.cluster_id).filter(Boolean)
        )];
        // Fetch audit for each upstream cluster
        Promise.all(
          clusterIds.map((cid) =>
            fetchJson<{ items: AuditEntry[] }>(`${API}/audit/log?object_type=cluster&object_id=${cid}&limit=20`)
              .then((r) => r?.items ?? [])
          )
        ).then((results) => {
          const merged = results.flat().sort((a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
          setClusterAudit(merged);
        });
      })
      .catch((err) => { if (!ctrl.signal.aborted) showToast(`Failed to load entity: ${err instanceof Error ? err.message : "unknown error"}`, "error"); });
    // Semantic endpoint returns {items}
    fetchJson<{ items: Measure[] }>(`${API}/semantic?canonical_root_id=${entityId}`).then((r) =>
      setMeasures(r?.items ?? [])
    );
    // Canonical entity's own audit (phase history)
    fetchJson<{ items: AuditEntry[] }>(
      `${API}/audit/log?object_type=canonical&object_id=${entityId}&limit=50`
    ).then((r) => setCanonicalAudit(r?.items ?? []));
    return () => ctrl.abort();
  }, [entityId]);

  if (!entityId || !detail) return null;
  // Normalize entity_type → type for display if backend sends entity_type
  const normalizedType = (detail.type ?? detail.entity_type ?? "Reference") as CanonicalEntity["type"];
  const detailColumns: ColumnDef[] = Array.isArray(detail.columns) ? detail.columns as unknown as ColumnDef[] : [];
  const detailLineage: LineageNode[] = Array.isArray(detail.lineage) ? detail.lineage : [];
  const sc = STATUS_CFG[detail.status] ?? STATUS_CFG.draft;

  const handleApprove = async () => {
    try {
      const res = await fetch(`${API}/canonical/${detail.id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await fetchJson<CanonicalDetail>(`${API}/canonical/${detail.id}`);
      if (updated) setDetail(updated);
      showToast("Entity approved", "success");
    } catch (err) {
      showToast(`Approve failed: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    }
  };

  const handleGenerateSpec = async () => {
    try {
      const res = await fetch(`${API}/canonical/${detail.id}/generate-spec`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await fetchJson<CanonicalDetail>(`${API}/canonical/${detail.id}`);
      if (updated) setDetail(updated);
      showToast("Gold spec generated", "success");
    } catch (err) {
      showToast(`Generate spec failed: ${err instanceof Error ? err.message : "unknown error"}`, "error");
    }
  };

  return (
    <SlideOver
      open={!!entityId}
      onClose={onClose}
      title={detail.name}
      subtitle={`${detail.domain} / ${normalizedType}`}
      tabs={DETAIL_TABS}
      activeTab={tab}
      onTabChange={setTab}
      headerRight={<Badge label={`${sc.icon} ${sc.label}`} bg={sc.bg} color={sc.color} strike={sc.strike} />}
      footer={
        <div className="flex gap-2">
          {detail.status === "draft" && (
            <button type="button" onClick={handleApprove} className="rounded-md px-4 py-1.5 text-sm font-medium" style={{ background: "var(--bp-operational-green)", color: "var(--bp-surface-1)" }}>
              Approve
            </button>
          )}
          {detail.status === "approved" && (
            <button type="button" onClick={handleGenerateSpec} className="rounded-md px-4 py-1.5 text-sm font-medium" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)" }}>
              Generate Gold Spec
            </button>
          )}
        </div>
      }
    >
      {tab === "definition" && <DefinitionTab detail={detail} />}
      {tab === "columns" && <ColumnsTab columns={detailColumns} />}
      {tab === "lineage" && <LineageTab nodes={detailLineage} />}
      {tab === "relationships" && <RelationshipsTab rows={detail.relationships ?? []} />}
      {tab === "measures" && <MeasuresTab rows={measures} />}
      {tab === "cluster_history" && <ClusterHistoryTab entries={clusterAudit} lineage={detailLineage} />}
      {tab === "phase_history" && <AuditHistoryTab entries={canonicalAudit} label="Phase" />}
    </SlideOver>
  );
}

function DefinitionTab({ detail }: { detail: CanonicalDetail }) {
  const sc = STATUS_CFG[detail.status] ?? STATUS_CFG.draft;
  const desc = detail.business_description ?? detail.description;
  const entityType = detail.type ?? detail.entity_type ?? "Reference";
  return (
    <div className="space-y-4">
      {desc && <p style={font("body", 14, "var(--bp-ink-primary)", { lineHeight: 1.6 })}>{desc}</p>}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        {([
          ["Grain", detail.grain],
          ["Domain", detail.domain],
          ["Entity Type", entityType],
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
  const TH = (h: string) => <th key={h} scope="col" className="pb-2 pr-3 font-medium" style={font("body", 11, "var(--bp-ink-muted)", { textTransform: "uppercase", letterSpacing: "0.05em" })}>{h}</th>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" style={font("body", 13, "var(--bp-ink-primary)")}>
        <thead><tr style={{ borderBottom: "1px solid var(--bp-border)" }}>{["Column", "Business Name", "Type", "Null", "Key", "Classification", "Description"].map(TH)}</tr></thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name} style={{ borderBottom: "1px solid var(--bp-border)" }}>
              <td className="py-1.5 pr-3" style={font("mono", 12, "var(--bp-ink-primary)")}>{c.name}</td>
              <td className="py-1.5 pr-3">{c.business_name}</td>
              <td className="py-1.5 pr-3" style={font("mono", 11, "var(--bp-ink-secondary)")}>{c.data_type}</td>
              <td className="py-1.5 pr-3">{c.nullable ? "Yes" : "No"}</td>
              <td className="py-1.5 pr-3"><Badge label={c.key} bg={(KEY_CFG[c.key] ?? KEY_CFG.None).bg} color={(KEY_CFG[c.key] ?? KEY_CFG.None).color} /></td>
              <td className="py-1.5 pr-3"><Badge label={c.classification} bg={(CLS_CFG[c.classification] ?? CLS_CFG.Public).bg} color={(CLS_CFG[c.classification] ?? CLS_CFG.Public).color} /></td>
              <td className="py-1.5 pr-3 max-w-[200px] truncate" title={c.description}>{c.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LineageTab({ nodes }: { nodes: LineageNode[] }) {
  if (!nodes.length) return <p style={font("body", 13, "var(--bp-ink-muted)")}>No lineage data available.</p>;
  return (
    <div className="space-y-3">
      <p style={font("body", 12, "var(--bp-ink-muted)", { marginBottom: 8 })}>
        Extracted entities that feed this canonical entity:
      </p>
      {nodes.map((n, i) => (
        <div
          key={n.id ?? i}
          className="flex items-center gap-3 rounded-lg p-2.5"
          style={{ border: "1px solid var(--bp-border)" }}
        >
          <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 24, height: 24, background: "var(--bp-copper)", color: "var(--bp-surface-1)", fontSize: 12, fontWeight: 600 }}>{i + 1}</span>
          <div className="min-w-0">
            <p style={font("body", 14, "var(--bp-ink-primary)", { fontWeight: 500 })}>{n.entity_name ?? n.label ?? "Unknown"}</p>
            {n.specimen_name && <p style={font("mono", 11, "var(--bp-ink-muted)")}>from {n.specimen_name}</p>}
            {n.type && !n.specimen_name && <p style={font("mono", 11, "var(--bp-ink-muted)")}>{n.type}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditHistoryTab({ entries, label }: { entries: Array<{ action: string; created_at: string; notes?: string }>; label: string }) {
  if (!entries.length) return <p style={font("body", 13, "var(--bp-ink-muted)")}>No {label.toLowerCase()} history recorded.</p>;
  return (
    <div className="space-y-2">
      {entries.map((e, i) => (
        <div
          key={i}
          className="flex items-start gap-3 py-2"
          style={{ borderBottom: "1px solid var(--bp-border)" }}
        >
          <span style={font("mono", 11, "var(--bp-ink-muted)", { minWidth: 140, flexShrink: 0 })}>
            {new Date(e.created_at).toLocaleString()}
          </span>
          <div className="min-w-0">
            <span style={font("body", 13, "var(--bp-ink-primary)")}>{e.action}</span>
            {e.notes && <p style={font("body", 12, "var(--bp-ink-muted)", { marginTop: 2 })}>{e.notes}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

const CLUSTER_ACTION_LABELS: Record<string, string> = {
  "resolved:approve": "Cluster approved — members confirmed",
  "resolved:split": "Cluster split into sub-groups",
  "resolved:merge": "Cluster merged with another",
  "resolved:dismiss": "Cluster dismissed — members returned to unclustered",
  "resolved:remove_member": "Member removed from cluster",
  "resolved:mark_standalone": "Member marked standalone",
  "column_decisions_updated": "Column reconciliation decisions saved",
  "updated": "Cluster metadata updated",
};

function ClusterHistoryTab({ entries, lineage }: { entries: AuditEntry[]; lineage: LineageNode[] }) {
  const clusterIds = [...new Set(lineage.map((e: Record<string, unknown>) => e.cluster_id).filter(Boolean))];
  if (!clusterIds.length && !entries.length) {
    return <p style={font("body", 13, "var(--bp-ink-muted)")}>No upstream clusters linked to this canonical entity.</p>;
  }
  if (!entries.length) {
    return (
      <div>
        <p style={font("body", 13, "var(--bp-ink-muted)")}>
          Derived from {clusterIds.length} upstream cluster{clusterIds.length !== 1 ? "s" : ""} (IDs: {clusterIds.join(", ")}). No audit events recorded yet.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <p className="pb-2" style={font("body", 12, "var(--bp-ink-muted)", { borderBottom: "1px solid var(--bp-border)" })}>
        Events from {clusterIds.length} upstream cluster{clusterIds.length !== 1 ? "s" : ""}:
      </p>
      {entries.map((e, i) => {
        const label = CLUSTER_ACTION_LABELS[e.action] ?? e.action;
        return (
          <div
            key={i}
            className="flex items-start gap-3 py-2"
            style={{ borderBottom: "1px solid var(--bp-border)" }}
          >
            <span style={font("mono", 11, "var(--bp-ink-muted)", { minWidth: 140, flexShrink: 0 })}>
              {new Date(e.created_at).toLocaleString()}
            </span>
            <div className="min-w-0">
              <span style={font("body", 13, "var(--bp-ink-primary)")}>{label}</span>
              {e.object_id && (
                <span style={font("mono", 11, "var(--bp-ink-muted)", { marginLeft: 8 })}>
                  Cluster #{e.object_id}
                </span>
              )}
              {e.notes && <p style={font("body", 12, "var(--bp-ink-muted)", { marginTop: 2 })}>{e.notes}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RelationshipsTab({ rows }: { rows: Relationship[] }) {
  const TH = (h: string) => <th key={h} scope="col" className="pb-2 pr-3 font-medium" style={font("body", 11, "var(--bp-ink-muted)", { textTransform: "uppercase", letterSpacing: "0.05em" })}>{h}</th>;
  return (
    <table className="w-full text-left" style={font("body", 13, "var(--bp-ink-primary)")}>
      <thead><tr style={{ borderBottom: "1px solid var(--bp-border)" }}>{["Related Entity", "FK Column", "Cardinality", "Direction"].map(TH)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} style={{ borderBottom: "1px solid var(--bp-border)" }}>
            <td className="py-2 pr-3" style={{ fontWeight: 500 }}>{r.related_entity}</td>
            <td className="py-2 pr-3" style={font("mono", 12, "var(--bp-ink-secondary)")}>{r.fk_column}</td>
            <td className="py-2 pr-3"><Badge label={r.cardinality} bg="var(--bp-lz-light)" color="var(--bp-lz)" /></td>
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
        <div key={m.name} className="rounded-lg p-3.5" style={{ border: "1px solid var(--bp-border)" }}>
          <div className="flex items-center justify-between mb-2">
            <span style={font("body", 14, "var(--bp-ink-primary)", { fontWeight: 600 })}>{m.name}</span>
            <Badge label={m.type} bg="var(--bp-copper-soft)" color="var(--bp-copper)" />
          </div>
          {m.description && <p className="mb-2" style={font("body", 13, "var(--bp-ink-secondary)")}>{m.description}</p>}
          <pre className="rounded-md p-3 overflow-x-auto" style={{ background: "var(--bp-code-block, var(--bp-surface-inset))", ...font("mono", 12, "var(--bp-ink-primary)") }}>{m.expression}</pre>
        </div>
      ))}
    </div>
  );
}

/* ---------- DOMAIN GRID VIEW ---------- */

function DomainGrid({ entities, domains, onSelect }: { entities: CanonicalEntity[]; domains: string[]; onSelect: (id: number) => void }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => {
    const map: Record<string, CanonicalEntity[]> = {};
    for (const d of domains) map[d] = [];
    for (const e of entities) (map[e.domain] ??= []).push(e);
    return map;
  }, [entities, domains]);

  const toggle = (d: string) => setCollapsed((p) => ({ ...p, [d]: !p[d] }));

  return (
    <div className="space-y-1 pb-6">
      {Object.entries(grouped).map(([domain, items]) => (
        <div key={domain}>
          <button
            type="button"
            className="flex items-center gap-2 w-full py-3 group"
            onClick={() => toggle(domain)}
            aria-expanded={!collapsed[domain]}
          >
            <span style={{ fontSize: 12, color: "var(--bp-ink-muted)", transition: "transform 150ms ease-out", transform: collapsed[domain] ? "rotate(-90deg)" : "rotate(0)" }}>{"\u25BC"}</span>
            <span style={font("display", 15, "var(--bp-ink-primary)", { letterSpacing: "-0.01em" })}>{domain}</span>
            <span className="rounded-full px-2 py-0.5" style={{ background: "var(--bp-border)", ...font("mono", 11, "var(--bp-ink-muted)") }}>{items.length}</span>
          </button>
          {!collapsed[domain] && (
            <div className="rounded-lg overflow-hidden mb-3" style={{ border: "1px solid var(--bp-border)" }}>
              <table className="w-full text-left">
                <thead>
                  <tr style={{ background: "var(--bp-surface-1)", borderBottom: "1px solid var(--bp-border)" }}>
                    {["Entity", "Type", "Grain", "Cols", "Status", "Provenance"].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2 font-medium" style={font("body", 11, "var(--bp-ink-muted)", { textTransform: "uppercase", letterSpacing: "0.05em" })}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((e, i) => {
                    const sc = STATUS_CFG[e.status];
                    return (
                      <tr
                        key={e.id}
                        className="gs-stagger-row cursor-pointer transition-colors hover:bg-black/[0.02] bp-row-interactive"
                        style={{ borderBottom: "1px solid var(--bp-border)", background: i % 2 === 1 ? "var(--bp-surface-inset)" : undefined, "--i": Math.min(i, 15) } as React.CSSProperties}
                        onClick={() => onSelect(e.id)}
                      >
                        <td className="px-4 py-2" style={font("body", 13, "var(--bp-ink-primary)", { fontWeight: 500, textDecoration: sc.strike ? "line-through" : undefined })}>{e.name}</td>
                        <td className="px-4 py-2"><Badge label={e.type} bg={TYPE_BG[e.type]} color="var(--bp-ink-secondary)" /></td>
                        <td className="px-4 py-2 max-w-[180px] truncate" title={e.grain} style={font("mono", 12, "var(--bp-ink-secondary)")}>{e.grain}</td>
                        <td className="px-4 py-2" style={font("mono", 12, "var(--bp-ink-secondary)")}>{e.columns}</td>
                        <td className="px-4 py-2"><Badge label={`${sc.icon} ${sc.label}`} bg={sc.bg} color={sc.color} strike={sc.strike} /></td>
                        <td className="px-4 py-2"><ProvenanceThread phase={e.phase} size="sm" /></td>
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

function RelationshipMap({ entities, onSelect }: { entities: CanonicalEntity[]; onSelect: (id: number) => void }) {
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    // Relationships endpoint returns {items: [{from_root_id, to_root_id, from_entity, to_entity, column_name, ...}]}
    fetchJson<{ items: Array<{ from_root_id: number; to_root_id: number; from_entity: string; to_entity: string; column_name: string }> }>(
      `${API}/canonical/relationships`
    ).then((r) => {
      if (!r?.items) return;
      setEdges(r.items.map((rel, i) => ({
        id: `e-${i}`,
        source: String(rel.from_root_id),
        target: String(rel.to_root_id),
        label: rel.column_name,
        type: "default",
        style: { stroke: "var(--bp-ink-muted)" },
        labelStyle: { fontSize: 11, fill: "var(--bp-ink-secondary)" },
      })));
    });
  }, []);

  const nodes: Node[] = useMemo(() => {
    const facts = entities.filter((e) => e.type === "Fact");
    const dims = entities.filter((e) => e.type !== "Fact");
    const all: Node[] = [];
    // Facts in a central column
    facts.forEach((e, i) => {
      all.push({
        id: String(e.root_id ?? e.id),
        position: { x: 400, y: i * 120 },
        data: { label: e.name, entity: e },
        style: { width: 280, background: "var(--bp-surface-1)", border: "2px solid var(--bp-copper)", borderRadius: 8, padding: 12, cursor: "pointer", fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-primary)", fontWeight: 500 },
      });
    });
    // Dims surrounding
    dims.forEach((e, i) => {
      const col = i % 2 === 0 ? 0 : 800;
      const row = Math.floor(i / 2);
      all.push({
        id: String(e.root_id ?? e.id),
        position: { x: col, y: row * 100 },
        data: { label: e.name, entity: e },
        style: { width: 200, background: "var(--bp-surface-1)", border: `1px solid ${e.type === "Dimension" || e.type === "Reference" ? "var(--bp-dismissed)" : "var(--bp-lz)"}`, borderRadius: 8, padding: 10, cursor: "pointer", fontFamily: "var(--bp-font-body)", fontSize: 12, color: "var(--bp-ink-primary)" },
      });
    });
    return all;
  }, [entities]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const entity = (node.data as { entity?: CanonicalEntity })?.entity;
    onSelect(entity?.id ?? parseInt(node.id, 10));
  }, [onSelect]);

  return (
    <div className="rounded-lg overflow-hidden mb-6" style={{ height: "calc(100vh - 280px)", border: "1px solid var(--bp-border)" }}>
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
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);
  const [entities, setEntities] = useState<CanonicalEntity[]>([]);
  const [domains, setDomains] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const { domainNames } = useDomainContext();

  // Filters
  const [filterDomain, setFilterDomain] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");

  const loadInitialData = useCallback(() => {
    setLoading(true);
    setFetchError(null);
    Promise.all([
      fetchJson<Stats>(`${API}/stats`).then((s) => s && setStats(s)),
      fetchJson<{ items: Array<{ domain: string; entity_count: number }> }>(`${API}/canonical/domains`)
        .then((r) => r?.items && setDomains(r.items.map((d) => d.domain))),
    ]).catch(() => setFetchError("Failed to load canonical data. Check your connection and try again."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadInitialData(); }, [loadInitialData]);

  useEffect(() => {
    const p = new URLSearchParams({ limit: "200" });
    if (filterDomain) p.set("domain", filterDomain);
    if (filterType) p.set("type", filterType);
    if (filterStatus) p.set("status", filterStatus);
    // List endpoint returns {items, total}
    fetchJson<{ items: CanonicalEntity[] }>(`${API}/canonical?${p}`).then((r) => {
      if (!r?.items) return;
      // Normalize: backend uses entity_type, columns may be column_count
      setEntities(r.items.map((e) => ({
        ...e,
        type: (e.type ?? e.entity_type ?? "Reference") as CanonicalEntity["type"],
        columns: e.columns ?? e.column_count ?? 0,
      })));
    });
  }, [filterDomain, filterType, filterStatus]);

  const filtered = useMemo(() => {
    if (!search) return entities;
    const q = search.toLowerCase();
    return entities.filter((e) => e.name.toLowerCase().includes(q) || e.domain.toLowerCase().includes(q) || e.grain.toLowerCase().includes(q));
  }, [entities, search]);

  // Prefer domainNames from context; fall back to locally fetched domains
  const domainOptions = domainNames.length > 0 ? domainNames : domains;

  if (loading) {
    return (
      <GoldStudioLayout activeTab="canonical">
        <GoldLoading rows={5} label="Loading canonical entities" />
      </GoldStudioLayout>
    );
  }

  return (
    <GoldStudioLayout activeTab="canonical">
      {stats && (
        <div style={{ borderBottom: "1px solid var(--bp-border)", padding: "12px 0 14px" }}>
          <div className="flex items-end gap-8 mb-2">
            {[
              { label: "Canonical Approved", value: stats.canonical_approved, color: "var(--bp-operational-green)", i: 0 },
              { label: "Total Entities", value: stats.canonical_total, color: "var(--bp-ink-primary)", i: 1 },
              { label: "Domains", value: domains.length, color: "var(--bp-copper)", i: 2 },
            ].map((m) => (
              <div key={m.label} className="gs-hero-enter" style={{ "--i": m.i } as React.CSSProperties}>
                <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--bp-ink-tertiary)" }}>{m.label}</span>
                <div style={{ fontFamily: "var(--bp-font-display)", fontSize: 36, letterSpacing: "-0.02em", lineHeight: 1, color: m.color }}>{m.value}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-5">
            {[
              { label: "Specimens", value: stats.specimens },
              { label: "Clusters", value: stats.clusters_total },
              { label: "Gold Specs", value: stats.gold_specs },
            ].map((m, i) => (
              <div key={m.label} className="gs-stagger-row flex items-center gap-1.5" style={{ "--i": i } as React.CSSProperties}>
                <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--bp-ink-tertiary)" }}>{m.label}</span>
                <span style={{ fontFamily: "var(--bp-font-display)", fontSize: 18, color: "var(--bp-ink-primary)" }}>{m.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {fetchError && (
        <div role="alert" className="flex items-center justify-between rounded-lg px-4 py-3 mb-3" style={{ background: "var(--bp-copper-soft)", border: "1px solid var(--bp-copper)" }}>
          <span style={font("body", 13, "var(--bp-copper)")}>{fetchError}</span>
          <button type="button" onClick={loadInitialData} className="rounded-md px-3 py-1 text-sm font-medium" style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)" }}>Retry</button>
        </div>
      )}

      {/* Toolbar: view toggle + filters */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-3">
        {/* View toggle */}
        <div className="inline-flex rounded-lg overflow-hidden" role="group" aria-label="View mode" style={{ border: "1px solid var(--bp-border)" }}>
          {(["grid", "map"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className="px-4 py-1.5 transition-colors"
              style={{
                background: view === v ? "var(--bp-copper)" : "var(--bp-surface-1)",
                color: view === v ? "var(--bp-surface-1)" : "var(--bp-ink-secondary)",
                ...font("body", 12, view === v ? "var(--bp-surface-1)" : "var(--bp-ink-secondary)", { fontWeight: 500 }),
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
            aria-label="Filter by domain"
            className="rounded-md px-3 py-1.5"
            style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)", ...font("body", 12, "var(--bp-ink-primary)") }}
          >
            <option value="">All Domains</option>
            {domainOptions.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>

          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            aria-label="Filter by entity type"
            className="rounded-md px-3 py-1.5"
            style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)", ...font("body", 12, "var(--bp-ink-primary)") }}
          >
            <option value="">All Types</option>
            {["Fact", "Dimension", "Bridge", "Reference", "Aggregate"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            aria-label="Filter by status"
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
            aria-label="Search canonical entities"
            className="rounded-md px-3 py-1.5 w-52"
            style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)", ...font("body", 12, "var(--bp-ink-primary)") }}
          />
        </div>
      </div>

      {/* Content */}
      {!entities.length && !loading && (
        <GoldEmpty noun="canonical entities" />
      )}
      {entities.length > 0 && !filtered.length && (
        <GoldNoResults query={search || undefined} />
      )}
      {filtered.length > 0 && (
        <div style={{ animation: "gsFadeIn 200ms var(--ease-claude) both" }} key={view}>
          {view === "grid" ? <DomainGrid entities={filtered} domains={domains} onSelect={setSelectedId} /> : <RelationshipMap entities={filtered} onSelect={setSelectedId} />}
        </div>
      )}

      {/* Detail slide-over */}
      <DetailSlideOver entityId={selectedId} onClose={() => setSelectedId(null)} />
    </GoldStudioLayout>
  );
}
