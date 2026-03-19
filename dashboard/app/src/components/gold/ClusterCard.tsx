// Cluster Card — Full-width card displaying a Gold entity cluster with members, overlap, and actions.
// Spec: docs/superpowers/specs/2026-03-18-gold-studio-design.md § 6

import { useState, useCallback } from "react";
import { ChevronDown, Check, Scissors, Merge, XCircle, UserCheck, UserMinus } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ClusterMember {
  id: number;
  entity_name: string;
  specimen_name: string;
  source_system?: string | null;
  column_count: number;
  match_type: string;
}

export interface ClusterData {
  id: number;
  label: string | null;
  dominant_name: string | null;
  confidence: number;
  confidence_breakdown: string | null;
  status: string;
  resolution: string | null;
  division: string;
  member_count?: number;
}

export interface ClusterCardProps {
  cluster: ClusterData;
  members: ClusterMember[];
  onResolve: (action: string, payload?: Record<string, unknown>) => void;
  onConfirmGrouping: () => void;
  onLabelChange?: (clusterId: number, label: string) => void;
  onDismiss?: (clusterId: number) => void;
}

/* ------------------------------------------------------------------ */
/*  Status maps — aligned to spec statuses                             */
/* ------------------------------------------------------------------ */

const STATUS_RAIL: Record<string, string> = {
  unresolved: "var(--bp-copper)",
  resolved: "var(--bp-operational-green)",
  dismissed: "var(--bp-dismissed)",
  pending_steward: "var(--bp-caution-amber)",
  re_review: "var(--bp-re-review)",
};

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  unresolved: { bg: "var(--bp-copper-soft)", color: "var(--bp-copper)", label: "Unresolved" },
  resolved: { bg: "var(--bp-operational-light)", color: "var(--bp-operational-green)", label: "Resolved" },
  dismissed: { bg: "var(--bp-dismissed-light)", color: "var(--bp-dismissed)", label: "Dismissed" },
  pending_steward: { bg: "var(--bp-caution-light)", color: "var(--bp-caution-amber)", label: "Pending Steward" },
  re_review: { bg: "var(--bp-re-review-light)", color: "var(--bp-re-review)", label: "\u21BB Re-review" },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function isCrossSource(members: ClusterMember[]): boolean {
  const sources = new Set(
    members.map((m) => m.source_system ?? m.specimen_name.split(".")[0])
  );
  return sources.size > 1;
}

function parseBreakdown(raw: string | null): string {
  if (!raw) return "";
  try {
    const obj = JSON.parse(raw) as Record<string, number>;
    const parts = Object.entries(obj).map(([k, v]) => {
      const label = k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, " ");
      return `${label} ${v > 0 ? "+" : ""}${v}`;
    });
    const total = Object.values(obj).reduce((s, n) => s + n, 0);
    return `${parts.join(" \u00b7 ")} = ${total}%`;
  } catch {
    return raw;
  }
}

