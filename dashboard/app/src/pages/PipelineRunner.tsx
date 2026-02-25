import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Play, Loader2, AlertCircle, CheckCircle2, ChevronRight,
  Database, Layers, ArrowRight, Shield, RotateCcw, Info,
  ChevronDown, ChevronUp, Search, X, Zap, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──

interface SourceEntityCounts {
  total: number;
  active: number;
}

interface RunnerSource {
  dataSourceId: number;
  name: string;
  connectionName: string;
  isActive: boolean;
  entities: {
    landing: SourceEntityCounts;
    bronze: SourceEntityCounts;
    silver: SourceEntityCounts;
  };
}

interface RunnerEntity {
  lzEntityId: number;
  sourceSchema: string;
  sourceName: string;
  namespace: string;
  isIncremental: boolean;
  incrementalColumn: string;
  lzActive: boolean;
  bronzeEntityId: number | null;
  bronzeActive: boolean | null;
  primaryKeys: string | null;
  silverEntityId: number | null;
  silverActive: boolean | null;
}

interface RunnerState {
  active: boolean;
  startedAt?: number;
  layer?: string;
  selectedSources?: number[];
  kept?: { lz: number; bronze: number; silver: number };
  deactivated?: { lz: number; bronze: number; silver: number };
  affected?: { lz: number; bronze: number; silver: number };
  pipelineTriggered?: string;
  jobInstanceId?: string;
  triggeredAt?: number;
}

type WizardStep = 'source' | 'layer' | 'review' | 'running';
type LayerChoice = 'landing' | 'bronze' | 'silver' | 'full';

// ── API ──

const API = 'http://localhost:8787/api';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
  }
  return res.json();
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
  }
  return res.json();
}

// ── Layer config ──

const layerConfig: Record<LayerChoice, { label: string; description: string; pipeline: string; color: string; icon: string }> = {
  landing: {
    label: 'Landing Zone',
    description: 'Copy source data into raw parquet files in the Landing Zone lakehouse',
    pipeline: 'PL_FMD_LOAD_LANDINGZONE',
    color: 'text-slate-500',
    icon: '📥',
  },
  bronze: {
    label: 'Bronze',
    description: 'Transform Landing Zone parquet files into Delta tables in the Bronze lakehouse',
    pipeline: 'PL_FMD_LOAD_BRONZE',
    color: 'text-amber-600',
    icon: '🥉',
  },
  silver: {
    label: 'Silver',
    description: 'Apply cleansing rules and load Bronze Delta tables into Silver lakehouse',
    pipeline: 'PL_FMD_LOAD_SILVER',
    color: 'text-purple-500',
    icon: '🥈',
  },
  full: {
    label: 'Full Pipeline',
    description: 'Run the complete flow: Landing Zone → Bronze → Silver in one execution',
    pipeline: 'PL_FMD_LOAD_ALL',
    color: 'text-emerald-500',
    icon: '🚀',
  },
};

// ── Step indicator ──

function StepIndicator({ step, currentStep, label }: { step: WizardStep; currentStep: WizardStep; label: string }) {
  const steps: WizardStep[] = ['source', 'layer', 'review', 'running'];
  const currentIdx = steps.indexOf(currentStep);
  const stepIdx = steps.indexOf(step);
  const isComplete = stepIdx < currentIdx;
  const isCurrent = step === currentStep;

  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all",
        isComplete && "bg-emerald-500 text-white",
        isCurrent && "bg-primary text-primary-foreground ring-2 ring-primary/30",
        !isComplete && !isCurrent && "bg-muted text-muted-foreground",
      )}>
        {isComplete ? <CheckCircle2 className="w-5 h-5" /> : stepIdx + 1}
      </div>
      <span className={cn(
        "text-sm font-medium transition-colors",
        isCurrent ? "text-foreground" : "text-muted-foreground",
      )}>
        {label}
      </span>
    </div>
  );
}

// ── Source card ──

function SourceCard({ source, selected, onToggle }: {
  source: RunnerSource;
  selected: boolean;
  onToggle: () => void;
}) {
  const totalEntities = source.entities.landing.total;
  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full text-left p-4 rounded-xl border-2 transition-all duration-200",
        selected
          ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
          : "border-border hover:border-primary/40 hover:bg-muted/30",
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center",
            selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}>
            <Database className="w-5 h-5" />
          </div>
          <div>
            <p className="font-semibold text-sm">{source.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{source.connectionName}</p>
          </div>
        </div>
        <div className={cn(
          "w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all",
          selected ? "border-primary bg-primary" : "border-muted-foreground/30",
        )}>
          {selected && <CheckCircle2 className="w-4 h-4 text-primary-foreground" />}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          { label: 'Landing', count: source.entities.landing.active, color: 'text-slate-500' },
          { label: 'Bronze', count: source.entities.bronze.active, color: 'text-amber-600' },
          { label: 'Silver', count: source.entities.silver.active, color: 'text-purple-500' },
        ].map(({ label, count, color }) => (
          <div key={label} className="text-center py-1.5 rounded-md bg-muted/50">
            <p className={cn("text-lg font-bold tabular-nums", color)}>{count}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {totalEntities} total entities
      </p>
    </button>
  );
}

