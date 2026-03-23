import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Loader2, CheckCircle2, XCircle, Clock, Activity,
  ArrowRight, Database, Layers, HardDrive, AlertTriangle, Play,
  Pause, ChevronDown, ChevronUp, Zap, FileText, Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ──

interface PipelineEvent {
  PipelineName: string;
  LogType: string;
  LogDateTime: string;
  LogData: string | null;
  PipelineRunGuid: string;
  EntityLayer: string;
}

interface NotebookEvent {
  NotebookName: string;
  LogType: string;
  LogDateTime: string;
  LogData: string | null;
  EntityId: string | null;
  EntityLayer: string;
  PipelineRunGuid: string;
}

interface CopyEvent {
  CopyActivityName: string;
  EntityName: string;
  LogType: string;
  LogDateTime: string;
  LogData: string | null;
  EntityId: string | null;
  EntityLayer: string;
  PipelineRunGuid: string;
}

interface BronzeEntity {
  BronzeLayerEntityId: string;
  SchemaName: string;
  TableName: string;
  InsertDateTime: string;
  IsProcessed: string;
  LoadEndDateTime: string | null;
}

interface LzEntity {
  LandingzoneEntityId: string;
  FilePath: string;
  FileName: string;
  InsertDateTime: string;
  IsProcessed: string;
  LoadEndDateTime: string | null;
}

interface Counts {
  lzRegistered?: string;
  lzPipelineTotal?: string;
  lzProcessed?: string;
  brzRegistered?: string;
  brzPipelineTotal?: string;
  brzProcessed?: string;
  slvRegistered?: string;
  slvPipelineTotal?: string;
  slvProcessed?: string;
  brzViewPending?: string;
  slvViewPending?: string;
}

interface LiveData {
  pipelineEvents: PipelineEvent[];
  notebookEvents: NotebookEvent[];
  copyEvents: CopyEvent[];
  counts: Counts;
  bronzeEntities: BronzeEntity[];
  lzEntities: LzEntity[];
  serverTime: string;
}

interface PipelineRun {
  guid: string;
  name: string;
  layer: string;
  startTime: string | null;
  endTime: string | null;
  status: 'running' | 'completed' | 'failed';
  logData: string | null;
  durationSec: number | null;
}

// ── Helpers ──

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso.endsWith('Z') ? iso : iso + 'Z');
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true });
}

function fmtDuration(sec: number | null): string {
  if (sec === null || sec < 0) return '...';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

function num(v: string | undefined): number {
  return parseInt(v || '0', 10) || 0;
}

function parseCopyOutput(logData: string | null): { rowsCopied: number; dataWritten: number; duration: string } {
  if (!logData) return { rowsCopied: 0, dataWritten: 0, duration: '' };
  try {
    const parsed = JSON.parse(logData);
    // Handle both formats: nested CopyOutput (pipeline) and flat (notebook)
    const co = parsed?.CopyOutput || parsed?.copyOutput || parsed || {};
    return {
      rowsCopied: co.rowsCopied || 0,
      dataWritten: co.dataWritten || 0,
      duration: co.duration || '',
    };
  } catch { return { rowsCopied: 0, dataWritten: 0, duration: '' }; }
}

function parseNotebookDetail(logData: string | null): { action: string; detail: string } {
  if (!logData) return { action: '', detail: '' };
  try {
    const parsed = JSON.parse(logData);
    const action = parsed?.Action || '';
    if (action === 'End') {
      // Handle pipeline format (nested CopyOutput) and notebook format (flat)
      const co = parsed?.CopyOutput || parsed;
      const schema = co?.TargetSchema || '';
      const name = co?.TargetName || co?.source || '';
      const runtime = co?.['Total Runtime'] || co?.duration || '';
      const rows = co?.RowsInserted ?? co?.rowsCopied ?? '';
      let detail = schema && name ? `${schema}.${name}` : name || '';
      if (rows) detail += ` (${typeof rows === 'number' ? rows.toLocaleString() : rows} rows)`;
      if (runtime) detail += ` [${runtime}]`;
      return { action, detail };
    }
    if (action === 'Error') {
      return { action, detail: parsed?.Message || JSON.stringify(parsed).slice(0, 120) };
    }
    return { action, detail: '' };
  } catch { return { action: '', detail: logData?.slice(0, 80) || '' }; }
}

// ── Progress Bar Component ──

function ProgressBar({ current, total, label, color }: { current: number; total: number; label: string; color: string }) {
  const pct = total > 0 ? (current / total) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>{label}</span>
        <span style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: '"tnum"', color: 'var(--bp-ink-tertiary)' }}>
          {current.toLocaleString()} / {total.toLocaleString()}
          {total > 0 && <span className="ml-1">({pct.toFixed(1)}%)</span>}
        </span>
      </div>
      <div className="h-2.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bp-canvas)' }}>
        <div
          className={cn("h-full rounded-full transition-all duration-700", color)}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

