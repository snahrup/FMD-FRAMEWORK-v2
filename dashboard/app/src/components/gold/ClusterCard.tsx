// Cluster Card — Full-width card displaying a Gold entity cluster with members, overlap, and actions.

import { useState } from "react";
import { ChevronDown, Check, Scissors, Merge, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ClusterMember {
  id: number;
  entity_name: string;
  specimen_name: string;
  column_count: number;
  match_type: string;
}

interface ClusterData {
  id: number;
  label: string | null;
  dominant_name: string | null;
  confidence: number;
  confidence_breakdown: string | null;
  status: string;
  resolution: string | null;
  division: string;
}

interface ClusterCardProps {
  cluster: ClusterData;
  members: ClusterMember[];
  onResolve: (action: string) => void;
  onConfirmGrouping: () => void;
}

const STATUS_RAIL: Record<string, string> = {
  unresolved: "#B45624",
  resolved: "#3D7C4F",
  promoted: "#C2952B",
  pending_steward: "#C27A1A",
  dismissed: "#A8A29E",
};

const STATUS_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  unresolved: { bg: "rgba(180,86,36,0.1)", color: "#B45624", label: "Unresolved" },
  resolved: { bg: "rgba(61,124,79,0.1)", color: "#3D7C4F", label: "Resolved" },
  promoted: { bg: "rgba(194,149,43,0.1)", color: "#C2952B", label: "Promoted" },
  pending_steward: { bg: "rgba(194,122,26,0.1)", color: "#C27A1A", label: "Pending Steward" },
  dismissed: { bg: "rgba(0,0,0,0.05)", color: "#A8A29E", label: "Dismissed" },
};

function isCrossSource(members: ClusterMember[]): boolean {
  const sources = new Set(members.map((m) => m.specimen_name.split(".")[0]));
  return sources.size > 1;
}

function parseBreakdown(raw: string | null): string {
  if (!raw) return "";
  // Expect JSON like {"name":40,"columns":30,"query":17,"cross_source":-5}
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

export function ClusterCard({ cluster, members, onResolve, onConfirmGrouping }: ClusterCardProps) {
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(cluster.label ?? "");
  const [splitOpen, setSplitOpen] = useState(false);

  const badge = STATUS_BADGE[cluster.status] ?? STATUS_BADGE.unresolved;
  const railColor = STATUS_RAIL[cluster.status] ?? STATUS_RAIL.unresolved;
  const crossSource = isCrossSource(members);

  // Find unique columns info per member
  const totalCols = Math.max(...members.map((m) => m.column_count), 1);

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

        <div className="flex-1 min-w-0 p-4">
          {/* Header row */}
          <div className="flex items-center gap-3 flex-wrap">
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

            {/* Inline-editable label */}
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
                onBlur={() => setEditingLabel(false)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") setEditingLabel(false);
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
                  color: "#C27A1A",
                  background: "rgba(194,122,26,0.1)",
                }}
              >
                &#9888; Cross-source
              </span>
            )}
          </div>

          {/* Confidence breakdown */}
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
          <div className="mt-3 overflow-x-auto">
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
                      <td className="py-2 pr-4">{m.entity_name}</td>
                      <td
                        className="py-2 pr-4"
                        style={{ fontFamily: "var(--bp-font-mono)", fontSize: 12, color: "var(--bp-ink-secondary)" }}
                      >
                        {m.specimen_name}
                      </td>
                      <td className="py-2 pr-4 text-right" style={{ fontFamily: "var(--bp-font-mono)" }}>
                        {m.column_count}
                      </td>
                      <td className="py-2 pr-4">
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
                          {/* Column overlap bar */}
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

          {/* Unique columns summary */}
          {members.length > 1 && (
            <p
              className="mt-2"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 12,
                color: "var(--bp-ink-muted)",
              }}
            >
              {members.map((m) => {
                const overlap = columnOverlapPercent(m.match_type);
                if (overlap === null || overlap >= 100) return null;
                const unique = Math.round(m.column_count * (1 - overlap / 100));
                if (unique <= 0) return null;
                return `${unique} column${unique !== 1 ? "s" : ""} unique to ${m.entity_name}`;
              }).filter(Boolean).join(" \u00b7 ")}
            </p>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-2 mt-4">
            {/* Confirm Grouping — primary */}
            <button
              type="button"
              onClick={onConfirmGrouping}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors hover:opacity-90"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 13,
                fontWeight: 500,
                color: "#fff",
                background: "var(--bp-copper)",
              }}
            >
              <Check size={14} />
              Confirm Grouping
            </button>

            {/* Split dropdown */}
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
                  className="absolute left-0 top-full mt-1 rounded-md shadow-lg z-10 py-1 min-w-[160px]"
                  style={{
                    background: "var(--bp-surface-1)",
                    border: "1px solid var(--bp-border)",
                  }}
                >
                  {members.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="block w-full text-left px-3 py-1.5 hover:bg-black/5 transition-colors"
                      style={{
                        fontFamily: "var(--bp-font-body)",
                        fontSize: 12,
                        color: "var(--bp-ink-primary)",
                      }}
                      onClick={() => {
                        onResolve(`split:${m.id}`);
                        setSplitOpen(false);
                      }}
                    >
                      Remove {m.entity_name}
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

            {/* Dismiss */}
            <button
              type="button"
              onClick={() => onResolve("dismiss")}
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
        </div>
      </div>
    </div>
  );
}
