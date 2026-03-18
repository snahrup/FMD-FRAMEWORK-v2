// Gold Clusters — Entity cluster browser: review, resolve, reconcile columns, promote to canonical.

import { useState, useEffect, useCallback } from "react";
import { Search } from "lucide-react";
import { GoldStudioLayout, StatsStrip, SlideOver } from "@/components/gold";
import { ClusterCard } from "@/components/gold/ClusterCard";
import { ColumnReconciliation } from "@/components/gold/ColumnReconciliation";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ClusterSummary {
  id: number;
  label: string | null;
  dominant_name: string | null;
  confidence: number;
  confidence_breakdown: string | null;
  status: string;
  resolution: string | null;
  division: string;
}

interface ClusterMember {
  id: number;
  entity_name: string;
  specimen_name: string;
  column_count: number;
  match_type: string;
}

interface ClusterDetail {
  cluster: ClusterSummary;
  members: ClusterMember[];
}

interface UnclusteredEntity {
  id: number;
  entity_name: string;
  specimen_name: string;
  source_db: string;
  column_count: number;
}

interface StatsPayload {
  total_clusters: number;
  unresolved: number;
  resolved: number;
  avg_confidence: number;
  not_clustered: number;
}

interface ReconciliationColumn {
  column_name: string;
  data_type: string | null;
  presence: Record<number, boolean>;
  decision: "include" | "exclude" | "review";
  key_designation: "pk" | "bk" | "fk" | "none" | null;
  source_expression?: Record<number, string>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_FILTERS = [
  { value: "", label: "All Statuses" },
  { value: "unresolved", label: "Unresolved" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
  { value: "pending_steward", label: "Pending Steward" },
] as const;

const API = "/api/gold-studio";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function GoldClusters() {
  /* State */
  const [stats, setStats] = useState<StatsPayload | null>(null);
  const [clusters, setClusters] = useState<ClusterDetail[]>([]);
  const [unclustered, setUnclustered] = useState<UnclusteredEntity[]>([]);
  const [loading, setLoading] = useState(true);

  /* Filters */
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [minConf, setMinConf] = useState(0);
  const [maxConf, setMaxConf] = useState(100);
  const [divisionFilter, setDivisionFilter] = useState("");

  /* Active tab */
  const [activeTab, setActiveTab] = useState<"clusters" | "unclustered">("clusters");

  /* SlideOver for reconciliation */
  const [reconOpen, setReconOpen] = useState(false);
  const [reconClusterId, setReconClusterId] = useState<number | null>(null);
  const [reconColumns, setReconColumns] = useState<ReconciliationColumn[]>([]);
  const [reconMembers, setReconMembers] = useState<Array<{ id: number; entity_name: string }>>([]);

  /* ---------------------------------------------------------------- */
  /*  Data fetching                                                    */
  /* ---------------------------------------------------------------- */

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API}/stats`);
      if (res.ok) setStats(await res.json());
    } catch {
      /* silent */
    }
  }, []);

  const fetchClusters = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`${API}/clusters?${params}`);
      if (res.ok) setClusters(await res.json());
    } catch {
      /* silent */
    }
  }, [statusFilter]);

  const fetchUnclustered = useCallback(async () => {
    try {
      const res = await fetch(`${API}/clusters/unclustered`);
      if (res.ok) setUnclustered(await res.json());
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchStats(), fetchClusters(), fetchUnclustered()]).finally(() =>
      setLoading(false)
    );
  }, [fetchStats, fetchClusters, fetchUnclustered]);

  // Re-fetch clusters when status filter changes
  useEffect(() => {
    fetchClusters();
  }, [fetchClusters]);

  /* ---------------------------------------------------------------- */
  /*  Filter logic                                                     */
  /* ---------------------------------------------------------------- */

  const divisions = Array.from(new Set(clusters.map((c) => c.cluster.division).filter(Boolean)));

  const filtered = clusters.filter((c) => {
    if (search) {
      const q = search.toLowerCase();
      const nameMatch =
        c.cluster.dominant_name?.toLowerCase().includes(q) ||
        c.cluster.label?.toLowerCase().includes(q) ||
        c.members.some(
          (m) =>
            m.entity_name.toLowerCase().includes(q) ||
            m.specimen_name.toLowerCase().includes(q)
        );
      if (!nameMatch) return false;
    }
    if (c.cluster.confidence < minConf || c.cluster.confidence > maxConf) return false;
    if (divisionFilter && c.cluster.division !== divisionFilter) return false;
    return true;
  });

  const filteredUnclustered = unclustered.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.entity_name.toLowerCase().includes(q) ||
      e.specimen_name.toLowerCase().includes(q) ||
      e.source_db.toLowerCase().includes(q)
    );
  });

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */

  const handleResolve = useCallback(
    async (clusterId: number, action: string) => {
      try {
        await fetch(`${API}/clusters/${clusterId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        await Promise.all([fetchStats(), fetchClusters()]);
      } catch {
        /* silent */
      }
    },
    [fetchStats, fetchClusters]
  );

  const openReconciliation = useCallback(
    async (clusterId: number) => {
      try {
        const res = await fetch(`${API}/clusters/${clusterId}`);
        if (!res.ok) return;
        const detail = await res.json();
        setReconClusterId(clusterId);
        setReconMembers(
          (detail.members as ClusterMember[]).map((m) => ({
            id: m.id,
            entity_name: m.entity_name,
          }))
        );
        setReconColumns(detail.columns ?? []);
        setReconOpen(true);
      } catch {
        /* silent */
      }
    },
    []
  );

  const handleSaveReconciliation = useCallback(
    async (
      decisions: Array<{ column_name: string; decision: string; key_designation: string | null }>
    ) => {
      if (reconClusterId === null) return;
      try {
        await fetch(`${API}/clusters/${reconClusterId}/columns`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions }),
        });
        setReconOpen(false);
        await Promise.all([fetchStats(), fetchClusters()]);
      } catch {
        /* silent */
      }
    },
    [reconClusterId, fetchStats, fetchClusters]
  );

  const handlePromote = useCallback(
    async (entityId: number) => {
      try {
        await fetch(`${API}/clusters/unclustered/${entityId}/promote`, { method: "POST" });
        await Promise.all([fetchStats(), fetchUnclustered()]);
      } catch {
        /* silent */
      }
    },
    [fetchStats, fetchUnclustered]
  );

  const handleIgnore = useCallback(
    async (entityId: number) => {
      try {
        await fetch(`${API}/clusters/unclustered/${entityId}/ignore`, { method: "POST" });
        await fetchUnclustered();
      } catch {
        /* silent */
      }
    },
    [fetchUnclustered]
  );

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <GoldStudioLayout activeTab="clusters">
      {/* Stats strip */}
      {stats && (
        <StatsStrip
          items={[
            { label: "Total Clusters", value: stats.total_clusters },
            { label: "Unresolved", value: stats.unresolved, highlight: true },
            { label: "Resolved", value: stats.resolved },
            { label: "Avg Confidence", value: `${stats.avg_confidence}%` },
            {
              label: "Not Clustered",
              value: stats.not_clustered,
              onClick: () => setActiveTab("unclustered"),
            },
          ]}
        />
      )}

      <div className="px-6 py-5">
        {/* Filter bar */}
        <div className="flex items-center gap-3 flex-wrap mb-5">
          {/* Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md px-2.5 py-1.5 text-sm outline-none"
            style={{
              fontFamily: "var(--bp-font-body)",
              color: "var(--bp-ink-primary)",
              background: "var(--bp-surface-inset)",
              border: "1px solid var(--bp-border)",
            }}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>

          {/* Division */}
          {divisions.length > 1 && (
            <select
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              className="rounded-md px-2.5 py-1.5 text-sm outline-none"
              style={{
                fontFamily: "var(--bp-font-body)",
                color: "var(--bp-ink-primary)",
                background: "var(--bp-surface-inset)",
                border: "1px solid var(--bp-border)",
              }}
            >
              <option value="">All Divisions</option>
              {divisions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}

          {/* Confidence range */}
          <div className="flex items-center gap-1">
            <span
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 12,
                color: "var(--bp-ink-muted)",
              }}
            >
              Conf:
            </span>
            <input
              type="number"
              min={0}
              max={100}
              value={minConf}
              onChange={(e) => setMinConf(Number(e.target.value))}
              className="rounded px-1.5 py-1 text-xs w-12 outline-none"
              style={{
                fontFamily: "var(--bp-font-mono)",
                color: "var(--bp-ink-primary)",
                background: "var(--bp-surface-inset)",
                border: "1px solid var(--bp-border)",
              }}
            />
            <span style={{ color: "var(--bp-ink-muted)", fontSize: 12 }}>&ndash;</span>
            <input
              type="number"
              min={0}
              max={100}
              value={maxConf}
              onChange={(e) => setMaxConf(Number(e.target.value))}
              className="rounded px-1.5 py-1 text-xs w-12 outline-none"
              style={{
                fontFamily: "var(--bp-font-mono)",
                color: "var(--bp-ink-primary)",
                background: "var(--bp-surface-inset)",
                border: "1px solid var(--bp-border)",
              }}
            />
            <span style={{ color: "var(--bp-ink-muted)", fontSize: 12 }}>%</span>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--bp-ink-muted)" }}
            />
            <input
              type="text"
              placeholder="Search clusters, entities, specimens..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md pl-8 pr-3 py-1.5 text-sm outline-none"
              style={{
                fontFamily: "var(--bp-font-body)",
                color: "var(--bp-ink-primary)",
                background: "var(--bp-surface-inset)",
                border: "1px solid var(--bp-border)",
              }}
            />
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 mb-4" style={{ borderBottom: "1px solid var(--bp-border)" }}>
          {(
            [
              { id: "clusters" as const, label: `Clusters (${filtered.length})` },
              { id: "unclustered" as const, label: `Unclustered (${filteredUnclustered.length})` },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="pb-2 px-3 text-center transition-colors relative"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontWeight: 500,
                fontSize: 13,
                color:
                  activeTab === tab.id ? "var(--bp-copper)" : "var(--bp-ink-muted)",
              }}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span
                  className="absolute bottom-0 left-0 right-0"
                  style={{
                    height: 2,
                    background: "var(--bp-copper)",
                    borderRadius: "1px 1px 0 0",
                  }}
                />
              )}
            </button>
          ))}
        </div>

        {/* Cluster list */}
        {activeTab === "clusters" && (
          <div className="space-y-3">
            {loading && !clusters.length && (
              <p
                className="text-center py-12"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 14,
                  color: "var(--bp-ink-muted)",
                }}
              >
                Loading clusters...
              </p>
            )}
            {!loading && filtered.length === 0 && (
              <p
                className="text-center py-12"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 14,
                  color: "var(--bp-ink-muted)",
                }}
              >
                No clusters match your filters.
              </p>
            )}
            {filtered.map((c) => (
              <ClusterCard
                key={c.cluster.id}
                cluster={c.cluster}
                members={c.members}
                onResolve={(action) => handleResolve(c.cluster.id, action)}
                onConfirmGrouping={() => openReconciliation(c.cluster.id)}
              />
            ))}
          </div>
        )}

        {/* Unclustered entities table */}
        {activeTab === "unclustered" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left" style={{ fontSize: 13 }}>
              <thead>
                <tr
                  style={{
                    fontFamily: "var(--bp-font-body)",
                    fontSize: 11,
                    color: "var(--bp-ink-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}
                >
                  <th className="pb-2 pr-4 font-medium">Entity</th>
                  <th className="pb-2 pr-4 font-medium">Specimen</th>
                  <th className="pb-2 pr-4 font-medium">Source DB</th>
                  <th className="pb-2 pr-4 font-medium text-right">Columns</th>
                  <th className="pb-2 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredUnclustered.map((e) => (
                  <tr
                    key={e.id}
                    style={{
                      fontFamily: "var(--bp-font-body)",
                      color: "var(--bp-ink-primary)",
                      borderTop: "1px solid var(--bp-border)",
                    }}
                  >
                    <td className="py-2.5 pr-4">{e.entity_name}</td>
                    <td
                      className="py-2.5 pr-4"
                      style={{ fontFamily: "var(--bp-font-mono)", fontSize: 12, color: "var(--bp-ink-secondary)" }}
                    >
                      {e.specimen_name}
                    </td>
                    <td className="py-2.5 pr-4" style={{ color: "var(--bp-ink-secondary)" }}>
                      {e.source_db}
                    </td>
                    <td className="py-2.5 pr-4 text-right" style={{ fontFamily: "var(--bp-font-mono)" }}>
                      {e.column_count}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handlePromote(e.id)}
                          className="rounded px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-90"
                          style={{
                            color: "#fff",
                            background: "var(--bp-copper)",
                          }}
                        >
                          Promote to Canonical
                        </button>
                        <button
                          type="button"
                          onClick={() => handleIgnore(e.id)}
                          className="rounded px-2.5 py-1 text-xs font-medium transition-colors hover:bg-black/5"
                          style={{
                            color: "var(--bp-ink-muted)",
                            border: "1px solid var(--bp-border)",
                          }}
                        >
                          Ignore
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && filteredUnclustered.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-12 text-center"
                      style={{
                        fontFamily: "var(--bp-font-body)",
                        fontSize: 14,
                        color: "var(--bp-ink-muted)",
                      }}
                    >
                      All entities are clustered.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Column Reconciliation slide-over */}
      <SlideOver
        open={reconOpen}
        onClose={() => setReconOpen(false)}
        title="Column Reconciliation"
        subtitle={
          reconClusterId !== null
            ? `Cluster #${reconClusterId} \u2014 ${reconMembers.length} members`
            : undefined
        }
        width="wide"
      >
        {reconClusterId !== null && reconColumns.length > 0 && (
          <ColumnReconciliation
            clusterId={reconClusterId}
            columns={reconColumns}
            members={reconMembers}
            onSave={handleSaveReconciliation}
          />
        )}
        {reconClusterId !== null && reconColumns.length === 0 && (
          <p
            className="text-center py-12"
            style={{
              fontFamily: "var(--bp-font-body)",
              fontSize: 14,
              color: "var(--bp-ink-muted)",
            }}
          >
            No column data available for this cluster.
          </p>
        )}
      </SlideOver>
    </GoldStudioLayout>
  );
}
