// Column Reconciliation — Matrix for reconciling columns across cluster members inside a SlideOver.
// Spec: docs/superpowers/specs/2026-03-18-gold-studio-design.md § B

import { useState, useMemo, useCallback } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

interface ColumnEntry {
  column_name: string;
  data_type: string | null;
  presence: Record<number, boolean>;
  decision: "include" | "exclude" | "review";
  key_designation: "pk" | "bk" | "fk" | "none" | null;
  source_expression?: Record<number, string>;
}

interface MemberRef {
  id: number;
  entity_name: string;
}

interface ColumnReconciliationProps {
  clusterId: number;
  columns: ColumnEntry[];
  members: MemberRef[];
  onSave: (
    decisions: Array<{ column_name: string; decision: string; key_designation: string | null }>
  ) => void;
}

type Decision = "include" | "exclude" | "review";
type KeyDesignation = "pk" | "bk" | "fk" | "none";

const DECISION_OPTIONS: { value: Decision; label: string }[] = [
  { value: "include", label: "Include" },
  { value: "exclude", label: "Exclude" },
  { value: "review", label: "Review" },
];

const KEY_OPTIONS: { value: KeyDesignation; label: string }[] = [
  { value: "pk", label: "PK" },
  { value: "bk", label: "BK" },
  { value: "fk", label: "FK" },
  { value: "none", label: "None" },
];