// ── Pipeline Run Row ──

function PipelineRunRow({ run }: { run: PipelineRun }) {
  const icon = run.status === 'running'
    ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--bp-caution)' }} />
    : run.status === 'failed'
      ? <XCircle className="h-4 w-4" style={{ color: 'var(--bp-fault)' }} />
      : <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--bp-operational)' }} />;

  const statusText = run.status === 'running' ? 'Running...' : run.status === 'failed' ? 'Failed' : 'Completed';
  const statusColor = run.status === 'running' ? 'var(--bp-caution)' : run.status === 'failed' ? 'var(--bp-fault)' : 'var(--bp-operational)';

  return (
    <div className="flex items-center gap-3 py-2 px-3 rounded-md transition-colors" style={{ backgroundColor: 'var(--bp-surface-1)' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bp-surface-inset)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--bp-surface-1)'}>
      {icon}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate" style={{ color: 'var(--bp-ink-primary)' }}>{run.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bp-canvas)', color: 'var(--bp-ink-tertiary)', fontFamily: "var(--font-mono)" }}>
            {run.layer}
          </span>
        </div>
      </div>
      <span className="text-xs font-medium" style={{ color: statusColor }}>{statusText}</span>
      <span className="text-xs w-20 text-right" style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: '"tnum"', color: 'var(--bp-ink-muted)' }}>{fmtTime(run.startTime)}</span>
      <span className="text-xs w-16 text-right" style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: '"tnum"', color: 'var(--bp-ink-muted)' }}>{fmtDuration(run.durationSec)}</span>
    </div>
  );
}

// ── Main Component ──

