// Specimen Card — Two-line expandable card for Gold Ledger specimens.
// Shows status rail, name, type badge, steward, provenance, and expands to show entities/queries/columns/preview.

import { useState, useCallback, useEffect } from "react";
import { ChevronDown, Copy, Check, Database, Table2, Columns3, Eye, Loader2, Zap, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProvenanceThread } from "./ProvenanceThread";

const API = import.meta.env.VITE_API_URL || "";

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

interface ColumnInfo {
  id: number;
  column_name: string;
  data_type: string | null;
  nullable: boolean;
  is_key: boolean;
  source_expression: string | null;
  is_calculated: boolean;
  ordinal: number | null;
}

interface PreviewData {
  columns: { name: string; python_type: string }[];
  rows: any[][];
  row_count: number;
  truncated: boolean;
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
    source_class?: string;
  };
  expanded: boolean;
  onToggle: () => void;
  onDelete?: (id: number) => void;
  entities?: SpecimenEntity[];
  queries?: SpecimenQuery[];
}

// ── Status rail color mapping ──

function getRailColor(jobState: string): string {
  switch (jobState) {
    case "extracting":
    case "schema_discovery":
      return "var(--bp-copper)";
    case "extracted":
    case "accepted":
      return "var(--bp-operational)";
    case "parse_failed":
      return "var(--bp-fault)";
    case "parse_warning":
      return "var(--bp-caution)";
    case "needs_connection":
    case "schema_pending":
      return "var(--bp-lz)";
    case "queued":
    default:
      return "var(--bp-ink-muted)";
  }
}

// ── Job state badge ──

