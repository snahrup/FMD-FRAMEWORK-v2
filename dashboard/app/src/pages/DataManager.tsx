import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, Link } from "react-router-dom";
import {
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  TableProperties,
  Pencil,
  X,
  Check,
  Lock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  MapPin,
} from "lucide-react";

// ============================================================================
// TYPES
// ============================================================================

interface TableMeta {
  name: string;
  displayName: string;
  category: string;
  rowCount: number;
  editable: boolean;
}

interface ColumnMeta {
  key: string;
  label: string;
  type: "text" | "boolean" | "number" | "datetime" | "fk";
  editable: boolean;
}

interface FkOption {
  value: number | string;
  label: string;
}

interface TableDataResponse {
  table: string;
  displayName: string;
  category: string;
  editable: boolean;
  total: number;
  page: number;
  perPage: number;
  columns: ColumnMeta[];
  rows: Record<string, unknown>[];
  fkOptions?: Record<string, FkOption[]>;
}

// ============================================================================
// HELPERS
// ============================================================================

const API = "/api/data-manager";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

async function putJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function formatNumber(n: unknown): string {
  if (n == null) return "\u2014";
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return num.toLocaleString("en-US");
}

// ============================================================================
// ENTITY TABLE DETECTION & CROSS-PAGE LINKS
// ============================================================================

/** Tables whose rows represent pipeline entities — these get cross-links to DataJourney.
 *  Names MUST match the backend TABLE_REGISTRY keys (snake_case). */
const ENTITY_TABLES = new Set([
  "lz_entities",
  "bronze_entities",
  "silver_entities",
  "entity_status",
]);

/** Given a backend table name, returns the column key that holds the LZ entity ID for Journey links.
 *  DataJourney expects `?entity={LandingzoneEntityId}` — all entity tables trace back to this. */
function getEntityIdColumn(tableName: string): string | null {
  switch (tableName) {
    case "lz_entities": return "LandingzoneEntityId";
    case "bronze_entities": return "LandingzoneEntityId";  // FK to lz_entities
    case "silver_entities": return "BronzeLayerEntityId";   // FK chain: silver→bronze→lz (needs resolve)
    case "entity_status": return "LandingzoneEntityId";
    default: return null;
  }
}

/** Given a backend table name, returns the column key for the entity's source table name */
function getEntityNameColumn(tableName: string): string | null {
  switch (tableName) {
    case "lz_entities": return "SourceName";
    case "bronze_entities": return "Name";       // Bronze uses "Name" column
    case "silver_entities": return "Name";        // Silver uses "Name" column
    case "entity_status": return "Layer";         // No name column; show layer instead
    default: return null;
  }
}

/** Status value → color mapping for status columns */
function getStatusColor(value: string): { bg: string; fg: string; label: string } {
  const v = String(value).toLowerCase().trim();
  if (["succeeded", "success", "complete", "loaded", "active"].includes(v))
    return { bg: "var(--bp-operational-light)", fg: "var(--bp-operational)", label: value };
  if (["failed", "error", "fault"].includes(v))
    return { bg: "var(--bp-fault-light)", fg: "var(--bp-fault)", label: value };
  if (["running", "in progress", "inprogress", "in_progress", "pending", "queued"].includes(v))
    return { bg: "var(--bp-warning-light, #FEF3C7)", fg: "var(--bp-warning, #92400E)", label: value };
  if (["not_started", "inactive", "disabled"].includes(v))
    return { bg: "var(--bp-surface-inset)", fg: "var(--bp-ink-muted)", label: value };
  return { bg: "var(--bp-surface-inset)", fg: "var(--bp-ink-secondary)", label: value };
}

/** Check if a column name looks like a status column */
function isStatusColumn(colKey: string): boolean {
  const k = colKey.toLowerCase();
  return k === "status" || k.endsWith("status") || k === "loadstatus" || k === "runstatus" || k === "pipelinestatus";
}

/** Category-specific empty states */
const CATEGORY_EMPTY_MESSAGES: Record<string, string> = {
  "Source Systems": "No source systems registered yet. Use the Source Manager to onboard your first data source.",
  "Data Entities": "No entities found. Register entities through the Source Manager or deploy script.",
  "Load Status": "No load records yet. Run a pipeline to see load status data here.",
  "Run History": "No pipeline runs recorded. Execute a pipeline to populate run history.",
  "Pipeline Queues": "Queue is empty — no pending pipeline operations.",
  "Audit Trail": "No audit entries. Activity will appear here as pipelines execute.",
};

// ============================================================================
// SIDEBAR
// ============================================================================

