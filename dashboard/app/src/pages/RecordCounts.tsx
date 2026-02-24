import { useEffect, useState, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  Hash,
  RefreshCw,
  Loader2,
  XCircle,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  Download,
  Database,
  Table2,
  Sparkles,
  Route,
} from "lucide-react";

// ============================================================================
// TYPES
// ============================================================================

interface BronzeEntity {
  BronzeLayerEntityId: string;
  LandingzoneEntityId: string;
  LakehouseId: string;
  Schema: string;
  Name: string;
  PrimaryKeys: string;
  FileType: string;
  IsActive: string;
}

interface SilverEntity {
  SilverLayerEntityId: string;
  BronzeLayerEntityId: string;
  LakehouseId: string;
  Schema: string;
  Name: string;
  FileType: string;
  IsActive: string;
}

interface Entity {
  LandingzoneEntityId: string;
  SourceSchema: string;
  SourceName: string;
  FileName: string;
  FilePath: string;
  FileType: string;
  IsIncremental: string;
  IsActive: string;
  DataSourceName: string;
}

interface LakehouseCount {
  schema: string;
  table: string;
  rowCount: number;
}

interface CountsMeta {
  cachedAt: string | null;
  fromCache: boolean;
  cacheAgeSec: number;
  queryTimeSec?: number;
}

type CountsResponse = Record<string, LakehouseCount[] | CountsMeta> & { _meta?: CountsMeta };

/** One row in the matrix: a table that exists in at least one lakehouse layer */
interface CountRow {
  id: string;
  tableName: string;
  schema: string;
  dataSource: string;
  loadType: string;
  bronzeCount: number | null;
  silverCount: number | null;
  status: "match" | "mismatch" | "bronze-only" | "silver-only" | "pending";
  delta: number;
}

// ============================================================================
// HELPERS
// ============================================================================

const API = "http://localhost:8787/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

type SortKey = "tableName" | "schema" | "dataSource" | "bronzeCount" | "silverCount" | "delta" | "status";
type SortDir = "asc" | "desc";

const STATUS_ORDER: Record<string, number> = { mismatch: 0, "bronze-only": 1, "silver-only": 2, match: 3, pending: 4 };

// ============================================================================
// MOCK DATA — realistic seed for UI preview
// ============================================================================

function generateMockCounts(): Record<string, LakehouseCount[]> {
  const schemas = ["dbo", "staging", "raw"];
  const sources = [
    { name: "IPC_PowerData", tables: [
      { table: "Customers", bronze: 48723, silver: 48723 },
      { table: "Orders", bronze: 312567, silver: 312419 },
      { table: "OrderLines", bronze: 1247893, silver: 1247893 },
      { table: "Products", bronze: 3412, silver: 3412 },
      { table: "ProductCategories", bronze: 87, silver: 87 },
      { table: "Suppliers", bronze: 1248, silver: 1248 },
      { table: "Warehouses", bronze: 24, silver: 24 },
      { table: "InventorySnapshots", bronze: 89472, silver: 89108 },
      { table: "Shipments", bronze: 156234, silver: 156234 },
      { table: "Returns", bronze: 8923, silver: 8901 },
    ]},
    { name: "IPC_FinanceDB", tables: [
      { table: "GLAccounts", bronze: 1847, silver: 1847 },
      { table: "JournalEntries", bronze: 523891, silver: 523891 },
      { table: "JournalLines", bronze: 2145678, silver: 2145678 },
      { table: "CostCenters", bronze: 342, silver: 342 },
      { table: "BudgetLines", bronze: 15672, silver: 15672 },
      { table: "APInvoices", bronze: 67234, silver: 67189 },
      { table: "ARInvoices", bronze: 45123, silver: 45123 },
      { table: "BankTransactions", bronze: 234567, silver: null },
    ]},
    { name: "IPC_MES", tables: [
      { table: "WorkOrders", bronze: 78234, silver: 78234 },
      { table: "WorkOrderOperations", bronze: 312456, silver: 312456 },
      { table: "MachineEvents", bronze: 1893421, silver: 1891203 },
      { table: "ProductionRuns", bronze: 45678, silver: 45678 },
      { table: "QualityChecks", bronze: 123456, silver: 123456 },
      { table: "Downtime", bronze: 34521, silver: 34521 },
      { table: "SensorReadings", bronze: 5672341, silver: null },
    ]},
    { name: "IPC_HRConnect", tables: [
      { table: "Employees", bronze: 2847, silver: 2847 },
      { table: "Departments", bronze: 45, silver: 45 },
      { table: "TimeEntries", bronze: 456789, silver: 456789 },
      { table: "PayrollRuns", bronze: 13456, silver: 13456 },
      { table: "Benefits", bronze: 8934, silver: 8934 },
    ]},
  ];

  const bronze: LakehouseCount[] = [];
  const silver: LakehouseCount[] = [];

  for (const src of sources) {
    const schema = schemas[Math.floor(Math.random() * schemas.length)];
    for (const t of src.tables) {
      bronze.push({ schema, table: t.table, rowCount: t.bronze });
      if (t.silver !== null) {
        silver.push({ schema, table: t.table, rowCount: t.silver });
      }
    }
  }

  // Add a few silver-only tables (views/aggregations that only exist in silver)
  silver.push({ schema: "analytics", table: "DailyRevenueSummary", rowCount: 1847 });
  silver.push({ schema: "analytics", table: "CustomerSegments", rowCount: 312 });

  return {
    LH_BRONZE_LAYER: bronze,
    LH_SILVER_LAYER: silver,
  };
}