function JobStateBadge({ state }: { state: string }) {
  const config: Record<string, { bg: string; color: string; label: string; pulse?: boolean }> = {
    queued: { bg: "rgba(168,162,158,0.12)", color: "var(--bp-ink-tertiary)", label: "Queued" },
    extracting: { bg: "rgba(180,86,36,0.10)", color: "var(--bp-copper)", label: "Extracting", pulse: true },
    schema_discovery: { bg: "rgba(180,86,36,0.10)", color: "var(--bp-copper)", label: "Schema Discovery", pulse: true },
    extracted: { bg: "rgba(61,124,79,0.10)", color: "var(--bp-operational)", label: "Extracted" },
    parse_warning: { bg: "rgba(194,122,26,0.10)", color: "var(--bp-caution)", label: "Parse Warning" },
    parse_failed: { bg: "rgba(185,58,42,0.10)", color: "var(--bp-fault)", label: "Parse Failed" },
    needs_connection: { bg: "rgba(91,127,163,0.10)", color: "var(--bp-lz)", label: "Needs Connection" },
    schema_pending: { bg: "rgba(168,162,158,0.12)", color: "var(--bp-ink-tertiary)", label: "Schema Pending" },
    accepted: { bg: "rgba(61,124,79,0.10)", color: "var(--bp-operational)", label: "Accepted" },
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

// ── Type badge ──

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

// ── Source class badge ──

function SourceClassBadge({ sourceClass }: { sourceClass: string }) {
  if (sourceClass === "structural") return null;
  const isSupporting = sourceClass === "supporting";
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5"
      style={{
        background: isSupporting ? "rgba(194,122,26,0.08)" : "rgba(168,162,158,0.10)",
        color: isSupporting ? "var(--bp-caution)" : "var(--bp-ink-tertiary)",
        fontFamily: "var(--bp-font-mono)",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      {isSupporting ? "Supporting" : "Contextual"}
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
      style={{ color: copied ? "var(--bp-operational)" : "var(--bp-ink-muted)" }}
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
  const resolved = clusterId > 0;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5"
      style={{
        background: resolved ? "rgba(61,124,79,0.10)" : "rgba(194,122,26,0.10)",
        color: resolved ? "var(--bp-operational)" : "var(--bp-caution)",
        fontFamily: "var(--bp-font-mono)",
        fontSize: 11,
      }}
    >
      {resolved ? "\u2713" : "\u26A0"} C-{Math.abs(clusterId)}
    </span>
  );
}

// ── Columns Panel ──

function ColumnsPanel({ entities }: { entities: SpecimenEntity[] }) {
  const [columns, setColumns] = useState<Record<number, ColumnInfo[]>>({});
  const [loading, setLoading] = useState<Record<number, boolean>>({});
  const [expandedEntity, setExpandedEntity] = useState<number | null>(entities[0]?.id ?? null);

  const loadColumns = useCallback(async (entityId: number) => {
    if (columns[entityId]) return;
    setLoading((prev) => ({ ...prev, [entityId]: true }));
    try {
      const res = await fetch(`${API}/api/gold-studio/entities/${entityId}/columns`);
      if (res.ok) {
        const data = await res.json();
        setColumns((prev) => ({ ...prev, [entityId]: data.items }));
      }
    } finally {
      setLoading((prev) => ({ ...prev, [entityId]: false }));
    }
  }, [columns]);

  useEffect(() => {
    if (expandedEntity) loadColumns(expandedEntity);
  }, [expandedEntity, loadColumns]);

  return (
    <div style={{ padding: 0 }}>
      {entities.map((ent) => {
        const isOpen = expandedEntity === ent.id;
        const cols = columns[ent.id] || [];
        const isLoading = loading[ent.id];

        return (
          <div key={ent.id}>
            <button
              type="button"
              onClick={() => {
                setExpandedEntity(isOpen ? null : ent.id);
              }}
              className="w-full text-left flex items-center gap-2 px-5 py-2 transition-colors hover:bg-black/[0.02]"
              style={{ borderBottom: "1px solid var(--bp-border-subtle)" }}
            >
              <Table2 size={13} style={{ color: "var(--bp-copper)", flexShrink: 0 }} />
              <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 12, fontWeight: 500, color: "var(--bp-ink-primary)" }}>
                {ent.entity_name}
              </span>
              <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 11, color: "var(--bp-ink-muted)", marginLeft: "auto" }}>
                {ent.column_count} col{ent.column_count !== 1 ? "s" : ""}
              </span>
              <ChevronDown
                size={13}
                style={{
                  color: "var(--bp-ink-muted)",
                  transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 200ms",
                }}
              />
            </button>

            {isOpen && (
              <div style={{ background: "var(--bp-surface-2, rgba(0,0,0,0.02))" }}>
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-4" style={{ color: "var(--bp-ink-muted)", fontSize: 12 }}>
                    <Loader2 size={14} className="animate-spin" /> Loading columns...
                  </div>
                ) : cols.length === 0 ? (
                  <div style={{ padding: "12px 20px", fontSize: 12, color: "var(--bp-ink-muted)" }}>No columns extracted</div>
                ) : (
                  <table className="w-full" style={{ fontSize: 12 }}>
                    <thead>
                      <tr style={{
                        borderBottom: "1px solid var(--bp-border)",
                        color: "var(--bp-ink-muted)",
                        fontFamily: "var(--bp-font-mono)",
                        fontSize: 10,
                        fontWeight: 500,
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}>
                        <th className="text-left py-1.5 px-5 font-medium" style={{ width: 20 }}>#</th>
                        <th className="text-left py-1.5 px-3 font-medium">Column</th>
                        <th className="text-left py-1.5 px-3 font-medium">Type</th>
                        <th className="text-center py-1.5 px-3 font-medium">Nullable</th>
                        <th className="text-center py-1.5 px-3 font-medium">Key</th>
                        <th className="text-left py-1.5 px-3 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cols.map((col, i) => (
                        <tr
                          key={col.id || i}
                          style={{
                            borderBottom: "1px solid var(--bp-border-subtle)",
                            background: i % 2 === 1 ? "var(--bp-surface-inset, rgba(0,0,0,0.015))" : "transparent",
                          }}
                        >
                          <td className="py-1 px-5" style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, color: "var(--bp-ink-muted)" }}>
                            {col.ordinal ?? i + 1}
                          </td>
                          <td className="py-1 px-3" style={{ fontFamily: "var(--bp-font-mono)", fontWeight: 500, color: col.is_key ? "var(--bp-copper)" : "var(--bp-ink-primary)" }}>
                            {col.column_name}
                            {col.is_key && <span style={{ marginLeft: 4, fontSize: 9, color: "var(--bp-copper)" }}>PK</span>}
                          </td>
                          <td className="py-1 px-3" style={{ fontFamily: "var(--bp-font-mono)", fontSize: 11, color: "var(--bp-ink-secondary)" }}>
                            {col.data_type || "—"}
                          </td>
                          <td className="py-1 px-3 text-center" style={{ fontSize: 11, color: col.nullable ? "var(--bp-ink-muted)" : "var(--bp-operational)" }}>
                            {col.nullable ? "yes" : "no"}
                          </td>
                          <td className="py-1 px-3 text-center">
                            {col.is_key && (
                              <span className="inline-block rounded-full" style={{ width: 6, height: 6, background: "var(--bp-copper)" }} />
                            )}
                          </td>
                          <td className="py-1 px-3" style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, color: "var(--bp-ink-muted)" }}>
                            {col.source_expression || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Data Preview Panel ──

function PreviewPanel({ specimenId }: { specimenId: number }) {
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/api/gold-studio/specimens/${specimenId}/preview`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
        throw new Error(body.detail || body.error || `HTTP ${res.status}`);
      }
      setPreview(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  }, [specimenId]);

  return (
    <div style={{ padding: 0 }}>
      {!preview && !loading && !error && (
        <div className="flex flex-col items-center gap-3 py-6">
          <Database size={20} style={{ color: "var(--bp-ink-muted)" }} />
          <p style={{ fontSize: 12, color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-body)" }}>
            Run this query against the source database and preview results
          </p>
          <button
            type="button"
            onClick={loadPreview}
            className="bp-btn-primary inline-flex items-center gap-2"
            style={{ fontSize: 12, padding: "6px 16px" }}
          >
            <Zap size={13} /> Run Preview (TOP 50)
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center gap-2 py-8" style={{ color: "var(--bp-copper)", fontSize: 12 }}>
          <Loader2 size={16} className="animate-spin" />
          <span style={{ fontFamily: "var(--bp-font-body)" }}>Querying source database...</span>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center gap-2 py-6">
          <p style={{ fontSize: 12, color: "var(--bp-fault)", fontFamily: "var(--bp-font-body)" }}>{error}</p>
          <button type="button" onClick={loadPreview} className="bp-btn-secondary" style={{ fontSize: 11, padding: "4px 12px" }}>
            Retry
          </button>
        </div>
      )}

      {preview && (
        <div>
          <div className="flex items-center gap-3 px-5 py-2" style={{ borderBottom: "1px solid var(--bp-border)" }}>
            <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 11, color: "var(--bp-ink-secondary)" }}>
              {preview.row_count} row{preview.row_count !== 1 ? "s" : ""}
              {preview.truncated && " (truncated)"}
            </span>
            <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 11, color: "var(--bp-ink-muted)" }}>
              {preview.columns.length} column{preview.columns.length !== 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={loadPreview}
              className="ml-auto text-xs transition-colors hover:text-[var(--bp-copper)]"
              style={{ fontFamily: "var(--bp-font-body)", fontSize: 11, color: "var(--bp-ink-muted)" }}
            >
              Refresh
            </button>
          </div>
          <div className="overflow-x-auto" style={{ maxHeight: 360 }}>
            <table className="w-full" style={{ fontSize: 11 }}>
              <thead>
                <tr style={{
                  position: "sticky",
                  top: 0,
                  background: "var(--bp-surface-inset, #faf9f7)",
                  borderBottom: "1px solid var(--bp-border)",
                  color: "var(--bp-ink-muted)",
                  fontFamily: "var(--bp-font-mono)",
                  fontSize: 10,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  zIndex: 1,
                }}>
                  {preview.columns.map((col, i) => (
                    <th key={i} className="text-left py-1.5 px-3 font-medium whitespace-nowrap">{col.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, ri) => (
                  <tr
                    key={ri}
                    style={{
                      borderBottom: "1px solid var(--bp-border-subtle)",
                      background: ri % 2 === 1 ? "var(--bp-surface-inset, rgba(0,0,0,0.015))" : "transparent",
                    }}
                  >
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="py-1 px-3 whitespace-nowrap"
                        style={{
                          fontFamily: "var(--bp-font-mono)",
                          fontSize: 11,
                          color: cell === null ? "var(--bp-ink-muted)" : "var(--bp-ink-primary)",
                          maxWidth: 200,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {cell === null ? "NULL" : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Component ──

type InnerTab = "tables" | "columns" | "preview" | "queries";

export function SpecimenCard({ specimen, expanded, onToggle, onDelete, entities, queries }: SpecimenCardProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>("tables");

  const hasTables = entities && entities.length > 0;
  const hasQueries = queries && queries.length > 0;
  const isExtracted = ["extracted", "accepted", "parse_warning"].includes(specimen.job_state);

  // Auto-select the best available tab
  const activeTab = (() => {
    if (innerTab === "tables" && hasTables) return "tables";
    if (innerTab === "columns" && hasTables && isExtracted) return "columns";
    if (innerTab === "preview" && isExtracted && specimen.source_system) return "preview";
    if (innerTab === "queries" && hasQueries) return "queries";
    // fallback
    if (hasTables) return "tables";
    if (hasQueries) return "queries";
    return innerTab;
  })();

  const tabs: { key: InnerTab; label: string; icon: typeof Table2; count?: number; show: boolean }[] = [
    { key: "tables", label: "Tables", icon: Table2, count: entities?.length, show: !!hasTables },
    { key: "columns", label: "Columns", icon: Columns3, count: specimen.column_count, show: !!hasTables && isExtracted },
    { key: "preview", label: "Preview", icon: Eye, show: isExtracted && !!specimen.source_system },
    { key: "queries", label: "SQL", icon: Database, count: queries?.length, show: !!hasQueries },
  ];

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: "var(--bp-surface-1)",
        border: expanded ? "1px solid var(--bp-border-strong)" : "1px solid var(--bp-border)",
      }}
    >
      {/* Header */}
      <div
        className="w-full flex items-start gap-0 transition-colors hover:bg-black/[0.015]"
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

        <button
          type="button"
          onClick={onToggle}
          className="flex-1 min-w-0 px-3.5 py-2.5 text-left"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} specimen ${specimen.name}`}
          style={{ background: "transparent" }}
        >
          {/* Line 1: Name + type badge + source + steward + provenance */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span
              className="truncate"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontWeight: 500,
                fontSize: 13,
                color: "var(--bp-ink-primary)",
                maxWidth: 280,
              }}
            >
              {specimen.name}
            </span>

            <TypeBadge type={specimen.type} />

            {specimen.source_system && (
              <span
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5"
                style={{
                  background: "rgba(61,124,79,0.08)",
                  fontFamily: "var(--bp-font-mono)",
                  fontSize: 10,
                  fontWeight: 500,
                  color: "var(--bp-operational)",
                  letterSpacing: "0.03em",
                }}
              >
                <Database size={9} /> {specimen.source_system}
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

            {specimen.source_class && specimen.source_class !== "structural" ? (
              <SourceClassBadge sourceClass={specimen.source_class} />
            ) : specimen.provenance_phase ? (
              <ProvenanceThread phase={specimen.provenance_phase as 1|2|3|4|5|6|7} size="sm" showTooltip />
            ) : null}
          </div>

          {/* Line 2: Counts + job state badge */}
          <div className="flex items-center gap-3 mt-1">
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
        </button>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1 p-2 self-center">
          {onDelete && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(specimen.id); }}
              className="rounded-md p-1.5 transition-colors hover:bg-red-50"
              style={{ color: "var(--bp-ink-muted)" }}
              aria-label="Delete specimen"
              title="Delete specimen"
            >
              <Trash2 size={14} className="hover:text-red-500" />
            </button>
          )}
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md p-1 transition-colors hover:bg-black/[0.04]"
            aria-label={`${expanded ? "Collapse" : "Expand"} specimen details`}
            style={{ color: "var(--bp-ink-muted)" }}
          >
            <ChevronDown
              size={16}
              className="transition-transform duration-200"
              style={{
                color: "var(--bp-ink-muted)",
                transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div
          style={{
            background: "var(--bp-surface-inset)",
            borderTop: "1px solid var(--bp-border)",
          }}
        >
          {/* Inner tabs */}
          {tabs.some((t) => t.show) && (
            <div
              className="flex gap-0.5 px-4 pt-2.5"
              style={{ borderBottom: "1px solid var(--bp-border)" }}
            >
              {tabs.filter((t) => t.show).map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setInnerTab(tab.key)}
                    className={cn(
                      "pb-2 px-3 text-center transition-colors relative inline-flex items-center gap-1.5",
                      isActive
                        ? "text-[var(--bp-copper)]"
                        : "text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-secondary)]"
                    )}
                    style={{
                      fontFamily: "var(--bp-font-body)",
                      fontWeight: isActive ? 600 : 500,
                      fontSize: 12,
                    }}
                  >
                    <Icon size={12} />
                    {tab.label}
                    {tab.count != null && (
                      <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 10, opacity: 0.7 }}>
                        ({tab.count})
                      </span>
                    )}
                    {isActive && (
                      <span
                        className="absolute bottom-0 left-0 right-0"
                        style={{
                          height: 2.5,
                          background: "var(--bp-copper)",
                          borderRadius: "1px 1px 0 0",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Tables tab */}
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
                    <th className="text-left py-1.5 px-5 font-medium">Entity Name</th>
                    <th className="text-left py-1.5 px-3 font-medium">Source DB</th>
                    <th className="text-right py-1.5 px-3 font-medium">Cols</th>
                    <th className="text-left py-1.5 px-3 font-medium">Cluster</th>
                    <th className="text-left py-1.5 px-5 font-medium">Provenance</th>
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
                      <td className="py-1.5 px-5" style={{ fontWeight: 500 }}>
                        {ent.entity_name}
                      </td>
                      <td
                        className="py-1.5 px-3"
                        style={{
                          color: "var(--bp-ink-muted)",
                          fontFamily: "var(--bp-font-mono)",
                          fontSize: 12,
                        }}
                      >
                        {ent.source_database || "—"}
                      </td>
                      <td
                        className="py-1.5 px-3 text-right"
                        style={{
                          fontFamily: "var(--bp-font-mono)",
                          fontSize: 12,
                          color: "var(--bp-ink-secondary)",
                        }}
                      >
                        {ent.column_count}
                      </td>
                      <td className="py-1.5 px-3">
                        <ClusterBadge clusterId={ent.cluster_id} />
                      </td>
                      <td
                        className="py-1.5 px-5"
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

          {/* Columns tab */}
          {activeTab === "columns" && hasTables && (
            <ColumnsPanel entities={entities!} />
          )}

          {/* Preview tab */}
          {activeTab === "preview" && (
            <PreviewPanel specimenId={specimen.id} />
          )}

          {/* Queries tab */}
          {activeTab === "queries" && hasQueries && (
            <div className="flex flex-col gap-2.5 p-4">
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
                      background: "var(--bp-code-block)",
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
                padding: "24px 16px",
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
