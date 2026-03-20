// Gold Clusters — Entity cluster browser: review, resolve, reconcile columns, promote to canonical.
// Spec: docs/superpowers/specs/2026-03-18-gold-studio-design.md § 6

import { useState, useEffect, useCallback, useRef } from "react";
import { Search } from "lucide-react";
import { GoldStudioLayout, StatsStrip, SlideOver, useGoldToast, GoldLoading, GoldEmpty, GoldNoResults } from "@/components/gold";
import { ClusterCard } from "@/components/gold/ClusterCard";
import type { ClusterData, ClusterMember } from "@/components/gold/ClusterCard";
import { ColumnReconciliation } from "@/components/gold/ColumnReconciliation";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ClusterDetail {
  cluster: ClusterData;
  members: ClusterMember[];
}

interface UnclusteredEntity {
  id: number;
  entity_name: string;
  specimen_name: string;
  specimen_source: string | null;
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
  { value: "re_review", label: "Re-review" },
] as const;

const API = "/api/gold-studio";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function GoldClusters() {
  const { showToast } = useGoldToast();

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

  /* Abort controller for cluster fetches */
  const clusterAbortRef = useRef<AbortController | null>(null);

  /* Dismiss notes modal */
  const [dismissTarget, setDismissTarget] = useState<number | null>(null);
  const [dismissNotes, setDismissNotes] = useState("");
  const dismissInputRef = useRef<HTMLTextAreaElement>(null);

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
    clusterAbortRef.current?.abort();
    const ctrl = new AbortController();
    clusterAbortRef.current = ctrl;
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`${API}/clusters?${params}`, { signal: ctrl.signal });
      if (!res.ok) return;
      const body = await res.json();
      // API returns { items, total, limit, offset } — items are cluster summaries
      const summaries: ClusterData[] = body.items ?? body;
      // Hydrate each cluster with its members via detail endpoint
      const details: ClusterDetail[] = await Promise.all(
        summaries.map(async (c) => {
          try {
            const dRes = await fetch(`${API}/clusters/${c.id}`);
            if (dRes.ok) {
              const detail = await dRes.json();
              return {
                cluster: { ...c, member_count: detail.members?.length ?? c.member_count },
                members: detail.members ?? [],
              };
            }
          } catch { /* fallback below */ }
          return { cluster: c, members: [] };
        })
      );
      if (ctrl.signal.aborted) return;
      setClusters(details);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      /* silent */
    }
  }, [statusFilter]);

  const fetchUnclustered = useCallback(async () => {
    try {
      const res = await fetch(`${API}/clusters/unclustered?limit=500`);
      if (!res.ok) return;
      const body = await res.json();
      setUnclustered(body.items ?? body);
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
      (e.specimen_source ?? "").toLowerCase().includes(q)
    );
  });

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                         */
  /* ---------------------------------------------------------------- */

  const handleResolve = useCallback(
    async (clusterId: number, action: string, payload?: Record<string, unknown>) => {
      try {
        const res = await fetch(`${API}/clusters/${clusterId}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...payload }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await Promise.all([fetchStats(), fetchClusters(), fetchUnclustered()]);
        showToast("Cluster resolved", "success");
      } catch {
        showToast("Failed to resolve cluster", "error");
      }
    },
    [fetchStats, fetchClusters, fetchUnclustered, showToast]
  );

  const handleLabelChange = useCallback(
    async (clusterId: number, label: string) => {
      try {
        const res = await fetch(`${API}/clusters/${clusterId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchClusters();
        showToast("Cluster updated", "success");
      } catch {
        showToast("Failed to update cluster", "error");
      }
    },
    [fetchClusters, showToast]
  );

  const handleDismissRequest = useCallback((clusterId: number) => {
    setDismissTarget(clusterId);
    setDismissNotes("");
    // Focus the textarea after render
    setTimeout(() => dismissInputRef.current?.focus(), 50);
  }, []);

  const handleDismissConfirm = useCallback(async () => {
    if (dismissTarget === null || !dismissNotes.trim()) return;
    await handleResolve(dismissTarget, "dismiss", { notes: dismissNotes.trim() });
    setDismissTarget(null);
    setDismissNotes("");
  }, [dismissTarget, dismissNotes, handleResolve]);

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
        setReconColumns(detail.column_decisions ?? detail.columns ?? []);
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
        const res = await fetch(`${API}/clusters/${reconClusterId}/columns`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setReconOpen(false);
        setReconColumns([]);
        setReconMembers([]);
        setReconClusterId(null);
        await Promise.all([fetchStats(), fetchClusters()]);
        showToast("Column decisions saved", "success");
      } catch {
        showToast("Failed to save column decisions", "error");
      }
    },
    [reconClusterId, fetchStats, fetchClusters, showToast]
  );

  // Promote unclustered entity to standalone canonical — opens canonical creation flow
  // For now, advances provenance to 'clustered' (standalone) so it leaves the unclustered list
  const handlePromote = useCallback(
    async (entityId: number) => {
      try {
        // Mark as standalone by setting provenance to 'canonicalized'
        const res = await fetch(`${API}/entities/${entityId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provenance: "canonicalized" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await Promise.all([fetchStats(), fetchUnclustered()]);
        showToast("Entity promoted", "success");
      } catch {
        showToast("Failed to promote entity", "error");
      }
    },
    [fetchStats, fetchUnclustered, showToast]
  );

  // Soft-delete unclustered entity — removes from consideration
  const handleIgnore = useCallback(
    async (entityId: number) => {
      try {
        const res = await fetch(`${API}/entities/${entityId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await Promise.all([fetchStats(), fetchUnclustered()]);
        showToast("Entity removed", "success");
      } catch {
        showToast("Failed to remove entity", "error");
      }
    },
    [fetchStats, fetchUnclustered, showToast]
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

      <div style={{ paddingBottom: 20 }}>
        {/* Filter bar */}
        <div className="flex items-center gap-2.5 flex-wrap mb-4">
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
              <GoldLoading rows={4} label="Loading clusters" />
            )}
            {!loading && clusters.length > 0 && filtered.length === 0 && (
              <GoldNoResults query={search || undefined} />
            )}
            {!loading && clusters.length === 0 && (
              <GoldEmpty noun="clusters" />
            )}
            {filtered.map((c) => (
              <ClusterCard
                key={c.cluster.id}
                cluster={c.cluster}
                members={c.members}
                onResolve={(action, payload) => handleResolve(c.cluster.id, action, payload)}
                onConfirmGrouping={() => openReconciliation(c.cluster.id)}
                onLabelChange={handleLabelChange}
                onDismiss={handleDismissRequest}
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
                  <th className="pb-2 pr-4 font-medium">Source</th>
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
                    <td className="py-2 pr-4">{e.entity_name}</td>
                    <td
                      className="py-2 pr-4"
                      style={{ fontFamily: "var(--bp-font-mono)", fontSize: 12, color: "var(--bp-ink-secondary)" }}
                    >
                      {e.specimen_name}
                    </td>
                    <td className="py-2 pr-4" style={{ color: "var(--bp-ink-secondary)" }}>
                      {e.specimen_source ?? "\u2014"}
                    </td>
                    <td className="py-2 pr-4 text-right" style={{ fontFamily: "var(--bp-font-mono)" }}>
                      {e.column_count}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handlePromote(e.id)}
                          className="rounded px-2.5 py-1 text-xs font-medium transition-colors hover:opacity-90"
                          style={{
                            color: "var(--bp-surface-1)",
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
                    <td colSpan={5}>
                      {search ? (
                        <GoldNoResults query={search} />
                      ) : (
                        <GoldEmpty noun="unclustered entities" />
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dismiss notes modal — spec requires notes for dismiss action */}
      {dismissTarget !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.35)" }}
          onClick={() => setDismissTarget(null)}
        >
          <div
            className="rounded-lg p-5 w-full max-w-md"
            style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                fontFamily: "var(--bp-font-display)",
                fontSize: 16,
                fontWeight: 600,
                color: "var(--bp-ink-primary)",
                marginBottom: 12,
              }}
            >
              Dismiss Cluster #{dismissTarget}
            </h3>
            <p
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 13,
                color: "var(--bp-ink-secondary)",
                marginBottom: 8,
              }}
            >
              Provide a reason for dismissing this cluster. Members will be returned to the unclustered pool.
            </p>
            <textarea
              ref={dismissInputRef}
              value={dismissNotes}
              onChange={(e) => setDismissNotes(e.target.value)}
              rows={3}
              placeholder="Reason for dismissal..."
              className="w-full rounded-md px-3 py-2 text-sm outline-none resize-y"
              style={{
                fontFamily: "var(--bp-font-body)",
                color: "var(--bp-ink-primary)",
                background: "var(--bp-surface-inset)",
                border: "1px solid var(--bp-border)",
              }}
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setDismissTarget(null)}
                className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-black/5"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  color: "var(--bp-ink-muted)",
                  border: "1px solid var(--bp-border)",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDismissConfirm}
                disabled={!dismissNotes.trim()}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-40"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  color: "var(--bp-surface-1)",
                  background: "var(--bp-copper)",
                }}
              >
                Dismiss Cluster
              </button>
            </div>
          </div>
        </div>
      )}

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
          <GoldEmpty noun="column data" />
        )}
      </SlideOver>
    </GoldStudioLayout>
  );
}
