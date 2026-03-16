import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
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

  return (
    <div className="flex flex-col h-full border-r border-border/50 bg-card/50">
      <div className="p-3 border-b border-border/30">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border/50 bg-background">
          <Search className="w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            placeholder="Filter tables..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground/40"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground/40">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : (
          categoryOrder
            .filter((cat) => grouped[cat])
            .map((cat) => {
              const isCollapsed = collapsed[cat];
              return (
                <div key={cat} className="mb-1">
                  <button
                    onClick={() => setCollapsed((p) => ({ ...p, [cat]: !p[cat] }))}
                    className="flex items-center gap-1.5 w-full px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3 h-3" />
                    ) : (
                      <ChevronDown className="w-3 h-3" />
                    )}
                    {cat}
                    <span className="ml-auto text-muted-foreground/30">{grouped[cat].length}</span>
                  </button>
                  {!isCollapsed && (
                    <div className="space-y-0.5">
                      {grouped[cat].map((t) => (
                        <button
                          key={t.name}
                          onClick={() => onSelect(t.name)}
                          className={`flex items-center justify-between w-full px-3 py-1.5 rounded-md text-xs transition-colors ${
                            selected === t.name
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-foreground/70 hover:bg-muted/50 hover:text-foreground"
                          }`}
                        >
                          <span className="truncate">{t.displayName}</span>
                          <span className="text-[10px] text-muted-foreground/30 tabular-nums ml-2">
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
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
        isTrue
          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
          : "bg-red-500/10 text-red-400 border border-red-500/20"
      }`}
    >
      {isTrue ? "Active" : "Inactive"}
    </span>
  );
}

function CellValue({ value, type }: { value: unknown; type: string }) {
  if (value == null) return <span className="text-muted-foreground/30">&mdash;</span>;
  if (type === "boolean") return <BoolBadge value={value} />;
  if (type === "number") return <span className="tabular-nums">{formatNumber(value)}</span>;
  const str = String(value);
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
      <div className="flex items-center gap-1 text-muted-foreground/50">
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
        className={`relative w-8 h-4.5 rounded-full transition-colors ${
          isChecked ? "bg-emerald-500" : "bg-muted-foreground/20"
        }`}
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
        className="w-full px-2 py-1 rounded border border-border/50 bg-background text-xs text-foreground"
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
      className="w-full px-2 py-1 rounded border border-border/50 bg-background text-xs text-foreground"
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
  const { columns, rows, editable, fkOptions } = data;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50 border-b border-border/30">
            {columns.map((col) => (
              <th
                key={col.key}
                className="text-left px-3 py-2.5 font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none"
                onClick={() => onSort(col.key)}
              >
                <div className="flex items-center gap-1">
                  {col.label}
                  {sort === col.key ? (
                    sortOrder === "asc" ? (
                      <ArrowUp className="w-3 h-3 text-primary" />
                    ) : (
                      <ArrowDown className="w-3 h-3 text-primary" />
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
            return (
              <tr
                key={pk}
                className={`border-b border-border/10 transition-colors ${
                  isEditing ? "bg-primary/5" : "hover:bg-muted/30"
                }`}
              >
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
                      <CellValue value={row[col.key]} type={col.type} />
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
                          className="p-1 rounded hover:bg-emerald-500/10 text-emerald-500 transition-colors disabled:opacity-50"
                          title="Save"
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
                          className="p-1 rounded hover:bg-red-500/10 text-red-400 transition-colors disabled:opacity-50"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => onStartEdit(pk, row as Record<string, unknown>)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground/40 hover:text-foreground transition-colors"
                        title="Edit row"
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
                colSpan={columns.length + (editable ? 1 : 0)}
                className="px-3 py-12 text-center text-muted-foreground/40 text-sm"
              >
                No data in this table
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
    <div className="flex items-center justify-between px-4 py-3 border-t border-border/30">
      <span className="text-xs text-muted-foreground/50">
        Showing {(page - 1) * perPage + 1}&ndash;{Math.min(page * perPage, total)} of{" "}
        {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-2 py-1 rounded text-xs border border-border/30 hover:bg-muted disabled:opacity-30 transition-colors"
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
              className={`px-2 py-1 rounded text-xs border transition-colors ${
                p === page
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border/30 hover:bg-muted"
              }`}
            >
              {p}
            </button>
          );
        })}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="px-2 py-1 rounded text-xs border border-border/30 hover:bg-muted disabled:opacity-30 transition-colors"
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
      className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg border text-sm animate-[fadeIn_0.2s_ease-out] ${
        type === "success"
          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
          : "bg-red-500/10 border-red-500/30 text-red-400"
      }`}
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

  // Table list
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);

  // Table data
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [tableSearch, setTableSearch] = useState("");

  // Editing
  const [editingPk, setEditingPk] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Fetch table list
  useEffect(() => {
    setTablesLoading(true);
    fetchJson<TableMeta[]>(`${API}/tables`)
      .then(setTables)
      .catch(() => {})
      .finally(() => setTablesLoading(false));
  }, []);

  // Fetch table data
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

  // Select table
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

  // Sort
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

  // Edit
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

    // Build body with only editable, changed fields
    const originalRow = tableData.rows.find((r) => String(r._pk) === editingPk);
    const body: Record<string, unknown> = {};
    for (const col of tableData.columns) {
      if (!col.editable) continue;
      const newVal = editValues[col.key];
      const oldVal = originalRow?.[col.key];
      if (newVal !== oldVal) {
        // For FK columns, send the raw value
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
      // Refresh data
      loadTableData(selectedTable, page, sort, sortOrder, tableSearch);
      // Refresh table list for updated row counts
      fetchJson<TableMeta[]>(`${API}/tables`).then(setTables);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Update failed", type: "error" });
    } finally {
      setSaving(false);
    }
  }, [editingPk, editValues, tableData, selectedTable, page, sort, sortOrder, tableSearch, loadTableData]);

  // Debounced search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      setTableSearch(searchInput);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  return (
    <div className="h-[calc(100vh-theme(spacing.12))] flex bg-background">
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
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground/40">
            <TableProperties className="w-12 h-12" />
            <p className="text-sm font-medium">Select a table to browse</p>
            <p className="text-xs">
              Browse and manage your pipeline metadata with human-readable names
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-border/30 bg-card/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <TableProperties className="w-5 h-5 text-primary" />
                  <h2 className="font-display text-lg font-semibold">
                    {tableData?.displayName || selectedTable}
                  </h2>
                  {tableData?.editable && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      Editable
                    </span>
                  )}
                  {tableData && !tableData.editable && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground border border-border/30">
                      Read Only
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground/50">
                  {tableData ? `${tableData.total.toLocaleString()} rows` : ""}
                </span>
              </div>

              {/* In-table search */}
              <div className="flex items-center gap-2 max-w-sm">
                <div className="flex items-center gap-2 flex-1 px-2.5 py-1.5 rounded-md border border-border/50 bg-background">
                  <Search className="w-3.5 h-3.5 text-muted-foreground/50" />
                  <input
                    type="text"
                    placeholder="Search rows..."
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    className="w-full text-xs bg-transparent outline-none text-foreground placeholder:text-muted-foreground/40"
                  />
                  {searchInput && (
                    <button onClick={() => setSearchInput("")}>
                      <X className="w-3 h-3 text-muted-foreground/40 hover:text-foreground" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Grid */}
            <div className="flex-1 overflow-y-auto">
              {dataLoading && !tableData ? (
                <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground/40">
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
