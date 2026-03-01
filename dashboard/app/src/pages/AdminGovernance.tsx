import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  XCircle,
  RefreshCw,
  ArrowRight,
  Layers,
  Loader2,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEntityDigest } from '@/hooks/useEntityDigest';

// ── Types for API responses ──

interface Connection {
  ConnectionId: string;
  ConnectionGuid: string;
  Name: string;
  Type: string;
  IsActive: string;
}

interface DataSource {
  DataSourceId: string;
  Name: string;
  Namespace: string;
  Type: string;
  Description: string | null;
  IsActive: string;
  ConnectionName: string;
}

interface Pipeline {
  PipelineId: string;
  PipelineGuid: string;
  WorkspaceGuid: string;
  Name: string;
  IsActive: string;
}

interface Workspace {
  WorkspaceId: string;
  WorkspaceGuid: string;
  Name: string;
}

interface Lakehouse {
  LakehouseId: string;
  LakehouseGuid: string;
  WorkspaceGuid: string;
  Name: string;
  IsActive: string;
}

interface DashboardStats {
  activeConnections: number;
  activeDataSources: number;
  activeEntities: number;
  lakehouses: number;
  entityBreakdown: { DataSourceName: string; DataSourceType: string; EntityCount: string }[];
}

// ── Icon component for Fabric SVGs ──

function FabricIcon({ name, className = 'w-5 h-5' }: { name: string; className?: string }) {
  return <img src={`/icons/${name}.svg`} alt={name} className={className} />;
}

// ── Layer colors ──

const layerColors: Record<string, string> = {
  source: '#64748b',
  landing: '#3b82f6',
  bronze: '#f59e0b',
  silver: '#8b5cf6',
  gold: '#10b981',
};

// ── API fetch helper ──

