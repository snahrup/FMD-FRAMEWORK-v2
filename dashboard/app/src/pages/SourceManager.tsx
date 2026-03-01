import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Database,
  Server,
  Plus,
  CheckCircle,
  Circle,
  ChevronRight,
  ChevronDown,
  Cable,
  TableProperties,
  FolderInput,
  Copy,
  RefreshCw,
  Search,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Info,
  Trash2,
  X,
  Square,
  CheckSquare,
  MinusSquare,
  Route,
  Zap,
  ArrowUpDown,
  Settings2,
  Layers,
  TrendingUp,
} from 'lucide-react';
import { SourceOnboardingWizard } from '@/components/sources/SourceOnboardingWizard';
import { useEntityDigest, invalidateDigestCache } from '@/hooks/useEntityDigest';
import type { DigestEntity } from '@/hooks/useEntityDigest';

// ── Types matching API responses ──

interface GatewayConnection {
  id: string;
  displayName: string;
  server: string;
  database: string;
  authType: string;
  encryption: string;
  connectivityType: string;
  gatewayId: string;
}

interface RegisteredConnection {
  ConnectionId: string;
  ConnectionGuid: string;
  Name: string;
  Type: string;
  IsActive: string;
}

interface RegisteredDataSource {
  DataSourceId: string;
  Name: string;
  Namespace: string;
  Type: string;
  Description: string;
  ConnectionName: string;
  IsActive: string;
}

interface RegisteredEntity {
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

interface CascadeImpact {
  landing: { LandingzoneEntityId: number; SourceSchema: string; SourceName: string; DataSourceName: string }[];
  bronze: { BronzeLayerEntityId: number; SourceSchema: string; SourceName: string; DestinationName: string }[];
  silver: { SilverLayerEntityId: number; SourceSchema: string; SourceName: string; DestinationName: string }[];
}

interface LoadConfigEntity {
  entityId: number;
  schema: string;
  table: string;
  dataSource: string;
  dataSourceId: number;
  IsIncremental: boolean | number;
  watermarkColumn: string | null;
  lastWatermarkValue: string | null;
  lastLoadTime: string | null;
  bronzeEntityId: number | null;
  primaryKeys: string | null;
  silverEntityId: number | null;
  FileName: string | null;
}

interface AnalysisResult {
  datasource: string;
  datasourceId: number;
  server: string;
  database: string;
  summary: {
    total: number;
    incrementalRecommended: number;
    fullLoadOnly: number;
    hasPrimaryKeys: number;
    noPrimaryKeys: number;
    bronzeRegistered: number;
    silverRegistered: number;
  };
  entities: Array<{
    entityId: number;
    schema: string;
    table: string;
    rowCount: number | null;
    primaryKeys: string[];
    recommendedLoad: string;
    recommendedColumn: string | null;
  }>;
}

/** Map a DigestEntity to the legacy RegisteredEntity shape used throughout this page. */
function digestToRegistered(d: DigestEntity): RegisteredEntity {
  return {
    LandingzoneEntityId: String(d.id),
    SourceSchema: d.sourceSchema,
    SourceName: d.tableName,
    FileName: d.tableName,
    FilePath: d.source,
    FileType: 'parquet',
    IsIncremental: d.isIncremental ? 'True' : 'False',
    IsActive: d.isActive ? 'True' : 'False',
    DataSourceName: d.source,
  };
}

export default function SourceManager() {
  // ── Entity data from digest hook (replaces /api/entities fetch) ──
  const {
    allEntities: digestEntities,
    refresh: refreshDigest,
    loading: digestLoading,
  } = useEntityDigest();

  // Derive registeredEntities from the digest
  const registeredEntities = digestEntities.map(digestToRegistered);

  // ── Data state (live from API — everything except entities) ──
  const [gatewayConnections, setGatewayConnections] = useState<GatewayConnection[]>([]);
  const [registeredConnections, setRegisteredConnections] = useState<RegisteredConnection[]>([]);
  const [registeredDataSources, setRegisteredDataSources] = useState<RegisteredDataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // ── UI state ──
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedConnection, setExpandedConnection] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ── Entity delete state ──
  const [deleteTarget, setDeleteTarget] = useState<RegisteredEntity | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Multi-select state ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  // ── Cascade impact state ──
  const [cascadeImpact, setCascadeImpact] = useState<CascadeImpact | null>(null);
  const [loadingImpact, setLoadingImpact] = useState(false);

  // ── Load Optimization Engine state ──
  const [entityViewMode, setEntityViewMode] = useState<'registry' | 'loadConfig'>('registry');
  const [loadConfigData, setLoadConfigData] = useState<LoadConfigEntity[]>([]);
  const [loadConfigLoading, setLoadConfigLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeTarget, setAnalyzeTarget] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState<Map<number, { isIncremental?: boolean; column?: string }>>(new Map());
  const [savingConfig, setSavingConfig] = useState(false);
  const [loadConfigFilter, setLoadConfigFilter] = useState<'all' | 'incremental' | 'full'>('all');

  // ── Entity group expand state (by data source name — start all expanded) ──
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [sourcesInitialized, setSourcesInitialized] = useState(false);