function generateMockEntities(): { entities: Entity[]; bronzeEntities: BronzeEntity[]; silverEntities: SilverEntity[] } {
  const sources = [
    { name: "IPC_PowerData", tables: ["Customers", "Orders", "OrderLines", "Products", "ProductCategories", "Suppliers", "Warehouses", "InventorySnapshots", "Shipments", "Returns"] },
    { name: "IPC_FinanceDB", tables: ["GLAccounts", "JournalEntries", "JournalLines", "CostCenters", "BudgetLines", "APInvoices", "ARInvoices", "BankTransactions"] },
    { name: "IPC_MES", tables: ["WorkOrders", "WorkOrderOperations", "MachineEvents", "ProductionRuns", "QualityChecks", "Downtime", "SensorReadings"] },
    { name: "IPC_HRConnect", tables: ["Employees", "Departments", "TimeEntries", "PayrollRuns", "Benefits"] },
  ];

  const entities: Entity[] = [];
  const bronzeEntities: BronzeEntity[] = [];
  const silverEntities: SilverEntity[] = [];
  const schemas = ["dbo", "staging", "raw"];
  let id = 1;

  for (const src of sources) {
    const schema = schemas[Math.floor(Math.random() * schemas.length)];
    for (const table of src.tables) {
      const lzId = `LZ-${String(id).padStart(3, "0")}`;
      const brzId = `BRZ-${String(id).padStart(3, "0")}`;
      const slvId = `SLV-${String(id).padStart(3, "0")}`;

      entities.push({
        LandingzoneEntityId: lzId,
        SourceSchema: "dbo",
        SourceName: table,
        FileName: `${table}.parquet`,
        FilePath: `/LandingZone/${src.name}/${table}`,
        FileType: "parquet",
        IsIncremental: Math.random() > 0.4 ? "True" : "False",
        IsActive: "True",
        DataSourceName: src.name,
      });

      bronzeEntities.push({
        BronzeLayerEntityId: brzId,
        LandingzoneEntityId: lzId,
        LakehouseId: "LH_BRONZE",
        Schema: schema,
        Name: table,
        PrimaryKeys: "Id",
        FileType: "delta",
        IsActive: "True",
      });

      silverEntities.push({
        SilverLayerEntityId: slvId,
        BronzeLayerEntityId: brzId,
        LakehouseId: "LH_SILVER",
        Schema: schema,
        Name: table,
        FileType: "delta",
        IsActive: "True",
      });

      id++;
    }
  }

  return { entities, bronzeEntities, silverEntities };
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function RecordCounts() {
  // Metadata (loaded once on mount)
  const [entities, setEntities] = useState<Entity[]>([]);
  const [bronzeEntities, setBronzeEntities] = useState<BronzeEntity[]>([]);
  const [silverEntities, setSilverEntities] = useState<SilverEntity[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);

  // Lakehouse counts — starts empty, populated from API
  const [counts, setCounts] = useState<Record<string, LakehouseCount[]> | null>(null);
  const [countsMeta, setCountsMeta] = useState<CountsMeta | null>(null);
  const [countsLoading, setCountsLoading] = useState(false);
  const [countsError, setCountsError] = useState<string | null>(null);

  // UI
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("tableName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Demo mode flag — only true when user explicitly enables it
  const [isDemo, setIsDemo] = useState(false);

  // Load counts on demand
  const loadCounts = useCallback(async (force = false) => {
    setCountsLoading(true);
    setCountsError(null);
    try {
      const data = await fetchJson<CountsResponse>(force ? "/lakehouse-counts?force=1" : "/lakehouse-counts");
      const meta = data._meta as CountsMeta | undefined;
      // Separate meta from actual count data
      const countData: Record<string, LakehouseCount[]> = {};
      for (const [key, val] of Object.entries(data)) {
        if (key !== "_meta" && Array.isArray(val)) {
          countData[key] = val;
        }
      }
      setCounts(countData);
      setCountsMeta(meta || null);
      setIsDemo(false);
    } catch {
      // API unavailable — show empty state (user can enable demo mode manually)
      setCounts({});
      setCountsMeta(null);
      setCountsError("API server not reachable");
    } finally {
      setCountsLoading(false);
    }
  }, []);

  // Load metadata + counts on mount
  useEffect(() => {
    async function loadInitial() {
      setMetaLoading(true);
      try {
        const [entRes, brzRes, slvRes] = await Promise.all([
          fetch(`${API}/entities`),
          fetch(`${API}/bronze-entities`),
          fetch(`${API}/silver-entities`),
        ]);
        if (entRes.ok) setEntities(await entRes.json());
        if (brzRes.ok) setBronzeEntities(await brzRes.json());
        if (slvRes.ok) setSilverEntities(await slvRes.json());
      } catch {
        // API unavailable — leave empty
      } finally {
        setMetaLoading(false);
      }
      // Also trigger count load
      loadCounts();
    }
    loadInitial();
  }, [loadCounts]);

  // Build the matrix rows
  const rows: CountRow[] = useMemo(() => {
    if (!counts) return [];

    const bronzeCounts = counts["LH_BRONZE_LAYER"] || [];
    const silverCounts = counts["LH_SILVER_LAYER"] || [];

    // Build lookup maps
    const bronzeMap = new Map<string, number>();
    for (const c of bronzeCounts) {
      bronzeMap.set(`${c.schema}.${c.table}`.toLowerCase(), c.rowCount);
    }
    const silverMap = new Map<string, number>();
    for (const c of silverCounts) {
      silverMap.set(`${c.schema}.${c.table}`.toLowerCase(), c.rowCount);
    }

    // Build entity-to-datasource lookup from metadata
    const entityToSource = new Map<string, { dataSource: string; loadType: string }>();
    for (const ent of entities) {
      const brz = bronzeEntities.find(b => b.LandingzoneEntityId === ent.LandingzoneEntityId);
      if (brz) {
        entityToSource.set(`${brz.Schema}.${brz.Name}`.toLowerCase(), {
          dataSource: ent.DataSourceName,
          loadType: ent.IsIncremental === "True" ? "Incremental" : "Full",
        });
      }
    }

    // Merge all tables from both lakehouses
    const allKeys = new Set<string>();
    for (const c of bronzeCounts) allKeys.add(`${c.schema}.${c.table}`.toLowerCase());
    for (const c of silverCounts) allKeys.add(`${c.schema}.${c.table}`.toLowerCase());

    const result: CountRow[] = [];
    for (const key of allKeys) {
      const [schema, ...rest] = key.split(".");
      const tableName = rest.join(".");
      const bc = bronzeMap.get(key) ?? null;
      const sc = silverMap.get(key) ?? null;

      let status: CountRow["status"] = "pending";
      let delta = 0;
      if (bc !== null && sc !== null) {
        if (bc === sc) { status = "match"; delta = 0; }
        else { status = "mismatch"; delta = Math.abs(bc - sc); }
      } else if (bc !== null && sc === null) {
        status = "bronze-only";
      } else if (bc === null && sc !== null) {
        status = "silver-only";
      }

      const meta = entityToSource.get(key);
      result.push({
        id: key,
        tableName,
        schema,
        dataSource: meta?.dataSource || "",
        loadType: meta?.loadType || "",
        bronzeCount: bc,
        silverCount: sc,
        status,
        delta,
      });
    }

    return result;
  }, [counts, entities, bronzeEntities, silverEntities]);

  // Filter and sort
  const displayed = useMemo(() => {
    let filtered = rows;

    // Status filter
    if (filterStatus !== "all") {
      filtered = filtered.filter(r => r.status === filterStatus);
    }

    // Search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.tableName.toLowerCase().includes(q) ||
        r.schema.toLowerCase().includes(q) ||
        r.dataSource.toLowerCase().includes(q)
      );
    }

    // Sort
    const dir = sortDir === "asc" ? 1 : -1;
    filtered = [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "tableName": return dir * a.tableName.localeCompare(b.tableName);
        case "schema": return dir * a.schema.localeCompare(b.schema);
        case "dataSource": return dir * a.dataSource.localeCompare(b.dataSource);
        case "bronzeCount": return dir * ((a.bronzeCount ?? -1) - (b.bronzeCount ?? -1));
        case "silverCount": return dir * ((a.silverCount ?? -1) - (b.silverCount ?? -1));
        case "delta": return dir * (a.delta - b.delta);
        case "status": return dir * ((STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
        default: return 0;
      }
    });

    return filtered;
  }, [rows, searchQuery, sortKey, sortDir, filterStatus]);

  // Stats
  const stats = useMemo(() => {
    const total = rows.length;
    const matched = rows.filter(r => r.status === "match").length;
    const mismatched = rows.filter(r => r.status === "mismatch").length;
    const bronzeOnly = rows.filter(r => r.status === "bronze-only").length;
    const silverOnly = rows.filter(r => r.status === "silver-only").length;
    const totalBronzeRows = rows.reduce((s, r) => s + (r.bronzeCount ?? 0), 0);
    const totalSilverRows = rows.reduce((s, r) => s + (r.silverCount ?? 0), 0);
    const matchRate = total > 0 ? Math.round((matched / total) * 100) : 0;
    return { total, matched, mismatched, bronzeOnly, silverOnly, totalBronzeRows, totalSilverRows, matchRate };
  }, [rows]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  // Export CSV
  const exportCsv = () => {
    if (!displayed.length) return;
    const header = "Table,Schema,Data Source,Load Type,Bronze Rows,Silver Rows,Delta,Status";
    const csvRows = displayed.map(r =>
      `"${r.tableName}","${r.schema}","${r.dataSource}","${r.loadType}",${r.bronzeCount ?? ""},${r.silverCount ?? ""},${r.delta},"${r.status}"`
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `record-counts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusBadge = (status: CountRow["status"]) => {
    switch (status) {
      case "match":
        return <span className="inline-flex items-center gap-1 text-emerald-400 text-[10px] font-medium"><CheckCircle2 className="w-3 h-3" /> Match</span>;
      case "mismatch":
        return <span className="inline-flex items-center gap-1 text-amber-400 text-[10px] font-medium"><AlertTriangle className="w-3 h-3" /> Mismatch</span>;
      case "bronze-only":
        return <span className="text-[10px] font-medium text-muted-foreground">Bronze only</span>;
      case "silver-only":
        return <span className="text-[10px] font-medium text-muted-foreground">Silver only</span>;
      default:
        return <span className="text-[10px] text-muted-foreground/50">—</span>;
    }
  };

  // Cache age display
  const cacheLabel = countsMeta
    ? countsMeta.fromCache
      ? `Cached ${countsMeta.cacheAgeSec}s ago`
      : `Loaded ${countsMeta.queryTimeSec ? `in ${countsMeta.queryTimeSec}s` : "just now"}`
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">Record Counts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Compare row counts across lakehouse layers to spot-check data migration accuracy
        </p>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => loadCounts(false)}
            disabled={countsLoading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium cursor-pointer hover:bg-primary/90 disabled:opacity-60 disabled:cursor-wait transition-colors"
          >
            {countsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Hash className="w-4 h-4" />}
            {counts ? "Reload Counts" : "Load Counts"}
          </button>
          {counts && (
            <button
              onClick={() => loadCounts(true)}
              disabled={countsLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-card text-muted-foreground text-xs font-medium cursor-pointer hover:bg-muted hover:text-foreground disabled:opacity-60 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Force Refresh
            </button>
          )}
          {isDemo && (
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-500 text-[10px] font-semibold uppercase tracking-wider">
              <Sparkles className="w-3 h-3" />
              Demo Data
            </span>
          )}
          {cacheLabel && !isDemo && (
            <span className="text-[10px] text-muted-foreground font-mono">{cacheLabel}</span>
          )}
        </div>

        {counts && displayed.length > 0 && (
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-card text-muted-foreground text-xs font-medium cursor-pointer hover:bg-muted hover:text-foreground transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        )}
      </div>

      {/* Error */}
      {countsError && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-destructive/30 bg-destructive/5">
          <XCircle className="w-5 h-5 text-destructive flex-shrink-0" />
          <div>
            <div className="text-sm font-medium text-destructive">Failed to load counts</div>
            <div className="text-xs text-muted-foreground mt-0.5">{countsError}</div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!counts && !countsLoading && !countsError && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Hash className="w-16 h-16 text-muted-foreground/15 mb-4" />
          <h2 className="text-lg font-semibold text-foreground/60 mb-2">No counts loaded</h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Click <strong>Load Counts</strong> to query all lakehouse SQL endpoints for table row counts.
            Results are cached for 5 minutes so repeated loads are fast.
          </p>
          <p className="text-xs text-muted-foreground/60 mt-3 max-w-sm">
            This queries the Bronze and Silver lakehouse SQL analytics endpoints.
            Landing Zone stores raw files and doesn't have queryable table counts.
          </p>
        </div>
      )}

      {/* Loading */}
      {countsLoading && !counts && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
          <p className="text-sm text-muted-foreground">Querying lakehouse SQL endpoints...</p>
          <p className="text-xs text-muted-foreground/60 mt-1">This may take a few seconds on first load</p>
        </div>
      )}

      {/* Summary Cards */}
      {counts && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <Table2 className="w-4 h-4 text-amber-500" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Bronze</span>
              </div>
              <div className="text-xl font-bold tabular-nums text-foreground">{fmt(stats.total - stats.silverOnly)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{fmt(stats.totalBronzeRows)} total rows</div>
            </div>

            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-violet-500" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Silver</span>
              </div>
              <div className="text-xl font-bold tabular-nums text-foreground">{fmt(stats.total - stats.bronzeOnly)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{fmt(stats.totalSilverRows)} total rows</div>
            </div>

            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Matched</span>
              </div>
              <div className="text-xl font-bold tabular-nums text-emerald-500">{fmt(stats.matched)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{stats.matchRate}% match rate</div>
            </div>

            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Mismatched</span>
              </div>
              <div className={`text-xl font-bold tabular-nums ${stats.mismatched > 0 ? "text-amber-500" : "text-foreground"}`}>{fmt(stats.mismatched)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{fmt(stats.bronzeOnly + stats.silverOnly)} single-layer</div>
            </div>

            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <Database className="w-4 h-4 text-muted-foreground" />
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total</span>
              </div>
              <div className="text-xl font-bold tabular-nums text-foreground">{fmt(stats.total)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">unique tables</div>
            </div>
          </div>

          {/* Search and Filters */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-foreground text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 placeholder:text-muted-foreground"
                placeholder="Search tables, schemas, sources..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-2 py-1.5 rounded-md border border-border bg-background text-foreground text-xs outline-none cursor-pointer"
              >
                <option value="all">All tables ({fmt(rows.length)})</option>
                <option value="match">Matched ({fmt(stats.matched)})</option>
                <option value="mismatch">Mismatched ({fmt(stats.mismatched)})</option>
                <option value="bronze-only">Bronze only ({fmt(stats.bronzeOnly)})</option>
                <option value="silver-only">Silver only ({fmt(stats.silverOnly)})</option>
              </select>
            </div>

            <span className="text-[10px] text-muted-foreground ml-auto">
              Showing {fmt(displayed.length)} of {fmt(rows.length)}
            </span>
          </div>

          {/* Data Table */}
          <div className="rounded-lg border border-border overflow-hidden bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 border-b border-border">
                    {([
                      ["tableName", "Table Name", "text-left"],
                      ["schema", "Schema", "text-left"],
                      ["dataSource", "Data Source", "text-left"],
                      ["bronzeCount", "Bronze Rows", "text-right"],
                      ["silverCount", "Silver Rows", "text-right"],
                      ["delta", "Delta", "text-right"],
                      ["status", "Status", "text-center"],
                    ] as [SortKey, string, string][]).map(([key, label, align]) => (
                      <th
                        key={key}
                        className={`px-3 py-2.5 ${align} text-[10px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none transition-colors`}
                        onClick={() => toggleSort(key)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {label}
                          <SortIcon col={key} />
                        </span>
                      </th>
                    ))}
                    <th className="px-2 py-2.5 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {displayed.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-12 text-center text-muted-foreground text-sm">
                        No tables match your search or filter.
                      </td>
                    </tr>
                  ) : (
                    displayed.map((row) => (
                      <tr
                        key={row.id}
                        className={`border-b border-border/50 transition-colors hover:bg-muted/20 ${
                          row.status === "mismatch" ? "bg-amber-500/[0.03]" : ""
                        }`}
                      >
                        <td className="px-3 py-2 font-medium text-foreground truncate max-w-[200px]" title={row.tableName}>
                          {row.tableName}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground font-mono text-xs">{row.schema}</td>
                        <td className="px-3 py-2 text-muted-foreground text-xs truncate max-w-[150px]" title={row.dataSource}>
                          {row.dataSource || <span className="text-muted-foreground/40 italic">unlinked</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-xs" style={{ color: "#f59e0b" }}>
                          {row.bronzeCount !== null ? fmt(row.bronzeCount) : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-xs" style={{ color: "#8b5cf6" }}>
                          {row.silverCount !== null ? fmt(row.silverCount) : <span className="text-muted-foreground/30">—</span>}
                        </td>
                        <td className={`px-3 py-2 text-right font-mono tabular-nums text-xs ${
                          row.delta > 0 ? "text-amber-400 font-semibold" : "text-muted-foreground/30"
                        }`}>
                          {row.delta > 0 ? fmt(row.delta) : row.status === "match" ? "0" : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">{statusBadge(row.status)}</td>
                        <td className="px-2 py-2 text-center">
                          <Link
                            to={`/journey?table=${encodeURIComponent(row.tableName)}&schema=${encodeURIComponent(row.schema)}`}
                            className="text-muted-foreground/30 hover:text-primary transition-colors"
                            title="View data journey"
                          >
                            <Route className="w-3.5 h-3.5" />
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
            <span>
              {fmt(stats.total)} tables across {Object.keys(counts).filter(k => k !== "_meta").length} lakehouses
            </span>
            <span>
              Bronze: {fmt(stats.totalBronzeRows)} rows &middot; Silver: {fmt(stats.totalSilverRows)} rows
              {stats.totalBronzeRows !== stats.totalSilverRows && (
                <span className="text-amber-400 ml-2">
                  Δ {fmt(Math.abs(stats.totalBronzeRows - stats.totalSilverRows))} rows
                </span>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
