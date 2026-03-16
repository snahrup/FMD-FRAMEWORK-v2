import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Database,
  Table2,
  Search,
  Play,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Terminal,
  Loader2,
  AlertCircle,
} from "lucide-react";

/* ---------- types ---------- */

interface TableInfo {
  name: string;
  row_count: number;
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface TableDataResponse {
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  per_page: number;
}

interface QueryResponse {
  rows: Record<string, unknown>[];
  count: number;
}

/* ---------- helpers ---------- */

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

/* ---------- component ---------- */

type Tab = "data" | "schema" | "query";

export default function DatabaseExplorer() {
  /* ---- table list ---- */
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);

  /* ---- selected table ---- */
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("data");

  /* ---- data tab ---- */
  const [tableData, setTableData] = useState<TableDataResponse | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [page, setPage] = useState(1);
  const perPage = 50;

  /* ---- schema tab ---- */
  const [schema, setSchema] = useState<ColumnInfo[]>([]);
  const [schemaLoading, setSchemaLoading] = useState(false);

  /* ---- query tab ---- */
  const [sql, setSql] = useState("");
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [queryLoading, setQueryLoading] = useState(false);

  /* ---- errors ---- */
  const [error, setError] = useState<string | null>(null);

  /* ---- search ---- */
  const [search, setSearch] = useState("");