export default function LiveMonitor() {
  const [data, setData] = useState<LiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [pollInterval, setRefreshInterval] = useState(5);
  const [refreshCount, setRefreshCount] = useState(0);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [timeWindow, setTimeWindow] = useState(30); // minutes — default 30m (show recent only)
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    pipelines: true, progress: true, notebooks: true, copies: true, bronze: true, lz: true,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const fetchData = useCallback(async () => {
    setRefreshing(true);
    try {
      const resp = await fetch(`/api/live-monitor?minutes=${timeWindow}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const json = await resp.json();
      setData(json);
      setError(null);
      setLastRefresh(new Date());
      setRefreshCount(c => c + 1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [timeWindow]);

  // Auto-refresh
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(fetchData, pollInterval * 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, pollInterval, fetchData]);

  // ── Build pipeline runs from events ──
  const pipelineRuns: PipelineRun[] = [];
  if (data?.pipelineEvents) {
    const byGuid: Record<string, PipelineEvent[]> = {};
    for (const evt of data.pipelineEvents) {
      const g = evt.PipelineRunGuid;
      if (!byGuid[g]) byGuid[g] = [];
      byGuid[g].push(evt);
    }
    for (const [guid, events] of Object.entries(byGuid)) {
      const sorted = events.sort((a, b) => a.LogDateTime.localeCompare(b.LogDateTime));
      const start = sorted.find(e => e.LogType === 'StartPipeline');
      const end = sorted.find(e => e.LogType === 'EndPipeline' || e.LogType === 'FailPipeline');

      let durationSec: number | null = null;
      const startDt = start?.LogDateTime ? new Date(start.LogDateTime + 'Z') : null;
      const endDt = end?.LogDateTime ? new Date(end.LogDateTime + 'Z') : null;
      if (startDt && endDt) {
        durationSec = (endDt.getTime() - startDt.getTime()) / 1000;
      } else if (startDt) {
        durationSec = (Date.now() - startDt.getTime()) / 1000;
      }

      pipelineRuns.push({
        guid,
        name: sorted[0].PipelineName,
        layer: sorted[0].EntityLayer,
        startTime: start?.LogDateTime || null,
        endTime: end?.LogDateTime || null,
        status: !end ? 'running' : end.LogType === 'FailPipeline' ? 'failed' : 'completed',
        logData: end?.LogData || null,
        durationSec,
      });
    }
    // Sort: running first, then by start time desc
    pipelineRuns.sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (b.status === 'running' && a.status !== 'running') return 1;
      return (b.startTime || '').localeCompare(a.startTime || '');
    });
  }

  // ── Counts ──
  const counts = data?.counts || {};

  // ── Notebook event stats ──
  const nbEnds = data?.notebookEvents?.filter(e => e.LogType === 'EndNotebookActivity').length || 0;
  const nbFails = data?.notebookEvents?.filter(e => e.LogType === 'FailNotebookActivity').length || 0;

  // ── Copy event stats ──
  const copyEnds = data?.copyEvents?.filter(e => e.LogType === 'EndCopyActivity') || [];
  const totalRowsCopied = copyEnds.reduce((sum, e) => sum + parseCopyOutput(e.LogData).rowsCopied, 0);
  const totalDataWritten = copyEnds.reduce((sum, e) => sum + parseCopyOutput(e.LogData).dataWritten, 0);

  // ── Detect if anything is actively running ──
  const hasActiveRun = pipelineRuns.some(r => r.status === 'running');

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--bp-copper)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ padding: '32px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[32px] font-normal tracking-tight flex items-center gap-2" style={{ fontFamily: 'var(--bp-font-display)', color: 'var(--bp-ink-primary)' }}>
            <Activity className="h-6 w-6" style={{ color: 'var(--bp-copper)' }} />
            Live Pipeline Monitor
          </h1>
          <p className="text-sm mt-1" style={{ fontFamily: "var(--font-sans)", color: 'var(--bp-ink-secondary)' }}>
            Real-time entity-level pipeline progress
            {lastRefresh && (
              <span className="ml-2 text-xs" style={{ fontFamily: "var(--font-mono)", color: 'var(--bp-ink-muted)' }}>
                · Refresh #{refreshCount} · {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveRun && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--bp-caution)] bg-[var(--bp-caution-light)] px-3 py-1.5 rounded-full animate-pulse">
              <Zap className="h-3.5 w-3.5" />
              Pipeline Running
            </div>
          )}
          <select
            value={timeWindow}
            onChange={(e) => setTimeWindow(Number(e.target.value))}
            aria-label="Time window filter"
            className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value={5}>Last 5 min</option>
            <option value={15}>Last 15 min</option>
            <option value={30}>Last 30 min</option>
            <option value={60}>Last 1 hour</option>
            <option value={120}>Last 2 hours</option>
            <option value={240}>Last 4 hours</option>
            <option value={480}>Last 8 hours</option>
            <option value={1440}>Last 24 hours</option>
            <option value={0}>All time</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={cn("gap-1.5", autoRefresh && "border-[var(--bp-operational)] text-[var(--bp-operational)]")}
          >
            {autoRefresh ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {autoRefresh ? `Auto ${pollInterval}s` : 'Paused'}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5" disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && (
        <Card style={{ border: '1px solid var(--bp-fault)', backgroundColor: 'var(--bp-fault-light)' }}>
          <CardContent className="py-3 flex items-center gap-2 text-sm" style={{ color: 'var(--bp-fault)' }}>
            <AlertTriangle className="h-4 w-4" />
            {error}
          </CardContent>
        </Card>
      )}

      {/* Pipeline Runs */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" role="button" tabIndex={0} aria-expanded={expandedSections.pipelines} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('pipelines'); } }} onClick={() => toggleSection('pipelines')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Play className="h-4 w-4 text-[var(--bp-copper)]" />
              Pipeline Runs
              <span className="text-xs text-muted-foreground font-normal ml-1">
                ({timeWindow === 0 ? 'all time' : `last ${timeWindow >= 60 ? `${timeWindow / 60}h` : `${timeWindow}m`}`})
              </span>
            </CardTitle>
            {expandedSections.pipelines ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {expandedSections.pipelines && (
          <CardContent className="pt-0">
            {pipelineRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No pipeline runs {timeWindow === 0 ? '' : `in the last ${timeWindow >= 60 ? `${timeWindow / 60} hours` : `${timeWindow} minutes`}`}
              </p>
            ) : (
              <div style={{ borderColor: 'var(--bp-border-subtle)' }}>
                {pipelineRuns.map(run => (
                  <PipelineRunRow key={run.guid} run={run} />
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Entity Processing Progress */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" role="button" tabIndex={0} aria-expanded={expandedSections.progress} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('progress'); } }} onClick={() => toggleSection('progress')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="h-4 w-4 text-[var(--bp-operational)]" />
              Entity Processing Progress
            </CardTitle>
            {expandedSections.progress ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {expandedSections.progress && (
          <CardContent className="space-y-5 pt-0">
            <ProgressBar
              label="Landing Zone"
              current={num(counts.lzProcessed)}
              total={num(counts.lzRegistered)}
              color="bg-[var(--bp-copper)]"
            />
            <div className="flex items-center gap-4 text-[11px] -mt-1 pl-1" style={{ color: 'var(--bp-ink-muted)', fontFamily: "var(--font-mono)", fontFeatureSettings: '"tnum"' }}>
              <span>Registered: {num(counts.lzRegistered).toLocaleString()}</span>
              <span>·</span>
              <span>Queued: {num(counts.lzPipelineTotal).toLocaleString()}</span>
              <span>·</span>
              <span>Loaded: {num(counts.lzProcessed).toLocaleString()}</span>
            </div>

            <ProgressBar
              label="Bronze"
              current={num(counts.brzProcessed)}
              total={num(counts.brzRegistered)}
              color="bg-[var(--bp-caution)]"
            />
            <div className="flex items-center gap-4 text-[11px] -mt-1 pl-1" style={{ color: 'var(--bp-ink-muted)', fontFamily: "var(--font-mono)", fontFeatureSettings: '"tnum"' }}>
              <span>Registered: {num(counts.brzRegistered).toLocaleString()}</span>
              <span>·</span>
              <span>Queued: {num(counts.brzPipelineTotal).toLocaleString()}</span>
              <span>·</span>
              <span>Pending: {num(counts.brzViewPending).toLocaleString()}</span>
              <span>·</span>
              <span>Loaded: {num(counts.brzProcessed).toLocaleString()}</span>
            </div>

            <ProgressBar
              label="Silver"
              current={num(counts.slvProcessed)}
              total={num(counts.slvRegistered)}
              color="bg-[var(--bp-ink-tertiary)]"
            />
            <div className="flex items-center gap-4 text-[11px] -mt-1 pl-1" style={{ color: 'var(--bp-ink-muted)', fontFamily: "var(--font-mono)", fontFeatureSettings: '"tnum"' }}>
              <span>Registered: {num(counts.slvRegistered).toLocaleString()}</span>
              <span>·</span>
              <span>Queued: {num(counts.slvPipelineTotal).toLocaleString()}</span>
              <span>·</span>
              <span>Pending: {num(counts.slvViewPending).toLocaleString()}</span>
              <span>·</span>
              <span>Loaded: {num(counts.slvProcessed).toLocaleString()}</span>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Notebook Executions — entity level */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" role="button" tabIndex={0} aria-expanded={expandedSections.notebooks} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('notebooks'); } }} onClick={() => toggleSection('notebooks')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-[var(--bp-copper)]" />
              Notebook Executions
              <span className="text-xs text-muted-foreground font-normal ml-1">(entity-level)</span>
              {nbEnds > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bp-operational-light)] text-[var(--bp-operational)] font-mono">
                  {nbEnds} completed
                </span>
              )}
              {nbFails > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono" style={{ backgroundColor: 'var(--bp-fault-light)', color: 'var(--bp-fault)' }}>
                  {nbFails} failed
                </span>
              )}
            </CardTitle>
            {expandedSections.notebooks ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {expandedSections.notebooks && (
          <CardContent className="pt-0">
            {(!data?.notebookEvents || data.notebookEvents.length === 0) ? (
              <div className="text-sm text-muted-foreground py-6 text-center space-y-1">
                <p>No notebook executions {timeWindow === 0 ? '' : `in the last ${timeWindow >= 60 ? `${timeWindow / 60} hours` : `${timeWindow} minutes`}`}</p>
                <p className="text-xs">This section populates when Bronze/Silver notebooks process entities</p>
              </div>
            ) : (
              <div className="max-h-[500px] overflow-y-auto" style={{ borderColor: 'var(--bp-border-subtle)' }}>
                {data.notebookEvents.map((evt, i) => {
                  const { action, detail } = parseNotebookDetail(evt.LogData);
                  const isEnd = evt.LogType === 'EndNotebookActivity';
                  const isFail = evt.LogType === 'FailNotebookActivity';
                  const isStart = evt.LogType === 'StartNotebookActivity';
                  const icon = isFail ? <XCircle className="h-3.5 w-3.5" style={{ color: 'var(--bp-fault)' }} />
                    : isEnd ? <CheckCircle2 className="h-3.5 w-3.5" style={{ color: 'var(--bp-operational)' }} />
                      : <ArrowRight className="h-3.5 w-3.5" style={{ color: 'var(--bp-caution)' }} />;

                  return (
                    <div key={i} className="py-2 px-2" style={{ borderBottom: '1px solid var(--bp-border-subtle)', backgroundColor: 'var(--bp-surface-1)' }}>
                      <div className="flex items-center gap-2">
                        {icon}
                        <span className="text-xs w-20" style={{ fontFamily: "var(--font-mono)", fontFeatureSettings: '"tnum"', color: 'var(--bp-ink-muted)' }}>{fmtTime(evt.LogDateTime)}</span>
                        <span className="text-sm font-medium truncate flex-1" style={{ color: 'var(--bp-ink-primary)' }}>{evt.NotebookName}</span>
                        {evt.EntityId && (
                          <span className="text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bp-canvas)', color: 'var(--bp-ink-tertiary)', fontFamily: "var(--font-mono)" }}>
                            Entity {evt.EntityId}
                          </span>
                        )}
                        <span className="text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>{evt.EntityLayer}</span>
                      </div>
                      {detail && (
                        <div className="text-xs mt-0.5 ml-6" style={{ color: isFail ? 'var(--bp-fault)' : 'var(--bp-ink-tertiary)' }}>
                          {detail}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Copy Activity — LZ loads */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" role="button" tabIndex={0} aria-expanded={expandedSections.copies} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('copies'); } }} onClick={() => toggleSection('copies')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Copy className="h-4 w-4 text-[var(--bp-ink-tertiary)]" />
              Copy Activity — Landing Zone Loads
              {copyEnds.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bp-copper-light)] text-[var(--bp-copper)] font-mono">
                  {totalRowsCopied.toLocaleString()} rows · {fmtBytes(totalDataWritten)}
                </span>
              )}
            </CardTitle>
            {expandedSections.copies ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {expandedSections.copies && (
          <CardContent className="pt-0">
            {copyEnds.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No copy activity {timeWindow === 0 ? '' : `in the last ${timeWindow >= 60 ? `${timeWindow / 60} hours` : `${timeWindow} minutes`}`}
              </p>
            ) : (
              <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                {copyEnds.map((evt, i) => {
                  const { rowsCopied, dataWritten, duration } = parseCopyOutput(evt.LogData);
                  return (
                    <div key={i} className="flex items-center gap-3 py-2 px-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--bp-operational)] flex-shrink-0" />
                      <span className="text-xs font-mono text-muted-foreground w-20">{fmtTime(evt.LogDateTime)}</span>
                      <span className="text-sm font-medium flex-1 truncate">{evt.EntityName}</span>
                      <span className="text-xs font-mono text-muted-foreground w-24 text-right">
                        {rowsCopied > 0 ? `${rowsCopied.toLocaleString()} rows` : '—'}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground w-16 text-right">
                        {dataWritten > 0 ? fmtBytes(dataWritten) : duration || '—'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Bronze Layer — Recently Processed */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" role="button" tabIndex={0} aria-expanded={expandedSections.bronze} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('bronze'); } }} onClick={() => toggleSection('bronze')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-[var(--bp-caution)]" />
              Bronze Layer — Entity Processing
              {data?.bronzeEntities && data.bronzeEntities.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bp-caution-light)] text-[var(--bp-caution)] font-mono">
                  {data.bronzeEntities.length} tracked
                </span>
              )}
            </CardTitle>
            {expandedSections.bronze ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {expandedSections.bronze && (
          <CardContent className="pt-0">
            {(!data?.bronzeEntities || data.bronzeEntities.length === 0) ? (
              <div className="text-sm text-muted-foreground py-6 text-center space-y-1">
                <p>No Bronze entities have been processed yet</p>
                <p className="text-xs">Rows appear here as the Bronze notebook processes LZ files into Bronze tables</p>
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                {data.bronzeEntities.map((ent, i) => {
                  const isProcessed = ent.IsProcessed === 'True' || ent.IsProcessed === '1';
                  let dur = '';
                  if (ent.InsertDateTime && ent.LoadEndDateTime) {
                    const ms = new Date(ent.LoadEndDateTime + 'Z').getTime() - new Date(ent.InsertDateTime + 'Z').getTime();
                    dur = fmtDuration(ms / 1000);
                  }
                  return (
                    <div key={i} className="flex items-center gap-3 py-2 px-2">
                      {isProcessed
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--bp-operational)] flex-shrink-0" />
                        : <Clock className="h-3.5 w-3.5 text-[var(--bp-caution)] flex-shrink-0" />
                      }
                      <span className="text-xs font-mono text-muted-foreground w-20">{fmtTime(ent.InsertDateTime)}</span>
                      <span className="text-sm font-medium flex-1 truncate">{ent.SchemaName}.{ent.TableName}</span>
                      <span className="text-xs font-mono text-muted-foreground">{dur}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* Landing Zone — Recent Files */}
      <Card>
        <CardHeader className="pb-2 cursor-pointer" role="button" tabIndex={0} aria-expanded={expandedSections.lz} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSection('lz'); } }} onClick={() => toggleSection('lz')}>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-[var(--bp-ink-tertiary)]" />
              Landing Zone — Recent Files
              {data?.lzEntities && data.lzEntities.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bp-copper-light)] text-[var(--bp-copper)] font-mono">
                  {data.lzEntities.filter(e => e.IsProcessed === 'True' || e.IsProcessed === '1').length} processed
                </span>
              )}
            </CardTitle>
            {expandedSections.lz ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardHeader>
        {expandedSections.lz && (
          <CardContent className="pt-0">
            {(!data?.lzEntities || data.lzEntities.length === 0) ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No LZ pipeline entities tracked</p>
            ) : (
              <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
                {data.lzEntities.map((ent, i) => {
                  const isProcessed = ent.IsProcessed === 'True' || ent.IsProcessed === '1';
                  const fileName = ent.FileName || ent.FilePath?.split('/').pop() || '—';
                  return (
                    <div key={i} className="flex items-center gap-3 py-2 px-2">
                      {isProcessed
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--bp-operational)] flex-shrink-0" />
                        : <Clock className="h-3.5 w-3.5 text-[var(--bp-caution)] flex-shrink-0" />
                      }
                      <span className="text-xs font-mono text-muted-foreground w-20">{fmtTime(ent.InsertDateTime)}</span>
                      <span className="text-sm flex-1 truncate" title={ent.FilePath}>
                        <span className="font-medium">{fileName}</span>
                        {ent.FilePath && (
                          <span className="text-muted-foreground ml-1 text-xs">{ent.FilePath}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