export function ColumnReconciliation({
  clusterId,
  columns,
  members,
  onSave,
}: ColumnReconciliationProps) {
  // Local state: decisions and key designations per column
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => {
    const init: Record<string, Decision> = {};
    for (const col of columns) {
      const presentCount = members.filter((m) => col.presence[m.id]).length;
      const allPresent = presentCount === members.length;
      // Auto-default: present in ALL → include; present in only ONE → review (needs steward decision); otherwise keep original
      if (allPresent) {
        init[col.column_name] = "include";
      } else if (presentCount <= 1 && members.length > 1) {
        init[col.column_name] = "review";
      } else {
        init[col.column_name] = col.decision;
      }
    }
    return init;
  });

  // Quick filter: show only Review columns
  const [showOnlyReview, setShowOnlyReview] = useState(false);

  // Sort column
  const [sortBy, setSortBy] = useState<"name" | "decision">("name");

  const [keys, setKeys] = useState<Record<string, KeyDesignation>>(() => {
    const init: Record<string, KeyDesignation> = {};
    for (const col of columns) {
      init[col.column_name] = (col.key_designation as KeyDesignation) ?? "none";
    }
    return init;
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedExpr, setExpandedExpr] = useState<Set<string>>(new Set());

  const hasUnresolved = useMemo(
    () => Object.values(decisions).some((d) => d === "review"),
    [decisions]
  );

  const reviewCount = useMemo(
    () => Object.values(decisions).filter((d) => d === "review").length,
    [decisions]
  );

  // PK conflict detection — warn if multiple columns designated as PK
  const pkConflict = useMemo(() => {
    const pkCols = Object.entries(keys)
      .filter(([name, k]) => k === "pk" && decisions[name] === "include")
      .map(([name]) => name);
    return pkCols.length > 1 ? pkCols : null;
  }, [keys, decisions]);

  // Filtered and sorted columns for display
  const displayColumns = useMemo(() => {
    let cols = showOnlyReview
      ? columns.filter((c) => decisions[c.column_name] === "review")
      : columns;
    if (sortBy === "decision") {
      const order: Record<string, number> = { review: 0, include: 1, exclude: 2 };
      cols = [...cols].sort(
        (a, b) => (order[decisions[a.column_name]] ?? 1) - (order[decisions[b.column_name]] ?? 1)
      );
    } else {
      cols = [...cols].sort((a, b) => a.column_name.localeCompare(b.column_name));
    }
    return cols;
  }, [columns, decisions, showOnlyReview, sortBy]);

  const allSelected = selected.size === columns.length;

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(columns.map((c) => c.column_name)));
    }
  }, [allSelected, columns]);

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const bulkSetDecision = useCallback(
    (d: Decision) => {
      setDecisions((prev) => {
        const next = { ...prev };
        for (const name of selected) next[name] = d;
        return next;
      });
    },
    [selected]
  );

  const handleSave = useCallback(() => {
    onSave(
      columns.map((col) => ({
        column_name: col.column_name,
        decision: decisions[col.column_name],
        key_designation:
          decisions[col.column_name] === "include" ? keys[col.column_name] : null,
      }))
    );
  }, [columns, decisions, keys, onSave]);

  return (
    <div className="flex flex-col h-full">
      {/* Bulk toolbar */}
      {selected.size > 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2 mb-3 rounded-md"
          style={{ background: "var(--bp-copper-soft)" }}
        >
          <span
            style={{
              fontFamily: "var(--bp-font-body)",
              fontSize: 12,
              color: "var(--bp-copper)",
              fontWeight: 500,
            }}
          >
            {selected.size} selected
          </span>
          <button
            type="button"
            onClick={() => bulkSetDecision("include")}
            className="rounded px-2 py-0.5 text-xs font-medium transition-colors hover:opacity-80"
            style={{ background: "var(--bp-copper)", color: "var(--bp-surface-1)" }}
          >
            Set Include
          </button>
          <button
            type="button"
            onClick={() => bulkSetDecision("exclude")}
            className="rounded px-2 py-0.5 text-xs font-medium transition-colors hover:bg-black/5"
            style={{
              color: "var(--bp-ink-secondary)",
              border: "1px solid var(--bp-border)",
            }}
          >
            Set Exclude
          </button>
        </div>
      )}

      {/* Quick filter & PK warning bar */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <button
          type="button"
          onClick={() => setShowOnlyReview(!showOnlyReview)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            showOnlyReview ? "opacity-100" : "opacity-60 hover:opacity-80"
          )}
          style={{
            fontFamily: "var(--bp-font-body)",
            color: showOnlyReview ? "var(--bp-caution-amber)" : "var(--bp-ink-muted)",
            background: showOnlyReview ? "var(--bp-caution-light)" : "var(--bp-surface-inset)",
            border: `1px solid ${showOnlyReview ? "rgba(194,122,26,0.3)" : "var(--bp-border)"}`,
          }}
        >
          <Filter size={12} />
          Show Review Only ({reviewCount})
        </button>
        <button
          type="button"
          onClick={() => setSortBy(sortBy === "name" ? "decision" : "name")}
          className="rounded-md px-2.5 py-1 text-xs transition-colors hover:bg-black/5"
          style={{
            fontFamily: "var(--bp-font-body)",
            color: "var(--bp-ink-muted)",
            border: "1px solid var(--bp-border)",
          }}
        >
          Sort: {sortBy === "name" ? "A-Z" : "By Decision"}
        </button>
        {pkConflict && (
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium"
            style={{
              fontFamily: "var(--bp-font-body)",
              color: "var(--bp-copper)",
              background: "var(--bp-copper-soft)",
              border: "1px solid rgba(180,86,36,0.2)",
            }}
          >
            <AlertTriangle size={12} />
            Multiple PK columns: {pkConflict.join(", ")}
          </span>
        )}
      </div>

      {/* Matrix table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left" style={{ fontSize: 12 }}>
          <thead className="sticky top-0 z-[1]" style={{ background: "var(--bp-surface-1)" }}>
            <tr
              style={{
                fontFamily: "var(--bp-font-mono)",
                fontSize: 10,
                color: "var(--bp-ink-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                borderBottom: "2px solid var(--bp-border)",
              }}
            >
              <th className="pb-2 pr-2 font-medium w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  style={{ accentColor: "var(--bp-copper)" }}
                />
              </th>
              <th className="pb-2 pr-3 font-medium">Column</th>
              <th className="pb-2 pr-3 font-medium">Type</th>
              {members.map((m) => (
                <th key={m.id} className="pb-2 pr-3 font-medium text-center" title={m.entity_name}>
                  {m.entity_name.length > 14
                    ? m.entity_name.slice(0, 12) + "\u2026"
                    : m.entity_name}
                </th>
              ))}
              <th className="pb-2 pr-3 font-medium">Decision</th>
              <th className="pb-2 font-medium">Key</th>
            </tr>
          </thead>
          <tbody>
            {displayColumns.map((col) => {
              const dec = decisions[col.column_name];
              const isReview = dec === "review";
              const hasExpr =
                col.source_expression &&
                Object.keys(col.source_expression).length > 0;
              const exprOpen = expandedExpr.has(col.column_name);

              return (
                <tr
                  key={col.column_name}
                  className={cn("transition-colors", isReview && "relative")}
                  style={{
                    background: isReview ? "var(--bp-caution-light)" : undefined,
                    borderTop: "1px solid var(--bp-border)",
                    fontFamily: "var(--bp-font-body)",
                    color: "var(--bp-ink-primary)",
                  }}
                >
                  <td className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.has(col.column_name)}
                      onChange={() => toggleSelect(col.column_name)}
                      style={{ accentColor: "var(--bp-copper)" }}
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-1">
                      {hasExpr && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedExpr((prev) => {
                              const next = new Set(prev);
                              if (next.has(col.column_name)) next.delete(col.column_name);
                              else next.add(col.column_name);
                              return next;
                            })
                          }
                          className="shrink-0"
                          style={{ color: "var(--bp-ink-muted)" }}
                        >
                          {exprOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                      )}
                      <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 12 }}>
                        {col.column_name}
                      </span>
                    </div>
                    {/* Inline source expression preview — visible without expanding */}
                    {hasExpr && !exprOpen && (() => {
                      const entries = Object.entries(col.source_expression!);
                      const first = entries[0];
                      if (!first) return null;
                      const member = members.find((m) => String(m.id) === first[0]);
                      return (
                        <span
                          className="ml-2"
                          style={{
                            fontFamily: "var(--bp-font-mono)",
                            fontSize: 10,
                            color: "var(--bp-ink-muted)",
                          }}
                          title={`${entries.length} source expression${entries.length > 1 ? "s" : ""}`}
                        >
                          {member?.entity_name ?? first[0]}: {first[1].length > 30 ? first[1].slice(0, 28) + "\u2026" : first[1]}
                          {entries.length > 1 && ` +${entries.length - 1}`}
                        </span>
                      );
                    })()}
                    {/* Expanded source expressions */}
                    {hasExpr && exprOpen && (
                      <div className="mt-1 pl-5 space-y-0.5">
                        {Object.entries(col.source_expression!).map(([eid, expr]) => {
                          const member = members.find((m) => String(m.id) === eid);
                          return (
                            <div
                              key={eid}
                              style={{
                                fontFamily: "var(--bp-font-mono)",
                                fontSize: 11,
                                color: "var(--bp-ink-muted)",
                              }}
                            >
                              <span style={{ color: "var(--bp-ink-secondary)" }}>
                                {member?.entity_name ?? eid}:
                              </span>{" "}
                              {expr}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td
                    className="py-1.5 pr-3"
                    style={{ fontFamily: "var(--bp-font-mono)", fontSize: 11, color: "var(--bp-ink-muted)" }}
                  >
                    {col.data_type ?? "\u2014"}
                  </td>
                  {/* Presence cells */}
                  {members.map((m) => (
                    <td key={m.id} className="py-1.5 pr-3 text-center">
                      {col.presence[m.id] ? (
                        <span style={{ color: "var(--bp-operational-green)" }}>{"\u2713"}</span>
                      ) : (
                        <span style={{ color: "var(--bp-ink-muted)" }}>{"\u2014"}</span>
                      )}
                    </td>
                  ))}
                  {/* Decision dropdown */}
                  <td className="py-1.5 pr-3">
                    <select
                      value={dec}
                      onChange={(e) =>
                        setDecisions((prev) => ({
                          ...prev,
                          [col.column_name]: e.target.value as Decision,
                        }))
                      }
                      className="rounded px-1.5 py-0.5 text-xs outline-none"
                      style={{
                        fontFamily: "var(--bp-font-body)",
                        color: isReview ? "var(--bp-caution-amber)" : "var(--bp-ink-primary)",
                        background: "var(--bp-surface-inset)",
                        border: "1px solid var(--bp-border)",
                      }}
                    >
                      {DECISION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {/* Key dropdown */}
                  <td className="py-1.5">
                    {dec === "include" ? (
                      <select
                        value={keys[col.column_name]}
                        onChange={(e) =>
                          setKeys((prev) => ({
                            ...prev,
                            [col.column_name]: e.target.value as KeyDesignation,
                          }))
                        }
                        className="rounded px-1.5 py-0.5 text-xs outline-none"
                        style={{
                          fontFamily: "var(--bp-font-body)",
                          color: "var(--bp-ink-primary)",
                          background: "var(--bp-surface-inset)",
                          border: "1px solid var(--bp-border)",
                        }}
                      >
                        {KEY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ color: "var(--bp-ink-muted)", fontSize: 11 }}>{"\u2014"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        className="shrink-0 flex items-center justify-between pt-3 mt-3"
        style={{ borderTop: "2px solid var(--bp-border)" }}
      >
        <div className="flex items-center gap-3">
          <span
            style={{
              fontFamily: "var(--bp-font-mono)",
              fontSize: 11,
              letterSpacing: "0.02em",
              color: hasUnresolved ? "var(--bp-caution-amber)" : "var(--bp-operational-green)",
              fontWeight: 500,
            }}
          >
            {hasUnresolved
              ? `${reviewCount} column${reviewCount !== 1 ? "s" : ""} need review`
              : "\u2713 All columns resolved"}
          </span>
          <span
            style={{
              fontFamily: "var(--bp-font-mono)",
              fontSize: 10,
              color: "var(--bp-ink-muted)",
            }}
          >
            {columns.length} total \u00b7{" "}
            {Object.values(decisions).filter((d) => d === "include").length} include \u00b7{" "}
            {Object.values(decisions).filter((d) => d === "exclude").length} exclude
          </span>
        </div>
        <button
          type="button"
          disabled={hasUnresolved}
          onClick={handleSave}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            hasUnresolved ? "opacity-40 cursor-not-allowed" : "hover:opacity-90"
          )}
          style={{
            fontFamily: "var(--bp-font-body)",
            color: "#fff",
            background: hasUnresolved ? "var(--bp-ink-muted)" : "var(--bp-copper)",
          }}
        >
          Save Decisions
        </button>
      </div>
    </div>
  );
}
