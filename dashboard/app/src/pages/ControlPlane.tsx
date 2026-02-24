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
  ArrowRight,
  Clock,
  Activity,
  Shield,
  FileJson,
  Layers,
} from 'lucide-react';

// ── Types ──

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
  sourceSystems: Array<{
    namespace: string;
    connections: Array<{ name: string; type: string; isActive: string }>;
    dataSources: Array<{ name: string; type: string; isActive: string; connectionName: string }>;
    entities: { landing: number; bronze: number; silver: number };
    activeEntities: { landing: number; bronze: number; silver: number };
  }>;
  lakehouses: Array<{ LakehouseId: string; Name: string }>;
  workspaces: Array<{ WorkspaceId: string; Name: string }>;
  recentRuns: Array<Record<string, string>>;
}

// ── Helpers ──

function timeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diff = now - then;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const HEALTH_CONFIG = {
  healthy: { label: 'All Systems Operational', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', icon: CheckCircle, pulse: 'bg-emerald-500' },
  warning: { label: 'Degraded — Recent Failures', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', icon: AlertTriangle, pulse: 'bg-amber-500' },
  critical: { label: 'Critical — Pipelines Failing', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', icon: XCircle, pulse: 'bg-red-500' },
  setup: { label: 'Initial Setup — No Sources', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', icon: Layers, pulse: 'bg-blue-500' },
  offline: { label: 'SQL Database Offline', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', icon: XCircle, pulse: 'bg-red-500' },
};

// ── Component ──

export default function ControlPlane() {
  const [data, setData] = useState<ControlPlaneData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Track tab visibility — pause polling when tab is hidden
  const visibleRef = useRef(true);
  useEffect(() => {
    const onVisChange = () => { visibleRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, []);

  // Single effect: initial load + auto-refresh + manual refresh via refreshKey
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function doFetch(background: boolean) {
      if (background) setRefreshing(true);
      try {
        const res = await fetch('/api/control-plane', { signal: controller.signal });
        if (cancelled) return;
        if (!res.ok) throw new Error('API not responding');
        const result = await res.json();
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (e: unknown) {
        if (cancelled || (e instanceof DOMException && e.name === 'AbortError')) return;
        setError(e instanceof Error ? e.message : 'Connection failed');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    doFetch(refreshKey > 0);

    let interval: ReturnType<typeof setInterval> | undefined;
    if (autoRefresh) {
      interval = setInterval(() => {
        if (visibleRef.current) doFetch(true);
      }, 30000);
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (interval) clearInterval(interval);
    };
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
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-4" />
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

  const healthCfg = HEALTH_CONFIG[data.health] || HEALTH_CONFIG.setup;
  const HealthIcon = healthCfg.icon;
  const s = data.summary;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">Control Plane</h1>
          <p className="text-muted-foreground mt-1">
            Real-time view of the FMD data platform — single point of control
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 border border-border rounded-lg text-muted-foreground transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Updating...' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Snapshot Banner */}
      {data._fromSnapshot && (
        <div className="rounded-lg p-4 bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
          <FileJson className="h-5 w-5 text-amber-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-300">Showing Last Known State (Snapshot)</p>
            <p className="text-xs text-amber-400/70 mt-0.5">
              SQL database is unreachable. This data was cached at{' '}
              {data._snapshotAge ? new Date(data._snapshotAge * 1000).toLocaleString() : 'unknown time'}.
              Live data will resume when the database is back online.
            </p>
          </div>
        </div>
      )}

      {/* Overall Health Banner */}
      <div className={`rounded-xl p-5 border ${healthCfg.bg} flex items-center justify-between`}>
        <div className="flex items-center gap-4">
          <div className="relative">
            <HealthIcon className={`h-8 w-8 ${healthCfg.color}`} />
            <div className={`absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full ${healthCfg.pulse} animate-pulse`} />
          </div>
          <div>
            <p className={`text-lg font-semibold ${healthCfg.color}`}>{healthCfg.label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Last refreshed: {data.lastRefreshed ? timeAgo(data.lastRefreshed) : 'N/A'}
              {data.lastRefreshed && <span className="ml-2 text-muted-foreground/60">({formatTimestamp(data.lastRefreshed)})</span>}
            </p>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-6 text-sm">
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">{s.connections.active}</p>
            <p className="text-xs text-muted-foreground">Connections</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">{s.dataSources.active}</p>
            <p className="text-xs text-muted-foreground">Data Sources</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">{s.entities.landing.active + s.entities.bronze.active + s.entities.silver.active}</p>
            <p className="text-xs text-muted-foreground">Entities</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground">{s.pipelines.active}</p>
            <p className="text-xs text-muted-foreground">Pipelines</p>
          </div>
        </div>
      </div>

      {/* Data Flow Pipeline — Medallion Architecture */}
      <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/20 dark:to-slate-900/10 rounded-xl border border-slate-200/50 dark:border-slate-800/30 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Layers className="h-5 w-5 text-muted-foreground" />
          Medallion Architecture — Data Flow
        </h2>
        <div className="flex items-stretch gap-0 overflow-x-auto">
          {/* Source Systems */}
          <div className="flex-1 min-w-[160px]">
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 h-full">
              <div className="flex items-center gap-2 mb-3">
                <Server className="h-4 w-4 text-blue-400" />
                <p className="text-sm font-semibold text-blue-400">Source Systems</p>
              </div>
              <p className="text-3xl font-bold text-foreground">{s.connections.active}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.connections.total} connections total</p>
              <div className="mt-3 pt-3 border-t border-blue-500/10">
                <p className="text-2xl font-bold text-foreground">{s.dataSources.active}</p>
                <p className="text-xs text-muted-foreground">databases configured</p>
              </div>
            </div>
          </div>

          <div className="flex items-center px-2 text-muted-foreground/30">
            <ArrowRight className="h-6 w-6" />
          </div>

          {/* Landing Zone */}
          <div className="flex-1 min-w-[140px]">
            <div className="rounded-lg border border-slate-500/30 bg-slate-500/5 p-4 h-full">
              <div className="flex items-center gap-2 mb-3">
                <Database className="h-4 w-4 text-slate-400" />
                <p className="text-sm font-semibold text-slate-400">Landing Zone</p>
              </div>
              <p className="text-3xl font-bold text-foreground">{s.entities.landing.active}</p>
              <p className="text-xs text-muted-foreground mt-1">active entities</p>
              <div className="mt-3 pt-3 border-t border-slate-500/10">
                <p className="text-xs text-muted-foreground">{s.entities.landing.total} total registered</p>
              </div>
            </div>
          </div>

          <div className="flex items-center px-2 text-muted-foreground/30">
            <ArrowRight className="h-6 w-6" />
          </div>

          {/* Bronze */}
          <div className="flex-1 min-w-[140px]">
            <div className="rounded-lg border border-amber-600/30 bg-amber-600/5 p-4 h-full">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="h-4 w-4 text-amber-500" />
                <p className="text-sm font-semibold text-amber-500">Bronze</p>
              </div>
              <p className="text-3xl font-bold text-foreground">{s.entities.bronze.active}</p>
              <p className="text-xs text-muted-foreground mt-1">active entities</p>
              <div className="mt-3 pt-3 border-t border-amber-600/10">
                <p className="text-xs text-muted-foreground">{s.entities.bronze.total} total registered</p>
              </div>
            </div>
          </div>

          <div className="flex items-center px-2 text-muted-foreground/30">
            <ArrowRight className="h-6 w-6" />
          </div>

          {/* Silver */}
          <div className="flex-1 min-w-[140px]">
            <div className="rounded-lg border border-gray-400/30 bg-gray-400/5 p-4 h-full">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-gray-300" />
                <p className="text-sm font-semibold text-gray-300">Silver</p>
              </div>
              <p className="text-3xl font-bold text-foreground">{s.entities.silver.active}</p>
              <p className="text-xs text-muted-foreground mt-1">active entities</p>
              <div className="mt-3 pt-3 border-t border-gray-400/10">
                <p className="text-xs text-muted-foreground">{s.entities.silver.total} total registered</p>
              </div>
            </div>
          </div>

          <div className="flex items-center px-2 text-muted-foreground/30">
            <ArrowRight className="h-6 w-6" />
          </div>

          {/* Gold / Business */}
          <div className="flex-1 min-w-[140px]">
            <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-4 h-full">
              <div className="flex items-center gap-2 mb-3">
                <Layers className="h-4 w-4 text-yellow-400" />
                <p className="text-sm font-semibold text-yellow-400">Gold</p>
              </div>
              <p className="text-3xl font-bold text-foreground">{s.workspaces}</p>
              <p className="text-xs text-muted-foreground mt-1">workspaces</p>
              <div className="mt-3 pt-3 border-t border-yellow-500/10">
                <p className="text-xs text-muted-foreground">{s.lakehouses} lakehouses</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Source Systems Detail */}
      <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/20 dark:to-blue-900/10 rounded-xl border border-blue-200/50 dark:border-blue-800/30 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Cable className="h-5 w-5 text-muted-foreground" />
          Source Systems
        </h2>
        {data.sourceSystems.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No source systems registered yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.sourceSystems.map(src => {
              const allActive = src.connections.every(c => c.isActive === 'True') &&
                                src.dataSources.every(d => d.isActive === 'True');
              return (
                <div key={src.namespace} className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                      <p className="font-semibold text-foreground">{src.namespace}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      allActive
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      {allActive ? 'Active' : 'Partial'}
                    </span>
                  </div>

                  <div className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Connections</span>
                      <span className="font-medium text-foreground">{src.connections.length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Data Sources</span>
                      <span className="font-medium text-foreground">{src.dataSources.length}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Landing Entities</span>
                      <span className="font-medium text-foreground">
                        {src.activeEntities.landing}
                        {src.entities.landing !== src.activeEntities.landing && (
                          <span className="text-muted-foreground/60"> / {src.entities.landing}</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Connection names */}
                  <div className="mt-3 pt-3 border-t border-border">
                    {src.dataSources.map(ds => (
                      <div key={ds.name} className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <Database className="h-3 w-3 shrink-0" />
                        <span className="font-mono truncate">{ds.name}</span>
                        <span className={`ml-auto shrink-0 h-1.5 w-1.5 rounded-full ${ds.isActive === 'True' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pipeline Health & Recent Runs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pipeline Health Summary */}
        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/20 dark:to-emerald-900/10 rounded-xl border border-emerald-200/50 dark:border-emerald-800/30 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            Pipeline Health
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-4 text-center">
              <p className="text-3xl font-bold text-emerald-400">{data.pipelineHealth.succeeded}</p>
              <p className="text-xs text-muted-foreground mt-1">Succeeded</p>
            </div>
            <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-4 text-center">
              <p className="text-3xl font-bold text-red-400">{data.pipelineHealth.failed}</p>
              <p className="text-xs text-muted-foreground mt-1">Failed</p>
            </div>
            <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-4 text-center">
              <p className="text-3xl font-bold text-blue-400">{data.pipelineHealth.running}</p>
              <p className="text-xs text-muted-foreground mt-1">Running Now</p>
            </div>
            <div className="rounded-lg bg-muted/50 border border-border p-4 text-center">
              <p className="text-3xl font-bold text-foreground">{data.pipelineHealth.recentRuns}</p>
              <p className="text-xs text-muted-foreground mt-1">Total Recent Runs</p>
            </div>
          </div>

          {data.pipelineHealth.recentRuns > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Success Rate</p>
              </div>
              <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all duration-500"
                  style={{ width: `${data.pipelineHealth.recentRuns > 0 ? (data.pipelineHealth.succeeded / data.pipelineHealth.recentRuns * 100) : 0}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1 text-right">
                {data.pipelineHealth.recentRuns > 0 ? Math.round(data.pipelineHealth.succeeded / data.pipelineHealth.recentRuns * 100) : 0}%
              </p>
            </div>
          )}
        </div>

        {/* Recent Pipeline Runs */}
        <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/20 dark:to-amber-900/10 rounded-xl border border-amber-200/50 dark:border-amber-800/30 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            Recent Pipeline Runs
          </h2>
          {data.recentRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No pipeline runs recorded yet.</p>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {data.recentRuns.map((run, i) => {
                const status = (run.Status || '').toLowerCase();
                const isSuccess = status === 'succeeded';
                const isFailed = status === 'failed';
                const isRunning = status === 'inprogress' || status === 'running';
                return (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                    <div className="shrink-0">
                      {isSuccess && <CheckCircle className="h-4 w-4 text-emerald-400" />}
                      {isFailed && <XCircle className="h-4 w-4 text-red-400" />}
                      {isRunning && <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />}
                      {!isSuccess && !isFailed && !isRunning && <Clock className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {run.PipelineName || run.Name || `Run #${run.PipelineExecutionId || i + 1}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {run.StartTime ? formatTimestamp(run.StartTime) : 'Unknown time'}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                      isSuccess ? 'bg-emerald-500/10 text-emerald-400' :
                      isFailed ? 'bg-red-500/10 text-red-400' :
                      isRunning ? 'bg-blue-500/10 text-blue-400' :
                      'bg-muted text-muted-foreground'
                    }`}>
                      {run.Status || 'Unknown'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Infrastructure Footer */}
      <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/20 dark:to-purple-900/10 rounded-xl border border-purple-200/50 dark:border-purple-800/30 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Server className="h-5 w-5 text-muted-foreground" />
          Infrastructure
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Workspaces</p>
            {data.workspaces.length > 0 ? (
              <div className="space-y-1">
                {data.workspaces.map(ws => (
                  <div key={ws.WorkspaceId} className="flex items-center gap-2 text-sm">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-foreground truncate">{ws.Name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None registered</p>
            )}
          </div>

          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Lakehouses</p>
            {data.lakehouses.length > 0 ? (
              <div className="space-y-1">
                {data.lakehouses.map(lh => (
                  <div key={lh.LakehouseId} className="flex items-center gap-2 text-sm">
                    <Database className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-foreground truncate">{lh.Name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">None registered</p>
            )}
          </div>

          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Active Pipelines</p>
            <p className="text-2xl font-bold text-foreground">{s.pipelines.active}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.pipelines.total} total registered</p>
          </div>

          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Platform</p>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>Microsoft Fabric</p>
              <p className="text-xs">Metadata-Driven Framework</p>
              <p className="text-xs">Medallion Architecture</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer timestamp */}
      <div className="text-center text-xs text-muted-foreground pb-4">
        {data._fromSnapshot ? (
          <span className="text-amber-400">Snapshot mode — SQL database offline</span>
        ) : (
          <span>Live data · Last refreshed {data.lastRefreshed ? formatTimestamp(data.lastRefreshed) : 'N/A'}</span>
        )}
      </div>
    </div>
  );
}
