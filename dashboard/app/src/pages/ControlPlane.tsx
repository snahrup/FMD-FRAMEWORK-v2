import { useState, useEffect, useRef } from 'react';
import {
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  Database,
  Cable,
  Server,
  Clock,
  Activity,
  FileJson,
  Layers,
  ChevronDown,
  ChevronRight,
  Play,
  Timer,
  Plug,
  HardDrive,
  GitBranch,
  Wrench,
} from 'lucide-react';

// ── Types ──

interface PipelineRun {
  RunGuid: string;
  PipelineName: string;
  EntityLayer: string;
  TriggerType: string;
  StartTime: string | null;
  EndTime: string | null;
  Status: string;
  Duration: string | null;
  DurationSec: number | null;
}

interface SourceSystem {
  namespace: string;
  connections: Array<{ name: string; type: string; isActive: string | number | boolean }>;
  dataSources: Array<{ name: string; type: string; isActive: string | number | boolean; connectionName: string }>;
  entities: { landing: number; bronze: number; silver: number };
  activeEntities: { landing: number; bronze: number; silver: number };
}

interface LakehouseEntry {
  LakehouseId: string;
  Name: string;
  Environment?: string;
}

interface ControlPlaneData {
  health: 'healthy' | 'warning' | 'critical' | 'setup' | 'offline';
  lastRefreshed: string;
  _fromSnapshot: boolean;
  _snapshotAge?: number;
  error?: string;
  summary: {
    connections: { total: number; active: number };
    dataSources: { total: number; active: number };
    entities: {
      landing: { total: number; active: number };
      bronze: { total: number; active: number };
      silver: { total: number; active: number };
    };
    pipelines: { total: number; active: number };
    lakehouses: number;
    workspaces: number;
  };
  pipelineHealth: {
    recentRuns: number;
    succeeded: number;
    failed: number;
    running: number;
  };
  sourceSystems: SourceSystem[];
  lakehouses: LakehouseEntry[];
  workspaces: Array<{ WorkspaceId: string; Name: string }>;
  recentRuns: PipelineRun[];
}

// ── Helpers ──

function utc(iso: string): Date {
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z');
}

