// Column Reconciliation — Matrix for reconciling columns across cluster members inside a SlideOver.

import { useState, useMemo, useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
      // Auto-default: present in ALL → include, otherwise keep original
      const allPresent = members.every((m) => col.presence[m.id]);
      init[col.column_name] = allPresent ? "include" : col.decision;
    }
    return init;
  });

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
            style={{ background: "var(--bp-copper)", color: "#fff" }}
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

      {/* Matrix table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left" style={{ fontSize: 12 }}>
          <thead className="sticky top-0 z-[1]" style={{ background: "var(--bp-surface-1)" }}>
            <tr
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 11,
                color: "var(--bp-ink-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              <th className="pb-2 pr-2 font-medium w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAll}
                  className="accent-[#B45624]"
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
            {columns.map((col) => {
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
                    background: isReview ? "rgba(194,122,26,0.06)" : undefined,
                    borderTop: "1px solid var(--bp-border)",
                    fontFamily: "var(--bp-font-body)",
                    color: "var(--bp-ink-primary)",
                  }}
                >
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={selected.has(col.column_name)}
                      onChange={() => toggleSelect(col.column_name)}
                      className="accent-[#B45624]"
                    />
                  </td>
                  <td className="py-2 pr-3">
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
                    className="py-2 pr-3"
                    style={{ fontFamily: "var(--bp-font-mono)", fontSize: 11, color: "var(--bp-ink-muted)" }}
                  >
                    {col.data_type ?? "\u2014"}
                  </td>
                  {/* Presence cells */}
                  {members.map((m) => (
                    <td key={m.id} className="py-2 pr-3 text-center">
                      {col.presence[m.id] ? (
                        <span style={{ color: "var(--bp-operational-green)" }}>{"\u2713"}</span>
                      ) : (
                        <span style={{ color: "var(--bp-ink-muted)" }}>{"\u2014"}</span>
                      )}
                    </td>
                  ))}
                  {/* Decision dropdown */}
                  <td className="py-2 pr-3">
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
                        color: isReview ? "#C27A1A" : "var(--bp-ink-primary)",
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
                  <td className="py-2">
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
        className="shrink-0 flex items-center justify-between pt-4 mt-4"
        style={{ borderTop: "1px solid var(--bp-border)" }}
      >
        <span
          style={{
            fontFamily: "var(--bp-font-body)",
            fontSize: 12,
            color: hasUnresolved ? "#C27A1A" : "var(--bp-ink-muted)",
          }}
        >
          {hasUnresolved
            ? `${Object.values(decisions).filter((d) => d === "review").length} columns still need review`
            : "All columns resolved"}
        </span>
        <button
          type="button"
          disabled={hasUnresolved}
          onClick={handleSave}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-medium transition-colors",
            hasUnresolved ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
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
