import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  GitBranch,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SourceOnboardingWizard } from '@/components/sources/SourceOnboardingWizard';
import { useEntityDigest, invalidateDigestCache } from '@/hooks/useEntityDigest';
import type { DigestEntity } from '@/hooks/useEntityDigest';
import { useMetricContract } from '@/hooks/useMetricContract';
import { resolveSourceLabel } from '@/hooks/useSourceConfig';
import CompactPageHeader from '@/components/layout/CompactPageHeader';
import TableCardList from '@/components/ui/TableCardList';

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

/** Matches the actual backend response from GET /api/analyze-source */
interface AnalysisResult {
  datasourceId: number;
  tablesAnalyzed: number;
  server?: string;
  error?: string;
}

/** Map a DigestEntity to the legacy RegisteredEntity shape used throughout this page.
 *
 * DataSourceName uses the digest's `dataSourceName` (original DB name) so it matches
 * the onboarding step 2 referenceId (selectedGateway.database). The `source` field
 * (ds.Namespace) is kept as FilePath for display grouping.
 */
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
    DataSourceName: d.dataSourceName || d.source,
  };
}

export default function SourceManager() {
  const [searchParams] = useSearchParams();
  const deepLinkHandled = useRef(false);

  // ── Entity data from digest hook (replaces /api/entities fetch) ──
  const {
    allEntities: digestEntities,
    refresh: refreshDigest,
    loading: digestLoading,
  } = useEntityDigest();
  const { data: metricContract, loading: contractLoading } = useMetricContract();

  // Derive registeredEntities from the digest
  const registeredEntities = digestEntities.map(digestToRegistered);
  const tablesInScope = metricContract?.tables.inScope.value ?? registeredEntities.length;
  const landingLoaded = metricContract?.tables.landingLoaded.value ?? 0;
  const bronzeLoaded = metricContract?.tables.bronzeLoaded.value ?? 0;
  const silverLoaded = metricContract?.tables.silverLoaded.value ?? 0;
  const fabricCountsReady = Boolean(metricContract);
  const fabricCountsPending = contractLoading && !metricContract;

  // ── Data state (live from API — everything except entities) ──
  const [gatewayConnections, setGatewayConnections] = useState<GatewayConnection[]>([]);
  const [registeredConnections, setRegisteredConnections] = useState<RegisteredConnection[]>([]);
  const [registeredDataSources, setRegisteredDataSources] = useState<RegisteredDataSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<{ type: 'success' | 'error' | 'loading'; message: string } | null>(null);

  // ── UI state ──
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedConnection, setExpandedConnection] = useState<string | null>(null);
  const [gatewayExpanded, setGatewayExpanded] = useState(false);
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
  const [optimizingAll, setOptimizingAll] = useState(false);
  const [, setOptimizeAllResult] = useState<{ pk: number; wm: number; total: number; incr: number; errors: string[] } | null>(null);
  const [discoveringAll, setDiscoveringAll] = useState(false);
  const [, setDiscoverResult] = useState<{ sources: number; discovered: number; already: number; registered: number; trimmed: number; errors: string[] } | null>(null);
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

  // Deep-link: auto-filter to source when arriving via ?source=X (from FlowExplorer)
  useEffect(() => {
    if (deepLinkHandled.current) return;
    const sourceParam = searchParams.get('source');
    if (!sourceParam || registeredEntities.length === 0) return;
    deepLinkHandled.current = true;
    // Set search to filter to this source, and ensure it's expanded
    setSearchTerm(sourceParam);
    setExpandedSources(prev => new Set(prev).add(sourceParam));
  }, [searchParams, registeredEntities]);

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

  // Friendly label: use centralized source config
  const friendlyLabel = (name: string) => resolveSourceLabel(name);

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
      // Gateway connections require Fabric API access (VPN + SP token) —
      // fetch them best-effort so the page still loads without them.
      const [gwRes, connRes, dsRes] = await Promise.all([
        fetch('/api/gateway-connections').catch(() => null),
        fetch('/api/connections'),
        fetch('/api/datasources'),
      ]);

      if (!connRes.ok || !dsRes.ok) {
        throw new Error('API server not responding. Run: python dashboard/app/api/server.py');
      }

      const [conn, ds] = await Promise.all([
        connRes.json(), dsRes.json(),
      ]);

      // Gateway connections are optional — only needed for onboarding wizard
      if (gwRes?.ok) {
        const gw = await gwRes.json();
        setGatewayConnections(gw);
      }
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
    // Find the datasource name for better status messages
    const dsName = loadConfigData.find(e => e.dataSourceId === datasourceId)?.dataSource
      || registeredDataSources.find(ds => ds.DataSourceId === String(datasourceId))?.Name
      || `DS ${datasourceId}`;

    setAnalyzing(true);
    setAnalyzeTarget(String(datasourceId));
    setActionStatus({ type: 'loading', message: `Analyzing ${dsName} — connecting to source SQL Server...` });
    try {
      // Step 1: Count source tables (lightweight connectivity + table count check)
      const res = await fetch(`/api/analyze-source?datasource=${datasourceId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setActionStatus({ type: 'error', message: `${dsName}: ${err.error || 'Analysis failed'}` });
        return;
      }
      const result: AnalysisResult = await res.json();

      if (result.error) {
        setActionStatus({ type: 'error', message: `${dsName}: ${result.error}` });
        return;
      }

      setActionStatus({ type: 'loading', message: `${dsName}: Found ${result.tablesAnalyzed} tables — preparing Bronze and Silver load paths...` });

      // Step 2: Auto-register Bronze/Silver (silent — user doesn't need to know)
      await fetch('/api/register-bronze-silver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasourceId }),
      }).catch(() => {}); // swallow — registration is best-effort

      setActionStatus({
        type: 'success',
        message: `${dsName}: ${result.tablesAnalyzed} tables found on ${result.server || 'source'}. Bronze and Silver load paths are ready. Use "Optimize All" to discover PKs and watermarks.`,
      });
      invalidateDigestCache();
      refreshDigest();
      await fetchLoadConfig();
    } catch (e) {
      setActionStatus({ type: 'error', message: `${dsName}: ${e instanceof Error ? e.message : 'Analysis failed — check VPN connection and server logs'}` });
    } finally {
      setAnalyzing(false);
      setAnalyzeTarget(null);
    }
  };

  const handleOptimizeAll = async () => {
    setOptimizingAll(true);
    setOptimizeAllResult(null);
    setActionStatus({ type: 'loading', message: 'Optimizing all tables in scope — connecting to source databases and discovering PKs and watermarks...' });
    try {
      const res = await fetch('/api/engine/optimize-all', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setActionStatus({ type: 'error', message: `Optimize All failed: ${err.error || 'Unknown error'}` });
        return;
      }
      const result = await res.json();
      setOptimizeAllResult({
        pk: result.pk_discovered || 0,
        wm: result.watermark_discovered || 0,
        total: result.final_total || 0,
        incr: result.final_incremental || 0,
        errors: result.errors || [],
      });
      setActionStatus({
        type: 'success',
        message: `Optimization complete: ${result.pk_discovered} PKs discovered, ${result.watermark_discovered} watermark columns found. ${result.final_incremental}/${result.final_total} entities now incremental.${result.errors?.length ? ` (${result.errors.length} connection errors)` : ''}`,
      });
      invalidateDigestCache();
      refreshDigest();
      await fetchLoadConfig();
    } catch (e) {
      setActionStatus({ type: 'error', message: `Optimize All failed: ${e instanceof Error ? e.message : 'Check VPN and server logs'}` });
    } finally {
      setOptimizingAll(false);
    }
  };

  const handleDiscoverAll = async () => {
    setDiscoveringAll(true);
    setDiscoverResult(null);
    setActionStatus({ type: 'loading', message: 'Discovering tables across all source databases — connecting via VPN and scanning for new tables...' });
    try {
      const res = await fetch('/api/source-manager/discover-all', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setActionStatus({ type: 'error', message: `Discover All failed: ${err.error || 'Unknown error'}` });
        return;
      }
      const result = await res.json();
      setDiscoverResult({
        sources: result.sources_processed || 0,
        discovered: result.tables_discovered || 0,
        already: result.already_registered || 0,
        registered: result.newly_registered || 0,
        trimmed: result.whitespace_fixed || 0,
        errors: result.errors || [],
      });
      const msgs: string[] = [];
      msgs.push(`Scanned ${result.sources_processed} sources`);
      msgs.push(`${result.tables_discovered} tables found`);
      if (result.newly_registered > 0) msgs.push(`${result.newly_registered} new tables added to scope`);
      if (result.whitespace_fixed > 0) msgs.push(`${result.whitespace_fixed} names trimmed`);
      if (result.already_registered > 0) msgs.push(`${result.already_registered} already in scope`);
      if (result.errors?.length) msgs.push(`${result.errors.length} errors`);
      setActionStatus({
        type: result.newly_registered > 0 ? 'success' : 'success',
        message: `Discovery complete: ${msgs.join(', ')}.`,
      });
      invalidateDigestCache();
      refreshDigest();
      await fetchLoadConfig();
    } catch (e) {
      setActionStatus({ type: 'error', message: `Discover All failed: ${e instanceof Error ? e.message : 'Check VPN and server logs'}` });
    } finally {
      setDiscoveringAll(false);
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
        setActionStatus({ type: 'success', message: data.message || `Configured ${fmdName}` });
        invalidateDigestCache();
        refreshDigest();
        await loadData(true);
      } else {
        setActionStatus({ type: 'error', message: data.error || 'Connection setup failed' });
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
          <p className="text-xs text-muted-foreground mt-1">Loading gateway connections and configured sources</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <AlertTriangle className="h-8 w-8 text-[var(--bp-caution)] mx-auto mb-4" />
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
    <div className="bp-page-shell-wide space-y-6">
      <CompactPageHeader
        eyebrow="Load"
        title="Source Manager"
        summary="Connect source systems, decide which tables belong in scope, and tune load behavior from one place."
        meta={
          digestLoading
            ? "refreshing source scope"
            : fabricCountsPending
            ? "loading canonical Fabric counts"
            : "source onboarding and configuration"
        }
        actions={
          <button
            onClick={() => setShowOnboarding(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium shrink-0"
          >
            <Plus className="h-4 w-4" />
            New Data Source
          </button>
        }
        facts={[
          { label: "Tables In Scope", value: `${tablesInScope}`, tone: "accent" },
          { label: "Landing Loaded", value: fabricCountsReady ? `${landingLoaded}` : "Loading...", tone: fabricCountsReady ? (landingLoaded >= tablesInScope && tablesInScope > 0 ? "positive" : "warning") : "neutral" },
          { label: "Bronze Loaded", value: fabricCountsReady ? `${bronzeLoaded}` : "Loading...", tone: fabricCountsReady ? (bronzeLoaded >= tablesInScope && tablesInScope > 0 ? "positive" : "warning") : "neutral" },
          { label: "Silver Loaded", value: fabricCountsReady ? `${silverLoaded}` : "Loading...", tone: fabricCountsReady ? (silverLoaded >= tablesInScope && tablesInScope > 0 ? "positive" : "warning") : "neutral" },
        ]}
      />

      {/* Action Status Banner */}
      {actionStatus && (
        <div className={`rounded-lg p-4 flex items-center justify-between ${
          actionStatus.type === 'success'
            ? 'bg-[var(--bp-operational-light)] border border-[rgba(61,124,79,0.2)]'
            : actionStatus.type === 'loading'
            ? 'bg-[var(--bp-copper-light)] border border-[rgba(180,86,36,0.2)]'
            : 'bg-[var(--bp-fault-light)] border border-[rgba(185,58,42,0.2)]'
        }`}>
          <div className="flex items-center gap-3">
            {actionStatus.type === 'success' ? (
              <CheckCircle className="h-5 w-5 text-[var(--bp-operational)]" />
            ) : actionStatus.type === 'loading' ? (
              <Loader2 className="h-5 w-5 text-[var(--bp-copper)] animate-spin" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-[var(--bp-fault)]" />
            )}
            <p className={`text-sm font-medium ${
              actionStatus.type === 'success' ? 'text-[var(--bp-operational)]'
              : actionStatus.type === 'loading' ? 'text-[var(--bp-copper)]'
              : 'text-[var(--bp-fault)]'
            }`}>{actionStatus.message}</p>
          </div>
          {actionStatus.type !== 'loading' && (
            <button onClick={() => setActionStatus(null)} className="text-muted-foreground hover:text-foreground text-sm">Dismiss</button>
          )}
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Database className="w-4 h-4 text-[var(--bp-ink-secondary)]" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Connected Sources</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" style={{ fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--bp-ink-primary)" }}>{registeredDataSources.length}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              <span className="text-[var(--bp-ink-secondary)] font-medium">{externalSources.length}</span> external SQL · {registeredDataSources.length - externalSources.length} internal
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <TableProperties className="w-4 h-4 text-[var(--bp-caution)]" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Tables In Scope</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" style={{ fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--bp-ink-primary)" }}>{tablesInScope}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {fabricCountsReady
                ? `${landingLoaded} landing · ${bronzeLoaded} bronze · ${silverLoaded} silver`
                : fabricCountsPending
                ? "Loading Fabric counts..."
                : "Fabric counts unavailable"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[var(--bp-copper)]" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Incremental Loads</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" style={{ fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--bp-ink-primary)" }}>{incrementalCount}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {fullCount} full load · {registeredEntities.length > 0 ? Math.round((incrementalCount / (incrementalCount + fullCount || 1)) * 100) : 0}% optimized
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Cable className="w-4 h-4 text-[var(--bp-operational)]" />
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Gateway Connections</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" style={{ fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--bp-ink-primary)" }}>{gatewayConnections.length}</div>
            <div className="text-[10px] text-muted-foreground mt-1">
              <span className="text-[var(--bp-operational)] font-medium">{registeredCount}</span> configured · {gatewayConnections.length - registeredCount} available
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tables in scope — grouped by source */}
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
              Pipeline Scope
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
                <button
                  onClick={handleDiscoverAll}
                  disabled={discoveringAll || optimizingAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--bp-caution)] hover:bg-[#A86917] text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {discoveringAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                  Discover &amp; Add to Scope
                </button>
                <button
                  onClick={handleOptimizeAll}
                  disabled={optimizingAll || analyzing || discoveringAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--bp-copper)] hover:bg-[var(--bp-copper-hover)] text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {optimizingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Optimize All
                </button>
                {pendingUpdates.size > 0 && (
                  <button
                    onClick={handleSaveLoadConfig}
                    disabled={savingConfig}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--bp-operational)] hover:bg-[#357044] text-white rounded-lg transition-colors disabled:opacity-50"
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
        {/* ── Pipeline Scope Tab ── */}
        {entityViewMode === 'registry' && (
        <>
        {registeredEntities.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No tables are in scope yet. Use "New Data Source" to onboard one.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(entityGroups).sort(([a], [b]) => a.localeCompare(b)).map(([sourceName, entities]) => {
              const isExpanded = expandedSources.has(sourceName);
              const activeCount = entities.filter(e => e.IsActive === 'True').length;
              const selState = groupSelectionState(sourceName);
              return (
                <div key={sourceName} className="border border-border rounded-lg overflow-hidden">
                  {/* Source group header */}
                  <div className="flex items-center bg-muted hover:bg-muted/50 transition-colors">
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
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bp-operational-light)] text-[var(--bp-operational)] font-medium">
                          {activeCount} active
                        </span>
                        <Link
                          to={`/flow-explorer?source=${encodeURIComponent(sourceName)}`}
                          className="p-1 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                          title="View in Flow Explorer"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <GitBranch className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    </button>
                  </div>

                  {/* Expanded entity table */}
                  {isExpanded && (
                    <div>
                      <div className="p-3 lg:hidden">
                        <TableCardList
                          items={entities}
                          getId={(entity) => entity.LandingzoneEntityId}
                          getTitle={(entity) => `${entity.SourceSchema}.${entity.SourceName}`}
                          getSubtitle={(entity) => `${entity.FileName}.${entity.FileType} · ${entity.FilePath}`}
                          getStats={(entity) => [
                            { label: "Load", value: entity.IsIncremental === 'True' ? 'Incremental' : 'Full' },
                            { label: "Status", value: entity.IsActive === 'True' ? 'Active' : 'Inactive' },
                            { label: "Source", value: friendlyLabel(entity.DataSourceName || sourceName) },
                            { label: "Selected", value: selectedIds.has(entity.LandingzoneEntityId) ? 'Yes' : 'No' },
                          ]}
                          onCardClick={(entity) => toggleEntity(entity.LandingzoneEntityId)}
                          renderExpanded={(entity) => (
                            <div className="space-y-3">
                              <div className="flex flex-wrap gap-2 text-[11px]">
                                <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                                  Output: <strong>{entity.FileName}.{entity.FileType}</strong>
                                </span>
                                <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                                  Path: <strong>{entity.FilePath}</strong>
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Link
                                  to={`/journey?entity=${encodeURIComponent(String(entity.LandingzoneEntityId))}`}
                                  className="bp-btn-secondary"
                                  style={{ textDecoration: "none" }}
                                >
                                  <Route className="mr-1.5 h-3.5 w-3.5" />
                                  Open journey
                                </Link>
                                <Link
                                  to={`/flow-explorer?source=${encodeURIComponent(entity.DataSourceName || '')}&table=${encodeURIComponent(entity.SourceName)}`}
                                  className="bp-btn-secondary"
                                  style={{ textDecoration: "none" }}
                                >
                                  <GitBranch className="mr-1.5 h-3.5 w-3.5" />
                                  Open flow
                                </Link>
                                <button
                                  onClick={() => openDeleteModal(entity)}
                                  className="bp-btn-secondary"
                                  style={{ color: "var(--bp-fault)", borderColor: "rgba(185,58,42,0.2)" }}
                                >
                                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                                  Delete
                                </button>
                              </div>
                            </div>
                          )}
                        />
                      </div>
                      <div className="hidden overflow-x-auto lg:block">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-t border-border bg-muted">
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
                              <tr key={entity.LandingzoneEntityId} className={`border-t border-border/50 last:border-0 hover:bg-muted/50 transition-colors group ${isChecked ? 'bg-primary/5' : ''}`}>
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
                                      ? 'bg-[var(--bp-copper-light)] text-[var(--bp-copper)]'
                                      : 'bg-muted text-muted-foreground'
                                  }`}>
                                    {entity.IsIncremental === 'True' ? 'Incremental' : 'Full'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    entity.IsActive === 'True'
                                      ? 'bg-[var(--bp-operational-light)] text-[var(--bp-operational)]'
                                      : 'bg-[var(--bp-fault-light)] text-[var(--bp-fault)]'
                                  }`}>
                                    {entity.IsActive === 'True' ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Link
                                      to={`/journey?entity=${encodeURIComponent(String(entity.LandingzoneEntityId))}`}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary"
                                      title={`View data journey for ${entity.SourceSchema}.${entity.SourceName}`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Route className="w-3.5 h-3.5" />
                                    </Link>
                                    <Link
                                      to={`/flow-explorer?source=${encodeURIComponent(entity.DataSourceName || '')}&table=${encodeURIComponent(entity.SourceName)}`}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground hover:text-primary"
                                      title={`View in Flow Explorer`}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <GitBranch className="w-3.5 h-3.5" />
                                    </Link>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openDeleteModal(entity); }}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-[var(--bp-fault-light)] text-muted-foreground hover:text-[var(--bp-fault)]"
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
            <div className="flex items-center justify-between bg-muted rounded-lg border border-border p-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-foreground font-medium">{loadConfigData.length} tables in scope</span>
                <span className="text-[var(--bp-copper)] flex items-center gap-1">
                  <TrendingUp className="w-3.5 h-3.5" />
                  {incrementalCount} incremental
                </span>
                <span className="text-muted-foreground flex items-center gap-1">
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  {fullCount} full load
                </span>
                <span className="text-[var(--bp-operational)] flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5" />
                  {bronzeRegistered} Bronze-ready / {silverRegistered} Silver-ready
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
                  <div key={dsId} className="flex items-center gap-1 bg-muted rounded-lg border border-border px-3 py-1.5">
                    <span className="text-xs font-medium text-foreground mr-2">{friendlyLabel(dsName)}</span>
                    <button
                      onClick={() => handleAnalyzeSource(dsId)}
                      disabled={analyzing}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-[var(--bp-copper)] hover:bg-[var(--bp-copper-hover)] text-white transition-colors disabled:opacity-50"
                      title="Scan source tables for PKs, watermark columns, and row counts"
                    >
                      {analyzing && analyzeTarget === String(dsId) ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Search className="w-3 h-3" />
                      )}
                      Analyze
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
                <p className="text-xs text-muted-foreground">Add tables to scope first, then switch to this tab to configure load optimization.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {Object.entries(loadConfigBySource).sort(([a], [b]) => a.localeCompare(b)).map(([sourceName, entities]) => {
                  const srcIncr = entities.filter(e => isEntityIncremental(e)).length;
                  const srcBronze = entities.filter(e => e.bronzeEntityId != null).length;
                  return (
                    <div key={sourceName} className="border border-border rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between bg-muted p-3">
                        <div className="flex items-center gap-3">
                          <Database className="w-4 h-4 text-primary" />
                          <span className="font-semibold text-sm text-foreground">{friendlyLabel(sourceName)}</span>
                          <span className="text-xs text-muted-foreground">
                            {entities.length} tables | {srcIncr} incremental | {srcBronze} Bronze
                          </span>
                        </div>
                      </div>
                      <div className="p-3 lg:hidden">
                        <TableCardList
                          items={entities}
                          getId={(entity) => String(entity.entityId)}
                          getTitle={(entity) => `${entity.schema}.${entity.table}`}
                          getSubtitle={() => friendlyLabel(sourceName)}
                          getStats={(entity) => {
                            const pending = pendingUpdates.get(entity.entityId);
                            const isIncr = pending?.isIncremental ?? isEntityIncremental(entity);
                            const wmCol = pending?.column ?? entity.watermarkColumn ?? '';
                            return [
                              { label: "Load", value: isIncr ? 'Incremental' : 'Full' },
                              { label: "Watermark", value: wmCol || '—' },
                              { label: "Bronze", value: entity.bronzeEntityId != null ? 'Ready' : 'Missing' },
                              { label: "Silver", value: entity.silverEntityId != null ? 'Ready' : 'Missing' },
                            ];
                          }}
                          renderExpanded={(entity) => {
                            const pending = pendingUpdates.get(entity.entityId);
                            const isIncr = pending?.isIncremental ?? isEntityIncremental(entity);
                            const wmCol = pending?.column ?? entity.watermarkColumn ?? '';
                            return (
                              <div className="space-y-3">
                                <div className="grid gap-3 md:grid-cols-2">
                                  <label className="space-y-1 text-xs text-muted-foreground">
                                    <span>Load type</span>
                                    <select
                                      value={isIncr ? 'incremental' : 'full'}
                                      onChange={(e) => updatePending(entity.entityId, 'isIncremental', e.target.value === 'incremental')}
                                      className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
                                    >
                                      <option value="full">Full</option>
                                      <option value="incremental">Incremental</option>
                                    </select>
                                  </label>
                                  <label className="space-y-1 text-xs text-muted-foreground">
                                    <span>Watermark column</span>
                                    <input
                                      type="text"
                                      value={wmCol}
                                      onChange={(e) => updatePending(entity.entityId, 'column', e.target.value)}
                                      placeholder={entity.watermarkColumn || '—'}
                                      className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
                                    />
                                  </label>
                                </div>
                                <div className="flex flex-wrap gap-2 text-[11px]">
                                  <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                                    PKs: <strong>{entity.primaryKeys || '—'}</strong>
                                  </span>
                                  <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                                    Last value: <strong>{entity.lastWatermarkValue || '—'}</strong>
                                  </span>
                                </div>
                              </div>
                            );
                          }}
                        />
                      </div>
                      <div className="hidden overflow-x-auto lg:block">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-t border-border bg-muted">
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
                                <tr key={entity.entityId} className={`border-t border-border/50 last:border-0 hover:bg-muted/50 transition-colors ${hasPending ? 'bg-[var(--bp-caution-light)]' : ''}`}>
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
                                      <CheckCircle className="w-4 h-4 text-[var(--bp-operational)] inline-block" />
                                    ) : (
                                      <Circle className="w-4 h-4 text-muted-foreground/40 inline-block" />
                                    )}
                                  </td>
                                  <td className="py-2 px-3 text-center">
                                    {entity.silverEntityId != null ? (
                                      <CheckCircle className="w-4 h-4 text-[var(--bp-operational)] inline-block" />
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
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-[#FEFDFB] bg-[var(--bp-fault)] hover:bg-[#A03324] rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Selected
          </button>
        </div>
      )}

      {/* ── Delete Confirmation Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" role="button" tabIndex={0} onClick={() => !deleting && setDeleteTarget(null)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!deleting) setDeleteTarget(null); } }} />
          <div className="relative bg-background border border-border rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-[var(--bp-fault-light)]">
                <Trash2 className="w-5 h-5 text-[var(--bp-fault)]" />
              </div>
              <div>
                <h3 style={{ fontFamily: "var(--bp-font-body)", fontWeight: 700, color: "var(--bp-ink-primary)" }}>Delete Entity</h3>
                <p className="text-xs text-muted-foreground">This will remove data across all layers</p>
              </div>
            </div>
            <div className="p-3 bg-muted rounded-lg border border-border mb-4">
              <p className="text-sm text-foreground">
                Are you sure you want to delete <span className="font-bold font-mono">{deleteTarget.SourceSchema}.{deleteTarget.SourceName}</span> from <span className="font-semibold">{friendlyLabel(deleteTarget.DataSourceName)}</span>?
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Output: {deleteTarget.FileName}.{deleteTarget.FileType} | Path: {deleteTarget.FilePath}
              </p>
            </div>
            {/* Cascade Impact */}
            <div className="p-3 bg-[var(--bp-caution-light)] rounded-lg border border-[rgba(194,122,26,0.2)] mb-4">
              <p className="text-xs font-semibold text-[var(--bp-caution)] mb-2 uppercase tracking-wider">Cascade Impact</p>
              {loadingImpact ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking linked entities...
                </div>
              ) : cascadeImpact ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--bp-copper)]" />
                    <span className="text-foreground font-medium">Landing Zone:</span>
                    <span className="text-muted-foreground">{cascadeImpact.landing.length} table{cascadeImpact.landing.length !== 1 ? 's' : ''} + parquet files</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--bp-caution)]" />
                    <span className="text-foreground font-medium">Bronze:</span>
                    <span className="text-muted-foreground">
                      {cascadeImpact.bronze.length > 0
                        ? `${cascadeImpact.bronze.length} table${cascadeImpact.bronze.length !== 1 ? 's' : ''} (${cascadeImpact.bronze.map(b => b.DestinationName || b.SourceName).join(', ')})`
                        : 'none'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--bp-ink-secondary)]" />
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
                className="px-4 py-2 text-sm font-medium text-[#FEFDFB] bg-[var(--bp-fault)] hover:bg-[#A03324] rounded-lg transition-colors flex items-center gap-2 disabled:opacity-70"
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
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" role="button" tabIndex={0} onClick={() => !deleting && setShowBulkConfirm(false)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!deleting) setShowBulkConfirm(false); } }} />
          <div className="relative bg-background border border-border rounded-xl shadow-2xl p-6 max-w-lg w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-[var(--bp-fault-light)]">
                <Trash2 className="w-5 h-5 text-[var(--bp-fault)]" />
              </div>
              <div>
                <h3 style={{ fontFamily: "var(--bp-font-body)", fontWeight: 700, color: "var(--bp-ink-primary)" }}>Delete {selectedIds.size} {selectedIds.size === 1 ? 'Entity' : 'Entities'}</h3>
                <p className="text-xs text-muted-foreground">This will remove data across all layers</p>
              </div>
            </div>
            <div className="p-3 bg-muted rounded-lg border border-border mb-3 max-h-48 overflow-y-auto">
              <p className="text-sm text-foreground mb-2">Are you sure you want to delete these entities?</p>
              <ul className="space-y-1">
                {selectedEntitiesList.map(e => (
                  <li key={e.LandingzoneEntityId} className="text-xs text-muted-foreground flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--bp-fault)] shrink-0" />
                    <span className="font-mono">{e.SourceSchema}.{e.SourceName}</span>
                    <span className="text-muted-foreground/60">({friendlyLabel(e.DataSourceName)})</span>
                  </li>
                ))}
              </ul>
            </div>
            {/* Cascade Impact */}
            <div className="p-3 bg-[var(--bp-caution-light)] rounded-lg border border-[rgba(194,122,26,0.2)] mb-4">
              <p className="text-xs font-semibold text-[var(--bp-caution)] mb-2 uppercase tracking-wider">Cascade Impact</p>
              {loadingImpact ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking linked entities...
                </div>
              ) : cascadeImpact ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--bp-copper)]" />
                    <span className="text-foreground font-medium">Landing Zone:</span>
                    <span className="text-muted-foreground">{cascadeImpact.landing.length} table{cascadeImpact.landing.length !== 1 ? 's' : ''} + parquet files</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--bp-caution)]" />
                    <span className="text-foreground font-medium">Bronze:</span>
                    <span className="text-muted-foreground">
                      {cascadeImpact.bronze.length > 0
                        ? `${cascadeImpact.bronze.length} table${cascadeImpact.bronze.length !== 1 ? 's' : ''}`
                        : 'none'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[var(--bp-ink-secondary)]" />
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
                className="px-4 py-2 text-sm font-medium text-[#FEFDFB] bg-[var(--bp-fault)] hover:bg-[#A03324] rounded-lg transition-colors flex items-center gap-2 disabled:opacity-70"
              >
                {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {deleting ? 'Deleting...' : `Delete All ${selectedIds.size}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gateway Connections — collapsed by default */}
      <div className="rounded-xl border" style={{ background: 'var(--bp-surface-1)', borderColor: 'var(--bp-border)' }}>
        <button
          onClick={() => setGatewayExpanded(!gatewayExpanded)}
          className="w-full flex items-center justify-between p-5 hover:bg-muted/50 transition-colors text-left rounded-xl"
        >
              <div className="flex items-center gap-3">
                <Cable className="w-5 h-5 text-muted-foreground" />
                <div>
                  <h2 style={{ fontFamily: "var(--bp-font-body)", fontWeight: 600, fontSize: 18, color: "var(--bp-ink-primary)" }}>Gateway Connections</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                {registeredCount} configured · {gatewayConnections.length} total — on-premises SQL via PowerBIGateway
                  </p>
                </div>
              </div>
          {gatewayExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>

        {gatewayExpanded && (
          <div className="px-5 pb-5 pt-0">
            <div className="flex items-center justify-end gap-3 mb-3">
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
                            <CheckCircle className="h-5 w-5 text-[var(--bp-operational)]" />
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
                              ? 'bg-[var(--bp-operational-light)] text-[var(--bp-operational)]'
                              : 'bg-muted text-muted-foreground'
                          }`}>
                            {regConn ? 'Configured' : 'Available'}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">{conn.authType}</span>
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="border-t border-border bg-muted p-5">
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
                              <p className="text-muted-foreground text-xs uppercase tracking-wider">FMD Managed Name</p>
                              <div className="relative group">
                                <Info className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-72 p-3 bg-popover text-popover-foreground text-xs rounded-lg border border-border opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
                                  <p className="font-medium mb-1">Naming convention: CON_FMD_{'{SERVER}'}_{'{SOURCE}'}</p>
                                  <ul className="space-y-1 text-muted-foreground">
                                    <li><span className="font-mono text-foreground">CON_FMD</span> — prefix for all FMD-managed connections</li>
                                    <li><span className="font-mono text-foreground">{'{SERVER}'}</span> — the SQL Server hostname</li>
                                    <li><span className="font-mono text-foreground">{'{SOURCE}'}</span> — the Fabric display name (spaces removed)</li>
                                  </ul>
                                  <p className="mt-2 text-muted-foreground">This is the identifier used in pipeline expressions like <span className="font-mono">@item().ConnectionGuid</span></p>
                                </div>
                              </div>
                            </div>
                            <code className="text-sm font-mono text-[var(--bp-operational)]">{regConn.Name}</code>

                            {connDataSources.length > 0 && (
                              <div className="mt-3">
                                <p className="text-muted-foreground text-xs uppercase tracking-wider mb-2">Linked Data Sources</p>
                                <div className="space-y-2">
                                  {connDataSources.map(ds => (
                                    <div key={ds.DataSourceId} className="flex items-center gap-3 bg-card border border-border rounded-lg p-3">
                                      <Database className="h-4 w-4 text-[var(--bp-ink-secondary)]" />
                                      <div>
                                        <p className="text-sm font-medium text-foreground">{ds.Name}</p>
                                        <p className="text-xs text-muted-foreground">Namespace: {ds.Namespace} · Type: {ds.Type} · {ds.Description}</p>
                                      </div>
                                      <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                                        ds.IsActive === 'True'
                                          ? 'bg-[var(--bp-operational-light)] text-[var(--bp-operational)]'
                                          : 'bg-[var(--bp-fault-light)] text-[var(--bp-fault)]'
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
                            <p className="text-sm text-muted-foreground mb-3">This connection is available in the Fabric gateway but is not yet configured for FMD-managed loading.</p>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => registerConnection(conn)}
                                disabled={submitting}
                                className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium disabled:opacity-50"
                              >
                                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                                Configure Connection
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
        )}
      </div>

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
              onRefresh={async () => { invalidateDigestCache(); refreshDigest(); await loadData(true); }}
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
