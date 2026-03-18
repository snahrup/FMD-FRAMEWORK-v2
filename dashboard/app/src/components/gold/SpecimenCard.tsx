// Specimen Card — Two-line expandable card for Gold Ledger specimens.
// Shows status rail, name, type badge, steward, provenance, and expands to show entities/queries.

import { useState, useCallback } from "react";
import { ChevronDown, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProvenanceThread } from "./ProvenanceThread";

// ── Types ──

interface SpecimenEntity {
  id: number;
  entity_name: string;
  source_database: string | null;
  column_count: number;
  provenance: string;
  cluster_id: number | null;
}

interface SpecimenQuery {
  id: number;
  query_name: string | null;
  query_text: string;
  query_type: string;
  source_database: string | null;
}

export interface SpecimenCardProps {
  specimen: {
    id: number;
    name: string;
    type: string;
    division: string;
    source_system: string | null;
    steward: string;
    description: string | null;
    job_state: string;
    tags: string | null;
    created_at: string;
    entity_count?: number;
    column_count?: number;
    provenance_phase?: number;
  };
  expanded: boolean;
  onToggle: () => void;
  entities?: SpecimenEntity[];
  queries?: SpecimenQuery[];
}

// ── Status rail color mapping ──

function getRailColor(jobState: string): string {
  switch (jobState) {
    case "extracting":
    case "schema_discovery":
      return "#B45624"; // copper
    case "extracted":
      return "#3D7C4F"; // operational green
    case "parse_failed":
      return "#B93A2A"; // fault red
    case "parse_warning":
      return "#C27A1A"; // caution amber
    case "needs_connection":
    case "schema_pending":
      return "#5B7FA3"; // info blue
    case "queued":
    default:
      return "#A8A29E"; // muted stone
  }
}

// ── Job state badge ──

function JobStateBadge({ state }: { state: string }) {
  const config: Record<string, { bg: string; color: string; label: string; pulse?: boolean }> = {
    queued: { bg: "rgba(168,162,158,0.12)", color: "#78716C", label: "Queued" },
    extracting: { bg: "rgba(180,86,36,0.10)", color: "#B45624", label: "Extracting", pulse: true },
    schema_discovery: { bg: "rgba(180,86,36,0.10)", color: "#B45624", label: "Schema Discovery", pulse: true },
    extracted: { bg: "rgba(61,124,79,0.10)", color: "#3D7C4F", label: "Extracted" },
    parse_warning: { bg: "rgba(194,122,26,0.10)", color: "#C27A1A", label: "Parse Warning" },
    parse_failed: { bg: "rgba(185,58,42,0.10)", color: "#B93A2A", label: "Parse Failed" },
    needs_connection: { bg: "rgba(91,127,163,0.10)", color: "#5B7FA3", label: "Needs Connection" },
    schema_pending: { bg: "rgba(168,162,158,0.12)", color: "#78716C", label: "Schema Pending" },
  };

  const c = config[state] ?? config.queued!;

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5", c.pulse && "gold-state-pulse")}
      style={{
        background: c.bg,
        color: c.color,
        fontFamily: "var(--bp-font-mono)",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.02em",
      }}
    >
      {c.pulse && (
        <span
          className="inline-block rounded-full"
          style={{ width: 5, height: 5, background: c.color }}
        />
      )}
      {c.label}
    </span>
  );
}

// ── Type badge (RDL, PBIX, etc.) ──

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5"
      style={{
        background: "rgba(180,86,36,0.1)",
        color: "var(--bp-copper)",
        fontFamily: "var(--bp-font-mono)",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.03em",
      }}
    >
      {type.toUpperCase()}
    </span>
  );
}

// ── Copy button ──

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        handleCopy();
      }}
      className="rounded p-1 transition-colors hover:bg-white/10"
      style={{ color: copied ? "#3D7C4F" : "#A8A29E" }}
      aria-label="Copy SQL"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

// ── Cluster status badge ──

function ClusterBadge({ clusterId }: { clusterId: number | null }) {
  if (clusterId === null) {
    return (
      <span style={{ fontSize: 12, color: "var(--bp-ink-muted)" }}>—</span>
    );
  }
  // Positive cluster_id = resolved, negative or 0 = unresolved (convention)
  const resolved = clusterId > 0;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
      style={{
        background: resolved ? "rgba(61,124,79,0.10)" : "rgba(194,122,26,0.10)",
        color: resolved ? "#3D7C4F" : "#C27A1A",
        fontFamily: "var(--bp-font-mono)",
        fontSize: 11,
      }}
    >
      {resolved ? "\u2713" : "\u26A0"} C-{Math.abs(clusterId)}
    </span>
  );
}

