import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  X,
  Loader2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  AlertCircle,
  Search,
  ChevronDown,
  ChevronUp,
  Info,
  ArrowUpDown,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEntityDigest, type DigestEntity } from "@/hooks/useEntityDigest";

export interface DrillDownConfig {
  source: string;       // e.g. "MES"
  sourceName: string;   // e.g. "MES (Manufacturing)"
  layer?: string;       // e.g. "bronze" — if set, focuses on that layer
  status?: string;      // e.g. "pending" — pre-filter
}

// ── Status helpers ──

const STATUS_CONFIG = {
  complete: { icon: CheckCircle2, label: "Complete", color: "text-[var(--cl-success)]", bg: "bg-[var(--success-soft)]" },
  pending: { icon: Clock, label: "Pending", color: "text-[var(--cl-warning)]", bg: "bg-[var(--warning-soft)]" },
  error: { icon: AlertCircle, label: "Error", color: "text-[var(--cl-error)]", bg: "bg-[var(--error-soft)]" },
  partial: { icon: AlertTriangle, label: "Partial", color: "text-[var(--cl-info)]", bg: "bg-[var(--info-soft)]" },
  not_started: { icon: Clock, label: "Not Started", color: "text-muted-foreground", bg: "bg-muted/30" },
} as const;

const LAYER_STATUS = {
  loaded: { dot: "bg-[var(--cl-success)]", label: "Loaded" },
  pending: { dot: "bg-[var(--cl-warning)] animate-pulse", label: "Pending" },
  not_started: { dot: "bg-muted-foreground/30", label: "—" },
} as const;

type SortKey = "tableName" | "overall" | "lzStatus" | "bronzeStatus" | "silverStatus";

function LayerDot({ status }: { status: keyof typeof LAYER_STATUS }) {
  const cfg = LAYER_STATUS[status];
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("w-2 h-2 rounded-full", cfg.dot)} />
      <span className="text-xs text-muted-foreground">{cfg.label}</span>
    </div>
  );
}

// ── Main Component ──

function buildSqlExplorerUrl(entity: DigestEntity): string | null {
  const conn = entity.connection;
  if (!conn?.server) return null;
  const params = new URLSearchParams();
  params.set("server", conn.server);
  if (conn.database) params.set("database", conn.database);
  params.set("schema", entity.sourceSchema || "dbo");
  params.set("table", entity.tableName);
  return `/sql-explorer?${params}`;
}