function columnOverlapPercent(matchType: string): number | null {
  const match = matchType.match(/(\d+)%/);
  return match ? parseInt(match[1], 10) : null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ClusterCard({
  cluster,
  members,
  onResolve,
  onConfirmGrouping,
  onLabelChange,
  onDismiss,
}: ClusterCardProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(cluster.label ?? "");
  const [splitOpen, setSplitOpen] = useState(false);

  const badge = STATUS_BADGE[cluster.status] ?? STATUS_BADGE.unresolved;
  const railColor = STATUS_RAIL[cluster.status] ?? STATUS_RAIL.unresolved;
  const crossSource = isCrossSource(members);
  const isResolved = cluster.status === "resolved" || cluster.status === "dismissed";

  const commitLabel = useCallback(() => {
    setEditingLabel(false);
    const trimmed = labelDraft.trim();
    if (trimmed !== (cluster.label ?? "") && onLabelChange) {
      onLabelChange(cluster.id, trimmed);
    }
  }, [labelDraft, cluster.label, cluster.id, onLabelChange]);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: "var(--bp-surface-1)",
        border: "1px solid var(--bp-border)",
      }}
    >
      <div className="flex">
        {/* Status rail */}
        <div className="shrink-0" style={{ width: 3, background: railColor }} />

        <div className="flex-1 min-w-0 px-3.5 py-2.5">
          {/* Header row */}
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* Cluster ID */}
            <span
              style={{
                fontFamily: "var(--bp-font-mono)",
                fontSize: 12,
                color: "var(--bp-ink-muted)",
              }}
            >
              #{cluster.id}
            </span>

            {/* Dominant name */}
            <span
              style={{
                fontFamily: "var(--bp-font-display)",
                fontWeight: 500,
                fontSize: 14,
                color: "var(--bp-ink-primary)",
              }}
            >
              {cluster.dominant_name ?? "Unnamed Cluster"}
            </span>

            {/* Inline-editable label — persists via onLabelChange */}
            {editingLabel ? (
              <input
                autoFocus
                className="rounded px-2 py-0.5 text-sm outline-none"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 13,
                  color: "var(--bp-ink-primary)",
                  border: "1px solid var(--bp-copper)",
                  background: "var(--bp-surface-inset)",
                  width: 180,
                }}
                value={labelDraft}
                onChange={(e) => setLabelDraft(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitLabel();
                  if (e.key === "Escape") {
                    setLabelDraft(cluster.label ?? "");
                    setEditingLabel(false);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingLabel(true)}
                className="rounded px-2 py-0.5 transition-colors hover:bg-black/5"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 13,
                  color: cluster.label ? "var(--bp-ink-secondary)" : "var(--bp-ink-muted)",
                  fontStyle: cluster.label ? "normal" : "italic",
                }}
              >
                {cluster.label || "Add label..."}
              </button>
            )}

            {/* Confidence */}
            <span
              style={{
                fontFamily: "var(--bp-font-mono)",
                fontSize: 13,
                color: cluster.confidence >= 70 ? "var(--bp-operational-green)" : "var(--bp-caution-amber)",
                fontWeight: 600,
              }}
            >
              {cluster.confidence}%
            </span>

            {/* Status badge */}
            <span
              className="rounded-full px-2.5 py-0.5"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 11,
                fontWeight: 500,
                color: badge.color,
                background: badge.bg,
              }}
            >
              {badge.label}
            </span>

            {/* Cross-source badge */}
            {crossSource && (
              <span
                className="rounded-full px-2.5 py-0.5"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 11,
                  fontWeight: 500,
                  color: "var(--bp-caution-amber)",
                  background: "var(--bp-caution-light)",
                }}
              >
                &#9888; Cross-source
              </span>
            )}

            {/* Member count */}
            <span
              style={{
                fontFamily: "var(--bp-font-mono)",
                fontSize: 11,
                color: "var(--bp-ink-muted)",
              }}
            >
              {members.length} member{members.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Confidence breakdown — always visible per spec */}
          {cluster.confidence_breakdown && (
            <p
              className="mt-2"
              style={{
                fontFamily: "var(--bp-font-mono)",
                fontSize: 11,
                color: "var(--bp-ink-muted)",
                letterSpacing: "0.02em",
              }}
            >
              {parseBreakdown(cluster.confidence_breakdown)}
            </p>
          )}

          {/* Members table */}
          <div className="mt-2.5 overflow-x-auto">
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
                  <th className="pb-1.5 pr-4 font-medium">Entity</th>
                  <th className="pb-1.5 pr-4 font-medium">Specimen</th>
                  <th className="pb-1.5 pr-4 font-medium">Source</th>
                  <th className="pb-1.5 pr-4 font-medium text-right">Columns</th>
                  <th className="pb-1.5 pr-4 font-medium" style={{ minWidth: 200 }}>
                    Match
                  </th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const overlap = columnOverlapPercent(m.match_type);
                  return (
                    <tr
                      key={m.id}
                      style={{
                        fontFamily: "var(--bp-font-body)",
                        color: "var(--bp-ink-primary)",
                        borderTop: "1px solid var(--bp-border)",
                      }}
                    >
                      <td className="py-1.5 pr-4">{m.entity_name}</td>
                      <td
                        className="py-1.5 pr-4"
                        style={{ fontFamily: "var(--bp-font-mono)", fontSize: 12, color: "var(--bp-ink-secondary)" }}
                      >
                        {m.specimen_name}
                      </td>
                      <td
                        className="py-1.5 pr-4"
                        style={{ fontSize: 12, color: "var(--bp-ink-muted)" }}
                      >
                        {m.source_system ?? "\u2014"}
                      </td>
                      <td className="py-1.5 pr-4 text-right" style={{ fontFamily: "var(--bp-font-mono)" }}>
                        {m.column_count}
                      </td>
                      <td className="py-1.5 pr-4">
                        <div className="flex items-center gap-2">
                          <span
                            style={{
                              fontFamily: "var(--bp-font-mono)",
                              fontSize: 12,
                              color: "var(--bp-ink-secondary)",
                              minWidth: 70,
                            }}
                          >
                            {m.match_type}
                          </span>
                          {overlap !== null && (
                            <div
                              className="flex-1 rounded-full overflow-hidden"
                              style={{ height: 6, background: "var(--bp-surface-inset)", maxWidth: 120 }}
                            >
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${overlap}%`,
                                  background: "var(--bp-copper)",
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Unique columns summary — explicit textual evidence per spec */}
          {members.length > 1 && (() => {
            const lines = members
              .map((m) => {
                const overlap = columnOverlapPercent(m.match_type);
                if (overlap === null || overlap >= 100) return null;
                const unique = Math.round(m.column_count * (1 - overlap / 100));
                if (unique <= 0) return null;
                return `${unique} column${unique !== 1 ? "s" : ""} unique to ${m.entity_name}`;
              })
              .filter(Boolean);
            if (lines.length === 0) return null;
            return (
              <p
                className="mt-2"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 12,
                  color: "var(--bp-ink-muted)",
                }}
              >
                {lines.join(" \u00b7 ")}
              </p>
            );
          })()}

          {/* Action buttons — only shown for actionable statuses */}
          {!isResolved && (
            <div className="flex items-center gap-2 mt-3">
              {/* Confirm Grouping — primary, opens column reconciliation */}
              <button
                type="button"
                onClick={onConfirmGrouping}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors hover:opacity-90"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--bp-surface-1)",
                  background: "var(--bp-copper)",
                }}
              >
                <Check size={14} />
                Confirm Grouping
              </button>

              {/* Split dropdown — 3 sub-actions per spec */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSplitOpen(!splitOpen)}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors hover:bg-black/5"
                  style={{
                    fontFamily: "var(--bp-font-body)",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--bp-ink-secondary)",
                    border: "1px solid var(--bp-border)",
                    background: "transparent",
                  }}
                >
                  <Scissors size={14} />
                  Split
                  <ChevronDown size={12} />
                </button>
                {splitOpen && (
                  <div
                    className="absolute left-0 top-full mt-1 rounded-md z-10 py-1 min-w-[220px]"
                    style={{
                      background: "var(--bp-surface-1)",
                      border: "1px solid var(--bp-border)",
                    }}
                  >
                    {/* Create Sub-clusters — future packet, stubbed */}
                    <button
                      type="button"
                      disabled
                      className="block w-full text-left px-3 py-1.5 opacity-50 cursor-not-allowed"
                      style={{
                        fontFamily: "var(--bp-font-body)",
                        fontSize: 12,
                        color: "var(--bp-ink-muted)",
                      }}
                    >
                      Create Sub-clusters...
                    </button>
                    {/* Divider */}
                    <div style={{ height: 1, background: "var(--bp-border)", margin: "2px 0" }} />
                    {/* Remove Member — per member */}
                    {members.map((m) => (
                      <button
                        key={`remove-${m.id}`}
                        type="button"
                        className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-black/5 transition-colors"
                        style={{
                          fontFamily: "var(--bp-font-body)",
                          fontSize: 12,
                          color: "var(--bp-ink-primary)",
                        }}
                        onClick={() => {
                          onResolve("remove_member", { member_id: m.id });
                          setSplitOpen(false);
                        }}
                      >
                        <UserMinus size={12} style={{ color: "var(--bp-ink-muted)" }} />
                        Remove {m.entity_name}
                      </button>
                    ))}
                    {/* Divider */}
                    <div style={{ height: 1, background: "var(--bp-border)", margin: "2px 0" }} />
                    {/* Mark Standalone — per member */}
                    {members.map((m) => (
                      <button
                        key={`standalone-${m.id}`}
                        type="button"
                        className="flex items-center gap-2 w-full text-left px-3 py-1.5 hover:bg-black/5 transition-colors"
                        style={{
                          fontFamily: "var(--bp-font-body)",
                          fontSize: 12,
                          color: "var(--bp-ink-primary)",
                        }}
                        onClick={() => {
                          onResolve("mark_standalone", { member_id: m.id });
                          setSplitOpen(false);
                        }}
                      >
                        <UserCheck size={12} style={{ color: "var(--bp-operational-green)" }} />
                        Mark {m.entity_name} Standalone
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Merge With */}
              <button
                type="button"
                onClick={() => onResolve("merge")}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors hover:bg-black/5"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--bp-ink-secondary)",
                  border: "1px solid var(--bp-border)",
                  background: "transparent",
                }}
              >
                <Merge size={14} />
                Merge With...
              </button>

              {/* Dismiss — requires notes */}
              <button
                type="button"
                onClick={() => onDismiss?.(cluster.id)}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors hover:bg-black/5"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--bp-ink-muted)",
                  border: "1px solid var(--bp-border)",
                  background: "transparent",
                }}
              >
                <XCircle size={14} />
                Dismiss
              </button>
            </div>
          )}

          {/* Resolution summary for resolved/dismissed clusters */}
          {isResolved && cluster.resolution && (
            <p
              className="mt-3"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 12,
                color: "var(--bp-ink-muted)",
                fontStyle: "italic",
              }}
            >
              Resolved: {cluster.resolution}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