const API = 'http://localhost:8787/api';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export default function AdminGovernance() {
  // ── Entity data from the digest hook (replaces /entities, /bronze-entities, /silver-entities) ──
  const {
    allEntities,
    loading: digestLoading,
    error: digestError,
    refresh: refreshDigest,
  } = useEntityDigest();

  // ── Non-entity metadata (still fetched individually) ──
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [lakehouses, setLakehouses] = useState<Lakehouse[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [hoveredLane, setHoveredLane] = useState<string | null>(null);
  const [expandedLane, setExpandedLane] = useState<string | null>(null);

  const loadMetadata = useCallback(async () => {
    setMetaLoading(true);
    setMetaError(null);
    try {
      const [conn, ds, pipes, ws, lh, st] = await Promise.all([
        fetchJson<Connection[]>('/connections'),
        fetchJson<DataSource[]>('/datasources'),
        fetchJson<Pipeline[]>('/pipelines'),
        fetchJson<Workspace[]>('/workspaces'),
        fetchJson<Lakehouse[]>('/lakehouses'),
        fetchJson<DashboardStats>('/stats'),
      ]);
      setConnections(conn);
      setDataSources(ds);
      setPipelines(pipes);
      setWorkspaces(ws);
      setLakehouses(lh);
      setStats(st);
    } catch (err) {
      setMetaError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setMetaLoading(false);
    }
  }, []);

  useEffect(() => { loadMetadata(); }, [loadMetadata]);

  // ── Combined loading / error state ──
  const loading = digestLoading || metaLoading;
  const error = digestError || metaError;

  const loadData = useCallback(() => {
    refreshDigest();
    loadMetadata();
  }, [refreshDigest, loadMetadata]);

  // ── Derived entity counts from digest ──
  const lzEntityCount = allEntities.length;
  const bronzeEntityCount = useMemo(() => allEntities.filter(e => e.bronzeId !== null).length, [allEntities]);
  const silverEntityCount = useMemo(() => allEntities.filter(e => e.silverId !== null).length, [allEntities]);

  // Derived data
  const activePipelines = pipelines.filter(p => p.IsActive === 'True');
  const pipelinesByCategory = {
    landingZone: activePipelines.filter(p => p.Name.includes('_LDZ_')),
    bronze: activePipelines.filter(p => p.Name.includes('_BRONZE_') || p.Name.includes('_BRZ_')),
    silver: activePipelines.filter(p => p.Name.includes('_SILVER_') || p.Name.includes('_SLV_')),
    orchestration: activePipelines.filter(p => p.Name.includes('_LOAD_') && !p.Name.includes('_LDZ_')),
    utility: activePipelines.filter(p =>
      !p.Name.includes('_LDZ_') && !p.Name.includes('_BRONZE_') && !p.Name.includes('_BRZ_') &&
      !p.Name.includes('_SILVER_') && !p.Name.includes('_SLV_') &&
      !(p.Name.includes('_LOAD_') && !p.Name.includes('_LDZ_'))
    ),
  };

  const devWorkspaces = workspaces.filter(w => w.Name.includes('(D)'));
  const prodWorkspaces = workspaces.filter(w => w.Name.includes('(P)'));
  const configWorkspaces = workspaces.filter(w => !w.Name.includes('(D)') && !w.Name.includes('(P)'));

  // Build swim lane data grouped by data source (driven by digest)
  const sourceLanes = dataSources
    .filter(ds => ds.IsActive === 'True')
    .map(ds => {
      const conn = connections.find(c => c.Name === ds.ConnectionName);
      const dsEntities = allEntities.filter(e => e.source === ds.Name);
      const brzEnts = dsEntities.filter(e => e.bronzeId !== null);
      const slvEnts = dsEntities.filter(e => e.silverId !== null);
      return {
        id: ds.DataSourceId,
        connectionName: conn?.Name || ds.ConnectionName,
        dataSourceName: ds.Name,
        namespace: ds.Namespace,
        type: ds.Type,
        landingCount: dsEntities.length,
        bronzeCount: brzEnts.length,
        silverCount: slvEnts.length,
        digestEntities: dsEntities,
      };
    });

  // Connections with no data source registered yet
  const orphanConnections = connections
    .filter(c => c.IsActive === 'True' && c.Name !== 'ONELAKE')
    .filter(c => !dataSources.some(ds => ds.ConnectionName === c.Name));

  const hasLineageData = sourceLanes.length > 0 || orphanConnections.length > 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading framework metadata...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <XCircle className="w-12 h-12 text-destructive" />
        <p className="text-destructive font-medium">{error}</p>
        <Button onClick={loadData} variant="outline" className="gap-2">
          <RefreshCw className="w-4 h-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">Admin & Governance</h1>
          <p className="text-muted-foreground mt-1">
            Live framework metadata from Fabric SQL Database
          </p>
        </div>
        <Button onClick={loadData} variant="outline" size="sm" className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Health Scorecard — LIVE DATA */}
      <div className="bg-gradient-to-br from-emerald-50 to-blue-50/50 dark:from-emerald-950/20 dark:to-blue-950/10 rounded-xl border border-emerald-200/50 dark:border-emerald-800/30 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-6 flex items-center gap-2">
          <FabricIcon name="fabric" />
          Framework Health
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="bg-muted rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-950/30 rounded-lg flex items-center justify-center">
                <FabricIcon name="pipeline" />
              </div>
              <span className="text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 px-2 py-1 rounded-full">
                {activePipelines.length} active
              </span>
            </div>
            <p className="text-3xl font-bold text-foreground">{pipelines.length}</p>
            <p className="text-sm text-muted-foreground mt-1">Pipelines</p>
            <div className="flex items-center mt-2 space-x-3 text-xs text-muted-foreground">
              <span>{pipelinesByCategory.landingZone.length} LDZ</span>
              <span>{pipelinesByCategory.bronze.length} Bronze</span>
              <span>{pipelinesByCategory.silver.length} Silver</span>
            </div>
          </div>

          <div className="bg-muted rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-950/30 rounded-lg flex items-center justify-center">
                <FabricIcon name="sql_database" />
              </div>
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-1 rounded-full">
                Live
              </span>
            </div>
            <p className="text-3xl font-bold text-foreground">{stats?.activeConnections ?? 0}</p>
            <p className="text-sm text-muted-foreground mt-1">Connections</p>
            <p className="text-xs text-muted-foreground mt-2">{stats?.activeDataSources ?? 0} data sources</p>
          </div>

          <div className="bg-muted rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 bg-purple-100 dark:bg-purple-950/30 rounded-lg flex items-center justify-center">
                <FabricIcon name="lakehouse" />
              </div>
            </div>
            <p className="text-3xl font-bold text-foreground">{stats?.lakehouses ?? 0}</p>
            <p className="text-sm text-muted-foreground mt-1">Lakehouses</p>
            <div className="flex items-center mt-2 space-x-4 text-xs">
              <span className="text-blue-600 dark:text-blue-400">
                {lakehouses.filter(l => workspaces.find(w => w.WorkspaceGuid === l.WorkspaceGuid)?.Name.includes('(D)')).length} Dev
              </span>
              <span className="text-emerald-600 dark:text-emerald-400">
                {lakehouses.filter(l => workspaces.find(w => w.WorkspaceGuid === l.WorkspaceGuid)?.Name.includes('(P)')).length} Prod
              </span>
            </div>
          </div>

          <div className="bg-muted rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="w-10 h-10 bg-amber-100 dark:bg-amber-950/30 rounded-lg flex items-center justify-center">
                <FabricIcon name="sql_database" className="w-5 h-5" />
              </div>
            </div>
            <div className="flex items-baseline space-x-2">
              <p className="text-3xl font-bold text-foreground">{stats?.activeEntities ?? 0}</p>
              <p className="text-sm text-muted-foreground">entities</p>
            </div>
            <div className="flex items-center mt-2 space-x-4 text-xs">
              <span className="flex items-center text-blue-600 dark:text-blue-400">
                <div className="w-2 h-2 bg-blue-500 rounded-full mr-1.5"></div>
                {lzEntityCount} Landing
              </span>
              <span className="flex items-center text-amber-600 dark:text-amber-400">
                <div className="w-2 h-2 bg-amber-500 rounded-full mr-1.5"></div>
                {bronzeEntityCount} Bronze
              </span>
              <span className="flex items-center text-purple-600 dark:text-purple-400">
                <div className="w-2 h-2 bg-purple-500 rounded-full mr-1.5"></div>
                {silverEntityCount} Silver
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Entity Inventory by Layer */}
      <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/20 dark:to-purple-900/10 rounded-xl border border-purple-200/50 dark:border-purple-800/30 p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
          <Layers className="w-5 h-5" />
          Entity Inventory by Layer
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Connections', count: connections.filter(c => c.IsActive === 'True').length, color: layerColors.source, icon: 'sql_database' },
            { label: 'Landing Zone', count: lzEntityCount, color: layerColors.landing, icon: 'lakehouse' },
            { label: 'Bronze', count: bronzeEntityCount, color: layerColors.bronze, icon: 'lakehouse' },
            { label: 'Silver', count: silverEntityCount, color: layerColors.silver, icon: 'lakehouse' },
          ].map((item, index) => (
            <div key={item.label} className="relative bg-muted rounded-lg p-5 border border-border overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full" style={{ backgroundColor: item.color }}></div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center">
                  <FabricIcon name={item.icon} className="w-5 h-5 mr-2" />
                  <span className="font-medium text-foreground">{item.label}</span>
                </div>
                <span className="text-xs px-2 py-1 rounded-full font-medium" style={{
                  backgroundColor: `${item.color}15`,
                  color: item.color,
                }}>
                  Layer {index}
                </span>
              </div>
              <p className="text-3xl font-bold text-foreground">{item.count}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {item.count === 0 ? 'Not yet registered' : `${item.count} registered`}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Data Lineage — Enhanced Swim Lane Flow */}
      <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/20 dark:to-slate-900/10 rounded-xl border border-slate-200/50 dark:border-slate-800/30 p-6 shadow-sm overflow-hidden">
        <style>{`
          @keyframes flowRight {
            from { background-position: 0 0; }
            to { background-position: 16px 0; }
          }
          .flow-active {
            height: 2px;
            background: repeating-linear-gradient(90deg,
              var(--fc) 0px, var(--fc) 6px,
              transparent 6px, transparent 10px
            );
            background-size: 16px 2px;
            animation: flowRight 0.6s linear infinite;
          }
          .flow-empty {
            height: 2px;
            background: repeating-linear-gradient(90deg,
              var(--fc) 0px, var(--fc) 2px,
              transparent 2px, transparent 8px
            );
            background-size: 8px 2px;
            opacity: 0.15;
          }
        `}</style>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Data Lineage</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Live data flow traced through the medallion architecture
            </p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center space-x-6 mb-4 pb-4 border-b border-border">
          <span className="text-sm font-medium text-muted-foreground">Layers:</span>
          {[
            { label: 'Source', color: layerColors.source },
            { label: 'Landing', color: layerColors.landing },
            { label: 'Bronze', color: layerColors.bronze },
            { label: 'Silver', color: layerColors.silver },
            { label: 'Gold', color: layerColors.gold },
          ].map((item) => (
            <div key={item.label} className="flex items-center">
              <div className="w-3 h-3 rounded-full mr-1.5" style={{ backgroundColor: item.color }}></div>
              <span className="text-sm text-muted-foreground">{item.label}</span>
            </div>
          ))}
        </div>

        {!hasLineageData ? (
          <div className="text-center py-12 text-muted-foreground">
            <FabricIcon name="databases" className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No lineage data yet</p>
            <p className="text-sm mt-1">Register connections, data sources, and entities in Source Manager to build the lineage graph</p>
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div className="flex items-center mb-2 px-1">
              <div className="w-[170px] shrink-0 text-xs uppercase tracking-wider font-semibold text-center" style={{ color: layerColors.source }}>Source</div>
              <div className="flex-1" />
              <div className="w-[120px] shrink-0 text-xs uppercase tracking-wider font-semibold text-center" style={{ color: layerColors.landing }}>Landing Zone</div>
              <div className="flex-1" />
              <div className="w-[120px] shrink-0 text-xs uppercase tracking-wider font-semibold text-center" style={{ color: layerColors.bronze }}>Bronze</div>
              <div className="flex-1" />
              <div className="w-[120px] shrink-0 text-xs uppercase tracking-wider font-semibold text-center" style={{ color: layerColors.silver }}>Silver</div>
              <div className="flex-1" />
              <div className="w-[120px] shrink-0 text-xs uppercase tracking-wider font-semibold text-center" style={{ color: layerColors.gold }}>Gold</div>
            </div>

            {/* Swim lanes */}
            <div className="space-y-1">
              {sourceLanes.map(lane => {
                const isDimmed = hoveredLane !== null && hoveredLane !== lane.id;
                const isExpanded = expandedLane === lane.id;

                return (
                  <div key={lane.id}>
                    {/* Lane row */}
                    <div
                      className={`flex items-center px-1 py-1.5 rounded-lg cursor-pointer hover:bg-muted/50 transition-all duration-200 ${isDimmed ? 'opacity-[0.12]' : ''}`}
                      onMouseEnter={() => setHoveredLane(lane.id)}
                      onMouseLeave={() => setHoveredLane(null)}
                      onClick={() => setExpandedLane(isExpanded ? null : lane.id)}
                    >
                      {/* Source node */}
                      <div className="w-[170px] shrink-0">
                        <div className="rounded-lg border-2 px-3 py-2 bg-card relative overflow-hidden" style={{ borderColor: layerColors.source }}>
                          <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: layerColors.source }} />
                          <div className="flex items-center gap-1.5 ml-1">
                            {isExpanded
                              ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                              : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                            }
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold text-foreground truncate">{lane.dataSourceName}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{lane.connectionName}</p>
                            </div>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                              {lane.type.replace('_01', '')}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Connector → Landing */}
                      <div className="flex-1 mx-1.5">
                        <div className={lane.landingCount > 0 ? 'flow-active' : 'flow-empty'} style={{ '--fc': layerColors.landing } as React.CSSProperties} />
                      </div>

                      {/* Landing node */}
                      <div className="w-[120px] shrink-0">
                        {lane.landingCount > 0 ? (
                          <div className="rounded-lg border-2 px-2 py-2 bg-card relative overflow-hidden text-center" style={{ borderColor: layerColors.landing }}>
                            <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: layerColors.landing }} />
                            <p className="text-xl font-bold leading-none" style={{ color: layerColors.landing }}>{lane.landingCount}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">entities</p>
                          </div>
                        ) : (
                          <div className="rounded-lg border-2 border-dashed px-2 py-2 text-center" style={{ borderColor: `${layerColors.landing}30` }}>
                            <p className="text-xl font-bold leading-none text-muted-foreground/20">0</p>
                            <p className="text-[10px] text-muted-foreground/30 mt-0.5">pending</p>
                          </div>
                        )}
                      </div>

                      {/* Connector → Bronze */}
                      <div className="flex-1 mx-1.5">
                        <div className={lane.bronzeCount > 0 ? 'flow-active' : 'flow-empty'} style={{ '--fc': layerColors.bronze } as React.CSSProperties} />
                      </div>

                      {/* Bronze node */}
                      <div className="w-[120px] shrink-0">
                        {lane.bronzeCount > 0 ? (
                          <div className="rounded-lg border-2 px-2 py-2 bg-card relative overflow-hidden text-center" style={{ borderColor: layerColors.bronze }}>
                            <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: layerColors.bronze }} />
                            <p className="text-xl font-bold leading-none" style={{ color: layerColors.bronze }}>{lane.bronzeCount}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">entities</p>
                          </div>
                        ) : (
                          <div className="rounded-lg border-2 border-dashed px-2 py-2 text-center" style={{ borderColor: `${layerColors.bronze}30` }}>
                            <p className="text-xl font-bold leading-none text-muted-foreground/20">0</p>
                            <p className="text-[10px] text-muted-foreground/30 mt-0.5">pending</p>
                          </div>
                        )}
                      </div>

                      {/* Connector → Silver */}
                      <div className="flex-1 mx-1.5">
                        <div className={lane.silverCount > 0 ? 'flow-active' : 'flow-empty'} style={{ '--fc': layerColors.silver } as React.CSSProperties} />
                      </div>

                      {/* Silver node */}
                      <div className="w-[120px] shrink-0">
                        {lane.silverCount > 0 ? (
                          <div className="rounded-lg border-2 px-2 py-2 bg-card relative overflow-hidden text-center" style={{ borderColor: layerColors.silver }}>
                            <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: layerColors.silver }} />
                            <p className="text-xl font-bold leading-none" style={{ color: layerColors.silver }}>{lane.silverCount}</p>
                            <p className="text-[10px] text-muted-foreground mt-0.5">entities</p>
                          </div>
                        ) : (
                          <div className="rounded-lg border-2 border-dashed px-2 py-2 text-center" style={{ borderColor: `${layerColors.silver}30` }}>
                            <p className="text-xl font-bold leading-none text-muted-foreground/20">0</p>
                            <p className="text-[10px] text-muted-foreground/30 mt-0.5">pending</p>
                          </div>
                        )}
                      </div>

                      {/* Connector → Gold */}
                      <div className="flex-1 mx-1.5">
                        <div className="flow-empty" style={{ '--fc': layerColors.gold } as React.CSSProperties} />
                      </div>

                      {/* Gold node (future - MLVs) */}
                      <div className="w-[120px] shrink-0">
                        <div className="rounded-lg border-2 border-dashed px-2 py-2 text-center" style={{ borderColor: `${layerColors.gold}30` }}>
                          <p className="text-xl font-bold leading-none text-muted-foreground/20">0</p>
                          <p className="text-[10px] text-muted-foreground/30 mt-0.5">MLV</p>
                        </div>
                      </div>
                    </div>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <div className="ml-[170px] mt-1 mb-2 bg-muted/40 rounded-lg border border-border p-4 animate-in slide-in-from-top-2 duration-200">
                        <div className="grid grid-cols-3 gap-6">
                          {/* Landing entities */}
                          <div>
                            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: layerColors.landing }}>
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: layerColors.landing }} />
                              Landing Zone ({lane.landingCount})
                            </p>
                            <div className="space-y-0.5 max-h-40 overflow-y-auto">
                              {lane.digestEntities.map(e => (
                                <div key={e.id} className="flex items-center gap-2 text-[11px]">
                                  <span className="font-mono text-muted-foreground w-10 shrink-0">{e.sourceSchema}</span>
                                  <span className="font-mono text-foreground/80 truncate">{e.tableName}</span>
                                  <span className={`ml-auto text-[9px] px-1 py-0.5 rounded shrink-0 ${
                                    e.isIncremental
                                      ? 'bg-blue-100 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400'
                                      : 'bg-muted text-muted-foreground'
                                  }`}>
                                    {e.isIncremental ? 'INC' : 'FULL'}
                                  </span>
                                </div>
                              ))}
                              {lane.landingCount === 0 && <p className="text-[11px] text-muted-foreground italic">No entities registered</p>}
                            </div>
                          </div>

                          {/* Bronze entities */}
                          <div>
                            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: layerColors.bronze }}>
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: layerColors.bronze }} />
                              Bronze ({lane.bronzeCount})
                            </p>
                            <div className="space-y-0.5 max-h-40 overflow-y-auto">
                              {lane.digestEntities.filter(e => e.bronzeId !== null).map(e => (
                                <div key={`brz-${e.id}`} className="flex items-center gap-2 text-[11px]">
                                  <span className="font-mono text-muted-foreground w-10 shrink-0">{e.sourceSchema}</span>
                                  <span className="font-mono text-foreground/80 truncate">{e.tableName}</span>
                                </div>
                              ))}
                              {lane.bronzeCount === 0 && <p className="text-[11px] text-muted-foreground italic">Not yet processed</p>}
                            </div>
                          </div>

                          {/* Silver entities */}
                          <div>
                            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: layerColors.silver }}>
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: layerColors.silver }} />
                              Silver ({lane.silverCount})
                            </p>
                            <div className="space-y-0.5 max-h-40 overflow-y-auto">
                              {lane.digestEntities.filter(e => e.silverId !== null).map(e => (
                                <div key={`slv-${e.id}`} className="flex items-center gap-2 text-[11px]">
                                  <span className="font-mono text-muted-foreground w-10 shrink-0">{e.sourceSchema}</span>
                                  <span className="font-mono text-foreground/80 truncate">{e.tableName}</span>
                                </div>
                              ))}
                              {lane.silverCount === 0 && <p className="text-[11px] text-muted-foreground italic">Not yet processed</p>}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Orphan connections (no data source yet) */}
              {orphanConnections.map(conn => {
                const isDimmed = hoveredLane !== null && hoveredLane !== `orphan-${conn.ConnectionId}`;
                return (
                  <div
                    key={`orphan-${conn.ConnectionId}`}
                    className={`flex items-center px-1 py-1.5 rounded-lg transition-all duration-200 ${isDimmed ? 'opacity-[0.12]' : ''}`}
                    onMouseEnter={() => setHoveredLane(`orphan-${conn.ConnectionId}`)}
                    onMouseLeave={() => setHoveredLane(null)}
                  >
                    {/* Source node (dashed - pending) */}
                    <div className="w-[170px] shrink-0">
                      <div className="rounded-lg border-2 border-dashed px-3 py-2 bg-card relative" style={{ borderColor: `${layerColors.source}50` }}>
                        <div className="flex items-center gap-1.5">
                          <FabricIcon name="sql_database" className="w-3.5 h-3.5 shrink-0 opacity-40" />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-muted-foreground truncate">{conn.Name}</p>
                            <p className="text-[10px] text-muted-foreground/50">No data source</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Empty connectors + placeholder nodes */}
                    {[layerColors.landing, layerColors.bronze, layerColors.silver, layerColors.gold].map((color, i) => (
                      <div key={i} className="contents">
                        <div className="flex-1 mx-1.5">
                          <div className="flow-empty" style={{ '--fc': color } as React.CSSProperties} />
                        </div>
                        <div className="w-[120px] shrink-0">
                          <div className="rounded-lg border-2 border-dashed px-2 py-2 text-center" style={{ borderColor: `${color}15` }}>
                            <p className="text-xl font-bold leading-none text-muted-foreground/10">—</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Flow Summary */}
            <div className="mt-6 pt-4 border-t border-border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {sourceLanes.length} source{sourceLanes.length !== 1 ? 's' : ''} registered
                  {orphanConnections.length > 0 && ` \u00b7 ${orphanConnections.length} connection${orphanConnections.length !== 1 ? 's' : ''} pending`}
                </span>
                <div className="flex items-center space-x-6">
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">{connections.filter(c => c.IsActive === 'True').length}</span> connections
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">{lzEntityCount}</span> landing
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">{bronzeEntityCount}</span> bronze
                  </span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    <span className="font-medium text-foreground">{silverEntityCount}</span> silver
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Workspaces & Lakehouses + Pipeline Inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Workspaces */}
        <div className="bg-gradient-to-br from-blue-50 to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/10 rounded-xl border border-blue-200/50 dark:border-blue-800/30 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <FabricIcon name="folder" />
            Workspaces & Lakehouses
          </h2>

          {/* Dev */}
          {devWorkspaces.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Development</h3>
              <div className="space-y-2">
                {devWorkspaces.map(ws => (
                  <div key={ws.WorkspaceId} className="p-3 bg-muted rounded-lg border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <FabricIcon name="fabric" className="w-4 h-4" />
                      <span className="font-medium text-sm text-foreground">{ws.Name}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 ml-6">
                      {lakehouses.filter(l => l.WorkspaceGuid === ws.WorkspaceGuid).map(lh => (
                        <span key={lh.LakehouseId} className="text-xs bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-full flex items-center gap-1">
                          <FabricIcon name="lakehouse" className="w-3 h-3" />
                          {lh.Name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Prod */}
          {prodWorkspaces.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Production</h3>
              <div className="space-y-2">
                {prodWorkspaces.map(ws => (
                  <div key={ws.WorkspaceId} className="p-3 bg-muted rounded-lg border border-border">
                    <div className="flex items-center gap-2 mb-2">
                      <FabricIcon name="fabric" className="w-4 h-4" />
                      <span className="font-medium text-sm text-foreground">{ws.Name}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 ml-6">
                      {lakehouses.filter(l => l.WorkspaceGuid === ws.WorkspaceGuid).map(lh => (
                        <span key={lh.LakehouseId} className="text-xs bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-300 px-2 py-1 rounded-full flex items-center gap-1">
                          <FabricIcon name="lakehouse" className="w-3 h-3" />
                          {lh.Name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Config */}
          {configWorkspaces.length > 0 && (
            <div>
              <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Config</h3>
              <div className="space-y-2">
                {configWorkspaces.map(ws => (
                  <div key={ws.WorkspaceId} className="p-3 bg-muted rounded-lg border border-border">
                    <div className="flex items-center gap-2">
                      <FabricIcon name="fabric" className="w-4 h-4" />
                      <span className="font-medium text-sm text-foreground">{ws.Name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Pipeline Inventory */}
        <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/20 dark:to-amber-900/10 rounded-xl border border-amber-200/50 dark:border-amber-800/30 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <FabricIcon name="pipeline" />
            Pipeline Inventory ({activePipelines.length} active)
          </h2>

          {[
            { label: 'Landing Zone', pipes: pipelinesByCategory.landingZone, color: 'blue' },
            { label: 'Bronze Layer', pipes: pipelinesByCategory.bronze, color: 'amber' },
            { label: 'Silver Layer', pipes: pipelinesByCategory.silver, color: 'purple' },
            { label: 'Orchestration', pipes: pipelinesByCategory.orchestration, color: 'emerald' },
            { label: 'Utility', pipes: pipelinesByCategory.utility, color: 'slate' },
          ].filter(cat => cat.pipes.length > 0).map(cat => (
            <div key={cat.label} className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">{cat.label}</h3>
                <span className={`text-xs font-medium text-${cat.color}-600 dark:text-${cat.color}-400 bg-${cat.color}-50 dark:bg-${cat.color}-950/20 px-2 py-0.5 rounded-full`}>
                  {cat.pipes.length}
                </span>
              </div>
              <div className="space-y-1">
                {cat.pipes.map(p => (
                  <div key={p.PipelineId} className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 rounded text-sm hover:bg-muted transition-colors">
                    <FabricIcon name="pipeline" className="w-3.5 h-3.5 opacity-60" />
                    <span className="text-foreground/80 font-mono text-xs">{p.Name}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
