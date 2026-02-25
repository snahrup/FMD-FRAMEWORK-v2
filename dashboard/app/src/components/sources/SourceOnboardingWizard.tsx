import { useState, useEffect, useCallback, useRef } from 'react';
import {
  CheckCircle2, Lock, ChevronRight, ChevronDown,
  Plus, Loader2, Server, ArrowRight, AlertTriangle,
  Trash2, RefreshCw, Search, Database, HelpCircle,
  Settings2, Play, ExternalLink, Rocket, Zap,
} from 'lucide-react';
import { useBackgroundTasks } from '@/contexts/BackgroundTaskContext';

// ── Types ──

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

interface OnboardingStep {
  stepNumber: number;
  stepName: string;
  status: string;      // pending | in_progress | complete | skipped
  referenceId: string | null;
  notes: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

interface OnboardingSource {
  sourceName: string;
  steps: OnboardingStep[];
  createdAt: string;
}

const DATA_SOURCE_TYPES = [
  { value: 'ASQL_01', label: 'Azure SQL / On-Prem SQL', pipeline: 'PL_FMD_LDZ_COPY_FROM_ASQL_01' },
  { value: 'ONELAKE_TABLES_01', label: 'OneLake Tables', pipeline: 'PL_FMD_LDZ_COPY_FROM_ONELAKE_TABLES_01' },
  { value: 'ONELAKE_FILES_01', label: 'OneLake Files', pipeline: 'PL_FMD_LDZ_COPY_FROM_ONELAKE_FILES_01' },
  { value: 'ADLS_01', label: 'Azure Data Lake', pipeline: 'PL_FMD_LDZ_COPY_FROM_ADLS_01' },
  { value: 'FTP_01', label: 'FTP', pipeline: 'PL_FMD_LDZ_COPY_FROM_FTP_01' },
  { value: 'SFTP_01', label: 'SFTP', pipeline: 'PL_FMD_LDZ_COPY_FROM_SFTP_01' },
  { value: 'ORACLE_01', label: 'Oracle', pipeline: 'PL_FMD_LDZ_COPY_FROM_ORACLE_01' },
  { value: 'NOTEBOOK', label: 'Custom Notebook', pipeline: 'PL_FMD_LDZ_COPY_FROM_CUSTOM_NB' },
];

// 3 visual steps mapping to 4 internal DB steps
const VISUAL_STEPS = ['Configure Source', 'Select Tables', 'Pipeline Ready'];

// ── InfoTip component ──

function InfoTip({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block ml-1 align-middle">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-popover border border-border rounded-lg shadow-lg p-3 text-xs text-popover-foreground leading-relaxed">
          {children}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-popover border-r border-b border-border rotate-45 -mt-1" />
        </div>
      )}
    </span>
  );
}

// ── Props ──

interface SourceOnboardingWizardProps {
  gatewayConnections: GatewayConnection[];
  registeredConnections: RegisteredConnection[];
  registeredDataSources: RegisteredDataSource[];
  registeredEntities: RegisteredEntity[];
  onRefresh: () => Promise<void>;
}