  // Auto-expand all sources on first data load
  useEffect(() => {
    if (!sourcesInitialized && registeredEntities.length > 0) {
      setExpandedSources(new Set(registeredEntities.map(e => e.DataSourceName)));
      setSourcesInitialized(true);
    }
  }, [registeredEntities, sourcesInitialized]);

  const toggleSource = (sourceName: string) => {
    setExpandedSources(prev => {
      const next = new Set(prev);
      if (next.has(sourceName)) next.delete(sourceName);
      else next.add(sourceName);
      return next;
    });
  };

  const expandAllSources = () => {
    const allNames = new Set(registeredEntities.map(e => e.DataSourceName));
    setExpandedSources(allNames);
  };

  // Friendly label: strip underscores → spaces, trim
  const friendlyLabel = (name: string) => (name.replace(/_/g, ' ').trim() || name).toUpperCase();

  // Group entities by data source
  const entityGroups = registeredEntities.reduce<Record<string, RegisteredEntity[]>>((acc, e) => {
    const key = e.DataSourceName || 'Unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {});

  // ── Multi-select helpers ──
  const toggleEntity = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroupAll = (sourceName: string) => {
    const groupIds = (entityGroups[sourceName] || []).map(e => e.LandingzoneEntityId);
    const allSelected = groupIds.every(id => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        groupIds.forEach(id => next.delete(id));
      } else {
        groupIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const groupSelectionState = (sourceName: string): 'none' | 'some' | 'all' => {
    const groupIds = (entityGroups[sourceName] || []).map(e => e.LandingzoneEntityId);
    const count = groupIds.filter(id => selectedIds.has(id)).length;
    if (count === 0) return 'none';
    if (count === groupIds.length) return 'all';
    return 'some';
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedEntitiesList = registeredEntities.filter(e => selectedIds.has(e.LandingzoneEntityId));

  // Fetch cascade impact for given entity IDs
  const fetchCascadeImpact = async (ids: string[]) => {
    setLoadingImpact(true);
    setCascadeImpact(null);
    try {
      const res = await fetch(`/api/entities/cascade-impact?ids=${ids.join(',')}`);
      if (res.ok) setCascadeImpact(await res.json());
    } catch (e) {
      console.warn('Cascade impact lookup failed:', e);
    }
    setLoadingImpact(false);
  };

  // Trigger single delete modal with cascade impact
  const openDeleteModal = (entity: RegisteredEntity) => {
    setDeleteTarget(entity);
    fetchCascadeImpact([entity.LandingzoneEntityId]);
  };

  // Trigger bulk delete modal with cascade impact
  const openBulkDeleteModal = () => {
    setShowBulkConfirm(true);
    fetchCascadeImpact(Array.from(selectedIds));
  };

  // Delete single entity handler
  const handleDeleteEntity = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/entities/${deleteTarget.LandingzoneEntityId}`, { method: 'DELETE' });
      const result = await res.json();
      if (result.success) {
        invalidateDigestCache();
        refreshDigest();
        setSelectedIds(prev => { const next = new Set(prev); next.delete(deleteTarget.LandingzoneEntityId); return next; });
        setActionStatus({ type: 'success', message: result.message });
      } else {
        setActionStatus({ type: 'error', message: result.error || 'Delete failed' });
      }
    } catch (e) {
      setActionStatus({ type: 'error', message: e instanceof Error ? e.message : 'Delete failed' });
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
      setCascadeImpact(null);
    }
  };

  // Bulk delete handler
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeleting(true);
    try {
      const ids = Array.from(selectedIds).map(id => parseInt(id, 10));
      const res = await fetch('/api/entities/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const result = await res.json();
      if (result.success) {
        invalidateDigestCache();
        refreshDigest();
        setSelectedIds(new Set());
        setActionStatus({ type: 'success', message: result.message });
      } else {
        setActionStatus({ type: 'error', message: result.error || 'Bulk delete failed' });
      }
    } catch (e) {
      setActionStatus({ type: 'error', message: e instanceof Error ? e.message : 'Bulk delete failed' });
    } finally {
      setDeleting(false);
      setShowBulkConfirm(false);
      setCascadeImpact(null);
    }
  };

  // ── Data loading (gateway connections, connections, datasources — entities come from digest) ──
  const loadData = useCallback(async (background = false) => {
    if (background) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [gwRes, connRes, dsRes] = await Promise.all([
        fetch('/api/gateway-connections'),
        fetch('/api/connections'),
        fetch('/api/datasources'),
      ]);

      if (!gwRes.ok || !connRes.ok || !dsRes.ok) {
        throw new Error('API server not responding. Run: python dashboard/app/api/server.py');
      }

      const [gw, conn, ds] = await Promise.all([
        gwRes.json(), connRes.json(), dsRes.json(),
      ]);

      setGatewayConnections(gw);
      setRegisteredConnections(conn);
      setRegisteredDataSources(ds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Initial load only — no re-fetch on StrictMode re-mount since loadData identity is stable
  useEffect(() => { loadData(); }, [loadData]);

  // ── Load Configuration functions ──
  const fetchLoadConfig = useCallback(async (datasourceId?: number) => {
    setLoadConfigLoading(true);
    try {
      const url = datasourceId
        ? `/api/load-config?datasource=${datasourceId}`
        : '/api/load-config';
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setLoadConfigData(data);
        setPendingUpdates(new Map());
      }
    } catch (e) {
      console.warn('Failed to fetch load config:', e);
    } finally {
      setLoadConfigLoading(false);
    }
  }, []);

  const handleAnalyzeSource = async (datasourceId: number) => {
    setAnalyzing(true);
    setAnalyzeTarget(String(datasourceId));
    setActionStatus(null);
    try {
      const res = await fetch(`/api/analyze-source?datasource=${datasourceId}`);
      if (res.ok) {
        const result: AnalysisResult = await res.json();
        setActionStatus({
          type: 'success',
          message: `Analyzed ${result.summary.total} tables: ${result.summary.incrementalRecommended} incremental candidates, ${result.summary.hasPrimaryKeys} with PKs`,
        });
        // Refresh load config with new data + invalidate digest
        invalidateDigestCache();
        refreshDigest();
        await fetchLoadConfig();
      } else {
        const err = await res.json();
        setActionStatus({ type: 'error', message: err.error || 'Analysis failed' });
      }
    } catch (e) {
      setActionStatus({ type: 'error', message: e instanceof Error ? e.message : 'Analysis failed' });
    } finally {
      setAnalyzing(false);
      setAnalyzeTarget(null);
    }
  };

  const handleRegisterBronzeSilver = async (datasourceId: number) => {
    setRegistering(true);
    setActionStatus(null);
    try {
      const res = await fetch('/api/register-bronze-silver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasourceId }),
      });
      if (res.ok) {
        const result = await res.json();
        setActionStatus({
          type: 'success',
          message: `Registered ${result.bronzeCreated || 0} Bronze + ${result.silverCreated || 0} Silver entities`,
        });
        invalidateDigestCache();
        refreshDigest();
        await fetchLoadConfig();
      } else {
        const err = await res.json();
        setActionStatus({ type: 'error', message: err.error || 'Registration failed' });
      }
    } catch (e) {
      setActionStatus({ type: 'error', message: e instanceof Error ? e.message : 'Registration failed' });
    } finally {
      setRegistering(false);
    }
  };

  const updatePending = (entityId: number, field: 'isIncremental' | 'column', value: boolean | string) => {
    setPendingUpdates(prev => {
      const next = new Map(prev);
      const existing = next.get(entityId) || {};
      if (field === 'isIncremental') existing.isIncremental = value as boolean;
      else existing.column = value as string;
      next.set(entityId, existing);
      return next;
    });
  };

  const handleSaveLoadConfig = async () => {
    if (pendingUpdates.size === 0) return;
    setSavingConfig(true);
    setActionStatus(null);
    try {
      const updates = Array.from(pendingUpdates.entries()).map(([entityId, changes]) => ({
        entityId,
        isIncremental: changes.isIncremental,
        watermarkColumn: changes.column,
      }));
      const res = await fetch('/api/load-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      if (res.ok) {
        const result = await res.json();
        setActionStatus({ type: 'success', message: `Updated ${result.updated || 0} entities` });
        setPendingUpdates(new Map());
        invalidateDigestCache();
        refreshDigest();
        await fetchLoadConfig();
      } else {
        const err = await res.json();
        setActionStatus({ type: 'error', message: err.error || 'Save failed' });
      }
    } catch (e) {
      setActionStatus({ type: 'error', message: e instanceof Error ? e.message : 'Save failed' });
    } finally {
      setSavingConfig(false);
    }
  };

  // Auto-fetch load config when switching to loadConfig tab
  useEffect(() => {
    if (entityViewMode === 'loadConfig' && loadConfigData.length === 0) {
      fetchLoadConfig();
    }
  }, [entityViewMode, loadConfigData.length, fetchLoadConfig]);

  // ── Load config derived data ──
  const isEntityIncremental = (e: LoadConfigEntity) => e.IsIncremental === true || e.IsIncremental === 1;
  const filteredLoadConfig = loadConfigData.filter(e => {
    if (loadConfigFilter === 'incremental') return isEntityIncremental(e);
    if (loadConfigFilter === 'full') return !isEntityIncremental(e);
    return true;
  });
  const loadConfigBySource = filteredLoadConfig.reduce<Record<string, LoadConfigEntity[]>>((acc, e) => {
    const key = e.dataSource || 'Unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {});
  const incrementalCount = loadConfigData.filter(e => isEntityIncremental(e)).length;
  const fullCount = loadConfigData.filter(e => !isEntityIncremental(e)).length;
  const bronzeRegistered = loadConfigData.filter(e => e.bronzeEntityId != null).length;
  const silverRegistered = loadConfigData.filter(e => e.silverEntityId != null).length;

  // Get unique datasource IDs for action buttons
  const uniqueDataSources = Array.from(
    new Map(loadConfigData.map(e => [e.dataSourceId, e.dataSource])).entries()
  );

  // ── Check if a gateway connection is registered ──
  const isRegistered = (gwConn: GatewayConnection): RegisteredConnection | undefined => {
    return registeredConnections.find(
      rc => rc.ConnectionGuid.toLowerCase() === gwConn.id.toLowerCase()
    );
  };

  // ── Get data sources for a registered connection ──
  const getDataSourcesForConnection = (connName: string): RegisteredDataSource[] => {
    return registeredDataSources.filter(ds => ds.ConnectionName === connName);
  };

  // ── Actions ──
  const registerConnection = async (gwConn: GatewayConnection) => {
    setSubmitting(true);
    setActionStatus(null);
    // Generate FMD name from server + database
    const serverShort = gwConn.server.split('.')[0].toUpperCase().replace(/-/g, '');
    const dbShort = gwConn.database.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const fmdName = `CON_FMD_${serverShort}_${dbShort}`;

    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionGuid: gwConn.id,
          name: fmdName,
          type: 'SqlServer',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionStatus({ type: 'success', message: data.message || `Registered ${fmdName}` });
        invalidateDigestCache();
        refreshDigest();
        await loadData(true);
      } else {
        setActionStatus({ type: 'error', message: data.error || 'Registration failed' });
      }
    } catch (e) {
      setActionStatus({ type: 'error', message: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Derived data ──
  const filteredConnections = gatewayConnections.filter(c =>
    c.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.server.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.database.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const registeredCount = gatewayConnections.filter(c => isRegistered(c)).length;
  const externalSources = registeredDataSources.filter(ds => ds.Type === 'ASQL_01');
  const sqlConnections = registeredConnections.filter(c => c.Type === 'SqlServer');

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // ── Loading / Error states ──
  if (loading || digestLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Connecting to Fabric SQL Database...</p>
          <p className="text-xs text-muted-foreground mt-1">Loading gateway connections and registered sources</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-4" />
          <p className="text-foreground font-medium mb-2">API Server Not Running</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <div className="bg-muted rounded-lg p-4 text-left">
            <p className="text-xs text-muted-foreground mb-2">Start the API server:</p>
            <code className="text-sm font-mono text-foreground">python dashboard/app/api/server.py</code>
          </div>
          <button onClick={() => loadData()} className="mt-4 flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors mx-auto">
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">Source Manager</h1>
          <p className="text-muted-foreground mt-1">
            Register gateway connections, configure data sources, and manage landing zone entities
          </p>
        </div>
        <button
          onClick={() => setShowOnboarding(true)}
          className="flex items-center gap-2 px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium shrink-0"
        >
          <Plus className="h-4 w-4" />
          New Data Source
        </button>
      </div>

      {/* Action Status Banner */}
      {actionStatus && (
        <div className={`rounded-lg p-4 flex items-center justify-between ${
          actionStatus.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800'
            : 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800'
        }`}>
          <div className="flex items-center gap-3">
            {actionStatus.type === 'success' ? (
              <CheckCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            )}
            <p className={`text-sm font-medium ${
              actionStatus.type === 'success' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
            }`}>{actionStatus.message}</p>
          </div>
          <button onClick={() => setActionStatus(null)} className="text-muted-foreground hover:text-foreground text-sm">Dismiss</button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/20 dark:to-blue-900/10 rounded-xl border border-blue-200/50 dark:border-blue-800/30 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-950/30 rounded-lg flex items-center justify-center">
              <Cable className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
          <p className="text-3xl font-bold text-foreground">{gatewayConnections.length}</p>
          <p className="text-sm text-muted-foreground mt-1">Gateway Connections</p>
          <p className="text-xs text-muted-foreground mt-2">
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{registeredCount} registered</span> · {gatewayConnections.length - registeredCount} available
          </p>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/20 dark:to-purple-900/10 rounded-xl border border-purple-200/50 dark:border-purple-800/30 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-purple-100 dark:bg-purple-950/30 rounded-lg flex items-center justify-center">
              <Database className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
          </div>
          <p className="text-3xl font-bold text-foreground">{registeredDataSources.length}</p>
          <p className="text-sm text-muted-foreground mt-1">Data Sources</p>
          <p className="text-xs text-muted-foreground mt-2">
            <span className="text-purple-600 dark:text-purple-400 font-medium">{externalSources.length} external SQL</span> · {registeredDataSources.length - externalSources.length} internal
          </p>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/20 dark:to-amber-900/10 rounded-xl border border-amber-200/50 dark:border-amber-800/30 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-amber-100 dark:bg-amber-950/30 rounded-lg flex items-center justify-center">
              <TableProperties className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
          </div>
          <p className="text-3xl font-bold text-foreground">{registeredEntities.length}</p>
          <p className="text-sm text-muted-foreground mt-1">Landing Zone Entities</p>
          <p className="text-xs text-muted-foreground mt-2">Tables configured for ingestion</p>
        </div>

        <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/20 dark:to-emerald-900/10 rounded-xl border border-emerald-200/50 dark:border-emerald-800/30 p-5 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-950/30 rounded-lg flex items-center justify-center">
              <FolderInput className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
          </div>
          <p className="text-3xl font-bold text-foreground">{sqlConnections.length}</p>
          <p className="text-sm text-muted-foreground mt-1">SQL Connections</p>
          <p className="text-xs text-muted-foreground mt-2">On-prem via gateway</p>
        </div>
      </div>

      {/* Gateway Connections */}
      <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/20 dark:to-slate-900/10 rounded-xl border border-slate-200/50 dark:border-slate-800/30 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Gateway Connections</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              All on-premises SQL connections via PowerBIGateway — live from Fabric API
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search connections..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 pr-4 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground w-64"
              />
            </div>
            <button
              onClick={() => loadData(true)}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 border border-border rounded-lg text-muted-foreground transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="space-y-2">
          {filteredConnections.map((conn) => {
            const isExpanded = expandedConnection === conn.id;
            const regConn = isRegistered(conn);
            const connDataSources = regConn ? getDataSourcesForConnection(regConn.Name) : [];
            return (
              <div key={conn.id} className="border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedConnection(isExpanded ? null : conn.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      {regConn ? (
                        <CheckCircle className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <Circle className="h-5 w-5 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="w-10 h-10 bg-muted rounded-lg border border-border flex items-center justify-center">
                      <Server className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{conn.displayName}</p>
                      <p className="text-sm text-muted-foreground font-mono">{conn.server} → {conn.database}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        regConn
                          ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400'
                          : 'bg-muted text-muted-foreground'
                      }`}>
                        {regConn ? 'Registered' : 'Available'}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{conn.authType}</span>
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border bg-muted/30 p-5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Connection GUID</p>
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-mono text-foreground bg-muted px-2 py-1 rounded border border-border break-all">{conn.id}</code>
                          <button onClick={() => copyToClipboard(conn.id)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Server</p>
                        <p className="font-mono text-foreground">{conn.server}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Database</p>
                        <p className="font-mono text-foreground">{conn.database}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Encryption</p>
                        <p className="text-foreground">{conn.encryption}</p>
                      </div>
                    </div>

                    {regConn && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-muted-foreground text-xs uppercase tracking-wider">FMD Framework Name</p>
                          <div className="relative group">
                            <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-72 p-3 bg-popover text-popover-foreground text-xs rounded-lg border border-border shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
                              <p className="font-medium mb-1">Naming convention: CON_FMD_{'{SERVER}'}_{'{SOURCE}'}</p>
                              <ul className="space-y-1 text-muted-foreground">
                                <li><span className="font-mono text-foreground">CON_FMD</span> — prefix for all framework connections</li>
                                <li><span className="font-mono text-foreground">{'{SERVER}'}</span> — the SQL Server hostname</li>
                                <li><span className="font-mono text-foreground">{'{SOURCE}'}</span> — the Fabric display name (spaces removed)</li>
                              </ul>
                              <p className="mt-2 text-muted-foreground">This is the identifier used in pipeline expressions like <span className="font-mono">@item().ConnectionGuid</span></p>
                            </div>
                          </div>
                        </div>
                        <code className="text-sm font-mono text-emerald-600 dark:text-emerald-400">{regConn.Name}</code>

                        {connDataSources.length > 0 && (
                          <div className="mt-3">
                            <p className="text-muted-foreground text-xs uppercase tracking-wider mb-2">Linked Data Sources</p>
                            <div className="space-y-2">
                              {connDataSources.map(ds => (
                                <div key={ds.DataSourceId} className="flex items-center gap-3 bg-card border border-border rounded-lg p-3">
                                  <Database className="h-4 w-4 text-purple-500" />
                                  <div>
                                    <p className="text-sm font-medium text-foreground">{ds.Name}</p>
                                    <p className="text-xs text-muted-foreground">Namespace: {ds.Namespace} · Type: {ds.Type} · {ds.Description}</p>
                                  </div>
                                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                                    ds.IsActive === 'True'
                                      ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400'
                                      : 'bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400'
                                  }`}>{ds.IsActive === 'True' ? 'Active' : 'Inactive'}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {!regConn && (
                      <div className="mt-4 pt-4 border-t border-border">
                        <p className="text-sm text-muted-foreground mb-3">This connection is available in the Fabric gateway but not yet registered in the FMD framework.</p>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => registerConnection(conn)}
                            disabled={submitting}
                            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
                          >
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Register Connection
                          </button>
                          <a
                            href="https://app.fabric.microsoft.com/connections"
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-2 px-4 py-2 text-sm bg-muted hover:bg-muted/80 border border-border rounded-lg text-muted-foreground transition-colors"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Open in Fabric
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Registered Entities — Grouped by Data Source */}
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setEntityViewMode('registry')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                entityViewMode === 'registry'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Database className="w-4 h-4" />
              Entity Registry
              <span className={`text-xs ml-1 ${entityViewMode === 'registry' ? 'opacity-80' : ''}`}>({registeredEntities.length})</span>
            </button>
            <button
              onClick={() => setEntityViewMode('loadConfig')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                entityViewMode === 'loadConfig'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              }`}
            >
              <Zap className="w-4 h-4" />
              Load Optimization
              {loadConfigData.length > 0 && (
                <span className={`text-xs ml-1 ${entityViewMode === 'loadConfig' ? 'opacity-80' : ''}`}>
                  ({incrementalCount} incr / {fullCount} full)
                </span>
              )}
            </button>
          </div>
          <div className="flex items-center gap-3">
            {entityViewMode === 'registry' && selectedIds.size > 0 && (
              <button
                onClick={clearSelection}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear Selection
              </button>
            )}
            {entityViewMode === 'registry' && Object.keys(entityGroups).length > 0 && (
              <button
                onClick={expandAllSources}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Expand All
              </button>
            )}
            {entityViewMode === 'loadConfig' && (
              <div className="flex items-center gap-2">
                {pendingUpdates.size > 0 && (
                  <button
                    onClick={handleSaveLoadConfig}
                    disabled={savingConfig}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {savingConfig ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                    Apply Changes ({pendingUpdates.size})
                  </button>
                )}
                <button
                  onClick={() => fetchLoadConfig()}
                  disabled={loadConfigLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 ${loadConfigLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            )}
          </div>
        </div>
        {/* ── Entity Registry Tab ── */}
        {entityViewMode === 'registry' && (
        <>
        {registeredEntities.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No entities registered yet. Use "New Data Source" to onboard one.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(entityGroups).sort(([a], [b]) => a.localeCompare(b)).map(([sourceName, entities]) => {
              const isExpanded = expandedSources.has(sourceName);
              const activeCount = entities.filter(e => e.IsActive === 'True').length;
              const selState = groupSelectionState(sourceName);
              return (
                <div key={sourceName} className="border border-border rounded-lg overflow-hidden">
                  {/* Source group header */}
                  <div className="flex items-center bg-muted/30 hover:bg-muted/50 transition-colors">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleGroupAll(sourceName); }}
                      className="pl-3 pr-1 py-3 text-muted-foreground hover:text-foreground transition-colors"
                      title={selState === 'all' ? 'Deselect all' : 'Select all'}
                    >
                      {selState === 'all' ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : selState === 'some' ? (
                        <MinusSquare className="w-4 h-4 text-primary/60" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      onClick={() => toggleSource(sourceName)}
                      className="flex-1 flex items-center justify-between p-3"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        <Database className="w-4 h-4 text-primary" />
                        <span className="font-semibold text-sm text-foreground">{(entities[0]?.FilePath || sourceName).toUpperCase()}</span>
                        <span className="text-xs text-muted-foreground">
                          {entities.length} table{entities.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 font-medium">
                        {activeCount} active
                      </span>
                    </button>
                  </div>

                  {/* Expanded entity table */}
                  {isExpanded && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-t border-border bg-muted/20">
                            <th className="w-10 py-2 px-3"></th>
                            <th className="text-left py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Schema.Table</th>
                            <th className="text-left py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Output File</th>
                            <th className="text-left py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Path</th>
                            <th className="text-left py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Load Type</th>
                            <th className="text-left py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Status</th>
                            <th className="text-right py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium w-16"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {entities.map(entity => {
                            const isChecked = selectedIds.has(entity.LandingzoneEntityId);
                            return (
                              <tr key={entity.LandingzoneEntityId} className={`border-t border-border/50 last:border-0 hover:bg-muted/20 transition-colors group ${isChecked ? 'bg-primary/5' : ''}`}>
                                <td className="py-2.5 px-3">
                                  <button
                                    onClick={() => toggleEntity(entity.LandingzoneEntityId)}
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                  >
                                    {isChecked ? (
                                      <CheckSquare className="w-4 h-4 text-primary" />
                                    ) : (
                                      <Square className="w-4 h-4" />
                                    )}
                                  </button>
                                </td>
                                <td className="py-2.5 px-3 font-mono text-foreground">{entity.SourceSchema}.{entity.SourceName}</td>
                                <td className="py-2.5 px-3 font-mono text-muted-foreground text-xs">{entity.FileName}.{entity.FileType}</td>
                                <td className="py-2.5 px-3 font-mono text-muted-foreground text-xs">{entity.FilePath}</td>
                                <td className="py-2.5 px-3">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    entity.IsIncremental === 'True'
                                      ? 'bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400'
                                      : 'bg-muted text-muted-foreground'
                                  }`}>
                                    {entity.IsIncremental === 'True' ? 'Incremental' : 'Full'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    entity.IsActive === 'True'
                                      ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400'
                                      : 'bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400'
                                  }`}>
                                    {entity.IsActive === 'True' ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Link
                                      to={`/journey?entity=${entity.LandingzoneEntityId}`}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary"
                                      title={`View data journey for ${entity.SourceSchema}.${entity.SourceName}`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Route className="w-3.5 h-3.5" />
                                    </Link>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openDeleteModal(entity); }}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 text-muted-foreground hover:text-red-500"
                                      title={`Delete ${entity.SourceSchema}.${entity.SourceName}`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </>
        )}

        {/* ── Load Configuration Tab ── */}
        {entityViewMode === 'loadConfig' && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="flex items-center justify-between bg-muted/30 rounded-lg border border-border p-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-foreground font-medium">{loadConfigData.length} entities</span>
                <span className="text-blue-500 dark:text-blue-400 flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  {incrementalCount} incremental
                </span>
                <span className="text-muted-foreground flex items-center gap-1">
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  {fullCount} full load
                </span>
                <span className="text-emerald-500 dark:text-emerald-400 flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5" />
                  {bronzeRegistered} Bronze / {silverRegistered} Silver
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-background border border-border rounded-lg overflow-hidden text-xs">
                  {(['all', 'incremental', 'full'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setLoadConfigFilter(f)}
                      className={`px-3 py-1.5 transition-colors capitalize ${
                        loadConfigFilter === f
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Action buttons per data source */}
            {uniqueDataSources.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                {uniqueDataSources.map(([dsId, dsName]) => (
                  <div key={dsId} className="flex items-center gap-1 bg-muted/30 rounded-lg border border-border px-3 py-1.5">
                    <span className="text-xs font-medium text-foreground mr-2">{dsName}</span>
                    <button
                      onClick={() => handleAnalyzeSource(dsId)}
                      disabled={analyzing}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
                      title="Scan source tables for PKs, watermark columns, and row counts"
                    >
                      {analyzing && analyzeTarget === String(dsId) ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Search className="w-3 h-3" />
                      )}
                      Analyze
                    </button>
                    <button
                      onClick={() => handleRegisterBronzeSilver(dsId)}
                      disabled={registering}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-purple-600 hover:bg-purple-700 text-white transition-colors disabled:opacity-50"
                      title="Auto-register Bronze + Silver entities from analyzed data"
                    >
                      {registering ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Layers className="w-3 h-3" />
                      )}
                      Register B/S
                    </button>
                  </div>
                ))}
              </div>
            )}

            {loadConfigLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-primary mr-3" />
                <span className="text-sm text-muted-foreground">Loading entity configuration...</span>
              </div>
            ) : loadConfigData.length === 0 ? (
              <div className="text-center py-12">
                <Settings2 className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-2">No load configuration data available</p>
                <p className="text-xs text-muted-foreground">Register entities first, then switch to this tab to configure load optimization.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {Object.entries(loadConfigBySource).sort(([a], [b]) => a.localeCompare(b)).map(([sourceName, entities]) => {
                  const srcIncr = entities.filter(e => isEntityIncremental(e)).length;
                  const srcBronze = entities.filter(e => e.bronzeEntityId != null).length;
                  return (
                    <div key={sourceName} className="border border-border rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between bg-muted/30 p-3">
                        <div className="flex items-center gap-3">
                          <Database className="w-4 h-4 text-primary" />
                          <span className="font-semibold text-sm text-foreground">{sourceName.toUpperCase()}</span>
                          <span className="text-xs text-muted-foreground">
                            {entities.length} tables | {srcIncr} incremental | {srcBronze} Bronze
                          </span>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-t border-border bg-muted/20">
                              <th className="text-left py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Table</th>
                              <th className="text-left py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium w-28">Load Type</th>
                              <th className="text-left py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Watermark Column</th>
                              <th className="text-right py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium w-24">Source Rows</th>
                              <th className="text-left py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Primary Keys</th>
                              <th className="text-center py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium w-20">Bronze</th>
                              <th className="text-center py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium w-20">Silver</th>
                              <th className="text-left py-2 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium">Last Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entities.map(entity => {
                              const pending = pendingUpdates.get(entity.entityId);
                              const isIncr = pending?.isIncremental ?? isEntityIncremental(entity);
                              const wmCol = pending?.column ?? entity.watermarkColumn ?? '';
                              const hasPending = pending !== undefined;
                              return (
                                <tr key={entity.entityId} className={`border-t border-border/50 last:border-0 hover:bg-muted/20 transition-colors ${hasPending ? 'bg-amber-50/5' : ''}`}>
                                  <td className="py-2 px-3 font-mono text-foreground text-xs">
                                    {entity.schema}.{entity.table}
                                  </td>
                                  <td className="py-2 px-3">
                                    <select
                                      value={isIncr ? 'incremental' : 'full'}
                                      onChange={(e) => updatePending(entity.entityId, 'isIncremental', e.target.value === 'incremental')}
                                      className="text-xs bg-background border border-border rounded px-2 py-1 text-foreground w-full"
                                    >
                                      <option value="full">Full</option>
                                      <option value="incremental">Incremental</option>
                                    </select>
                                  </td>
                                  <td className="py-2 px-3">
                                    <input
                                      type="text"
                                      value={wmCol}
                                      onChange={(e) => updatePending(entity.entityId, 'column', e.target.value)}
                                      placeholder={entity.watermarkColumn || '—'}
                                      className="text-xs bg-background border border-border rounded px-2 py-1 text-foreground font-mono w-full"
                                    />
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono text-xs text-muted-foreground">
                                    —
                                  </td>
                                  <td className="py-2 px-3 font-mono text-xs text-muted-foreground truncate max-w-[200px]" title={entity.primaryKeys || ''}>
                                    {entity.primaryKeys || '—'}
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    {entity.bronzeEntityId != null ? (
                                      <CheckCircle className="w-4 h-4 text-emerald-500 inline-block" />
                                    ) : (
                                      <Circle className="w-4 h-4 text-muted-foreground/40 inline-block" />
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    {entity.silverEntityId != null ? (
                                      <CheckCircle className="w-4 h-4 text-emerald-500 inline-block" />
                                    ) : (
                                      <Circle className="w-4 h-4 text-muted-foreground/40 inline-block" />
                                    )}
                                  </td>
                                  <td className="py-2 px-3 font-mono text-xs text-muted-foreground">
                                    {entity.lastWatermarkValue || '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bulk Delete Floating Action Bar ── */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-4 bg-background/95 backdrop-blur-md border border-border rounded-xl shadow-2xl px-6 py-3">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} {selectedIds.size === 1 ? 'entity' : 'entities'} selected
          </span>
          <button
            onClick={clearSelection}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted"
          >
            Clear
          </button>
          <button
            onClick={openBulkDeleteModal}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Selected
          </button>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !deleting && setDeleteTarget(null)} />
          <div className="relative bg-background border border-border rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">Delete Entity</h3>
                <p className="text-xs text-muted-foreground">This will remove data across all layers</p>
              </div>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg border border-border mb-4">
              <p className="text-sm text-foreground">
                Are you sure you want to delete <span className="font-bold font-mono">{deleteTarget.SourceSchema}.{deleteTarget.SourceName}</span> from <span className="font-semibold">{friendlyLabel(deleteTarget.DataSourceName)}</span>?
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Output: {deleteTarget.FileName}.{deleteTarget.FileType} | Path: {deleteTarget.FilePath}
              </p>
            </div>
            {/* Cascade Impact */}
            <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg border border-amber-200/50 dark:border-amber-800/30 mb-4">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2 uppercase tracking-wider">Cascade Impact</p>
              {loadingImpact ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking linked entities...
                </div>
              ) : cascadeImpact ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-foreground font-medium">Landing Zone:</span>
                    <span className="text-muted-foreground">{cascadeImpact.landing.length} table{cascadeImpact.landing.length !== 1 ? 's' : ''} + parquet files</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-400" />
                    <span className="text-foreground font-medium">Bronze:</span>
                    <span className="text-muted-foreground">
                      {cascadeImpact.bronze.length > 0
                        ? `${cascadeImpact.bronze.length} table${cascadeImpact.bronze.length !== 1 ? 's' : ''} (${cascadeImpact.bronze.map(b => b.DestinationName || b.SourceName).join(', ')})`
                        : 'none'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    <span className="text-foreground font-medium">Silver:</span>
                    <span className="text-muted-foreground">
                      {cascadeImpact.silver.length > 0
                        ? `${cascadeImpact.silver.length} table${cascadeImpact.silver.length !== 1 ? 's' : ''} (${cascadeImpact.silver.map(s => s.DestinationName || s.SourceName).join(', ')})`
                        : 'none'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Unable to check cascade impact</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setDeleteTarget(null); setCascadeImpact(null); }}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-lg border border-border hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteEntity}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-70"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {deleting ? 'Deleting...' : 'Delete All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Bulk Delete Confirmation Modal ── */}
      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => !deleting && setShowBulkConfirm(false)} />
          <div className="relative bg-background border border-border rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">Delete {selectedIds.size} {selectedIds.size === 1 ? 'Entity' : 'Entities'}</h3>
                <p className="text-xs text-muted-foreground">This will remove data across all layers</p>
              </div>
            </div>
            <div className="p-3 bg-muted/30 rounded-lg border border-border mb-3 max-h-48 overflow-y-auto">
              <p className="text-sm text-foreground mb-2">Are you sure you want to delete these entities?</p>
              <ul className="space-y-1">
                {selectedEntitiesList.map(e => (
                  <li key={e.LandingzoneEntityId} className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                    <span className="font-mono">{e.SourceSchema}.{e.SourceName}</span>
                    <span className="text-muted-foreground/60">({friendlyLabel(e.DataSourceName)})</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* Cascade Impact */}
            <div className="p-3 bg-amber-50/50 dark:bg-amber-950/20 rounded-lg border border-amber-200/50 dark:border-amber-800/30 mb-4">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2 uppercase tracking-wider">Cascade Impact</p>
              {loadingImpact ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking linked entities...
                </div>
              ) : cascadeImpact ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-foreground font-medium">Landing Zone:</span>
                    <span className="text-muted-foreground">{cascadeImpact.landing.length} table{cascadeImpact.landing.length !== 1 ? 's' : ''} + parquet files</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-400" />
                    <span className="text-foreground font-medium">Bronze:</span>
                    <span className="text-muted-foreground">
                      {cascadeImpact.bronze.length > 0
                        ? `${cascadeImpact.bronze.length} table${cascadeImpact.bronze.length !== 1 ? 's' : ''}`
                        : 'none'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    <span className="text-foreground font-medium">Silver:</span>
                    <span className="text-muted-foreground">
                      {cascadeImpact.silver.length > 0
                        ? `${cascadeImpact.silver.length} table${cascadeImpact.silver.length !== 1 ? 's' : ''}`
                        : 'none'}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Unable to check cascade impact</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowBulkConfirm(false); setCascadeImpact(null); }}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors rounded-lg border border-border hover:bg-muted/50"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-70"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {deleting ? 'Deleting...' : `Delete All ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Onboarding Modal */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowOnboarding(false)}
          />
          {/* Modal */}
          <div className="relative w-full max-w-4xl max-h-[85vh] overflow-y-auto mx-4 rounded-xl shadow-2xl">
            <SourceOnboardingWizard
              gatewayConnections={gatewayConnections}
              registeredConnections={registeredConnections}
              registeredDataSources={registeredDataSources}
              registeredEntities={registeredEntities}
              onRefresh={() => { invalidateDigestCache(); refreshDigest(); loadData(true); }}
            />
            {/* Close button */}
            <button
              onClick={() => setShowOnboarding(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground text-sm bg-muted/80 hover:bg-muted rounded-lg px-3 py-1.5 transition-colors z-10"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