  /* ---- load table list ---- */
  const loadTables = useCallback(async () => {
    setTablesLoading(true);
    setError(null);
    try {
      const data = await fetchJson<TableInfo[]>("/api/db-explorer/tables");
      setTables(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTablesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTables();
  }, [loadTables]);

  /* ---- load table data ---- */
  const loadData = useCallback(
    async (table: string, p: number) => {
      setDataLoading(true);
      setError(null);
      try {
        const data = await fetchJson<TableDataResponse>(
          `/api/db-explorer/table/${encodeURIComponent(table)}?page=${p}&per_page=${perPage}`
        );
        setTableData(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setDataLoading(false);
      }
    },
    [perPage]
  );

  /* ---- load schema ---- */
  const loadSchema = useCallback(async (table: string) => {
    setSchemaLoading(true);
    setError(null);
    try {
      const data = await fetchJson<ColumnInfo[]>(
        `/api/db-explorer/table/${encodeURIComponent(table)}/schema`
      );
      setSchema(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  /* ---- select table ---- */
  const selectTable = useCallback(
    (name: string) => {
      setSelected(name);
      setPage(1);
      setTab("data");
      setQueryResult(null);
      setSql(`SELECT * FROM [${name}] LIMIT 100`);
      loadData(name, 1);
      loadSchema(name);
    },
    [loadData, loadSchema]
  );

  /* ---- pagination ---- */
  const totalPages = tableData ? Math.ceil(tableData.total / perPage) : 0;

  const goPage = useCallback(
    (p: number) => {
      if (!selected || p < 1 || p > totalPages) return;
      setPage(p);
      loadData(selected, p);
    },
    [selected, totalPages, loadData]
  );

  /* ---- run query ---- */
  const runQuery = useCallback(async () => {
    if (!sql.trim()) return;
    setQueryLoading(true);
    setError(null);
    try {
      const data = await fetchJson<QueryResponse>("/api/db-explorer/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: sql.trim() }),
      });
      setQueryResult(data);
    } catch (e) {
      setError((e as Error).message);
      setQueryResult(null);
    } finally {
      setQueryLoading(false);
    }
  }, [sql]);

  /* ---- filtered tables ---- */
  const filteredTables = useMemo(() => {
    if (!search) return tables;
    const q = search.toLowerCase();
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, search]);

  /* ---- total row count ---- */
  const totalRows = useMemo(
    () => tables.reduce((sum, t) => sum + t.row_count, 0),
    [tables]
  );

  /* ---- render data grid ---- */
  const renderDataGrid = (rows: Record<string, unknown>[]) => {
    if (!rows.length)
      return <p className="text-sm text-muted-foreground p-4">No rows</p>;
    const cols = Object.keys(rows[0]);
    return (
      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {cols.map((c) => (
                <th
                  key={c}
                  className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className="border-b last:border-0 hover:bg-muted/30 transition-colors"
              >
                {cols.map((c) => (
                  <td
                    key={c}
                    className="px-3 py-1.5 whitespace-nowrap max-w-[300px] truncate"
                    title={String(row[c] ?? "")}
                  >
                    {row[c] === null ? (
                      <span className="text-muted-foreground/50 italic">
                        NULL
                      </span>
                    ) : (
                      String(row[c])
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  /* ================================================================ */

  return (
    <div className="space-y-6">
      {/* ---- header ---- */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold flex items-center gap-2">
            <Database className="h-5 w-5" />
            Database Explorer
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse SQLite tables, inspect schemas, and run read-only queries
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{tables.length} tables</span>
          <span className="text-muted-foreground/40">|</span>
          <span>{totalRows.toLocaleString()} total rows</span>
          <button
            onClick={loadTables}
            disabled={tablesLoading}
            className="ml-2 p-1.5 rounded-md hover:bg-muted transition-colors"
            title="Refresh table list"
          >
            <RefreshCw
              className={`h-4 w-4 ${tablesLoading ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* ---- error banner ---- */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ---- main layout ---- */}
      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 200px)" }}>
        {/* ---- sidebar: table list ---- */}
        <div className="w-64 shrink-0 border rounded-lg overflow-hidden flex flex-col">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter tables..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tablesLoading ? (
              <div className="flex items-center justify-center p-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              filteredTables.map((t) => (
                <button
                  key={t.name}
                  onClick={() => selectTable(t.name)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-muted/50 transition-colors border-b last:border-0 ${
                    selected === t.name
                      ? "bg-primary/10 text-primary font-medium"
                      : ""
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Table2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{t.name}</span>
                  </span>
                  <span className="text-xs text-muted-foreground ml-1 shrink-0">
                    {t.row_count.toLocaleString()}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ---- main content ---- */}
        <div className="flex-1 min-w-0">
          {!selected ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Select a table from the sidebar
            </div>
          ) : (
            <div className="space-y-4">
              {/* ---- tab header ---- */}
              <div className="flex items-center gap-1 border-b">
                <TabButton
                  active={tab === "data"}
                  onClick={() => setTab("data")}
                  icon={<Table2 className="h-3.5 w-3.5" />}
                  label="Data"
                />
                <TabButton
                  active={tab === "schema"}
                  onClick={() => setTab("schema")}
                  icon={<Columns3 className="h-3.5 w-3.5" />}
                  label="Schema"
                />
                <TabButton
                  active={tab === "query"}
                  onClick={() => setTab("query")}
                  icon={<Terminal className="h-3.5 w-3.5" />}
                  label="Query"
                />
                <div className="ml-auto text-xs text-muted-foreground pr-2">
                  {selected}
                  {tableData && (
                    <span className="ml-1">
                      ({tableData.total.toLocaleString()} rows)
                    </span>
                  )}
                </div>
              </div>

              {/* ---- data tab ---- */}
              {tab === "data" && (
                <div className="space-y-3">
                  {dataLoading ? (
                    <div className="flex items-center justify-center p-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : tableData ? (
                    <>
                      {renderDataGrid(tableData.rows)}
                      {/* pagination */}
                      {totalPages > 1 && (
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            Page {page} of {totalPages}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => goPage(page - 1)}
                              disabled={page <= 1}
                              className="p-1.5 rounded-md hover:bg-muted disabled:opacity-30 transition-colors"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => goPage(page + 1)}
                              disabled={page >= totalPages}
                              className="p-1.5 rounded-md hover:bg-muted disabled:opacity-30 transition-colors"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
              )}

              {/* ---- schema tab ---- */}
              {tab === "schema" && (
                <div>
                  {schemaLoading ? (
                    <div className="flex items-center justify-center p-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="overflow-x-auto border rounded-lg">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                              Column
                            </th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                              Type
                            </th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                              NOT NULL
                            </th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                              PK
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {schema.map((col) => (
                            <tr
                              key={col.name}
                              className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                            >
                              <td className="px-3 py-1.5 font-mono text-xs">
                                {col.name}
                              </td>
                              <td className="px-3 py-1.5 text-muted-foreground">
                                {col.type || "—"}
                              </td>
                              <td className="px-3 py-1.5">
                                {col.notnull ? (
                                  <span className="text-amber-500 text-xs font-medium">
                                    YES
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/50 text-xs">
                                    no
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1.5">
                                {col.pk ? (
                                  <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                                    PK
                                  </span>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* ---- query tab ---- */}
              {tab === "query" && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <textarea
                      value={sql}
                      onChange={(e) => setSql(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                          e.preventDefault();
                          runQuery();
                        }
                      }}
                      placeholder="SELECT * FROM connections LIMIT 10"
                      rows={4}
                      className="flex-1 font-mono text-sm p-3 rounded-lg border bg-background resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={runQuery}
                      disabled={queryLoading || !sql.trim()}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {queryLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      Run Query
                    </button>
                    <span className="text-xs text-muted-foreground">
                      Ctrl+Enter to execute. SELECT and PRAGMA only.
                    </span>
                  </div>
                  {queryResult && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        {queryResult.count} row{queryResult.count !== 1 ? "s" : ""}{" "}
                        returned
                      </p>
                      {renderDataGrid(queryResult.rows)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- tab button ---- */

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