// ── Entity table ──

function EntityTable({ entities, selectedIds, onToggle, onToggleAll, searchTerm, onSearchChange }: {
  entities: RunnerEntity[];
  selectedIds: Set<number>;
  onToggle: (id: number) => void;
  onToggleAll: () => void;
  searchTerm: string;
  onSearchChange: (v: string) => void;
}) {
  const filtered = entities.filter(e =>
    e.sourceName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.sourceSchema.toLowerCase().includes(searchTerm.toLowerCase())
  );
  const allSelected = filtered.length > 0 && filtered.every(e => selectedIds.has(e.lzEntityId));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter entities..."
            className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg bg-background"
          />
        </div>
        <Button variant="outline" size="sm" onClick={onToggleAll} className="text-xs whitespace-nowrap">
          {allSelected ? 'Deselect All' : 'Select All'}
        </Button>
      </div>
      <div className="max-h-[400px] overflow-y-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Entity</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Schema</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">Incremental</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">LZ</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">Bronze</th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-muted-foreground">Silver</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(e => {
              const selected = selectedIds.has(e.lzEntityId);
              return (
                <tr
                  key={e.lzEntityId}
                  onClick={() => onToggle(e.lzEntityId)}
                  className={cn(
                    "border-b border-border/50 cursor-pointer transition-colors",
                    selected ? "bg-primary/5" : "hover:bg-muted/30",
                  )}
                >
                  <td className="px-3 py-2 text-center">
                    <div className={cn(
                      "w-4 h-4 rounded border-2 flex items-center justify-center",
                      selected ? "border-primary bg-primary" : "border-muted-foreground/30",
                    )}>
                      {selected && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{e.sourceName}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{e.sourceSchema}</td>
                  <td className="px-3 py-2 text-center">
                    {e.isIncremental ? (
                      <span className="text-emerald-500 text-xs font-medium">Yes</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">Full</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {e.lzActive ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mx-auto" /> : <X className="w-3.5 h-3.5 text-muted-foreground/30 mx-auto" />}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {e.bronzeEntityId ? (
                      e.bronzeActive ? <CheckCircle2 className="w-3.5 h-3.5 text-amber-500 mx-auto" /> : <X className="w-3.5 h-3.5 text-muted-foreground/30 mx-auto" />
                    ) : <span className="text-muted-foreground/30">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {e.silverEntityId ? (
                      e.silverActive ? <CheckCircle2 className="w-3.5 h-3.5 text-purple-500 mx-auto" /> : <X className="w-3.5 h-3.5 text-muted-foreground/30 mx-auto" />
                    ) : <span className="text-muted-foreground/30">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {selectedIds.size} of {entities.length} entities selected
        {searchTerm && ` (showing ${filtered.length} matching "${searchTerm}")`}
      </p>
    </div>
  );
}


// ── Main Component ──

export default function PipelineRunner() {
  const [step, setStep] = useState<WizardStep>('source');
  const [sources, setSources] = useState<RunnerSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selections
  const [selectedSources, setSelectedSources] = useState<Set<number>>(new Set());
  const [selectedLayer, setSelectedLayer] = useState<LayerChoice>('landing');
  const [entityMode, setEntityMode] = useState<'all' | 'custom'>('all');
  const [entities, setEntities] = useState<RunnerEntity[]>([]);
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<number>>(new Set());
  const [entitySearch, setEntitySearch] = useState('');
  const [expandedSource, setExpandedSource] = useState<number | null>(null);
  const [loadingEntities, setLoadingEntities] = useState(false);

  // Execution state
  const [preparing, setPreparing] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [runnerState, setRunnerState] = useState<RunnerState>({ active: false });
  const [execError, setExecError] = useState<string | null>(null);

  // Load sources + check runner state
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [srcs, state] = await Promise.all([
          fetchJson<RunnerSource[]>('/runner/sources'),
          fetchJson<RunnerState>('/runner/state'),
        ]);
        setSources(srcs);
        setRunnerState(state);
        if (state.active) {
          setStep('running');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Load entities for a source
  const loadEntities = useCallback(async (dsId: number) => {
    setLoadingEntities(true);
    try {
      const ents = await fetchJson<RunnerEntity[]>(`/runner/entities?dataSourceId=${dsId}`);
      setEntities(ents);
      setSelectedEntityIds(new Set(ents.map(e => e.lzEntityId)));
    } catch {
      setEntities([]);
    } finally {
      setLoadingEntities(false);
    }
  }, []);

  const toggleSource = (dsId: number) => {
    setSelectedSources(prev => {
      const next = new Set(prev);
      if (next.has(dsId)) next.delete(dsId);
      else next.add(dsId);
      return next;
    });
  };

  const toggleEntity = (id: number) => {
    setSelectedEntityIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllEntities = () => {
    const filtered = entities.filter(e =>
      e.sourceName.toLowerCase().includes(entitySearch.toLowerCase()) ||
      e.sourceSchema.toLowerCase().includes(entitySearch.toLowerCase())
    );
    const allSelected = filtered.every(e => selectedEntityIds.has(e.lzEntityId));
    if (allSelected) {
      setSelectedEntityIds(prev => {
        const next = new Set(prev);
        filtered.forEach(e => next.delete(e.lzEntityId));
        return next;
      });
    } else {
      setSelectedEntityIds(prev => {
        const next = new Set(prev);
        filtered.forEach(e => next.add(e.lzEntityId));
        return next;
      });
    }
  };

  // Computed values for review
  const selectedSourcesList = sources.filter(s => selectedSources.has(s.dataSourceId));
  const totalEntitiesInScope = selectedSourcesList.reduce((sum, s) => sum + s.entities.landing.active, 0);
  const pipelineName = layerConfig[selectedLayer].pipeline;

  // Execute the scoped run
  const executeRun = async () => {
    setExecError(null);
    setPreparing(true);
    try {
      // Step 1: Prepare scope
      const prepareBody: Record<string, unknown> = {
        dataSourceIds: Array.from(selectedSources),
        layer: selectedLayer,
      };
      if (entityMode === 'custom' && selectedEntityIds.size > 0) {
        prepareBody.entityIds = Array.from(selectedEntityIds);
      }
      await postJson('/runner/prepare', prepareBody);

      // Step 2: Trigger pipeline
      setTriggering(true);
      setPreparing(false);
      await postJson('/runner/trigger', { pipelineName });

      // Step 3: Switch to running state
      const state = await fetchJson<RunnerState>('/runner/state');
      setRunnerState(state);
      setStep('running');
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Execution failed');
      // If we partially prepared but failed to trigger, the scope is active — show running state
      const state = await fetchJson<RunnerState>('/runner/state').catch(() => ({ active: false }));
      setRunnerState(state);
      if (state.active) setStep('running');
    } finally {
      setPreparing(false);
      setTriggering(false);
    }
  };

  const restoreScope = async () => {
    setRestoring(true);
    setExecError(null);
    try {
      await postJson<Record<string, unknown>>('/runner/restore', {});
      setRunnerState({ active: false });
      setStep('source');
      setSelectedSources(new Set());
    } catch (err) {
      setExecError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading pipeline runner...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <p className="text-destructive font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3">
          <Zap className="w-7 h-7 text-amber-500" />
          Pipeline Runner
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Select sources, choose a layer, review, and fire. Full control over what runs and when.
        </p>
      </div>

      {/* Active scope warning banner */}
      {runnerState.active && step !== 'running' && (
        <div className="flex items-center gap-3 p-4 bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-300 dark:border-amber-700 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Active scope detected</p>
            <p className="text-xs text-amber-600 dark:text-amber-400">
              A previous scoped run is still active. Some entities are temporarily deactivated.
              Restore before starting a new run.
            </p>
          </div>
          <Button onClick={restoreScope} disabled={restoring} variant="outline" size="sm" className="gap-1.5">
            <RotateCcw className={cn("w-3.5 h-3.5", restoring && "animate-spin")} />
            {restoring ? 'Restoring...' : 'Restore Now'}
          </Button>
        </div>
      )}

      {/* Step indicator */}
      {step !== 'running' && (
        <div className="flex items-center gap-6">
          <StepIndicator step="source" currentStep={step} label="Select Sources" />
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <StepIndicator step="layer" currentStep={step} label="Choose Layer" />
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
          <StepIndicator step="review" currentStep={step} label="Review & Fire" />
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* Step 1: Select Sources                          */}
      {/* ═══════════════════════════════════════════════ */}
      {step === 'source' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Which data sources do you want to process?</h2>
            <div className="flex items-center gap-3">
              <p className="text-xs text-muted-foreground/60">Select one or more</p>
              <p className="text-sm text-muted-foreground tabular-nums">
                {selectedSources.size} of {sources.length} selected
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sources.map(source => (
              <SourceCard
                key={source.dataSourceId}
                source={source}
                selected={selectedSources.has(source.dataSourceId)}
                onToggle={() => toggleSource(source.dataSourceId)}
              />
            ))}
          </div>

          {/* Entity drill-down (optional) */}
          {selectedSources.size === 1 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Layers className="w-4 h-4" />
                    Entity-Level Control
                    <span className="text-xs font-normal text-muted-foreground">(optional)</span>
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant={entityMode === 'all' ? 'default' : 'outline'}
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setEntityMode('all')}
                    >
                      All Entities
                    </Button>
                    <Button
                      variant={entityMode === 'custom' ? 'default' : 'outline'}
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => {
                        setEntityMode('custom');
                        const dsId = Array.from(selectedSources)[0];
                        if (entities.length === 0 || expandedSource !== dsId) {
                          setExpandedSource(dsId);
                          loadEntities(dsId);
                        }
                      }}
                    >
                      Pick Specific Entities
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {entityMode === 'custom' && (
                <CardContent>
                  {loadingEntities ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      <span className="ml-2 text-sm text-muted-foreground">Loading entities...</span>
                    </div>
                  ) : (
                    <EntityTable
                      entities={entities}
                      selectedIds={selectedEntityIds}
                      onToggle={toggleEntity}
                      onToggleAll={toggleAllEntities}
                      searchTerm={entitySearch}
                      onSearchChange={setEntitySearch}
                    />
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {selectedSources.size > 1 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              Entity-level control is available when a single source is selected. With multiple sources, all active entities in each source will be included.
            </p>
          )}

          <div className="flex justify-end">
            <Button
              onClick={() => setStep('layer')}
              disabled={selectedSources.size === 0}
              className="gap-2"
            >
              Next: Choose Layer
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* Step 2: Choose Layer                            */}
      {/* ═══════════════════════════════════════════════ */}
      {step === 'layer' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Which pipeline layer do you want to run?</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.entries(layerConfig) as [LayerChoice, typeof layerConfig.landing][]).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => setSelectedLayer(key)}
                className={cn(
                  "w-full text-left p-5 rounded-xl border-2 transition-all duration-200",
                  selectedLayer === key
                    ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                    : "border-border hover:border-primary/40 hover:bg-muted/30",
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{cfg.icon}</span>
                  <div className="flex-1">
                    <p className={cn("font-semibold", cfg.color)}>{cfg.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>
                  </div>
                  <div className={cn(
                    "w-6 h-6 rounded-full border-2 flex items-center justify-center",
                    selectedLayer === key ? "border-primary bg-primary" : "border-muted-foreground/30",
                  )}>
                    {selectedLayer === key && <CheckCircle2 className="w-4 h-4 text-primary-foreground" />}
                  </div>
                </div>
                <div className="mt-3 px-1">
                  <p className="text-[11px] font-mono text-muted-foreground bg-muted/50 rounded px-2 py-1 inline-block">
                    {cfg.pipeline}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('source')} className="gap-2">
              Back
            </Button>
            <Button onClick={() => setStep('review')} className="gap-2">
              Next: Review
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* Step 3: Review & Fire                           */}
      {/* ═══════════════════════════════════════════════ */}
      {step === 'review' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Review your run configuration</h2>

          {/* Summary card */}
          <Card className="border-2 border-primary/20">
            <CardContent className="pt-6 space-y-4">
              {/* What will run */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pipeline</h3>
                <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                  <span className="text-xl">{layerConfig[selectedLayer].icon}</span>
                  <div>
                    <p className="font-semibold text-sm">{layerConfig[selectedLayer].label}</p>
                    <p className="text-xs font-mono text-muted-foreground">{pipelineName}</p>
                  </div>
                </div>
              </div>

              {/* Data sources */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Data Sources ({selectedSourcesList.length})</h3>
                <div className="space-y-2">
                  {selectedSourcesList.map(s => (
                    <div key={s.dataSourceId} className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Database className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium">{s.name}</span>
                        <span className="text-xs text-muted-foreground">via {s.connectionName}</span>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">
                        {entityMode === 'custom' && selectedSources.size === 1
                          ? `${selectedEntityIds.size} entities`
                          : `${s.entities.landing.active} entities`
                        }
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* What will be affected */}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Execution Scope</h3>
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Shield className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
                    <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
                      <p className="font-medium">Safe scoped execution</p>
                      <p>
                        Only{' '}
                        <strong>
                          {entityMode === 'custom' && selectedSources.size === 1
                            ? selectedEntityIds.size
                            : totalEntitiesInScope
                          }
                        </strong>{' '}
                        entities from{' '}
                        <strong>{selectedSourcesList.map(s => s.name).join(', ')}</strong>{' '}
                        will be processed. All other entities will be temporarily deactivated for the
                        duration of this run and automatically restorable afterward.
                      </p>
                      <p className="text-blue-600 dark:text-blue-400">
                        Non-selected sources are untouched and will resume normal operation after restore.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Failsafe warnings */}
          <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                <p className="font-medium">Before you fire</p>
                <ul className="space-y-0.5 list-disc list-inside">
                  <li>Entities not in scope will be temporarily deactivated in the metadata database</li>
                  <li>You must click <strong>"Restore All Entities"</strong> when the run completes (or if it fails)</li>
                  <li>If you close the browser, you can return here and restore — the state is saved on the server</li>
                  <li>Do not start another run until this one is restored</li>
                </ul>
              </div>
            </div>
          </div>

          {execError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-700 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-300">{execError}</p>
            </div>
          )}

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setStep('layer')} className="gap-2">
              Back
            </Button>
            <Button
              onClick={executeRun}
              disabled={preparing || triggering || runnerState.active}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              size="lg"
            >
              {preparing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Preparing scope...</>
              ) : triggering ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Triggering pipeline...</>
              ) : (
                <><Play className="w-4 h-4" /> Fire Pipeline</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════ */}
      {/* Step 4: Running / Active Scope                  */}
      {/* ═══════════════════════════════════════════════ */}
      {step === 'running' && (
        <div className="space-y-4">
          <Card className="border-2 border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/10">
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-amber-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">Scoped Run Active</h2>
                  <p className="text-sm text-muted-foreground">
                    Some entities are temporarily deactivated. Restore when complete.
                  </p>
                </div>
              </div>

              {/* Run details */}
              <div className="grid gap-3 sm:grid-cols-2">
                {runnerState.pipelineTriggered && (
                  <div className="p-3 bg-background rounded-lg border">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Pipeline</p>
                    <p className="text-sm font-mono font-medium mt-1">{runnerState.pipelineTriggered}</p>
                  </div>
                )}
                {runnerState.layer && (
                  <div className="p-3 bg-background rounded-lg border">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Layer</p>
                    <p className="text-sm font-medium mt-1 capitalize">{runnerState.layer === 'full' ? 'Full Pipeline' : runnerState.layer}</p>
                  </div>
                )}
                {runnerState.kept && (
                  <div className="p-3 bg-background rounded-lg border">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Entities In Scope</p>
                    <p className="text-sm font-medium mt-1 tabular-nums">
                      {runnerState.kept.lz} LZ · {runnerState.kept.bronze} Bronze · {runnerState.kept.silver} Silver
                    </p>
                  </div>
                )}
                {runnerState.affected && (
                  <div className="p-3 bg-background rounded-lg border">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Temporarily Deactivated</p>
                    <p className="text-sm font-medium mt-1 tabular-nums text-amber-600">
                      {runnerState.affected.lz} LZ · {runnerState.affected.bronze} Bronze · {runnerState.affected.silver} Silver
                    </p>
                  </div>
                )}
              </div>

              {runnerState.triggeredAt && (
                <p className="text-xs text-muted-foreground">
                  Started {new Date(runnerState.triggeredAt * 1000).toLocaleString('en-US', {
                    month: 'numeric', day: 'numeric', year: 'numeric',
                    hour: 'numeric', minute: '2-digit', hour12: true,
                  })}
                </p>
              )}

              {execError && (
                <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-700 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-sm text-red-700 dark:text-red-300">{execError}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Restore button */}
          <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg border">
            <div>
              <p className="text-sm font-semibold">Ready to restore?</p>
              <p className="text-xs text-muted-foreground">
                Click restore to reactivate all temporarily deactivated entities. Do this after the pipeline
                completes or if you need to cancel.
              </p>
            </div>
            <Button
              onClick={restoreScope}
              disabled={restoring}
              size="lg"
              className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {restoring ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Restoring...</>
              ) : (
                <><RotateCcw className="w-4 h-4" /> Restore All Entities</>
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5" />
            Check the Monitoring Hub on the Pipeline Monitor page to track this run's progress.
          </p>
        </div>
      )}
    </div>
  );
}