export function SourceOnboardingWizard({
  gatewayConnections,
  registeredConnections,
  registeredDataSources,
  registeredEntities,
  onRefresh,
}: SourceOnboardingWizardProps) {
  // ── Onboarding state from DB ──
  const [sources, setSources] = useState<OnboardingSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>('');
  const [activeVisualStep, setActiveVisualStep] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [newSourceName, setNewSourceName] = useState('');
  const [showNewSource, setShowNewSource] = useState(false);
  const [onboardingAvailable, setOnboardingAvailable] = useState(true);

  // ── Step 1: Configure Source state ──
  const [sourceLabel, setSourceLabel] = useState('');
  const [selectedGatewayId, setSelectedGatewayId] = useState('');
  const [tablePrefix, setTablePrefix] = useState('');
  const [sourceType, setSourceType] = useState('ASQL_01');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Step 2: Select Tables state ──
  const [discoveredTables, setDiscoveredTables] = useState<{ TABLE_SCHEMA: string; TABLE_NAME: string }[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [fetchingTables, setFetchingTables] = useState(false);
  const [tableSearchTerm, setTableSearchTerm] = useState('');
  const [bulkRegistering, setBulkRegistering] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 });
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [sourceCredentials, setSourceCredentials] = useState({ username: 'UsrSQLRead', password: 'Ku7T@hoqFDmDPqG4deMgrrxQ9' });
  const [filePath, setFilePath] = useState('');

  // Pipeline trigger state
  const [triggeringPipeline, setTriggeringPipeline] = useState(false);
  const [pipelineResult, setPipelineResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Background task context — registration survives page navigation
  const bgTasks = useBackgroundTasks();
  const activeTaskIdRef = useRef<string | null>(null);

  // Sync background task progress → local wizard state
  useEffect(() => {
    const taskId = activeTaskIdRef.current;
    if (!taskId) return;
    const task = bgTasks.tasks.find((t) => t.id === taskId);
    if (!task) return;

    setBulkProgress({ done: task.done, total: task.total });

    if (task.status !== 'running') {
      // Task finished — update wizard state
      setBulkRegistering(false);
      const succeeded = task.done - task.errors;
      if (succeeded > 0) {
        updateStep(3, 'complete', `${succeeded} entities`, 'Registered from source database');
        updateStep(4, 'complete', 'Ready', 'All steps completed');
      } else if (task.status === 'cancelled') {
        updateStep(3, 'in_progress', `${task.done} entities`, `Cancelled after ${task.done} registrations`);
      } else {
        updateStep(3, 'in_progress', '0 entities', `All ${task.errors} registrations failed`);
      }
      Promise.all([onRefresh(), loadOnboarding()]);
      setStatus({
        type: succeeded > 0 && task.errors === 0 ? 'success' : 'error',
        message: task.status === 'cancelled'
          ? `Cancelled — ${succeeded} registered before cancellation`
          : task.errors === 0
            ? `All ${task.done} entities registered successfully`
            : succeeded > 0
              ? `${succeeded} registered, ${task.errors} failed`
              : `All ${task.errors} registrations failed`,
      });
      if (succeeded > 0) {
        setDiscoveredTables([]);
        setSelectedTables(new Set());
      }
      activeTaskIdRef.current = null;
    }
  }, [bgTasks.tasks]);

  // ── Load onboarding data from DB ──
  const loadOnboarding = useCallback(async () => {
    try {
      const res = await fetch('/api/onboarding');
      if (!res.ok) return;
      const data: OnboardingSource[] = await res.json();
      setSources(data);
      setOnboardingAvailable(true);
      if (data.length > 0) {
        setSelectedSource(prev => prev || data[0].sourceName);
      }
    } catch {
      setOnboardingAvailable(false);
    }
  }, []);

  useEffect(() => { loadOnboarding(); }, [loadOnboarding]);

  // ── Current source steps ──
  const currentSource = sources.find(s => s.sourceName === selectedSource);
  const steps = currentSource?.steps || [];
  const getStep = (num: number) => steps.find(s => s.stepNumber === num);

  // Visual step → internal step mapping
  const isInternalComplete = (num: number) => getStep(num)?.status === 'complete';
  const isVisualStepComplete = (visIdx: number): boolean => {
    if (visIdx === 0) return !!isInternalComplete(1) && !!isInternalComplete(2);
    if (visIdx === 1) return !!isInternalComplete(3);
    if (visIdx === 2) return !!isInternalComplete(4);
    return false;
  };
  const canDoVisualStep = (visIdx: number): boolean => {
    if (visIdx === 0) return true;
    return isVisualStepComplete(visIdx - 1);
  };
  const getVisualStepRef = (visIdx: number): string => {
    if (visIdx === 0) return getStep(2)?.referenceId || getStep(1)?.referenceId || '';
    if (visIdx === 1) return getStep(3)?.referenceId || '';
    if (visIdx === 2) return getStep(4)?.referenceId || '';
    return '';
  };

  // ── Auto-derive helper ──
  const deriveFromLabel = (label: string) => {
    const clean = label.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const words = label.trim().split(/\s+/);
    const prefix = words.length > 1
      ? words.map(w => w[0]).join('').toUpperCase() + '_'
      : clean.substring(0, Math.min(clean.length, 6)) + '_';
    return { namespace: clean, prefix, folder: clean.toLowerCase() };
  };

  // ── Prefix conflict detection ──
  // Extract existing prefixes from registered entities (FileName = prefix + SourceName)
  const existingPrefixes = new Set<string>();
  registeredEntities.forEach(e => {
    const fn = e.FileName || '';
    const sn = e.SourceName || '';
    if (fn.endsWith(sn) && fn.length > sn.length) {
      existingPrefixes.add(fn.substring(0, fn.length - sn.length));
    }
  });
  const prefixConflict = !!(tablePrefix && existingPrefixes.has(tablePrefix));
  const existingPrefixList = Array.from(existingPrefixes).filter(p => p.length > 0);

  // Already-registered table keys for the current onboarding source (schema.name)
  const currentDsName = getStep(2)?.referenceId || '';
  const alreadyRegisteredKeys = new Set<string>(
    registeredEntities
      .filter(e => e.DataSourceName === currentDsName)
      .map(e => `${e.SourceSchema}.${e.SourceName}`)
  );

  // Build unique database options from gateway connections
  const databaseOptions = gatewayConnections.map(gw => ({
    id: gw.id,
    label: `${gw.server.split('.')[0]} → ${gw.database}`,
    server: gw.server,
    database: gw.database,
    displayName: gw.displayName,
    alreadyRegistered: registeredConnections.some(rc => rc.ConnectionGuid.toLowerCase() === gw.id.toLowerCase()),
  }));

  const selectedGateway = gatewayConnections.find(gw => gw.id === selectedGatewayId) || null;

  // ── API helpers ──
  const updateStep = async (stepNumber: number, stepStatus: string, referenceId?: string, notes?: string) => {
    await fetch('/api/onboarding/step', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceName: selectedSource,
        stepNumber,
        status: stepStatus,
        referenceId: referenceId || null,
        notes: notes || null,
      }),
    });
  };

  const createNewSource = async () => {
    if (!newSourceName.trim()) return;
    setSubmitting(true);
    setStatus(null);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceName: newSourceName.trim().toUpperCase() }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedSource(newSourceName.trim().toUpperCase());
        setNewSourceName('');
        setShowNewSource(false);
        setActiveVisualStep(0);
        setStatus({ type: 'success', message: `Onboarding started for "${newSourceName.trim().toUpperCase()}"` });
        await loadOnboarding();
      } else {
        setStatus({ type: 'error', message: data.error || 'Failed to create onboarding' });
      }
    } catch {
      setStatus({ type: 'error', message: 'Network error' });
    } finally {
      setSubmitting(false);
    }
  };

  const purgeSource = async (name: string) => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/sources/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceName: name }),
      });
      const data = await res.json();
      if (selectedSource === name) {
        setSelectedSource('');
        setActiveVisualStep(null);
      }
      setStatus({
        type: 'success',
        message: data.message || `Purged "${name}"`,
      });
      await Promise.all([loadOnboarding(), onRefresh()]);
    } catch {
      setStatus({ type: 'error', message: 'Failed to purge source data' });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 1: Configure Source (registers Connection + DataSource in one go) ──
  const configureSource = async () => {
    if (!selectedGateway || !sourceLabel.trim()) return;
    setSubmitting(true);
    setStatus(null);

    const derived = deriveFromLabel(sourceLabel);
    const namespace = derived.namespace;
    const folder = derived.folder;
    const prefix = tablePrefix || derived.prefix;
    const serverShort = selectedGateway.server.split('.')[0].toUpperCase().replace(/-/g, '');
    const dbShort = selectedGateway.database.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const fmdConnName = `CON_FMD_${serverShort}_${dbShort}`;

    try {
      // 1. Register connection (or reuse if already registered)
      const existingConn = registeredConnections.find(c => c.ConnectionGuid.toLowerCase() === selectedGateway.id.toLowerCase());
      const connName = existingConn ? existingConn.Name : fmdConnName;

      if (!existingConn) {
        const connRes = await fetch('/api/connections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ connectionGuid: selectedGateway.id, name: fmdConnName, type: 'SqlServer' }),
        });
        if (!connRes.ok) {
          const err = await connRes.json().catch(() => ({}));
          throw new Error(err.error || 'Connection registration failed');
        }
      }

      // 2. Register datasource
      const dsRes = await fetch('/api/datasources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionName: connName,
          name: selectedGateway.database,
          namespace,
          type: sourceType,
          description: `${sourceLabel} (${selectedGateway.database} on ${selectedGateway.server.split('.')[0]})`,
        }),
      });
      if (!dsRes.ok) {
        const err = await dsRes.json().catch(() => ({}));
        throw new Error(err.error || 'Data source registration failed');
      }

      // 3. Mark internal steps 1 and 2 complete
      await updateStep(1, 'complete', connName, `${selectedGateway.server} → ${selectedGateway.database}`);
      await updateStep(2, 'complete', selectedGateway.database, `${namespace} / ${sourceType} / prefix: ${prefix}`);

      // 4. Set up state for Step 2 (Select Tables)
      setFilePath(folder);
      setTablePrefix(prefix);

      setStatus({ type: 'success', message: `Source "${sourceLabel}" configured. Connection + data source registered.` });
      await Promise.all([onRefresh(), loadOnboarding()]);
      setTimeout(() => setActiveVisualStep(1), 400);
    } catch (e) {
      setStatus({ type: 'error', message: e instanceof Error ? e.message : 'Configuration failed' });
    } finally {
      setSubmitting(false);
    }
  };

  // ── Step 2: Table Discovery + Registration ──
  const fetchSourceTables = async () => {
    if (!selectedGateway) {
      // Try to find the gateway from the datasource/connection chain
      setStatus({ type: 'error', message: 'No database connection found. Complete Step 1 first.' });
      return;
    }
    setFetchingTables(true);
    setStatus(null);
    try {
      const res = await fetch('/api/source-tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          server: selectedGateway.server,
          database: selectedGateway.database,
          username: sourceCredentials.username,
          password: sourceCredentials.password,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Connection failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const tables = await res.json();
      setDiscoveredTables(tables);
      // Auto-select only NEW tables (skip already-registered ones)
      const newKeys = tables
        .map((t: { TABLE_SCHEMA: string; TABLE_NAME: string }) => `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`)
        .filter((k: string) => !alreadyRegisteredKeys.has(k));
      setSelectedTables(new Set(newKeys));
      const regCount = tables.length - newKeys.length;
      setStatus({ type: 'success', message: `Found ${tables.length} tables in ${selectedGateway.database}${regCount > 0 ? ` (${regCount} already registered)` : ''}` });
    } catch (e) {
      setStatus({ type: 'error', message: e instanceof Error ? e.message : 'Failed to fetch tables' });
    } finally {
      setFetchingTables(false);
    }
  };

  // Try to recover the gateway from existing registration when step 1 is already complete
  useEffect(() => {
    if (isVisualStepComplete(0) && !selectedGateway && currentSource) {
      const step1 = getStep(1);
      if (step1?.referenceId) {
        const regConn = registeredConnections.find(c => c.Name === step1.referenceId);
        if (regConn) {
          const gw = gatewayConnections.find(g => g.id.toLowerCase() === regConn.ConnectionGuid.toLowerCase());
          if (gw) setSelectedGatewayId(gw.id);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSource, selectedGatewayId, gatewayConnections, registeredConnections]);

  // Also recover filePath and tablePrefix from step 2 notes when resuming
  useEffect(() => {
    if (isVisualStepComplete(0) && currentSource) {
      const step2 = getStep(2);
      if (step2?.notes) {
        const parts = step2.notes.split('/');
        const nspart = parts[0]?.trim();
        if (nspart && !filePath) {
          setFilePath(nspart.toLowerCase());
        }
        const prefixMatch = step2.notes.match(/prefix:\s*(\S+)/);
        if (prefixMatch && !tablePrefix) {
          setTablePrefix(prefixMatch[1]);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSource]);

  const toggleTable = (key: string) => {
    setSelectedTables(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const bulkRegisterEntities = async () => {
    if (selectedTables.size === 0) return;

    // Find the datasource name from step 2 reference
    const step2 = getStep(2);
    const dsName = step2?.referenceId || '';
    const ds = registeredDataSources.find(d => d.Name === dsName);
    const dsType = ds?.Type || sourceType;
    const fp = filePath || dsName.toLowerCase();

    // Build table payloads
    const tables = Array.from(selectedTables).map((key) => {
      const [schema, ...nameParts] = key.split('.');
      const tableName = nameParts.join('.');
      const fileName = tablePrefix ? `${tablePrefix}${tableName}` : tableName;
      return { schema, tableName, fileName, filePath: fp };
    });

    // Dispatch to background context — survives navigation
    const taskId = bgTasks.startEntityRegistration(
      `Registering ${tables.length} ${sourceLabel || 'entities'}`,
      { dataSourceName: dsName, dataSourceType: dsType, tables }
    );
    activeTaskIdRef.current = taskId;

    // Update local UI state
    setBulkRegistering(true);
    setBulkProgress({ done: 0, total: tables.length });
    setStatus(null);
  };

  // ── If onboarding table doesn't exist, show setup instructions ──
  // ── Trigger pipeline ──
  const triggerLandingZonePipeline = async () => {
    // Determine which pipeline to trigger based on the source type
    const dsType = DATA_SOURCE_TYPES.find(t => t.value === sourceType);
    const pipelineName = dsType?.pipeline || 'PL_FMD_LDZ_COPY_FROM_ASQL_01';

    setTriggeringPipeline(true);
    setPipelineResult(null);
    try {
      const res = await fetch('/api/pipeline/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to trigger pipeline');
      setPipelineResult({
        type: 'success',
        message: `Pipeline "${pipelineName}" triggered successfully. Data will begin loading into the Landing Zone.`,
      });
    } catch (err: any) {
      setPipelineResult({
        type: 'error',
        message: err.message || 'Failed to trigger pipeline',
      });
    } finally {
      setTriggeringPipeline(false);
    }
  };

  if (!onboardingAvailable) {
    return (
      <div className="bg-card rounded-xl border border-border p-6">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-lg font-semibold text-foreground">Source Onboarding</h2>
          <span className="text-xs bg-amber-100 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full font-medium">
            Setup Required
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          Run the migration script to enable onboarding tracking:
        </p>
        <code className="text-xs font-mono bg-muted border border-border rounded-lg px-3 py-2 block">
          scripts/create_source_onboarding.sql
        </code>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Header + Source Selector */}
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Source Onboarding</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Add a new data source to the pipeline in 3 easy steps
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { loadOnboarding(); onRefresh(); }}
              className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Source selector row */}
        <div className="flex items-center gap-3">
          {sources.length > 0 && (
            <select
              value={selectedSource}
              onChange={(e) => { setSelectedSource(e.target.value); setActiveVisualStep(null); setStatus(null); setSelectedGatewayId(''); setDiscoveredTables([]); setSelectedTables(new Set()); setTablePrefix(''); setFilePath(''); }}
              className="px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground min-w-[200px]"
            >
              <option value="">Select a source...</option>
              {sources.filter(s => s.steps.filter(st => st.status === 'complete').length < 4).map(s => {
                const done = s.steps.filter(st => st.status === 'complete').length;
                return (
                  <option key={s.sourceName} value={s.sourceName}>
                    {s.sourceName} ({done}/4 complete)
                  </option>
                );
              })}
            </select>
          )}

          {showNewSource ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && createNewSource()}
                placeholder="e.g. M3CLOUD"
                className="px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground font-mono w-40"
                autoFocus
              />
              <button
                onClick={createNewSource}
                disabled={submitting || !newSourceName.trim()}
                className="px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
              </button>
              <button
                onClick={() => { setShowNewSource(false); setNewSourceName(''); }}
                className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewSource(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-muted border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> New Source
            </button>
          )}

          {selectedSource && (
            <button
              onClick={() => {
                if (confirm(`Remove "${selectedSource}" and ALL its registered data (connections, datasources, entities)?`))
                  purgeSource(selectedSource);
              }}
              className="p-2 text-muted-foreground/50 hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors ml-auto"
              title="Purge source (removes everything)"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Status banner */}
      {status && (
        <div className={`mx-6 mb-3 rounded-lg p-3 flex items-center gap-2 text-sm ${
          status.type === 'success'
            ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
            : 'bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
        }`}>
          {status.type === 'success' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          <span>{status.message}</span>
          <button onClick={() => setStatus(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">Dismiss</button>
        </div>
      )}

      {/* Stepper (3 visual steps) */}
      {currentSource && (
        <>
          <div className="px-6 pb-4">
            <div className="flex items-center">
              {VISUAL_STEPS.map((label, visIdx) => {
                const isComplete = isVisualStepComplete(visIdx);
                const isLocked = !canDoVisualStep(visIdx) && !isComplete;
                const isActive = activeVisualStep === visIdx;
                const isClickable = !isLocked;

                return (
                  <div key={visIdx} className="flex items-center flex-1 last:flex-initial">
                    <button
                      onClick={() => isClickable && setActiveVisualStep(isActive ? null : visIdx)}
                      disabled={isLocked}
                      className={`flex flex-col items-center gap-1.5 transition-all ${
                        isClickable ? 'cursor-pointer' : 'cursor-not-allowed'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-sm font-bold transition-all ${
                        isComplete
                          ? 'bg-emerald-100 dark:bg-emerald-950/30 border-emerald-400 dark:border-emerald-600 text-emerald-600 dark:text-emerald-400'
                          : isLocked
                            ? 'bg-muted border-border text-muted-foreground/30'
                            : isActive
                              ? 'bg-primary/10 border-primary text-primary ring-2 ring-primary/20'
                              : 'bg-muted border-border text-muted-foreground hover:border-primary/50'
                      }`}>
                        {isComplete
                          ? <CheckCircle2 className="h-5 w-5" />
                          : isLocked
                            ? <Lock className="h-4 w-4" />
                            : visIdx + 1}
                      </div>
                      <div className="text-center min-w-[110px]">
                        <p className={`text-xs font-semibold ${
                          isComplete ? 'text-emerald-600 dark:text-emerald-400' :
                          isLocked ? 'text-muted-foreground/30' :
                          isActive ? 'text-primary' :
                          'text-foreground'
                        }`}>
                          {label}
                        </p>
                        <p className={`text-[10px] mt-0.5 ${
                          isComplete ? 'text-emerald-500/70' :
                          isLocked ? 'text-muted-foreground/20' :
                          'text-muted-foreground'
                        }`}>
                          {isComplete
                            ? (getVisualStepRef(visIdx) || 'Done')
                            : isLocked
                              ? 'Requires previous step'
                              : 'Action needed'}
                        </p>
                      </div>
                    </button>
                    {visIdx < VISUAL_STEPS.length - 1 && (
                      <div className={`flex-1 h-0.5 mx-2 mt-[-24px] rounded-full transition-colors ${
                        isComplete ? 'bg-emerald-400 dark:bg-emerald-600' : 'bg-border'
                      }`} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Step detail panel */}
          {activeVisualStep !== null && (
            <div className="border-t border-border bg-muted/30 p-6">

              {/* ═══════ Visual Step 0: Configure Source ═══════ */}
              {activeVisualStep === 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-5 h-5 flex items-center justify-center">1</span>
                    <h3 className="text-sm font-semibold text-foreground">Configure Source</h3>
                    <InfoTip>
                      <p className="font-semibold mb-1">What is this?</p>
                      <p>This step sets up your data source. Pick the database you want to pull data from, give it a friendly name, and we'll configure everything automatically.</p>
                      <p className="mt-2">The <strong>Table Prefix</strong> prevents name collisions in the lakehouse. For example, both M3 and PowerData might have a "Customer" table. Prefixes make them <code className="bg-muted px-1 rounded">M3_Customer</code> and <code className="bg-muted px-1 rounded">PD_Customer</code>.</p>
                    </InfoTip>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4 ml-7">
                    Pick your database, name the source, set the table prefix.
                  </p>

                  {isVisualStepComplete(0) ? (
                    <div className="ml-7 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                      <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="font-medium">Configured</span>
                        <span className="text-emerald-600/70 dark:text-emerald-400/70 font-mono text-xs ml-1">
                          {getStep(2)?.referenceId}
                        </span>
                      </div>
                      {getStep(1)?.notes && (
                        <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 mt-1 ml-6">{getStep(1)?.notes}</p>
                      )}
                      {getStep(2)?.notes && (
                        <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 mt-0.5 ml-6">{getStep(2)?.notes}</p>
                      )}
                      <button onClick={() => setActiveVisualStep(1)} className="mt-2 ml-6 text-xs text-primary hover:underline flex items-center gap-1">
                        Continue to Select Tables <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="ml-7 space-y-4">
                      {/* Database selector dropdown */}
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1">
                          Database
                          <InfoTip>
                            <p>Select the database you want to ingest data from. These are the SQL Server connections that your Fabric admin has already configured via the on-premises data gateway.</p>
                            <p className="mt-2 text-muted-foreground">Don't see your database? Ask your Fabric admin to create a gateway connection for it.</p>
                          </InfoTip>
                        </label>
                        {databaseOptions.length === 0 ? (
                          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            <span>No gateway connections found. A Fabric admin needs to set up gateway connections first.</span>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {databaseOptions.map(opt => (
                              <button
                                key={opt.id}
                                onClick={() => setSelectedGatewayId(opt.id)}
                                className={`flex items-center gap-3 w-full text-left rounded-lg p-3 transition-all ${
                                  selectedGatewayId === opt.id
                                    ? 'bg-primary/10 border-2 border-primary ring-1 ring-primary/20'
                                    : 'bg-card border border-border hover:border-primary/50'
                                }`}
                              >
                                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                                  selectedGatewayId === opt.id
                                    ? 'border-primary bg-primary'
                                    : 'border-muted-foreground/30'
                                }`}>
                                  {selectedGatewayId === opt.id && (
                                    <div className="w-1.5 h-1.5 rounded-full bg-primary-foreground" />
                                  )}
                                </div>
                                <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-mono text-foreground">
                                    {opt.server.split('.')[0]} <span className="text-muted-foreground">→</span> {opt.database}
                                  </p>
                                  {opt.displayName && opt.displayName !== opt.database && (
                                    <p className="text-[10px] text-muted-foreground truncate">{opt.displayName}</p>
                                  )}
                                </div>
                                {opt.alreadyRegistered && (
                                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded">
                                    registered
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Source Label + Table Prefix */}
                      {selectedGateway && (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-medium text-foreground mb-1">
                                Source Label
                                <InfoTip>
                                  <p>A short, friendly name for this data source. Examples:</p>
                                  <ul className="list-disc ml-4 mt-1 space-y-0.5">
                                    <li><strong>M3 Cloud</strong> — for the M3 ERP system</li>
                                    <li><strong>PowerData</strong> — for the PowerData warehouse</li>
                                    <li><strong>MES</strong> — for the manufacturing execution system</li>
                                  </ul>
                                  <p className="mt-2 text-muted-foreground">Used to auto-generate the namespace, table prefix, and folder path.</p>
                                </InfoTip>
                              </label>
                              <input
                                type="text"
                                value={sourceLabel}
                                onChange={(e) => {
                                  setSourceLabel(e.target.value);
                                  const derived = deriveFromLabel(e.target.value);
                                  setTablePrefix(derived.prefix);
                                  setFilePath(derived.folder);
                                }}
                                placeholder="e.g. M3 Cloud"
                                className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-foreground mb-1">
                                Table Prefix
                                <InfoTip>
                                  <p>Added to the beginning of every table name in the lakehouse.</p>
                                  <p className="mt-1"><strong>Why?</strong> Lakehouses don't support custom schemas, so prefixes prevent naming conflicts.</p>
                                  <p className="mt-1"><strong>Example:</strong> With prefix <code className="bg-muted px-1 rounded">M3_</code>, a table called <code className="bg-muted px-1 rounded">Customer</code> becomes <code className="bg-muted px-1 rounded">M3_Customer</code></p>
                                  {existingPrefixList.length > 0 && (
                                    <p className="mt-2 text-amber-600 dark:text-amber-400">Already in use: {existingPrefixList.map(p => <code key={p} className="bg-muted px-1 rounded mr-1">{p}</code>)}</p>
                                  )}
                                </InfoTip>
                              </label>
                              <input
                                type="text"
                                value={tablePrefix}
                                onChange={(e) => setTablePrefix(e.target.value)}
                                placeholder="e.g. M3_"
                                className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg focus:outline-none focus:ring-2 text-foreground placeholder:text-muted-foreground font-mono ${
                                  prefixConflict
                                    ? 'border-red-400 dark:border-red-600 focus:ring-red-500/50'
                                    : 'border-border focus:ring-primary/50'
                                }`}
                              />
                              {prefixConflict && (
                                <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                                  <AlertTriangle className="h-3 w-3" />
                                  Prefix "{tablePrefix}" is already in use. Choose a unique prefix to avoid name collisions.
                                </p>
                              )}
                              {existingPrefixList.length > 0 && !prefixConflict && (
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  In use: {existingPrefixList.join(', ')}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Preview */}
                          {sourceLabel && (
                            <div className="bg-muted rounded-lg p-3 border border-border">
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">What this will create</p>
                              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                                <span className="text-muted-foreground">Database:</span>
                                <span className="font-mono text-foreground">{selectedGateway.server.split('.')[0]} → {selectedGateway.database}</span>
                                <span className="text-muted-foreground">Namespace:</span>
                                <span className="font-mono text-foreground">{deriveFromLabel(sourceLabel).namespace}</span>
                                <span className="text-muted-foreground">Table prefix:</span>
                                <span className="font-mono text-foreground">{tablePrefix}</span>
                                <span className="text-muted-foreground">Lakehouse folder:</span>
                                <span className="font-mono text-foreground">{filePath || deriveFromLabel(sourceLabel).folder}/</span>
                                <span className="text-muted-foreground">Pipeline type:</span>
                                <span className="font-mono text-foreground">{DATA_SOURCE_TYPES.find(t => t.value === sourceType)?.label}</span>
                              </div>
                            </div>
                          )}

                          {/* Advanced options */}
                          <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            <Settings2 className="h-3 w-3" />
                            {showAdvanced ? 'Hide' : 'Show'} advanced options
                            {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          </button>

                          {showAdvanced && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-dashed border-border rounded-lg p-4">
                              <div>
                                <label className="block text-xs font-medium text-foreground mb-1">
                                  Source Type
                                  <InfoTip>
                                    <p>Determines which pipeline processes this source. For SQL Server databases, use <strong>Azure SQL / On-Prem SQL</strong> (ASQL_01).</p>
                                    <p className="mt-1">Only change this if the source is not a SQL database.</p>
                                  </InfoTip>
                                </label>
                                <select
                                  value={sourceType}
                                  onChange={(e) => setSourceType(e.target.value)}
                                  className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground"
                                >
                                  {DATA_SOURCE_TYPES.map(t => (
                                    <option key={t.value} value={t.value}>{t.label}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-foreground mb-1">
                                  Folder Path
                                  <InfoTip>
                                    <p>The subfolder in the Landing Zone lakehouse. Auto-derived from source label.</p>
                                  </InfoTip>
                                </label>
                                <input
                                  type="text"
                                  value={filePath}
                                  onChange={(e) => setFilePath(e.target.value)}
                                  placeholder="auto-derived"
                                  className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground font-mono"
                                />
                              </div>
                            </div>
                          )}

                          <button
                            onClick={configureSource}
                            disabled={submitting || !sourceLabel.trim() || !selectedGateway || prefixConflict || !tablePrefix.trim()}
                            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium disabled:opacity-50"
                          >
                            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                            Configure Source
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ═══════ Visual Step 1: Select Tables ═══════ */}
              {activeVisualStep === 1 && (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-5 h-5 flex items-center justify-center">2</span>
                    <h3 className="text-sm font-semibold text-foreground">Select Tables to Ingest</h3>
                    <InfoTip>
                      <p className="font-semibold mb-1">What is this?</p>
                      <p>This step connects to your source database, pulls the list of all tables, and lets you pick which ones the pipeline should copy into the lakehouse.</p>
                      <p className="mt-2">Enter your SQL credentials below and click <strong>Fetch Tables</strong>. Then check the boxes and hit <strong>Register</strong>.</p>
                      <p className="mt-2 text-muted-foreground">Each selected table becomes a "landing zone entity" that the pipeline processes automatically.</p>
                    </InfoTip>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4 ml-7">
                    Connect to the source database, pick your tables, and register them for ingestion.
                  </p>

                  {!canDoVisualStep(1) ? (
                    <div className="ml-7 text-center py-4 text-muted-foreground">
                      <Lock className="h-5 w-5 mx-auto mb-1 opacity-40" />
                      <p className="text-sm">Complete Step 1 first</p>
                    </div>
                  ) : (
                    <div className="ml-7 space-y-4">
                      {/* Registered entities banner */}
                      {alreadyRegisteredKeys.size > 0 && (
                        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-3">
                          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            <span className="font-medium">{alreadyRegisteredKeys.size} table{alreadyRegisteredKeys.size !== 1 ? 's' : ''} already registered</span>
                          </div>
                          <p className="text-xs text-emerald-600/70 dark:text-emerald-400/60 mt-1 ml-6">
                            Registered tables appear dimmed below. Select additional tables to add to the framework.
                          </p>
                        </div>
                      )}

                      {/* Config row */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium text-foreground mb-1">
                            Table Prefix
                            <InfoTip>
                              <p>Prepended to every table name in the lakehouse. Set in Step 1, but you can adjust it here.</p>
                              <p className="mt-1"><strong>Example:</strong> <code className="bg-muted px-1 rounded">M3_</code> + <code className="bg-muted px-1 rounded">Customer</code> = <code className="bg-muted px-1 rounded">M3_Customer</code></p>
                            </InfoTip>
                          </label>
                          <input
                            type="text" value={tablePrefix}
                            onChange={(e) => setTablePrefix(e.target.value)}
                            placeholder="e.g. M3_"
                            className={`w-full px-3 py-2 text-sm bg-muted border rounded-lg focus:outline-none focus:ring-2 text-foreground placeholder:text-muted-foreground font-mono ${
                              prefixConflict
                                ? 'border-red-400 dark:border-red-600 focus:ring-red-500/50'
                                : 'border-border focus:ring-primary/50'
                            }`}
                          />
                          {prefixConflict && (
                            <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Prefix already in use
                            </p>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-foreground mb-1">
                            Folder Path
                            <InfoTip>
                              <p>Subfolder in the Landing Zone lakehouse where files land. Example: <code className="bg-muted px-1 rounded">m3cloud/</code></p>
                            </InfoTip>
                          </label>
                          <input
                            type="text" value={filePath}
                            onChange={(e) => setFilePath(e.target.value)}
                            placeholder="e.g. m3cloud"
                            className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground font-mono"
                          />
                        </div>
                      </div>

                      {/* Source credentials + Fetch button */}
                      <div className="flex items-end gap-3 flex-wrap">
                        <div className="w-44">
                          <label className="block text-xs font-medium text-foreground mb-1">
                            SQL Username
                            <InfoTip>
                              <p>The SQL Server login for the source database. Used to connect and list tables.</p>
                              <p className="mt-1 text-muted-foreground">Leave blank to use Windows Authentication.</p>
                            </InfoTip>
                          </label>
                          <input
                            type="text" value={sourceCredentials.username}
                            onChange={(e) => setSourceCredentials({ ...sourceCredentials, username: e.target.value })}
                            placeholder="SQL login"
                            className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                          />
                        </div>
                        <div className="w-44">
                          <label className="block text-xs font-medium text-foreground mb-1">SQL Password</label>
                          <input
                            type="password" value={sourceCredentials.password}
                            onChange={(e) => setSourceCredentials({ ...sourceCredentials, password: e.target.value })}
                            placeholder="Password"
                            className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                          />
                        </div>
                        <button
                          onClick={fetchSourceTables}
                          disabled={fetchingTables || !selectedGateway}
                          className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium disabled:opacity-50 transition-colors shrink-0"
                        >
                          {fetchingTables ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                          {fetchingTables ? 'Connecting...' : 'Fetch Tables'}
                        </button>
                      </div>

                      {/* Table picker */}
                      {discoveredTables.length > 0 && (
                        <div className="border border-border rounded-lg overflow-hidden">
                          {/* Toolbar */}
                          <div className="flex items-center gap-3 px-3 py-2 bg-muted border-b border-border">
                            <div className="relative flex-1">
                              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                              <input
                                type="text"
                                placeholder="Filter tables..."
                                value={tableSearchTerm}
                                onChange={(e) => setTableSearchTerm(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
                              />
                            </div>
                            {(() => {
                              const selectableKeys = discoveredTables
                                .map(t => `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`)
                                .filter(k => !alreadyRegisteredKeys.has(k));
                              const regCount = discoveredTables.length - selectableKeys.length;
                              const allNewSelected = selectableKeys.length > 0 && selectableKeys.every(k => selectedTables.has(k));
                              return (
                                <>
                                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                                    {selectedTables.size} new selected
                                    {regCount > 0 && <span className="text-emerald-600 dark:text-emerald-400"> · {regCount} registered</span>}
                                  </span>
                                  <button
                                    onClick={() => {
                                      if (allNewSelected) {
                                        setSelectedTables(new Set());
                                      } else {
                                        setSelectedTables(new Set(selectableKeys));
                                      }
                                    }}
                                    className="text-xs text-primary hover:text-primary/80 font-medium whitespace-nowrap"
                                  >
                                    {allNewSelected ? 'Deselect All New' : 'Select All New'}
                                  </button>
                                </>
                              );
                            })()}
                          </div>

                          {/* Table list */}
                          <div className="max-h-64 overflow-y-auto divide-y divide-border">
                            {discoveredTables
                              .filter(t => {
                                if (!tableSearchTerm) return true;
                                const term = tableSearchTerm.toLowerCase();
                                return t.TABLE_NAME.toLowerCase().includes(term) || t.TABLE_SCHEMA.toLowerCase().includes(term);
                              })
                              .map(t => {
                                const key = `${t.TABLE_SCHEMA}.${t.TABLE_NAME}`;
                                const isRegistered = alreadyRegisteredKeys.has(key);
                                const checked = isRegistered || selectedTables.has(key);
                                return (
                                  <label
                                    key={key}
                                    className={`flex items-center gap-3 px-3 py-2 text-xs transition-colors ${
                                      isRegistered
                                        ? 'bg-muted/40 opacity-50 cursor-default'
                                        : checked ? 'bg-primary/5 cursor-pointer' : 'hover:bg-muted/50 cursor-pointer'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={isRegistered}
                                      onChange={() => !isRegistered && toggleTable(key)}
                                      className="rounded border-border disabled:opacity-40"
                                    />
                                    <span className="text-muted-foreground font-mono w-16 shrink-0">{t.TABLE_SCHEMA}</span>
                                    <span className={`font-mono ${isRegistered ? 'text-muted-foreground' : 'text-foreground'}`}>{t.TABLE_NAME}</span>
                                    {isRegistered ? (
                                      <span className="ml-auto text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded font-medium">
                                        registered
                                      </span>
                                    ) : (
                                      <span className="ml-auto text-muted-foreground/50 font-mono text-[10px]">
                                        → {tablePrefix}{t.TABLE_NAME}
                                      </span>
                                    )}
                                  </label>
                                );
                              })}
                          </div>

                          {/* Register button */}
                          <div className="flex items-center justify-between px-3 py-2.5 bg-muted border-t border-border">
                            <div className="text-xs text-muted-foreground">
                              {selectedTables.size} new table{selectedTables.size !== 1 ? 's' : ''} will be registered
                              {alreadyRegisteredKeys.size > 0 && (
                                <span className="text-emerald-600 dark:text-emerald-400 ml-1">
                                  ({alreadyRegisteredKeys.size} already in framework)
                                </span>
                              )}
                            </div>
                            {bulkRegistering ? (
                              <button
                                disabled
                                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg font-medium opacity-80"
                              >
                                <Loader2 className="h-4 w-4 animate-spin" />
                                {bulkProgress.done} / {bulkProgress.total}
                              </button>
                            ) : (
                              <button
                                onClick={() => setShowConfirmation(true)}
                                disabled={selectedTables.size === 0}
                                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium disabled:opacity-50 transition-colors"
                              >
                                <ArrowRight className="h-4 w-4" />
                                Review {selectedTables.size} Tables
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ── Confirmation Recap Panel ── */}
                      {showConfirmation && selectedTables.size > 0 && !bulkRegistering && (
                        <div className="border border-primary/30 rounded-lg overflow-hidden bg-card shadow-lg">
                          <div className="px-4 py-3 bg-primary/10 border-b border-primary/20 flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-primary" />
                            <h4 className="text-sm font-semibold text-foreground">Confirm Entity Registration</h4>
                            <span className="ml-auto text-xs text-muted-foreground font-mono">
                              {selectedTables.size} table{selectedTables.size !== 1 ? 's' : ''}
                            </span>
                          </div>

                          {/* Summary row */}
                          <div className="px-4 py-3 border-b border-border bg-muted/30">
                            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                              <span className="text-muted-foreground">Source:</span>
                              <span className="font-mono text-foreground">{selectedSource}</span>
                              <span className="text-muted-foreground">Database:</span>
                              <span className="font-mono text-foreground">
                                {selectedGateway ? `${selectedGateway.server.split('.')[0]} → ${selectedGateway.database}` : '—'}
                              </span>
                              <span className="text-muted-foreground">Table Prefix:</span>
                              <span className="font-mono text-foreground font-semibold">{tablePrefix || '(none)'}</span>
                              <span className="text-muted-foreground">Folder:</span>
                              <span className="font-mono text-foreground">{filePath || '—'}/</span>
                              <span className="text-muted-foreground">Load Type:</span>
                              <span className="font-mono text-foreground">Full</span>
                            </div>
                          </div>

                          {/* Table list with prefix preview */}
                          <div className="max-h-60 overflow-y-auto divide-y divide-border">
                            {Array.from(selectedTables)
                              .sort()
                              .map(key => {
                                const [schema, ...nameParts] = key.split('.');
                                const tableName = nameParts.join('.');
                                const fileName = tablePrefix ? `${tablePrefix}${tableName}` : tableName;
                                return (
                                  <div key={key} className="flex items-center gap-3 px-4 py-1.5 text-xs">
                                    <span className="text-muted-foreground font-mono w-12 shrink-0 text-right">{schema}</span>
                                    <span className="font-mono text-muted-foreground">{tableName}</span>
                                    <ArrowRight className="h-3 w-3 text-primary/60 shrink-0" />
                                    <span className="font-mono text-foreground font-semibold">{fileName}</span>
                                  </div>
                                );
                              })}
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center justify-between px-4 py-3 bg-muted border-t border-border">
                            <button
                              onClick={() => setShowConfirmation(false)}
                              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
                            >
                              Go Back
                            </button>
                            <button
                              onClick={() => { setShowConfirmation(false); bulkRegisterEntities(); }}
                              className="flex items-center gap-1.5 px-5 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold transition-colors"
                            >
                              <Plus className="h-4 w-4" />
                              Confirm & Register {selectedTables.size} Entities
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Registered entities list */}
                      {registeredEntities.length > 0 && (
                        <div className="pt-4 border-t border-border">
                          <p className="text-xs font-medium text-muted-foreground mb-2">
                            Registered entities ({registeredEntities.length})
                          </p>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {registeredEntities.map(e => (
                              <div key={e.LandingzoneEntityId} className="flex items-center gap-2 text-xs">
                                <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                                <span className="font-mono text-foreground">{e.SourceSchema}.{e.SourceName}</span>
                                <span className="text-muted-foreground">→ {e.FileName}</span>
                                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
                                  e.IsIncremental === 'True'
                                    ? 'bg-blue-100 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400'
                                    : 'bg-muted text-muted-foreground'
                                }`}>
                                  {e.IsIncremental === 'True' ? 'Incremental' : 'Full'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ═══════ Visual Step 2: Pipeline Ready ═══════ */}
              {activeVisualStep === 2 && (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-5 h-5 flex items-center justify-center">3</span>
                    <h3 className="text-sm font-semibold text-foreground">Pipeline Ready</h3>
                  </div>

                  {isVisualStepComplete(2) ? (
                    <div className="ml-7">
                      <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4 mb-4">
                        <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300 mb-2">
                          <CheckCircle2 className="h-5 w-5" />
                          <span className="font-semibold">Source fully configured</span>
                        </div>
                        <p className="text-xs text-emerald-600/80 dark:text-emerald-400/70">
                          All steps complete for <strong>{selectedSource}</strong>. The pipeline can now process this source.
                        </p>
                      </div>

                      <div className="bg-muted rounded-lg p-4 border border-border">
                        <p className="text-xs font-medium text-foreground mb-2">Configuration Summary</p>
                        <div className="space-y-2 text-xs">
                          {steps.map(s => (
                            <div key={s.stepNumber} className="flex items-start gap-2">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                              <div>
                                <span className="font-medium text-foreground">{s.stepName}</span>
                                {s.referenceId && (
                                  <span className="text-muted-foreground ml-2 font-mono">{s.referenceId}</span>
                                )}
                                {s.notes && (
                                  <p className="text-muted-foreground/70 text-[10px] mt-0.5">{s.notes}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Pipeline trigger result */}
                      {pipelineResult && (
                        <div className={`mt-4 rounded-lg p-3 border ${
                          pipelineResult.type === 'success'
                            ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
                            : 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800'
                        }`}>
                          <p className={`text-xs ${
                            pipelineResult.type === 'success' ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
                          }`}>
                            {pipelineResult.message}
                          </p>
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="mt-4 flex flex-col gap-2">
                        {!pipelineResult?.type || pipelineResult.type === 'error' ? (
                          <button
                            onClick={triggerLandingZonePipeline}
                            disabled={triggeringPipeline}
                            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium text-sm disabled:opacity-50 transition-colors"
                          >
                            {triggeringPipeline ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Triggering Pipeline...
                              </>
                            ) : (
                              <>
                                <Rocket className="h-4 w-4" />
                                Run Landing Zone Pipeline
                              </>
                            )}
                          </button>
                        ) : (
                          <a
                            href="/"
                            className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium text-sm transition-colors"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Go to Pipeline Monitor
                          </a>
                        )}

                        <button
                          onClick={() => { setShowNewSource(true); setSelectedSource(''); setActiveVisualStep(null); }}
                          className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 text-xs transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Onboard Another Source
                        </button>
                      </div>

                      <div className="mt-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                        <div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300 mb-1.5">
                          <Zap className="h-3.5 w-3.5" />
                          <span className="font-semibold">Load Optimization Available</span>
                        </div>
                        <p className="text-[11px] text-blue-600/80 dark:text-blue-400/70 mb-2">
                          Before running the pipeline, analyze your tables for incremental load opportunities and register Bronze/Silver entities.
                          This reduces subsequent pipeline runs from hours to minutes.
                        </p>
                        <a
                          href="/sources"
                          onClick={(e) => { e.preventDefault(); /* Switch to Load Config tab */ window.location.hash = '#load-config'; }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
                        >
                          <Zap className="h-3 w-3" />
                          Open Load Optimization
                        </a>
                      </div>

                      <div className="mt-4 bg-muted/50 rounded-lg p-3 border border-border">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">What the pipeline does</p>
                        <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                          <li>Reads your registered tables from the metadata DB</li>
                          <li>Copies source data into LH_DATA_LANDINGZONE as parquet files</li>
                          <li>Bronze layer normalizes to delta tables</li>
                          <li>Silver layer applies data quality rules and transformations</li>
                          <li>Gold layer creates materialized views for reporting</li>
                        </ol>
                      </div>
                    </div>
                  ) : (
                    <div className="ml-7 text-center py-4 text-muted-foreground">
                      <Lock className="h-5 w-5 mx-auto mb-1 opacity-40" />
                      <p className="text-sm">Complete Steps 1 and 2 first</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Auto-suggest bar when no step is open */}
          {activeVisualStep === null && (() => {
            const nextVisIdx = VISUAL_STEPS.findIndex((_, i) => !isVisualStepComplete(i));
            if (nextVisIdx < 0) return null;
            return (
              <div className="border-t border-border bg-primary/5 px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ChevronRight className="h-4 w-4 text-primary" />
                  <p className="text-sm text-foreground">
                    <strong>Next:</strong>{' '}
                    <span className="text-muted-foreground">Step {nextVisIdx + 1} — {VISUAL_STEPS[nextVisIdx]}</span>
                  </p>
                </div>
                <button
                  onClick={() => setActiveVisualStep(nextVisIdx)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-medium"
                >
                  Open <ArrowRight className="h-3 w-3" />
                </button>
              </div>
            );
          })()}
        </>
      )}

      {/* Empty state */}
      {!currentSource && sources.length === 0 && !showNewSource && (
        <div className="px-6 pb-6 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            No sources being onboarded. Click "New Source" to start.
          </p>
        </div>
      )}
    </div>
  );
}