function timeAgo(isoDate: string): string {
  const diff = Date.now() - utc(isoDate).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatTimestamp(iso: string): string {
  try {
    return utc(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const statusIcon = (status: string) => {
  const s = status.toLowerCase();
  if (s === 'succeeded') return <CheckCircle className="h-4 w-4" style={{ color: "var(--bp-operational)" }} />;
  if (s === 'failed') return <XCircle className="h-4 w-4" style={{ color: "var(--bp-fault)" }} />;
  if (s === 'inprogress') return <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--bp-copper)" }} />;
  return <Clock className="h-4 w-4" style={{ color: "var(--bp-ink-muted)" }} />;
};

const statusBadge = (status: string) => {
  const s = status.toLowerCase();
  const style = s === 'succeeded' ? { background: "var(--bp-operational-light)", color: "var(--bp-operational)", borderColor: "var(--bp-operational)" }
    : s === 'failed' ? { background: "var(--bp-fault-light)", color: "var(--bp-fault)", borderColor: "var(--bp-fault)" }
    : s === 'inprogress' ? { background: "var(--bp-copper-light)", color: "var(--bp-copper)", borderColor: "var(--bp-copper)" }
    : { background: "var(--bp-surface-inset)", color: "var(--bp-ink-muted)", borderColor: "var(--bp-border)" };
  return <span className="text-[11px] px-2 py-0.5 rounded border" style={{ fontFamily: "var(--bp-font-mono)", ...style }}>{status}</span>;
};

/** Check IsActive across both SQLite (integer 0/1) and Fabric SQL (string 'True'/'1') */
function checkActive(val: unknown): boolean {
  if (val === true || val === 1) return true;
  const s = String(val).toLowerCase();
  return s === 'true' || s === '1';
}

const HEALTH_CONFIG = {
  healthy: { label: 'All Systems Operational', color: 'text-[var(--bp-operational)]', bg: 'border', pulse: 'bg-[var(--bp-operational)]', bgStyle: { background: "var(--bp-operational-light)", borderColor: "var(--bp-operational)" } },
  warning: { label: 'Degraded — Recent Failures', color: 'text-[var(--bp-caution)]', bg: 'border', pulse: 'bg-[var(--bp-caution)]', bgStyle: { background: "var(--bp-caution-light)", borderColor: "var(--bp-caution)" } },
  critical: { label: 'Critical — Pipelines Failing', color: 'text-[var(--bp-fault)]', bg: 'border', pulse: 'bg-[var(--bp-fault)]', bgStyle: { background: "var(--bp-fault-light)", borderColor: "var(--bp-fault)" } },
  setup: { label: 'Initial Setup — No Sources', color: 'text-[var(--bp-copper)]', bg: 'border', pulse: 'bg-[var(--bp-copper)]', bgStyle: { background: "var(--bp-copper-light)", borderColor: "var(--bp-copper)" } },
  offline: { label: 'SQL Database Offline', color: 'text-[var(--bp-fault)]', bg: 'border', pulse: 'bg-[var(--bp-fault)]', bgStyle: { background: "var(--bp-fault-light)", borderColor: "var(--bp-fault)" } },
};

interface EntityMeta {
  entityId: string;
  dataSource: string;
  dataSourceId: string;
  schema: string;
  table: string;
  FileName: string;
  IsIncremental: string;
  watermarkColumn: string;
  bronzeEntityId: string | null;
  primaryKeys: string;
  silverEntityId: string | null;
}

type Tab = 'metadata' | 'execution' | 'connections' | 'infrastructure';

// ── Component ──

export default function ControlPlane() {
  const [data, setData] = useState<ControlPlaneData | null>(null);
  const [entities, setEntities] = useState<EntityMeta[]>([]);
  const [entityFilter, setEntityFilter] = useState('');
  const [entityDsFilter, setEntityDsFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<Tab>('metadata');
  const [expandedNs, setExpandedNs] = useState<Set<string>>(new Set());
  const [maintenanceRunning, setMaintenanceRunning] = useState(false);
  const [maintenanceResult, setMaintenanceResult] = useState<string | null>(null);
  const [entityError, setEntityError] = useState<string | null>(null);

  const visibleRef = useRef(true);
  useEffect(() => {
    const onVisChange = () => { visibleRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function doFetch(background: boolean) {
      if (background) setRefreshing(true);
      try {
        const [cpRes, entRes] = await Promise.all([
          fetch('/api/control-plane', { signal: controller.signal }),
          fetch('/api/load-config', { signal: controller.signal }),
        ]);
        if (cancelled) return;
        if (!cpRes.ok) throw new Error('API not responding');
        const result = await cpRes.json();
        if (cancelled) return;
        setData(result);
        if (entRes.ok) {
          const entData = await entRes.json();
          setEntities(Array.isArray(entData) ? entData : []);
          setEntityError(null);
        } else {
          setEntityError('Entity metadata unavailable (Fabric SQL unreachable)');
        }
        setError(null);
      } catch (e: unknown) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setError(e instanceof Error ? e.message : 'Connection failed');
      } finally {
        if (!cancelled) { setLoading(false); setRefreshing(false); }
      }
    }

    doFetch(refreshKey > 0);
    let interval: ReturnType<typeof setInterval> | undefined;
    if (autoRefresh) {
      interval = setInterval(() => { if (visibleRef.current) doFetch(true); }, 30000);
    }
    return () => { cancelled = true; controller.abort(); if (interval) clearInterval(interval); };
  }, [autoRefresh, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading Control Plane...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <AlertTriangle className="h-8 w-8 text-[var(--bp-caution)] mx-auto mb-4" />
          <p className="text-foreground font-medium mb-2">Cannot Reach Data Platform</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button onClick={() => setRefreshKey(k => k + 1)} className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors mx-auto">
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // TODO(P14): wire to actual endpoints — /api/entity-digest/resync and
  // /api/maintenance-agent/trigger do not exist yet. When implemented, restore
  // the resync + notebook trigger calls here.
  async function runMaintenanceAgent() {
    setMaintenanceResult("Maintenance agent not yet available — backend endpoints pending");
  }

  const healthCfg = HEALTH_CONFIG[data.health] || HEALTH_CONFIG.setup;
  const s = data.summary;
  const ph = data.pipelineHealth;
  const successRate = ph.recentRuns > 0 ? Math.round(ph.succeeded / ph.recentRuns * 100) : 0;

  const toggleNs = (ns: string) => {
    setExpandedNs(prev => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns); else next.add(ns);
      return next;
    });
  };

  // Filter source systems: hide namespaces with 0 entities and 0 connections
  // Only show source systems that have registered entities (hide internal: NB, ONELAKE, Unlinked)
  const activeSources = data.sourceSystems.filter(
    ss => ss.entities.landing > 0
  );

  return (
    <div className="space-y-4" style={{ padding: "32px", maxWidth: "1280px" }}>
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="bp-display" style={{ fontSize: 32, color: "var(--bp-ink-primary)", lineHeight: 1.1, margin: 0 }}>
            Control Plane
          </h1>
          <p style={{ fontSize: 13, color: "var(--bp-ink-tertiary)", marginTop: 4 }}>
            Metadata database — the single source of truth driving all FMD pipelines
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="rounded" aria-label="Toggle auto-refresh" />
            Auto
          </label>
          <button
            onClick={runMaintenanceAgent}
            disabled={true}
            className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--bp-caution-light)", border: "1px solid var(--bp-caution)", color: "var(--bp-caution)" }}
            title="Maintenance agent — backend endpoints not yet implemented"
          >
            <Wrench className="h-3.5 w-3.5" />
            Maintenance
          </button>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 border border-border rounded-lg text-muted-foreground transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Updating...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* ── Maintenance Result Banner ── */}
      {maintenanceResult && (
        <div className="rounded-lg p-3 border flex items-center justify-between gap-3"
          style={maintenanceResult.startsWith('Error')
            ? { background: "var(--bp-fault-light)", borderColor: "var(--bp-fault)" }
            : { background: "var(--bp-operational-light)", borderColor: "var(--bp-operational)" }
          }>
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 shrink-0" style={{ color: maintenanceResult.startsWith('Error') ? "var(--bp-fault)" : "var(--bp-operational)" }} />
            <p className="text-xs" style={{ color: maintenanceResult.startsWith('Error') ? "var(--bp-fault)" : "var(--bp-operational)" }}>
              {maintenanceResult}
            </p>
          </div>
          <button onClick={() => setMaintenanceResult(null)} className="text-xs text-muted-foreground hover:text-foreground">&times;</button>
        </div>
      )}

      {/* ── Snapshot Banner ── */}
      {data._fromSnapshot && (
        <div className="rounded-lg p-3 border flex items-center gap-3" style={{ background: "var(--bp-caution-light)", borderColor: "var(--bp-caution)" }}>
          <FileJson className="h-4 w-4 shrink-0" style={{ color: "var(--bp-caution)" }} />
          <p className="text-xs" style={{ color: "var(--bp-caution)" }}>
            Showing cached snapshot — SQL database unreachable. Live data resumes when DB is back.
          </p>
        </div>
      )}

      {/* ── Health Bar + Key Metrics ── */}
      <div className={`rounded-xl p-4 ${healthCfg.bg} flex flex-wrap items-center gap-4`} style={(healthCfg as any).bgStyle}>
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className={`h-3 w-3 rounded-full ${healthCfg.pulse} animate-pulse`} />
          </div>
          <div>
            <p className={`text-sm font-semibold ${healthCfg.color}`}>{healthCfg.label}</p>
            <p className="text-[10px] text-muted-foreground">
              {data.lastRefreshed ? timeAgo(data.lastRefreshed) : 'N/A'}
            </p>
          </div>
        </div>

        <div className="h-8 w-px bg-border/40 hidden sm:block" />

        {/* Compact metric pills */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Pill icon={<Plug className="h-3 w-3" />} label="Connections" value={s.connections.active} />
          <Pill icon={<Database className="h-3 w-3" />} label="Sources" value={s.dataSources.active} />
          <Pill icon={<Layers className="h-3 w-3" />} label="Entities" value={s.entities.landing.active} sub={`${s.entities.landing.active} LZ / ${s.entities.bronze.active} BR / ${s.entities.silver.active} SV`} />
          <Pill icon={<GitBranch className="h-3 w-3" />} label="Pipelines" value={s.pipelines.active} />
          <Pill icon={<HardDrive className="h-3 w-3" />} label="Lakehouses" value={s.lakehouses} />
          <Pill icon={<Server className="h-3 w-3" />} label="Workspaces" value={s.workspaces} />
        </div>

        {/* Pipeline health compact */}
        {ph.recentRuns > 0 && (
          <>
            <div className="h-8 w-px bg-border/40 hidden sm:block" />
            <div className="flex items-center gap-3 text-xs">
              <span style={{ color: "var(--bp-operational)", fontFamily: "var(--bp-font-mono)" }}>{ph.succeeded} OK</span>
              <span style={{ color: "var(--bp-fault)", fontFamily: "var(--bp-font-mono)" }}>{ph.failed} FAIL</span>
              <span style={{ color: "var(--bp-copper)", fontFamily: "var(--bp-font-mono)" }}>{ph.running} RUN</span>
              <span className="text-muted-foreground">({successRate}% success)</span>
            </div>
          </>
        )}
      </div>

      {/* ── Tab Navigation ── */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        <TabBtn active={activeTab === 'metadata'} onClick={() => setActiveTab('metadata')} icon={<Database className="h-3.5 w-3.5" />} label="Entity Metadata" count={entities.length} />
        <TabBtn active={activeTab === 'execution'} onClick={() => setActiveTab('execution')} icon={<Activity className="h-3.5 w-3.5" />} label="Execution Log" count={ph.recentRuns} />
        <TabBtn active={activeTab === 'connections'} onClick={() => setActiveTab('connections')} icon={<Cable className="h-3.5 w-3.5" />} label="Sources" count={activeSources.length} />
        <TabBtn active={activeTab === 'infrastructure'} onClick={() => setActiveTab('infrastructure')} icon={<Server className="h-3.5 w-3.5" />} label="Infrastructure" />
      </div>

      {/* ── Tab Content ── */}

      {/* Entity Metadata — THE actual control plane */}
      {activeTab === 'metadata' && (() => {
        const q = entityFilter.toLowerCase();
        const dsFilter = entityDsFilter;
        const dataSources = [...new Set(entities.map(e => e.dataSource))].sort();
        const filtered = entities.filter(e => {
          if (dsFilter && e.dataSource !== dsFilter) return false;
          if (q && !(e.table || '').toLowerCase().includes(q) && !(e.FileName || '').toLowerCase().includes(q) && !(e.schema || '').toLowerCase().includes(q)) return false;
          return true;
        });
        return (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {/* Entity load error banner */}
            {entityError && entities.length === 0 && (
              <div className="px-4 py-3 border-b flex items-center gap-2" style={{ borderColor: "var(--bp-caution)", background: "var(--bp-caution-light)" }}>
                <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--bp-caution)" }} />
                <p className="text-xs" style={{ color: "var(--bp-caution)" }}>{entityError}</p>
              </div>
            )}
            {/* Filters */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted">
              <input
                type="text"
                placeholder="Search tables..."
                aria-label="Filter entities by table name"
                value={entityFilter}
                onChange={e => setEntityFilter(e.target.value)}
                className="flex-1 max-w-xs px-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <select
                value={entityDsFilter}
                onChange={e => setEntityDsFilter(e.target.value)}
                aria-label="Filter by data source"
                className="px-3 py-1.5 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Sources ({entities.length})</option>
                {dataSources.map(ds => (
                  <option key={ds} value={ds}>{ds} ({entities.filter(e => e.dataSource === ds).length})</option>
                ))}
              </select>
              <span className="text-[10px] text-muted-foreground ml-auto">{filtered.length} of {entities.length} entities</span>
            </div>

            {/* Table */}
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-muted/60 text-left">
                    <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Source</th>
                    <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Schema</th>
                    <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Table</th>
                    <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">File Name</th>
                    <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Load Type</th>
                    <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Watermark</th>
                    <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Primary Keys</th>
                    <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Bronze</th>
                    <th className="px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Silver</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {filtered.slice(0, 200).map(e => {
                    const isInc = String(e.IsIncremental) === '1' || String(e.IsIncremental).toLowerCase() === 'true';
                    const hasBronze = !!e.bronzeEntityId;
                    const hasSilver = !!e.silverEntityId;
                    return (
                      <tr key={e.entityId} className="hover:bg-muted/50 transition-colors">
                        <td className="px-3 py-1.5">
                          <span className="font-mono text-foreground/80">{e.dataSource}</span>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground font-mono">{e.schema}</td>
                        <td className="px-3 py-1.5 font-mono text-foreground">{e.table}</td>
                        <td className="px-3 py-1.5 font-mono text-foreground/70">{e.FileName}</td>
                        <td className="px-3 py-1.5">
                          <span className="px-1.5 py-0.5 rounded border text-[10px]"
                            style={isInc
                              ? { fontFamily: "var(--bp-font-mono)", color: "var(--bp-copper)", background: "var(--bp-copper-light)", borderColor: "var(--bp-copper)" }
                              : { fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-muted)", background: "var(--bp-surface-inset)", borderColor: "var(--bp-border)" }
                            }>
                            {isInc ? 'INCR' : 'FULL'}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{e.watermarkColumn || '—'}</td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground max-w-[150px] truncate" title={e.primaryKeys}>{e.primaryKeys || '—'}</td>
                        <td className="px-3 py-1.5 text-center">
                          {hasBronze ? <CheckCircle className="h-3.5 w-3.5 inline" style={{ color: "var(--bp-caution)" }} /> : <span style={{ color: "var(--bp-ink-muted)" }}>—</span>}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {hasSilver ? <CheckCircle className="h-3.5 w-3.5 inline" style={{ color: "var(--bp-ink-tertiary)" }} /> : <span style={{ color: "var(--bp-ink-muted)" }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && entities.length === 0 && !entityError && (
                <div className="p-12 text-center">
                  <Database className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No entity metadata loaded.</p>
                  <p className="text-xs text-muted-foreground/60 mt-1">Entities appear here once sources are registered and the metadata DB is synced.</p>
                </div>
              )}
              {filtered.length === 0 && entities.length > 0 && (
                <div className="p-8 text-center">
                  <p className="text-sm text-muted-foreground">No entities match the current filters.</p>
                </div>
              )}
              {filtered.length > 200 && (
                <div className="px-4 py-2 text-center text-[10px] text-muted-foreground border-t border-border">
                  Showing 200 of {filtered.length} — use filters to narrow down
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {activeTab === 'execution' && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          {data.recentRuns.length === 0 ? (
            <div className="p-12 text-center">
              <Play className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No pipeline executions recorded yet.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Runs will appear here once PL_FMD_LOAD_ALL is triggered.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-left">
                    <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">Pipeline</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">Layer</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">Trigger</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">Started</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">Duration</th>
                    <th className="px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">Run GUID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.recentRuns.map((run, i) => (
                    <tr key={run.RunGuid || i} className="hover:bg-muted/50 transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {statusIcon(run.Status)}
                          {statusBadge(run.Status)}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-foreground">{run.PipelineName}</td>
                      <td className="px-4 py-2.5">
                        <LayerBadge layer={run.EntityLayer} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{run.TriggerType}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                        {run.StartTime ? formatTimestamp(run.StartTime) : '—'}
                      </td>
                      <td className="px-4 py-2.5">
                        {run.Duration ? (
                          <span className="text-xs font-mono text-foreground flex items-center gap-1">
                            <Timer className="h-3 w-3 text-muted-foreground" />
                            {run.Duration}
                          </span>
                        ) : run.Status === 'InProgress' ? (
                          <span className="text-xs animate-pulse" style={{ color: "var(--bp-copper)" }}>running...</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[10px] text-muted-foreground/50 font-mono">{run.RunGuid?.slice(0, 8) || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'connections' && (
        <div className="space-y-3">
          {activeSources.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-12 text-center">
              <Cable className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No source systems with registered entities.</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Sources appear here once entities are registered via the deployment script.</p>
            </div>
          )}
          {activeSources.map(src => {
            const isExpanded = expandedNs.has(src.namespace);
            const totalEntities = src.entities.landing + src.entities.bronze + src.entities.silver;
            const allActive = src.connections.every(c => checkActive(c.isActive)) &&
                              src.dataSources.every(d => checkActive(d.isActive));
            return (
              <div key={src.namespace} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Namespace header */}
                <button
                  onClick={() => toggleNs(src.namespace)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                >
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="font-semibold text-foreground">{src.namespace}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full border font-medium"
                    style={allActive
                      ? { background: "var(--bp-operational-light)", color: "var(--bp-operational)", borderColor: "var(--bp-operational)" }
                      : { background: "var(--bp-caution-light)", color: "var(--bp-caution)", borderColor: "var(--bp-caution)" }
                    }>
                    {allActive ? 'Active' : 'Partial'}
                  </span>
                  <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                    <span>{src.connections.length} conn</span>
                    <span>{src.dataSources.length} ds</span>
                    <span>{totalEntities} entities</span>
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/5">
                    {/* Connections */}
                    {src.connections.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Connections</p>
                        <div className="space-y-1">
                          {src.connections.map(c => (
                            <div key={c.name} className="flex items-center gap-2 text-xs">
                              <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: checkActive(c.isActive) ? "var(--bp-operational)" : "var(--bp-fault)" }} />
                              <span className="font-mono text-foreground">{c.name}</span>
                              <span className="text-muted-foreground/60">{c.type}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Data Sources */}
                    {src.dataSources.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Data Sources</p>
                        <div className="space-y-1">
                          {src.dataSources.map(ds => (
                            <div key={ds.name} className="flex items-center gap-2 text-xs">
                              <Database className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="font-mono text-foreground">{ds.name}</span>
                              <span className="text-muted-foreground/60">{ds.type}</span>
                              <span className="text-muted-foreground/40 ml-auto">via {ds.connectionName}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Entity counts */}
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Registered Entities</p>
                      <div className="flex gap-4 text-xs">
                        <span style={{ color: "var(--bp-ink-secondary)" }}>LZ: <strong style={{ color: "var(--bp-ink-primary)" }}>{src.activeEntities.landing}</strong></span>
                        <span style={{ color: "var(--bp-caution)" }}>Bronze: <strong style={{ color: "var(--bp-ink-primary)" }}>{src.activeEntities.bronze}</strong></span>
                        <span style={{ color: "var(--bp-ink-tertiary)" }}>Silver: <strong style={{ color: "var(--bp-ink-primary)" }}>{src.activeEntities.silver}</strong></span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === 'infrastructure' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Workspaces */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <Server className="h-3.5 w-3.5" />
              Workspaces ({data.workspaces.length})
            </h3>
            <div className="space-y-2">
              {data.workspaces.map(ws => (
                <div key={ws.WorkspaceId} className="flex items-center gap-2 text-sm">
                  <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: "var(--bp-operational)" }} />
                  <span className="text-foreground font-mono text-xs">{ws.Name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Lakehouses */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <HardDrive className="h-3.5 w-3.5" />
              Lakehouses ({data.lakehouses.length})
            </h3>
            <div className="space-y-2">
              {data.lakehouses.map(lh => (
                <div key={lh.LakehouseId} className="flex items-center gap-2 text-sm">
                  <Database className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-foreground font-mono text-xs">{lh.Name}</span>
                  {lh.Environment && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border ml-auto"
                      style={lh.Environment === 'DEV'
                        ? { fontFamily: "var(--bp-font-mono)", color: "var(--bp-copper)", borderColor: "var(--bp-copper)", background: "var(--bp-copper-light)" }
                        : { fontFamily: "var(--bp-font-mono)", color: "var(--bp-caution)", borderColor: "var(--bp-caution)", background: "var(--bp-caution-light)" }
                      }>{lh.Environment}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Pipelines */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <GitBranch className="h-3.5 w-3.5" />
              Pipelines
            </h3>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Total registered</span>
                <span className="text-lg font-bold text-foreground">{s.pipelines.total}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Active</span>
                <span className="text-lg font-bold" style={{ color: "var(--bp-operational)" }}>{s.pipelines.active}</span>
              </div>
              {s.pipelines.total > 0 && s.pipelines.total !== s.pipelines.active && (
                <div className="flex items-center justify-between pt-2 border-t border-border mt-2">
                  <span className="text-xs text-muted-foreground">Inactive</span>
                  <span className="text-xs font-mono text-muted-foreground">{s.pipelines.total - s.pipelines.active}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div className="text-center text-[10px] text-muted-foreground pb-2">
        {data._fromSnapshot ? (
          <span style={{ color: "var(--bp-caution)" }}>Snapshot mode — SQL database offline</span>
        ) : (
          <span>Live from integration metadata DB · {data.lastRefreshed ? formatTimestamp(data.lastRefreshed) : 'N/A'}</span>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function Pill({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number | string; sub?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/40 border border-border" title={sub || label}>
      <span className="text-muted-foreground">{icon}</span>
      <span className="font-mono font-bold text-foreground">{value}</span>
      <span className="text-muted-foreground/70 hidden sm:inline">{label}</span>
    </div>
  );
}

function TabBtn({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? 'text-foreground border-primary'
          : 'text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground/30'
      }`}
    >
      {icon}
      {label}
      {count !== undefined && <span className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded-full font-mono">{count}</span>}
    </button>
  );
}

function LayerBadge({ layer }: { layer: string }) {
  const l = (layer || '').toLowerCase();
  const style = l === 'control' ? { color: "var(--bp-copper)", background: "var(--bp-copper-light)", borderColor: "var(--bp-copper)" }
    : l === 'landing' || l === 'landingzone' ? { color: "var(--bp-ink-secondary)", background: "var(--bp-surface-2)", borderColor: "var(--bp-border)" }
    : l === 'bronze' ? { color: "var(--bp-caution)", background: "var(--bp-caution-light)", borderColor: "var(--bp-caution)" }
    : l === 'silver' ? { color: "var(--bp-ink-tertiary)", background: "var(--bp-surface-inset)", borderColor: "var(--bp-border-strong)" }
    : l === 'gold' ? { color: "var(--bp-caution)", background: "var(--bp-caution-light)", borderColor: "var(--bp-caution)" }
    : { color: "var(--bp-ink-muted)", background: "var(--bp-surface-inset)", borderColor: "var(--bp-border)" };
  return <span className="text-[10px] px-2 py-0.5 rounded border" style={{ fontFamily: "var(--bp-font-mono)", ...style }}>{layer || '—'}</span>;
}