function Sidebar({
  tables,
  selected,
  onSelect,
  loading,
}: {
  tables: TableMeta[];
  selected: string;
  onSelect: (name: string) => void;
  loading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    if (!search.trim()) return tables;
    const q = search.toLowerCase();
    return tables.filter((t) => t.displayName.toLowerCase().includes(q));
  }, [tables, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, TableMeta[]> = {};
    filtered.forEach((t) => {
      (groups[t.category] ||= []).push(t);
    });
    return groups;
  }, [filtered]);

  const categoryOrder = [
    "Source Systems",
    "Data Entities",
    "Load Status",
    "Run History",
    "Pipeline Queues",
    "Audit Trail",
  ];

  // Compute per-category stats
  const categoryStats = useMemo(() => {
    const stats: Record<string, { tables: number; totalRows: number }> = {};
    for (const cat of categoryOrder) {
      const catTables = grouped[cat] || [];
      stats[cat] = {
        tables: catTables.length,
        totalRows: catTables.reduce((sum, t) => sum + t.rowCount, 0),
      };
    }
    return stats;
  }, [grouped]);

  return (
    <div className="flex flex-col h-full" style={{ borderRight: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-2)" }}>
      <div className="p-3" style={{ borderBottom: "1px solid var(--bp-border)" }}>
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
          <Search className="w-3.5 h-3.5" style={{ color: "var(--bp-ink-muted)" }} />
          <input
            type="text"
            placeholder="Filter tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs bg-transparent outline-none"
            style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8" style={{ color: "var(--bp-ink-muted)" }}>
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : (
          categoryOrder
            .filter((cat) => grouped[cat])
            .map((cat) => {
              const isCollapsed = collapsed[cat];
              const stats = categoryStats[cat];
              return (
                <div key={cat} className="mb-1">
                  <button
                    onClick={() => setCollapsed((p) => ({ ...p, [cat]: !p[cat] }))}
                    className="flex items-center gap-1.5 w-full px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest transition-colors"
                    style={{ color: "var(--bp-ink-muted)" }}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                    <span className="flex-1 text-left">{cat}</span>
                    <span
                      className="text-[9px] font-normal normal-case tracking-normal"
                      style={{ fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--bp-ink-muted)", opacity: 0.6 }}
                    >
                      {stats.tables} · {stats.totalRows.toLocaleString()}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-0.5">
                      {grouped[cat].map((t) => (
                        <button
                          key={t.name}
                          onClick={() => onSelect(t.name)}
                          className="flex items-center justify-between w-full px-3 py-1.5 rounded-md text-xs transition-colors"
                          style={
                            selected === t.name
                              ? { backgroundColor: "var(--bp-copper-light)", color: "var(--bp-copper)", fontWeight: 500 }
                              : { color: "var(--bp-ink-secondary)" }
                          }
                        >
                          <span className="truncate">{t.displayName}</span>
                          <span className="text-[10px] ml-2" style={{ fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--bp-ink-muted)", opacity: 0.5 }}>
                            {t.rowCount.toLocaleString()}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}

// ============================================================================
// DATA GRID
// ============================================================================

function BoolBadge({ value }: { value: unknown }) {
  const isTrue = value === true || value === 1 || value === "1";
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium"
      style={
        isTrue
          ? { backgroundColor: "var(--bp-operational-light)", color: "var(--bp-operational)", border: "1px solid rgba(61,124,79,0.2)" }
          : { backgroundColor: "var(--bp-fault-light)", color: "var(--bp-fault)", border: "1px solid rgba(185,58,42,0.2)" }
      }
    >
      {isTrue ? "Active" : "Inactive"}
    </span>
  );
}

function CellValue({ value, type, colKey }: { value: unknown; type: string; colKey?: string }) {
  if (value == null) return <span style={{ color: "var(--bp-ink-muted)", opacity: 0.3 }}>&mdash;</span>;
  if (type === "boolean") return <BoolBadge value={value} />;
  if (type === "number") return <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatNumber(value)}</span>;
  const str = String(value);
  // Render status columns with colored badge
  if (colKey && isStatusColumn(colKey) && str.trim()) {
    const sc = getStatusColor(str);
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
        style={{ backgroundColor: sc.bg, color: sc.fg }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sc.fg }} />
        {sc.label}
      </span>
    );
  }
  if (str.length > 100) {
    return (
      <span title={str} className="cursor-help">
        {str.slice(0, 97)}...
      </span>
    );
  }
  return <>{str}</>;
}

function EditCell({
  col,
  value,
  rawValue,
  fkOptions,
  onChange,
}: {
  col: ColumnMeta;
  value: unknown;
  rawValue: unknown;
  fkOptions?: FkOption[];
  onChange: (val: unknown) => void;
}) {
  if (!col.editable) {
    return (
      <div className="flex items-center gap-1" style={{ color: "var(--bp-ink-muted)" }}>
        <CellValue value={value} type={col.type} />
        <Lock className="w-3 h-3 opacity-40" />
      </div>
    );
  }

  if (col.type === "boolean") {
    const isChecked = value === true || value === 1 || value === "1";
    return (
      <button
        onClick={() => onChange(!isChecked)}
        className="relative w-8 h-4.5 rounded-full transition-colors"
        style={{ backgroundColor: isChecked ? "var(--bp-operational)" : "var(--bp-ink-muted)" }}
      >
        <span
          className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${
            isChecked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    );
  }

  if (col.type === "fk" && fkOptions) {
    return (
      <select
        value={String(rawValue ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1 rounded text-xs"
        style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }}
      >
        <option value="">-- Select --</option>
        {fkOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      type="text"
      value={String(value ?? "")}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1 rounded text-xs"
      style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }}
    />
  );
}

function DataGrid({
  data,
  sort,
  sortOrder,
  onSort,
  editingPk,
  editValues,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onEditChange,
  saving,
}: {
  data: TableDataResponse;
  sort: string;
  sortOrder: "asc" | "desc";
  onSort: (col: string) => void;
  editingPk: string | null;
  editValues: Record<string, unknown>;
  onStartEdit: (pk: string, row: Record<string, unknown>) => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditChange: (key: string, val: unknown) => void;
  saving: boolean;
}) {
  const { columns, rows, editable, fkOptions, table, category } = data;
  const isEntityTable = ENTITY_TABLES.has(table);
  const entityIdCol = isEntityTable ? getEntityIdColumn(table) : null;
  const entityNameCol = isEntityTable ? getEntityNameColumn(table) : null;
  const emptyMessage = CATEGORY_EMPTY_MESSAGES[category] || "No data in this table";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ fontFamily: "var(--bp-font-mono)" }}>
        <thead>
          <tr style={{ backgroundColor: "var(--bp-surface-inset)", borderBottom: "1px solid var(--bp-border)" }}>
            {isEntityTable && (
              <th className="w-8 px-2 py-2.5" title="Open in Data Journey" />
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className="text-left px-3 py-2.5 font-medium cursor-pointer transition-colors select-none"
                style={{ color: "var(--bp-ink-secondary)" }}
                onClick={() => onSort(col.key)}
              >
                <div className="flex items-center gap-1">
                  {col.label}
                  {sort === col.key ? (
                    sortOrder === "asc" ? (
                      <ArrowUp className="w-3 h-3" style={{ color: "var(--bp-copper)" }} />
                    ) : (
                      <ArrowDown className="w-3 h-3" style={{ color: "var(--bp-copper)" }} />
                    )
                  ) : (
                    <ArrowUpDown className="w-3 h-3 opacity-20" />
                  )}
                </div>
              </th>
            ))}
            {editable && <th className="w-20 px-3 py-2.5" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const pk = String(row._pk);
            const isEditing = editingPk === pk;
            const entityId = entityIdCol ? row[entityIdCol] : null;
            const entityName = entityNameCol ? String(row[entityNameCol] ?? "") : "";
            return (
              <tr
                key={pk}
                className="transition-colors"
                style={{
                  borderBottom: "1px solid rgba(0,0,0,0.04)",
                  backgroundColor: isEditing ? "var(--bp-copper-light)" : undefined,
                }}
              >
                {isEntityTable && (
                  <td className="px-2 py-2">
                    {entityId != null ? (
                      <Link
                        to={`/journey?entity=${encodeURIComponent(String(entityId))}`}
                        title={`View ${entityName || 'entity'} in Data Journey`}
                        className="inline-flex items-center justify-center w-5 h-5 rounded transition-colors"
                        style={{ color: "var(--bp-copper)" }}
                      >
                        <MapPin className="w-3.5 h-3.5" />
                      </Link>
                    ) : null}
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-2 max-w-[300px]">
                    {isEditing ? (
                      <EditCell
                        col={col}
                        value={editValues[col.key] ?? row[col.key]}
                        rawValue={editValues[`_raw_${col.key}`] ?? row[`_raw_${col.key}`]}
                        fkOptions={fkOptions?.[col.key]}
                        onChange={(val) => onEditChange(col.key, val)}
                      />
                    ) : (
                      <CellValue value={row[col.key]} type={col.type} colKey={col.key} />
                    )}
                  </td>
                ))}
                {editable && (
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={onSaveEdit}
                          disabled={saving}
                          className="p-1 rounded transition-colors disabled:opacity-50"
                          title="Save"
                          style={{ color: "var(--bp-operational)" }}
                        >
                          {saving ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Check className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={onCancelEdit}
                          disabled={saving}
                          className="p-1 rounded transition-colors disabled:opacity-50"
                          title="Cancel"
                          style={{ color: "var(--bp-fault)" }}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => onStartEdit(pk, row as Record<string, unknown>)}
                        className="p-1 rounded transition-colors"
                        title="Edit row"
                        style={{ color: "var(--bp-ink-muted)" }}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columns.length + (editable ? 1 : 0) + (isEntityTable ? 1 : 0)}
                className="px-6 py-12 text-center"
                style={{ color: "var(--bp-ink-muted)" }}
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium">{emptyMessage}</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// PAGINATION
// ============================================================================

function Pagination({
  page,
  perPage,
  total,
  onPageChange,
}: {
  page: number;
  perPage: number;
  total: number;
  onPageChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between px-4 py-3" style={{ borderTop: "1px solid var(--bp-border)" }}>
      <span className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>
        Showing {(page - 1) * perPage + 1}&ndash;{Math.min(page * perPage, total)} of{" "}
        {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-30"
          style={{ border: "1px solid var(--bp-border)" }}
        >
          Prev
        </button>
        {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
          let p: number;
          if (totalPages <= 7) {
            p = i + 1;
          } else if (page <= 4) {
            p = i + 1;
          } else if (page >= totalPages - 3) {
            p = totalPages - 6 + i;
          } else {
            p = page - 3 + i;
          }
          return (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className="px-2 py-1 rounded text-xs transition-colors"
              style={
                p === page
                  ? { backgroundColor: "var(--bp-copper)", color: "#fff", border: "1px solid var(--bp-copper)" }
                  : { border: "1px solid var(--bp-border)" }
              }
            >
              {p}
            </button>
          );
        })}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-2 py-1 rounded text-xs transition-colors disabled:opacity-30"
          style={{ border: "1px solid var(--bp-border)" }}
        >
          Next
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// TOAST
// ============================================================================

function Toast({ message, type, onDismiss }: { message: string; type: "success" | "error"; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className="fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg text-sm animate-[fadeIn_0.2s_ease-out]"
      style={
        type === "success"
          ? { backgroundColor: "var(--bp-operational-light)", border: "1px solid rgba(61,124,79,0.3)", color: "var(--bp-operational)" }
          : { backgroundColor: "var(--bp-fault-light)", border: "1px solid rgba(185,58,42,0.3)", color: "var(--bp-fault)" }
      }
    >
      {message}
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function DataManager() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTable = searchParams.get("table") || "";

  const [tables, setTables] = useState<TableMeta[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [tableSearch, setTableSearch] = useState("");
  const [editingPk, setEditingPk] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    setTablesLoading(true);
    fetchJson<TableMeta[]>(`${API}/tables`)
      .then(setTables)
      .catch(() => {})
      .finally(() => setTablesLoading(false));
  }, []);

  const loadTableData = useCallback(
    async (tableName: string, p: number, s: string, so: string, search: string) => {
      if (!tableName) return;
      setDataLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(p),
          per_page: "50",
        });
        if (s) params.set("sort", s);
        if (so) params.set("order", so);
        if (search) params.set("search", search);
        const data = await fetchJson<TableDataResponse>(`${API}/table/${tableName}?${params}`);
        setTableData(data);
      } catch {
        setTableData(null);
      } finally {
        setDataLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (selectedTable) {
      loadTableData(selectedTable, page, sort, sortOrder, tableSearch);
    } else {
      setTableData(null);
    }
  }, [selectedTable, page, sort, sortOrder, tableSearch, loadTableData]);

  const selectTable = useCallback(
    (name: string) => {
      setSearchParams({ table: name }, { replace: true });
      setPage(1);
      setSort("");
      setSortOrder("asc");
      setTableSearch("");
      setEditingPk(null);
    },
    [setSearchParams]
  );

  const handleSort = useCallback(
    (col: string) => {
      if (sort === col) {
        setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
      } else {
        setSort(col);
        setSortOrder("asc");
      }
      setPage(1);
    },
    [sort]
  );

  const startEdit = useCallback((pk: string, row: Record<string, unknown>) => {
    setEditingPk(pk);
    setEditValues({ ...row });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingPk(null);
    setEditValues({});
  }, []);

  const handleEditChange = useCallback((key: string, val: unknown) => {
    setEditValues((prev) => ({ ...prev, [key]: val }));
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingPk || !tableData) return;
    setSaving(true);

    const originalRow = tableData.rows.find((r) => String(r._pk) === editingPk);
    const body: Record<string, unknown> = {};
    for (const col of tableData.columns) {
      if (!col.editable) continue;
      const newVal = editValues[col.key];
      const oldVal = originalRow?.[col.key];
      if (newVal !== oldVal) {
        if (col.type === "fk") {
          body[col.key] = editValues[col.key];
        } else {
          body[col.key] = newVal;
        }
      }
    }

    if (Object.keys(body).length === 0) {
      setEditingPk(null);
      setEditValues({});
      setSaving(false);
      return;
    }

    try {
      await putJson(`${API}/table/${tableData.table}/${editingPk}`, body);
      setToast({ message: "Row updated successfully", type: "success" });
      setEditingPk(null);
      setEditValues({});
      loadTableData(selectedTable, page, sort, sortOrder, tableSearch);
      fetchJson<TableMeta[]>(`${API}/tables`).then(setTables);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Update failed", type: "error" });
    } finally {
      setSaving(false);
    }
  }, [editingPk, editValues, tableData, selectedTable, page, sort, sortOrder, tableSearch, loadTableData]);

  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setTableSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  return (
    <div className="h-[calc(100vh-theme(spacing.12))] flex" style={{ backgroundColor: "var(--bp-canvas)" }}>
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0">
        <Sidebar
          tables={tables}
          selected={selectedTable}
          onSelect={selectTable}
          loading={tablesLoading}
        />
      </div>

      {/* Main Panel */}
      <div className="flex-1 flex flex-col min-w-0">
        {!selectedTable ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3" style={{ color: "var(--bp-ink-muted)" }}>
            <TableProperties className="w-12 h-12" />
            <p className="text-sm font-medium">Select a table to browse</p>
            <p className="text-xs">
              Browse and manage your pipeline metadata with human-readable names
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex-shrink-0 px-6 py-4" style={{ borderBottom: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <TableProperties className="w-5 h-5" style={{ color: "var(--bp-copper)" }} />
                  <h2 style={{ fontFamily: "var(--bp-font-display)", fontSize: "18px", fontWeight: 600, color: "var(--bp-ink-primary)" }}>
                    {tableData?.displayName || selectedTable}
                  </h2>
                  {tableData?.editable && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: "var(--bp-operational-light)", color: "var(--bp-operational)", border: "1px solid rgba(61,124,79,0.2)" }}>
                      Editable
                    </span>
                  )}
                  {tableData && !tableData.editable && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: "var(--bp-surface-inset)", color: "var(--bp-ink-muted)", border: "1px solid var(--bp-border)" }}>
                      Read Only
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {tableData && ENTITY_TABLES.has(tableData.table) && (
                    <Link
                      to="/journey"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
                      style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
                    >
                      <MapPin className="h-3 w-3" /> Data Journey
                      <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                    </Link>
                  )}
                  <span className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>
                    {tableData ? `${tableData.total.toLocaleString()} rows` : ""}
                  </span>
                </div>
              </div>

              {/* In-table search */}
              <div className="flex items-center gap-2 max-w-sm">
                <div className="flex items-center gap-2 flex-1 px-2.5 py-1.5 rounded-md" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
                  <Search className="w-3.5 h-3.5" style={{ color: "var(--bp-ink-muted)" }} />
                  <input
                    type="text"
                    placeholder="Search rows..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="w-full text-xs bg-transparent outline-none"
                    style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
                  />
                  {searchInput && (
                    <button onClick={() => setSearchInput("")}>
                      <X className="w-3 h-3" style={{ color: "var(--bp-ink-muted)" }} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto">
              {dataLoading && !tableData ? (
                <div className="flex items-center justify-center py-16 gap-2" style={{ color: "var(--bp-ink-muted)" }}>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">Loading...</span>
                </div>
              ) : tableData ? (
                <DataGrid
                  data={tableData}
                  sort={sort}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                  editingPk={editingPk}
                  editValues={editValues}
                  onStartEdit={startEdit}
                  onCancelEdit={cancelEdit}
                  onSaveEdit={saveEdit}
                  onEditChange={handleEditChange}
                  saving={saving}
                />
              ) : null}
            </div>

            {/* Pagination */}
            {tableData && (
              <Pagination
                page={tableData.page}
                perPage={tableData.perPage}
                total={tableData.total}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </div>

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />}
    </div>
  );
}