// ── Main Component ──

export function SpecimenCard({ specimen, expanded, onToggle, entities, queries }: SpecimenCardProps) {
  const [innerTab, setInnerTab] = useState<"tables" | "queries">("tables");

  const hasTables = entities && entities.length > 0;
  const hasQueries = queries && queries.length > 0;

  // Auto-select the available tab
  const activeTab = innerTab === "tables" && !hasTables && hasQueries ? "queries" : innerTab;

  return (
    <div
      className="rounded-lg overflow-hidden transition-shadow"
      style={{
        background: "var(--bp-surface-1)",
        border: "1px solid var(--bp-border)",
        boxShadow: expanded ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
      }}
    >
      {/* Clickable header */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full text-left flex items-start gap-0 transition-colors hover:bg-black/[0.015]"
        style={{ position: "relative" }}
      >
        {/* Status rail */}
        <div
          className="shrink-0 self-stretch"
          style={{
            width: 3,
            background: getRailColor(specimen.job_state),
            borderRadius: "3px 0 0 3px",
          }}
        />

        <div className="flex-1 min-w-0 px-4 py-3">
          {/* Line 1: Name + type badge + source + steward + provenance */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span
              className="truncate"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontWeight: 500,
                fontSize: 14,
                color: "var(--bp-ink-primary)",
                maxWidth: 280,
              }}
            >
              {specimen.name}
            </span>

            <TypeBadge type={specimen.type} />

            {specimen.source_system && (
              <span
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 12,
                  color: "var(--bp-ink-muted)",
                }}
              >
                {specimen.source_system}
              </span>
            )}

            <span
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 12,
                color: "var(--bp-ink-secondary)",
              }}
            >
              {specimen.steward}
            </span>

            {specimen.provenance_phase && (
              <ProvenanceThread
                phase={specimen.provenance_phase as 1 | 2 | 3 | 4 | 5 | 6 | 7}
                size="sm"
              />
            )}
          </div>

          {/* Line 2: Counts + job state badge */}
          <div className="flex items-center gap-3 mt-1.5">
            {(specimen.entity_count != null || specimen.column_count != null) && (
              <span
                style={{
                  fontFamily: "var(--bp-font-mono)",
                  fontSize: 12,
                  color: "var(--bp-ink-muted)",
                  letterSpacing: "0.02em",
                }}
              >
                {specimen.entity_count != null && (
                  <>{specimen.entity_count} table{specimen.entity_count !== 1 ? "s" : ""}</>
                )}
                {specimen.entity_count != null && specimen.column_count != null && " · "}
                {specimen.column_count != null && (
                  <>{specimen.column_count} col{specimen.column_count !== 1 ? "s" : ""}</>
                )}
              </span>
            )}

            <JobStateBadge state={specimen.job_state} />
          </div>
        </div>

        {/* Chevron */}
        <div className="shrink-0 p-3 self-center">
          <ChevronDown
            size={16}
            className="transition-transform duration-200"
            style={{
              color: "var(--bp-ink-muted)",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          />
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div
          style={{
            background: "var(--bp-surface-inset)",
            borderTop: "1px solid var(--bp-border)",
          }}
        >
          {/* Inner tabs — only show if there's content in at least one */}
          {(hasTables || hasQueries) && (
            <div
              className="flex gap-0.5 px-5 pt-3"
              style={{ borderBottom: "1px solid var(--bp-border)" }}
            >
              {hasTables && (
                <button
                  type="button"
                  onClick={() => setInnerTab("tables")}
                  className={cn(
                    "pb-2 px-3 text-center transition-colors relative",
                    activeTab === "tables"
                      ? "text-[var(--bp-copper)]"
                      : "text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-secondary)]"
                  )}
                  style={{
                    fontFamily: "var(--bp-font-body)",
                    fontWeight: 500,
                    fontSize: 12,
                  }}
                >
                  Tables ({entities!.length})
                  {activeTab === "tables" && (
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
              )}
              {hasQueries && (
                <button
                  type="button"
                  onClick={() => setInnerTab("queries")}
                  className={cn(
                    "pb-2 px-3 text-center transition-colors relative",
                    activeTab === "queries"
                      ? "text-[var(--bp-copper)]"
                      : "text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-secondary)]"
                  )}
                  style={{
                    fontFamily: "var(--bp-font-body)",
                    fontWeight: 500,
                    fontSize: 12,
                  }}
                >
                  Queries ({queries!.length})
                  {activeTab === "queries" && (
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
              )}
            </div>
          )}

          {/* Tables tab content */}
          {activeTab === "tables" && hasTables && (
            <div className="overflow-x-auto">
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--bp-border)",
                      color: "var(--bp-ink-muted)",
                      fontFamily: "var(--bp-font-body)",
                      fontSize: 11,
                      fontWeight: 500,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    <th className="text-left py-2 px-5 font-medium">Entity Name</th>
                    <th className="text-left py-2 px-3 font-medium">Source DB</th>
                    <th className="text-right py-2 px-3 font-medium">Cols</th>
                    <th className="text-left py-2 px-3 font-medium">Cluster</th>
                    <th className="text-left py-2 px-5 font-medium">Provenance</th>
                  </tr>
                </thead>
                <tbody>
                  {entities!.map((ent) => (
                    <tr
                      key={ent.id}
                      style={{
                        borderBottom: "1px solid var(--bp-border-subtle)",
                        color: "var(--bp-ink-primary)",
                      }}
                    >
                      <td
                        className="py-2 px-5"
                        style={{ fontWeight: 500 }}
                      >
                        {ent.entity_name}
                      </td>
                      <td
                        className="py-2 px-3"
                        style={{
                          color: "var(--bp-ink-muted)",
                          fontFamily: "var(--bp-font-mono)",
                          fontSize: 12,
                        }}
                      >
                        {ent.source_database || "—"}
                      </td>
                      <td
                        className="py-2 px-3 text-right"
                        style={{
                          fontFamily: "var(--bp-font-mono)",
                          fontSize: 12,
                          color: "var(--bp-ink-secondary)",
                        }}
                      >
                        {ent.column_count}
                      </td>
                      <td className="py-2 px-3">
                        <ClusterBadge clusterId={ent.cluster_id} />
                      </td>
                      <td
                        className="py-2 px-5"
                        style={{
                          fontFamily: "var(--bp-font-mono)",
                          fontSize: 11,
                          color: "var(--bp-ink-muted)",
                        }}
                      >
                        {ent.provenance}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Queries tab content */}
          {activeTab === "queries" && hasQueries && (
            <div className="flex flex-col gap-3 p-5">
              {queries!.map((q) => (
                <div key={q.id}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span
                      style={{
                        fontFamily: "var(--bp-font-body)",
                        fontWeight: 500,
                        fontSize: 13,
                        color: "var(--bp-ink-primary)",
                      }}
                    >
                      {q.query_name || `Query #${q.id}`}
                    </span>
                    <span
                      className="rounded px-1.5 py-0.5"
                      style={{
                        background: "rgba(180,86,36,0.1)",
                        color: "var(--bp-copper)",
                        fontFamily: "var(--bp-font-mono)",
                        fontSize: 10,
                        fontWeight: 500,
                      }}
                    >
                      {q.query_type.toUpperCase()}
                    </span>
                    {q.source_database && (
                      <span
                        style={{
                          fontFamily: "var(--bp-font-mono)",
                          fontSize: 11,
                          color: "var(--bp-ink-muted)",
                        }}
                      >
                        {q.source_database}
                      </span>
                    )}
                  </div>
                  <div
                    className="rounded-md relative group"
                    style={{
                      background: "#2B2A27",
                      padding: "12px 16px",
                      maxHeight: 200,
                      overflowY: "auto",
                    }}
                  >
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <CopyButton text={q.query_text} />
                    </div>
                    <pre
                      style={{
                        fontFamily: "var(--bp-font-mono)",
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: "#E7E5E0",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        margin: 0,
                      }}
                    >
                      {q.query_text}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty expanded state */}
          {!hasTables && !hasQueries && (
            <div
              style={{
                padding: "32px 20px",
                textAlign: "center",
                fontSize: 13,
                color: "var(--bp-ink-muted)",
              }}
            >
              {specimen.job_state === "queued"
                ? "Waiting to be processed..."
                : specimen.job_state === "extracting" || specimen.job_state === "schema_discovery"
                  ? "Extraction in progress..."
                  : "No entities or queries extracted yet"}
            </div>
          )}
        </div>
      )}

      {/* Pulse animation for extracting states */}
      <style>{`
        @keyframes gold-state-pulse-anim {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.6; }
        }
        .gold-state-pulse {
          animation: gold-state-pulse-anim 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