export function EntityDrillDown({
  config,
  onClose,
}: {
  config: DrillDownConfig;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const filters = useMemo(
    () => ({ source: config.source, layer: config.layer, status: config.status }),
    [config.source, config.layer, config.status],
  );
  const { data, loading, error, refresh, entitiesBySource } = useEntityDigest(filters);
  const [search, setSearch] = useState("");
  const [expandedEntity, setExpandedEntity] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("overall");
  const [sortAsc, setSortAsc] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>(config.status || "");

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const sourceData = data?.sources?.[config.source];
  const entities = entitiesBySource(config.source);

  // Apply search + status filter
  const filtered = entities.filter((e) => {
    if (search) {
      const q = search.toLowerCase();
      if (!e.tableName.toLowerCase().includes(q) && !e.sourceSchema.toLowerCase().includes(q) && !e.diagnosis.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (statusFilter && e.overall !== statusFilter) return false;
    return true;
  });

  // Sort
  const sortOrder: Record<string, number> = { error: 0, pending: 1, partial: 2, not_started: 3, complete: 4 };
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "tableName") {
      cmp = a.tableName.localeCompare(b.tableName);
    } else if (sortKey === "overall") {
      cmp = (sortOrder[a.overall] ?? 5) - (sortOrder[b.overall] ?? 5);
    } else {
      const statusOrder = { loaded: 2, pending: 1, not_started: 0 };
      cmp = (statusOrder[a[sortKey] as keyof typeof statusOrder] ?? 0) - (statusOrder[b[sortKey] as keyof typeof statusOrder] ?? 0);
    }
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const summary = sourceData?.summary;
  const layerLabel = config.layer ? { lz: "Landing Zone", bronze: "Bronze", silver: "Silver" }[config.layer] || config.layer : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[4px] animate-[fadeIn_0.15s_var(--ease-claude)]"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-background border-l border-border shadow-[var(--shadow-modal)] flex flex-col animate-[slideInRight_0.25s_var(--ease-claude)]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{config.sourceName}</h2>
            <p className="text-sm text-muted-foreground">
              {layerLabel ? `${layerLabel} layer` : "All layers"}
              {config.status ? ` — ${config.status}` : ""}
              {data ? ` — ${data.totalEntities} entities` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center hover:bg-accent transition-colors cursor-pointer"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Summary bar */}
        {summary && (
          <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-muted/20">
            {(["complete", "pending", "error", "partial", "not_started"] as const).map((s) => {
              const count = summary[s];
              if (count === 0) return null;
              const cfg = STATUS_CONFIG[s];
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(statusFilter === s ? "" : s)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all cursor-pointer",
                    statusFilter === s
                      ? cn(cfg.bg, cfg.color, "ring-1 ring-current/20")
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  )}
                >
                  <cfg.icon className="w-3 h-3" />
                  {count} {cfg.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Search */}
        <div className="px-6 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search tables..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-[var(--radius-md)] bg-muted/30 border border-border text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <AlertTriangle className="w-8 h-8 text-[var(--cl-error)]" />
              <p className="text-muted-foreground text-sm">{error}</p>
              <button onClick={refresh} className="text-sm text-[var(--cl-info)] hover:underline">
                Retry
              </button>
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <CheckCircle2 className="w-8 h-8 text-[var(--cl-success)]" />
              <p className="text-muted-foreground text-sm">
                {search ? "No entities match your search." : "All entities are fully loaded."}
              </p>
            </div>
          ) : (
            <>
              {/* Table header */}
              <div className="sticky top-0 z-10 grid grid-cols-[1fr_60px_60px_60px] gap-2 px-6 py-2 bg-card border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <button onClick={() => toggleSort("tableName")} className="flex items-center gap-1 text-left cursor-pointer hover:text-foreground">
                  Table {sortKey === "tableName" && <ArrowUpDown className="w-3 h-3" />}
                </button>
                <button onClick={() => toggleSort("lzStatus")} className="flex items-center gap-1 justify-center cursor-pointer hover:text-foreground">
                  LZ {sortKey === "lzStatus" && <ArrowUpDown className="w-3 h-3" />}
                </button>
                <button onClick={() => toggleSort("bronzeStatus")} className="flex items-center gap-1 justify-center cursor-pointer hover:text-foreground">
                  BRZ {sortKey === "bronzeStatus" && <ArrowUpDown className="w-3 h-3" />}
                </button>
                <button onClick={() => toggleSort("silverStatus")} className="flex items-center gap-1 justify-center cursor-pointer hover:text-foreground">
                  SLV {sortKey === "silverStatus" && <ArrowUpDown className="w-3 h-3" />}
                </button>
              </div>

              {/* Entity rows */}
              {sorted.map((entity) => {
                const isExpanded = expandedEntity === entity.id;
                const overallCfg = STATUS_CONFIG[entity.overall] || STATUS_CONFIG.not_started;

                return (
                  <div key={entity.id} className="border-b border-border/50">
                    {/* Row */}
                    <button
                      onClick={() => setExpandedEntity(isExpanded ? null : entity.id)}
                      className="w-full grid grid-cols-[1fr_60px_60px_60px] gap-2 px-6 py-3 text-left hover:bg-accent/30 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", overallCfg.color.replace("text-", "bg-"))} />
                        {buildSqlExplorerUrl(entity) ? (
                          <span
                            role="link"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(buildSqlExplorerUrl(entity)!);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.stopPropagation(); navigate(buildSqlExplorerUrl(entity)!); }
                            }}
                            className="text-sm text-[var(--cl-info)] hover:underline truncate font-mono cursor-pointer"
                            title={`Open ${entity.sourceSchema ? entity.sourceSchema + "." : ""}${entity.tableName} in SQL Explorer`}
                          >
                            {entity.sourceSchema ? `${entity.sourceSchema}.` : ""}{entity.tableName}
                            <ExternalLink className="w-3 h-3 inline-block ml-1 opacity-50" />
                          </span>
                        ) : (
                          <span className="text-sm text-foreground truncate font-mono">
                            {entity.sourceSchema ? `${entity.sourceSchema}.` : ""}{entity.tableName}
                          </span>
                        )}
                        {isExpanded ? <ChevronUp className="w-3 h-3 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-3 h-3 text-muted-foreground flex-shrink-0" />}
                      </div>
                      <div className="flex justify-center"><LayerDot status={entity.lzStatus} /></div>
                      <div className="flex justify-center"><LayerDot status={entity.bronzeStatus} /></div>
                      <div className="flex justify-center"><LayerDot status={entity.silverStatus} /></div>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="px-6 pb-4 space-y-3 animate-[fadeIn_0.15s_var(--ease-claude)]">
                        {/* Diagnosis */}
                        <div className={cn("flex gap-2.5 p-3 rounded-[var(--radius-md)] border", overallCfg.bg, "border-border/50")}>
                          <Info className={cn("w-4 h-4 mt-0.5 flex-shrink-0", overallCfg.color)} />
                          <p className="text-sm text-foreground/80 leading-relaxed">{entity.diagnosis}</p>
                        </div>

                        {/* Detail grid */}
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Entity ID</span>
                            <span className="font-mono text-foreground/70">{entity.id}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Load Type</span>
                            <span className="text-foreground/70">{entity.isIncremental ? "Incremental" : "Full"}</span>
                          </div>
                          {entity.watermarkColumn && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Watermark</span>
                              <span className="font-mono text-foreground/70">{entity.watermarkColumn}</span>
                            </div>
                          )}
                          {entity.bronzePKs && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Primary Keys</span>
                              <span className="font-mono text-foreground/70 truncate max-w-[200px]">{entity.bronzePKs}</span>
                            </div>
                          )}
                          {entity.lzLastLoad && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">LZ Last Load</span>
                              <span className="font-mono text-foreground/70">{entity.lzLastLoad.slice(0, 16).replace("T", " ")}</span>
                            </div>
                          )}
                          {entity.bronzeLastLoad && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Bronze Last Load</span>
                              <span className="font-mono text-foreground/70">{entity.bronzeLastLoad.slice(0, 16).replace("T", " ")}</span>
                            </div>
                          )}
                          {entity.silverLastLoad && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Silver Last Load</span>
                              <span className="font-mono text-foreground/70">{entity.silverLastLoad.slice(0, 16).replace("T", " ")}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Active</span>
                            <span className={entity.isActive ? "text-[var(--cl-success)]" : "text-[var(--cl-error)]"}>
                              {entity.isActive ? "Yes" : "No"}
                            </span>
                          </div>
                          {entity.connection?.server && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Server</span>
                              <span className="font-mono text-foreground/70 truncate max-w-[200px]">{entity.connection.server}</span>
                            </div>
                          )}
                          {entity.connection?.database && (
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Database</span>
                              <span className="font-mono text-foreground/70 truncate max-w-[200px]">{entity.connection.database}</span>
                            </div>
                          )}
                        </div>

                        {/* Error detail */}
                        {entity.lastError && (
                          <div className="p-3 rounded-[var(--radius-md)] bg-[var(--error-soft)] border border-[var(--cl-error)]/20">
                            <p className="text-xs font-medium text-[var(--cl-error)] mb-1">
                              Last Error ({entity.lastError.layer}) — {entity.lastError.time}
                            </p>
                            <p className="text-xs text-foreground/70 font-mono break-all leading-relaxed">
                              {entity.lastError.message}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-card flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {sorted.length} of {entities.length} entities
            {data?.buildTimeMs ? ` — digest built in ${data.buildTimeMs}ms` : ""}
          </span>
          <button
            onClick={refresh}
            className="text-xs text-[var(--cl-info)] hover:underline cursor-pointer"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Slide-in animation */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
