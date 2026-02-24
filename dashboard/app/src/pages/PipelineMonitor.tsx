import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Loader2, XCircle, Clock, Info,
  Play, Rocket, CheckCircle2, AlertCircle, Activity,
  ChevronDown, ChevronUp, X, Eye, EyeOff, Terminal,
  Copy, ArrowRight, Ban, Timer, SkipForward,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Bar, BarChart, Cell, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";

// ── Types ──

interface Pipeline {
  PipelineId: string;
  PipelineGuid: string;
  WorkspaceGuid: string;
  Name: string;
  IsActive: string;
}

interface PipelineExecution {
  [key: string]: string | null;
}

interface Workspace {
  WorkspaceId: string;
  WorkspaceGuid: string;
  Name: string;
}

interface TriggerResult {
  success: boolean;
  pipelineName: string;
  pipelineGuid: string;
  workspaceGuid: string;
  status: number;
  location: string;
}

interface ActiveRun {
  pipelineName: string;
  triggeredAt: Date;
  status: 'triggered' | 'running' | 'succeeded' | 'failed';
  location?: string;
  fromFabric?: boolean;  // true if this came from Fabric API (not local trigger)
}

interface FabricJob {
  id?: string;
  status: string;
  startTimeUtc?: string;
  endTimeUtc?: string;
  failureReason?: string | Record<string, unknown> | null;
  pipelineName: string;
  pipelineGuid: string;
  workspaceGuid: string;
  workspaceName: string;
  [key: string]: unknown;
}

// ── Fabric Icon ──

function FabricIcon({ name, className = 'w-5 h-5' }: { name: string; className?: string }) {
  return <img src={`/icons/${name}.svg`} alt={name} className={className} />;
}

// ── API ──

const API = 'http://localhost:8787/api';

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
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

// ── Pipeline display names ──
// Maps ugly internal names → clean business names. Unknown pipelines get auto-cleaned.

const displayNameOverrides: Record<string, string> = {
  // ── Orchestration ──
  'PL_FMD_LOAD_ALL':                       'Full Pipeline Run',
  'PL_FMD_LOAD_LANDINGZONE':               'Load Landing Zone',
  'PL_FMD_LOAD_BRONZE':                    'Load Bronze Layer',
  'PL_FMD_LOAD_SILVER':                    'Load Silver Layer',

  // ── Landing Zone: Command (dispatch) pipelines ──
  'PL_FMD_LDZ_COMMAND_ADF':                'Landing Zone: ADF Dispatch',
  'PL_FMD_LDZ_COMMAND_ADLS':               'Landing Zone: ADLS Dispatch',
  'PL_FMD_LDZ_COMMAND_ASQL':               'Landing Zone: SQL Server Dispatch',
  'PL_FMD_LDZ_COMMAND_FTP':                'Landing Zone: FTP Dispatch',
  'PL_FMD_LDZ_COMMAND_NOTEBOOK':           'Landing Zone: Notebook Dispatch',
  'PL_FMD_LDZ_COMMAND_ONELAKE':            'Landing Zone: OneLake Dispatch',
  'PL_FMD_LDZ_COMMAND_ORACLE':             'Landing Zone: Oracle Dispatch',
  'PL_FMD_LDZ_COMMAND_SFTP':               'Landing Zone: SFTP Dispatch',

  // ── Landing Zone: Copy (worker) pipelines ──
  'PL_FMD_LDZ_COPY_FROM_ADF':             'Copy from ADF',
  'PL_FMD_LDZ_COPY_FROM_ADLS_01':         'Copy from ADLS',
  'PL_FMD_LDZ_COPY_FROM_ASQL_01':         'Copy from SQL Server',
  'PL_FMD_LDZ_COPY_FROM_CUSTOM_NB':       'Copy via Custom Notebook',
  'PL_FMD_LDZ_COPY_FROM_FTP_01':          'Copy from FTP',
  'PL_FMD_LDZ_COPY_FROM_ONELAKE_FILES_01':    'Copy from OneLake Files',
  'PL_FMD_LDZ_COPY_FROM_ONELAKE_TABLES_01':   'Copy from OneLake Tables',
  'PL_FMD_LDZ_COPY_FROM_ORACLE_01':       'Copy from Oracle',
  'PL_FMD_LDZ_COPY_FROM_SFTP_01':         'Copy from SFTP',

  // ── Utility ──
  'PL_TOOLING_POST_ASQL_TO_FMD':           'SQL to FMD Utility',
};

function getDisplayName(technicalName: string): string {
  if (displayNameOverrides[technicalName]) return displayNameOverrides[technicalName];
  // Fallback: strip prefix and title-case
  return technicalName
    .replace(/^PL_(FMD_)?/, '')
    .replace(/_/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}


// ── Pipeline categorization ──

type PipelineCategory = 'Landing Zone' | 'Bronze' | 'Silver' | 'Orchestration' | 'Utility';

function categorize(name: string): PipelineCategory {
  if (name.includes('_LDZ_') || name.includes('LANDING')) return 'Landing Zone';
  if (name.includes('_BRONZE_') || name.includes('_BRZ_')) return 'Bronze';
  if (name.includes('_SILVER_') || name.includes('_SLV_')) return 'Silver';
  if (name.includes('_LOAD_') || name.includes('_TASKFLOW_')) return 'Orchestration';
  return 'Utility';
}

const categoryColors: Record<PipelineCategory, string> = {
  'Landing Zone': 'bg-blue-500',
  'Bronze': 'bg-amber-500',
  'Silver': 'bg-purple-500',
  'Orchestration': 'bg-emerald-500',
  'Utility': 'bg-slate-500',
};

const categoryChartColors: Record<PipelineCategory, string> = {
  'Landing Zone': '#3b82f6',
  'Bronze': '#f59e0b',
  'Silver': '#a855f7',
  'Orchestration': '#10b981',
  'Utility': '#64748b',
};

const categoryBadgeColors: Record<PipelineCategory, string> = {
  'Landing Zone': 'text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/40',
  'Bronze': 'text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40',
  'Silver': 'text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40',
  'Orchestration': 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-900/40',
  'Utility': 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-900/40',
};

// ── Quick Action definitions ──

interface QuickAction {
  label: string;
  pipelineName: string;
  description: string;
  icon: typeof Rocket;
  color: string;
  borderColor: string;
  bgColor: string;
  hoverBg: string;
}

const quickActions: QuickAction[] = [
  {
    label: 'Landing Zone',
    pipelineName: 'PL_FMD_LOAD_LANDINGZONE',
    description: 'Copy source data into Landing Zone lakehouse',
    icon: Rocket,
    color: 'text-blue-600 dark:text-blue-400',
    borderColor: 'border-blue-300 dark:border-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-950/40',
    hoverBg: 'hover:bg-blue-100 dark:hover:bg-blue-900/50',
  },
  {
    label: 'Bronze',
    pipelineName: 'PL_FMD_LOAD_BRONZE',
    description: 'Transform Landing Zone to Bronze layer',
    icon: Activity,
    color: 'text-amber-600 dark:text-amber-400',
    borderColor: 'border-amber-300 dark:border-amber-600',
    bgColor: 'bg-amber-50 dark:bg-amber-950/40',
    hoverBg: 'hover:bg-amber-100 dark:hover:bg-amber-900/50',
  },
  {
    label: 'Silver',
    pipelineName: 'PL_FMD_LOAD_SILVER',
    description: 'Transform Bronze to Silver layer',
    icon: Activity,
    color: 'text-purple-600 dark:text-purple-400',
    borderColor: 'border-purple-300 dark:border-purple-600',
    bgColor: 'bg-purple-50 dark:bg-purple-950/40',
    hoverBg: 'hover:bg-purple-100 dark:hover:bg-purple-900/50',
  },
  {
    label: 'Full Load',
    pipelineName: 'PL_FMD_LOAD_ALL',
    description: 'Run complete pipeline: LDZ → Bronze → Silver',
    icon: Rocket,
    color: 'text-emerald-600 dark:text-emerald-400',
    borderColor: 'border-emerald-300 dark:border-emerald-600',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/40',
    hoverBg: 'hover:bg-emerald-100 dark:hover:bg-emerald-900/50',
  },
];

// ── Medallion progress indicator ──

const layers = ['Landing Zone', 'Bronze', 'Silver', 'Gold'] as const;

function MedallionProgress({ category }: { category: PipelineCategory }) {
  const layerIndex = category === 'Landing Zone' ? 0
    : category === 'Bronze' ? 1
    : category === 'Silver' ? 2
    : category === 'Orchestration' ? 3 : -1;

  return (
    <div className="flex flex-col gap-1.5 mt-3 w-full max-w-md">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        <span>Landing</span>
        <span>Gold</span>
      </div>
      <div className="flex items-center gap-1">
        {layers.map((layer, index) => {
          let color = "bg-muted";
          if (layerIndex >= 0 && index <= layerIndex) {
            color = index === layerIndex ? categoryColors[category] : "bg-emerald-500/80";
          }
          return (
            <div
              key={layer}
              className={cn("h-2 flex-1 rounded-full transition-all duration-500", color)}
              title={layer}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Fabric Job Status helpers ──

type FabricStatus = 'completed' | 'failed' | 'inprogress' | 'running' | 'notstarted' | 'cancelled' | 'deduped' | 'unknown' | 'none';

function normalizeFabricStatus(raw?: string): FabricStatus {
  if (!raw) return 'none';
  const s = raw.toLowerCase();
  if (s === 'completed' || s === 'succeeded') return 'completed';
  if (s === 'failed') return 'failed';
  if (s === 'inprogress' || s === 'running') return 'inprogress';
  if (s === 'notstarted' || s === 'queued') return 'notstarted';
  if (s === 'cancelled') return 'cancelled';
  if (s === 'deduped') return 'deduped';
  return 'unknown';
}

const fabricStatusConfig: Record<FabricStatus, {
  label: string;
  icon: typeof CheckCircle2;
  color: string;
  bg: string;
  border: string;
  pulse?: boolean;
}> = {
  completed: {
    label: 'Succeeded',
    icon: CheckCircle2,
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-200 dark:border-emerald-800/50',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-50 dark:bg-red-950/30',
    border: 'border-red-200 dark:border-red-800/50',
  },
  inprogress: {
    label: 'In Progress',
    icon: Loader2,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800/50',
    pulse: true,
  },
  running: {
    label: 'Running',
    icon: Loader2,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800/50',
    pulse: true,
  },
  notstarted: {
    label: 'Queued',
    icon: Timer,
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800/50',
  },
  cancelled: {
    label: 'Cancelled',
    icon: Ban,
    color: 'text-slate-500 dark:text-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-950/30',
    border: 'border-slate-200 dark:border-slate-800/50',
  },
  deduped: {
    label: 'Deduped',
    icon: SkipForward,
    color: 'text-slate-500 dark:text-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-950/30',
    border: 'border-slate-200 dark:border-slate-800/50',
  },
  unknown: {
    label: 'Unknown',
    icon: Info,
    color: 'text-slate-500 dark:text-slate-400',
    bg: 'bg-slate-50 dark:bg-slate-900/20',
    border: 'border-slate-200 dark:border-slate-800/50',
  },
  none: {
    label: 'No runs',
    icon: Clock,
    color: 'text-muted-foreground',
    bg: 'bg-muted/30',
    border: 'border-border',
  },
};

function formatTimeAgo(isoString?: string): string {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDuration(startUtc?: string, endUtc?: string): string {
  if (!startUtc) return '';
  const start = new Date(startUtc).getTime();
  const end = endUtc ? new Date(endUtc).getTime() : Date.now();
  const secs = Math.floor((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function PipelineStatusBadge({ job }: { job?: FabricJob }) {
  const status = normalizeFabricStatus(job?.status);
  const config = fabricStatusConfig[status];
  const Icon = config.icon;

  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all",
      config.bg, config.border, config.color,
    )}>
      <Icon className={cn("w-3.5 h-3.5", config.pulse && "animate-spin")} />
      <span>{config.label}</span>
    </div>
  );
}

function PipelineStatusDetail({ job }: { job?: FabricJob }) {
  if (!job) return null;
  const status = normalizeFabricStatus(job.status);
  const isActive = status === 'inprogress' || status === 'running' || status === 'notstarted';

  return (
    <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
      {job.startTimeUtc && (
        <span title={new Date(job.startTimeUtc).toLocaleString()}>
          {isActive ? 'Started' : 'Ran'} {formatTimeAgo(job.startTimeUtc)}
        </span>
      )}
      {job.startTimeUtc && (
        <>
          <span className="text-border">|</span>
          <span className="flex items-center gap-1">
            <Timer className="w-3 h-3" />
            {formatDuration(job.startTimeUtc, job.endTimeUtc || undefined)}
          </span>
        </>
      )}
      {job.failureReason && (() => {
        const reason = typeof job.failureReason === 'string'
          ? job.failureReason
          : (job.failureReason as Record<string, unknown>)?.message as string || 'Error';
        return (
          <>
            <span className="text-border">|</span>
            <span className="text-red-500 dark:text-red-400 truncate max-w-[200px]" title={reason}>
              {reason}
            </span>
          </>
        );
      })()}
    </div>
  );
}

// ── Active Run Card ──

function ActiveRunCard({ run, onDismiss, onViewLog }: { run: ActiveRun; onDismiss: () => void; onViewLog: () => void }) {
  const elapsed = Math.round((Date.now() - run.triggeredAt.getTime()) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <div className={cn(
      "flex items-center justify-between p-3 rounded-lg border transition-all duration-300",
      run.status === 'triggered' || run.status === 'running'
        ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700"
        : run.status === 'succeeded'
          ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700"
          : "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700"
    )}>
      <div className="flex items-center gap-3">
        {(run.status === 'triggered' || run.status === 'running') && (
          <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
        )}
        {run.status === 'succeeded' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
        {run.status === 'failed' && <AlertCircle className="w-4 h-4 text-red-500" />}
        <div>
          <p className="text-sm font-semibold">{getDisplayName(run.pipelineName)}</p>
          <p className="text-xs text-muted-foreground font-mono">{run.pipelineName}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {run.status === 'triggered' ? 'Starting...' : run.status === 'running' ? 'In progress' : run.status}
            {' · '}
            {mins}m {secs}s
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onViewLog} className="gap-1.5 text-xs h-7">
          <Terminal className="w-3 h-3" />
          View Log
        </Button>
        {(run.status === 'succeeded' || run.status === 'failed') && (
          <Button variant="ghost" size="sm" onClick={onDismiss} className="text-xs h-7">
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Execution Log Modal ──

// ── Activity Run types ──
interface ActivityRun {
  activityName: string;
  activityType: string;
  status: string;
  startTime: string;
  endTime: string;
  durationMs: number;
  error: Record<string, unknown>;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  activityRunId: string;
}

function ActivityStatusIcon({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === 'succeeded') return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
  if (s === 'failed') return <AlertCircle className="w-4 h-4 text-red-500" />;
  if (s === 'inprogress' || s === 'running') return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
  if (s === 'cancelled') return <XCircle className="w-4 h-4 text-amber-500" />;
  return <Clock className="w-4 h-4 text-muted-foreground" />;
}

function activityTypeIcon(type: string): string {
  const t = type.toLowerCase();
  if (t === 'copy') return 'Copy';
  if (t === 'executepipeline') return 'Invoke Pipeline';
  if (t === 'tridentnotebook' || t === 'notebook') return 'Notebook';
  if (t === 'foreach') return 'For Each';
  if (t === 'ifcondition') return 'If Condition';
  if (t === 'wait') return 'Wait';
  if (t === 'setvariable') return 'Set Variable';
  if (t === 'lookup') return 'Lookup';
  if (t === 'executedataflow') return 'Dataflow';
  return type;
}

function formatDurationMs(ms: number): string {
  if (!ms || ms <= 0) return '—';
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function ExecutionLogModal({
  pipelineName,
  onClose,
  fabricJobs,
}: {
  pipelineName: string;
  onClose: () => void;
  fabricJobs: FabricJob[];
}) {
  const [pipelineExecs, setPipelineExecs] = useState<PipelineExecution[]>([]);
  const [copyExecs, setCopyExecs] = useState<PipelineExecution[]>([]);
  const [notebookExecs, setNotebookExecs] = useState<PipelineExecution[]>([]);
  const [activityRuns, setActivityRuns] = useState<ActivityRun[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'activities' | 'pipeline' | 'copy' | 'notebook'>('activities');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Find the latest job for this pipeline to get activity runs
  const latestJob = fabricJobs.find(j => j.pipelineName === pipelineName);
  const wsGuid = latestJob?.workspaceGuid || '';
  const jobId = latestJob?.id || '';

  const fetchActivityRuns = useCallback(async () => {
    if (!wsGuid || !jobId) {
      setActivityLoading(false);
      return;
    }
    try {
      const runs = await fetchJson<ActivityRun[]>(
        `/pipeline-activity-runs?workspaceGuid=${wsGuid}&jobInstanceId=${jobId}`
      );
      setActivityRuns(runs);
    } catch {
      // API may not be available yet
    } finally {
      setActivityLoading(false);
    }
  }, [wsGuid, jobId]);

  const fetchExecData = useCallback(async () => {
    try {
      const [pipes, copies, notebooks] = await Promise.all([
        fetchJson<PipelineExecution[]>('/pipeline-executions'),
        fetchJson<PipelineExecution[]>('/copy-executions'),
        fetchJson<PipelineExecution[]>('/notebook-executions'),
      ]);
      setPipelineExecs(pipes);
      setCopyExecs(copies);
      setNotebookExecs(notebooks);
    } catch {
      // continue polling
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExecData();
    fetchActivityRuns();
    pollRef.current = setInterval(() => {
      fetchExecData();
      fetchActivityRuns();
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchExecData, fetchActivityRuns]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const displayName = getDisplayName(pipelineName);

  // Get columns dynamically from data
  const getColumns = (data: PipelineExecution[]) => {
    if (data.length === 0) return [];
    return Object.keys(data[0]);
  };

  const getStatusColor = (status: string | null) => {
    if (!status) return 'text-muted-foreground';
    const s = status.toLowerCase();
    if (s === 'succeeded' || s === 'completed' || s === 'success') return 'text-emerald-600 dark:text-emerald-400';
    if (s === 'failed' || s === 'error') return 'text-red-600 dark:text-red-400';
    if (s === 'inprogress' || s === 'running' || s === 'queued') return 'text-blue-600 dark:text-blue-400';
    if (s === 'cancelled') return 'text-amber-600 dark:text-amber-400';
    return 'text-foreground';
  };

  const getStatusIcon = (status: string | null) => {
    if (!status) return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
    const s = status.toLowerCase();
    if (s === 'succeeded' || s === 'completed' || s === 'success') return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
    if (s === 'failed' || s === 'error') return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    if (s === 'inprogress' || s === 'running' || s === 'queued') return <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />;
    if (s === 'cancelled') return <XCircle className="w-3.5 h-3.5 text-amber-500" />;
    return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const formatCellValue = (key: string, value: string | null): string => {
    if (value === null) return '—';
    if (key.toLowerCase().includes('guid') && value.length > 20) {
      return value.substring(0, 8) + '...';
    }
    if (key.toLowerCase().includes('time') || key.toLowerCase().includes('date')) {
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
      } catch { /* return raw */ }
    }
    if (value.length > 60) return value.substring(0, 57) + '...';
    return value;
  };

  const tabs = [
    { key: 'activities' as const, label: 'Activity Runs', count: activityRuns.length },
    { key: 'pipeline' as const, label: 'Pipeline Log', count: pipelineExecs.length },
    { key: 'copy' as const, label: 'Copy Activities', count: copyExecs.length },
    { key: 'notebook' as const, label: 'Notebooks', count: notebookExecs.length },
  ];

  const activeData = activeTab === 'pipeline' ? pipelineExecs
    : activeTab === 'copy' ? copyExecs
    : activeTab === 'notebook' ? notebookExecs
    : [];

  const columns = getColumns(activeData);

  // Compute progress for activity runs
  const totalActivities = activityRuns.length;
  const completedActivities = activityRuns.filter(a => a.status.toLowerCase() === 'succeeded').length;
  const failedActivities = activityRuns.filter(a => a.status.toLowerCase() === 'failed').length;
  const runningActivities = activityRuns.filter(a => ['inprogress', 'running'].includes(a.status.toLowerCase())).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-[90vw] max-w-6xl h-[80vh] bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-4">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/40">
              <Terminal className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{displayName}</h2>
              <p className="text-xs text-muted-foreground font-mono flex items-center gap-2">
                {pipelineName}
                <button
                  onClick={() => navigator.clipboard.writeText(pipelineName)}
                  className="hover:text-foreground transition-colors"
                  title="Copy pipeline name"
                >
                  <Copy className="w-3 h-3" />
                </button>
                {latestJob && (
                  <>
                    <span className="text-border mx-1">|</span>
                    <PipelineStatusBadge job={latestJob} />
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              Live (4s)
            </div>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 pt-3 pb-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "px-4 py-2 text-sm font-medium rounded-t-lg border border-b-0 transition-all",
                activeTab === tab.key
                  ? "bg-background text-foreground border-border"
                  : "bg-transparent text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50",
              )}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className={cn(
                  "ml-2 text-xs px-1.5 py-0.5 rounded-full",
                  tab.key === 'activities' && runningActivities > 0
                    ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
                    : "bg-muted text-muted-foreground",
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto border-t border-border">
          {activeTab === 'activities' ? (
            // ── Activity Runs View ──
            activityLoading ? (
              <div className="flex items-center justify-center h-full gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <span className="text-muted-foreground">Loading activity runs from Fabric...</span>
              </div>
            ) : activityRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
                <Activity className="w-12 h-12 opacity-30" />
                <div className="text-center">
                  <p className="font-medium">No activity runs available</p>
                  <p className="text-sm mt-1">
                    {!latestJob
                      ? 'No recent pipeline execution found. Trigger a run to see activity-level detail.'
                      : 'Activity data will appear once the pipeline starts executing steps.'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {/* Progress summary */}
                <div className="flex items-center gap-4 p-3 bg-muted/30 rounded-lg border border-border">
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                      <span>{completedActivities + failedActivities} of {totalActivities} activities completed</span>
                      <span>
                        {completedActivities > 0 && <span className="text-emerald-500 mr-2">{completedActivities} succeeded</span>}
                        {failedActivities > 0 && <span className="text-red-500 mr-2">{failedActivities} failed</span>}
                        {runningActivities > 0 && <span className="text-blue-500">{runningActivities} running</span>}
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden flex">
                      {completedActivities > 0 && (
                        <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(completedActivities / totalActivities) * 100}%` }} />
                      )}
                      {runningActivities > 0 && (
                        <div className="h-full bg-blue-500 animate-pulse transition-all duration-500" style={{ width: `${(runningActivities / totalActivities) * 100}%` }} />
                      )}
                      {failedActivities > 0 && (
                        <div className="h-full bg-red-500 transition-all duration-500" style={{ width: `${(failedActivities / totalActivities) * 100}%` }} />
                      )}
                    </div>
                  </div>
                </div>

                {/* Activity list */}
                {activityRuns.map((activity, idx) => {
                  const s = activity.status.toLowerCase();
                  const isActive = s === 'inprogress' || s === 'running';
                  const isFailed = s === 'failed';
                  const isSucceeded = s === 'succeeded';
                  const errorMsg = activity.error?.message as string || '';

                  return (
                    <div
                      key={activity.activityRunId || idx}
                      className={cn(
                        "flex items-center gap-4 p-3 rounded-lg border transition-all",
                        isActive
                          ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-300 dark:border-blue-700"
                          : isFailed
                            ? "bg-red-50/30 dark:bg-red-950/10 border-red-200 dark:border-red-900/50"
                            : isSucceeded
                              ? "bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-900/50"
                              : "bg-card border-border",
                      )}
                    >
                      {/* Step number */}
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                        {idx + 1}
                      </div>

                      {/* Status icon */}
                      <div className="flex-shrink-0">
                        <ActivityStatusIcon status={activity.status} />
                      </div>

                      {/* Activity details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-foreground truncate">
                            {activity.activityName}
                          </span>
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex-shrink-0">
                            {activityTypeIcon(activity.activityType)}
                          </span>
                        </div>
                        {isFailed && errorMsg && (
                          <p className="text-xs text-red-500 dark:text-red-400 mt-0.5 truncate" title={errorMsg}>
                            {errorMsg}
                          </p>
                        )}
                        {activity.startTime && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {new Date(activity.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            {activity.endTime && ` → ${new Date(activity.endTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`}
                          </p>
                        )}
                      </div>

                      {/* Duration */}
                      <div className="flex-shrink-0 text-right">
                        <span className={cn(
                          "text-sm font-mono font-medium",
                          isActive ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground",
                        )}>
                          {isActive
                            ? formatDuration(activity.startTime, undefined)
                            : formatDurationMs(activity.durationMs)}
                        </span>
                        <p className={cn(
                          "text-[10px] font-semibold uppercase tracking-wider",
                          isActive ? "text-blue-500" : isFailed ? "text-red-500" : isSucceeded ? "text-emerald-500" : "text-muted-foreground",
                        )}>
                          {activity.status}
                        </p>
                      </div>

                      {/* Connector line to next */}
                      {idx < activityRuns.length - 1 && (
                        <div className="absolute left-[2.35rem] mt-[4.5rem] w-0.5 h-3 bg-border" />
                      )}
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            // ── Table-based views (Pipeline Log, Copy, Notebook) ──
            loading ? (
              <div className="flex items-center justify-center h-full gap-3">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                <span className="text-muted-foreground">Loading execution data...</span>
              </div>
            ) : activeData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
                <Terminal className="w-12 h-12 opacity-30" />
                <div className="text-center">
                  <p className="font-medium">No {activeTab} execution data yet</p>
                  <p className="text-sm mt-1">
                    Execution logs will appear here as the pipeline runs. Data refreshes every 4 seconds.
                  </p>
                </div>
              </div>
            ) : (
              <div className="min-w-full">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-muted/80 backdrop-blur-sm">
                      {columns.map((col) => (
                        <th
                          key={col}
                          className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap border-b border-border"
                        >
                          {col.replace(/([A-Z])/g, ' $1').trim()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeData.map((row, rowIdx) => (
                      <tr
                        key={rowIdx}
                        className={cn(
                          "border-b border-border/50 transition-colors hover:bg-muted/30",
                          rowIdx === 0 && "bg-blue-50/50 dark:bg-blue-950/20",
                        )}
                      >
                        {columns.map((col) => {
                          const val = row[col];
                          const isStatus = col.toLowerCase() === 'status';
                          return (
                            <td
                              key={col}
                              className={cn(
                                "px-3 py-2.5 whitespace-nowrap font-mono text-xs",
                                isStatus ? getStatusColor(val) : "text-foreground",
                              )}
                              title={val || ''}
                            >
                              <span className="flex items-center gap-1.5">
                                {isStatus && getStatusIcon(val)}
                                {isStatus ? (
                                  <span className="font-semibold">{val || '—'}</span>
                                ) : (
                                  formatCellValue(col, val)
                                )}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div ref={logEndRef} />
              </div>
            )
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border bg-muted/30 text-xs text-muted-foreground">
          <span>
            {activeTab === 'activities'
              ? `${activityRuns.length} activities`
              : `${activeData.length} ${activeTab === 'pipeline' ? 'pipeline' : activeTab === 'copy' ? 'copy activity' : 'notebook'} execution${activeData.length !== 1 ? 's' : ''}`}
          </span>
          <span className="flex items-center gap-1.5">
            <Info className="w-3 h-3" />
            Closing this window does not stop the pipeline
          </span>
        </div>
      </div>
    </div>
  );
}


// ── Main Component ──

export default function PipelineMonitor() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [executions, setExecutions] = useState<PipelineExecution[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<PipelineCategory | "All" | "Running">("All");
  const [showTechnicalNames, setShowTechnicalNames] = useState(false);

  // Trigger state — persist active runs to localStorage so they survive hot reloads
  const [triggeringPipeline, setTriggeringPipeline] = useState<string | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [activeRuns, setActiveRuns] = useState<ActiveRun[]>(() => {
    try {
      const stored = localStorage.getItem('fmd-active-runs');
      if (stored) {
        const parsed = JSON.parse(stored) as Array<ActiveRun & { triggeredAt: string }>;
        // Rehydrate Date objects, filter out stale runs (> 2 hours old)
        const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
        return parsed
          .map(r => ({ ...r, triggeredAt: new Date(r.triggeredAt) }))
          .filter(r => r.triggeredAt.getTime() > twoHoursAgo);
      }
    } catch { /* ignore */ }
    return [];
  });
  const [showActiveRuns, setShowActiveRuns] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Modal state
  const [modalPipeline, setModalPipeline] = useState<string | null>(null);
  const [fabricJobs, setFabricJobs] = useState<FabricJob[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pipes, execs, ws] = await Promise.all([
        fetchJson<Pipeline[]>('/pipelines'),
        fetchJson<PipelineExecution[]>('/pipeline-executions'),
        fetchJson<Workspace[]>('/workspaces'),
      ]);
      setPipelines(pipes);
      setExecutions(execs);
      setWorkspaces(ws);

      // Also fetch Fabric job instances (non-blocking — don't fail the page if this errors)
      try {
        const jobs = await fetchJson<FabricJob[]>('/fabric-jobs');
        setFabricJobs(jobs);
        // Sync active runs from Fabric API — pick up any running jobs we don't know about
        syncFabricJobsToActiveRuns(jobs);
      } catch { /* fabric-jobs endpoint may not be available yet */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Update locally-triggered active runs with Fabric API completion status
  // Note: we no longer inject new runs from Fabric — status badges handle that directly
  const syncFabricJobsToActiveRuns = useCallback((jobs: FabricJob[]) => {
    setActiveRuns(prevRuns => {
      let changed = false;
      const updated = prevRuns.map(run => {
        if (run.status !== 'triggered' && run.status !== 'running') return run;
        const job = jobs.find(j => j.pipelineName === run.pipelineName);
        if (!job) return run;
        const fabricStatus = job.status?.toLowerCase() || '';
        if (['completed', 'succeeded'].includes(fabricStatus)) { changed = true; return { ...run, status: 'succeeded' as const }; }
        if (['failed', 'cancelled', 'deduped'].includes(fabricStatus)) { changed = true; return { ...run, status: 'failed' as const }; }
        if (['inprogress', 'running'].includes(fabricStatus) && run.status === 'triggered') { changed = true; return { ...run, status: 'running' as const }; }
        return run;
      });
      return changed ? updated : prevRuns;
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Persist active runs to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('fmd-active-runs', JSON.stringify(activeRuns));
    } catch { /* ignore */ }
  }, [activeRuns]);

  // Derived boolean: are any local runs active?
  const hasActiveRuns = activeRuns.some(r => r.status === 'triggered' || r.status === 'running');

  // Auto-refresh elapsed time display for active runs (tick counter, not state copy)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!hasActiveRuns) return;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [hasActiveRuns]);

  // Always poll Fabric job status so status badges stay fresh (fixes stale "In Progress" bug)
  // Uses exponential backoff: 10s when active jobs detected, backs off to 30s/60s when idle
  const fabricPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fabricIntervalMs = useRef(10000);
  useEffect(() => {
    let cancelled = false;

    async function pollFabricJobs() {
      if (document.hidden) {
        // Skip poll when tab hidden, try again at same interval
        fabricPollRef.current = setTimeout(pollFabricJobs, fabricIntervalMs.current);
        return;
      }
      try {
        const jobs = await fetchJson<FabricJob[]>('/fabric-jobs');
        if (!cancelled && jobs.length > 0) {
          setFabricJobs(jobs);
          syncFabricJobsToActiveRuns(jobs);
          // Check if any jobs are actively running
          const hasRunning = jobs.some(j => {
            const s = j.status?.toLowerCase();
            return s === 'inprogress' || s === 'running' || s === 'notstarted' || s === 'queued';
          });
          // Fast poll when active, back off when idle (10s → 30s → 60s)
          fabricIntervalMs.current = hasRunning ? 10000 : Math.min(fabricIntervalMs.current * 2, 60000);
        }
      } catch {
        // Back off on error
        fabricIntervalMs.current = Math.min(fabricIntervalMs.current * 2, 60000);
      }
      if (!cancelled) {
        fabricPollRef.current = setTimeout(pollFabricJobs, fabricIntervalMs.current);
      }
    }

    // Start polling after initial delay
    fabricPollRef.current = setTimeout(pollFabricJobs, fabricIntervalMs.current);
    return () => {
      cancelled = true;
      if (fabricPollRef.current) clearTimeout(fabricPollRef.current);
    };
  }, [syncFabricJobsToActiveRuns]);

  // Poll for execution data and active run status when runs are active (faster interval)
  useEffect(() => {
    if (hasActiveRuns && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        try {
          const [execs, jobs] = await Promise.all([
            fetchJson<PipelineExecution[]>('/pipeline-executions').catch(() => [] as PipelineExecution[]),
            fetchJson<FabricJob[]>('/fabric-jobs').catch(() => [] as FabricJob[]),
          ]);
          setExecutions(execs);
          if (jobs.length > 0) {
            setFabricJobs(jobs);
            syncFabricJobsToActiveRuns(jobs);
          }
          if (execs.length > 0) {
            setActiveRuns(runs => runs.map(run => {
              if (run.status === 'triggered' || run.status === 'running') {
                const match = execs.find(e =>
                  e.PipelineName === run.pipelineName &&
                  new Date(e.StartTime as string) >= run.triggeredAt
                );
                if (match) {
                  const status = match.Status;
                  if (status === 'Succeeded' || status === 'Completed') return { ...run, status: 'succeeded' as const };
                  if (status === 'Failed' || status === 'Cancelled') return { ...run, status: 'failed' as const };
                  return { ...run, status: 'running' as const };
                }
              }
              return run;
            }));
          }
        } catch { /* continue */ }
      }, 5000);
    }
    if (!hasActiveRuns && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [hasActiveRuns, syncFabricJobsToActiveRuns]);

  const triggerPipeline = async (pipelineName: string) => {
    setTriggeringPipeline(pipelineName);
    setTriggerError(null);
    try {
      const result = await postJson<TriggerResult>('/pipeline/trigger', { pipelineName });
      if (result.success) {
        setActiveRuns(runs => [
          { pipelineName, triggeredAt: new Date(), status: 'triggered', location: result.location },
          ...runs,
        ]);
        setShowActiveRuns(true);
      }
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : 'Trigger failed');
    } finally {
      setTriggeringPipeline(null);
    }
  };

  const dismissRun = (index: number) => {
    setActiveRuns(runs => runs.filter((_, i) => i !== index));
  };

  const activePipelines = pipelines.filter(p => p.IsActive === 'True');

  // Build a map of latest Fabric job per pipeline name
  const latestJobByPipeline = new Map<string, FabricJob>();
  for (const job of fabricJobs) {
    const existing = latestJobByPipeline.get(job.pipelineName);
    if (!existing || (job.startTimeUtc && (!existing.startTimeUtc || job.startTimeUtc > existing.startTimeUtc))) {
      latestJobByPipeline.set(job.pipelineName, job);
    }
  }

  const isPipelineRunning = (name: string) => {
    if (activeRuns.some(r => r.pipelineName === name && (r.status === 'triggered' || r.status === 'running'))) return true;
    const job = latestJobByPipeline.get(name);
    if (job) {
      const s = normalizeFabricStatus(job.status);
      if (s === 'inprogress' || s === 'running' || s === 'notstarted') return true;
    }
    return false;
  };

  const filteredPipelines = activePipelines.filter(p => {
    const category = categorize(p.Name);
    const matchesSearch = p.Name.toLowerCase().includes(searchTerm.toLowerCase())
      || getDisplayName(p.Name).toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory =
      categoryFilter === "All"
      || (categoryFilter === "Running" ? isPipelineRunning(p.Name) : category === categoryFilter);
    return matchesSearch && matchesCategory;
  });

  const categoryCounts = activePipelines.reduce<Record<string, number>>((acc, p) => {
    const cat = categorize(p.Name);
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  const chartData = Object.entries(categoryCounts).map(([name, count]) => ({
    name: name === 'Landing Zone' ? 'LDZ' : name === 'Orchestration' ? 'Orch' : name,
    count,
    fill: categoryChartColors[name as PipelineCategory] || '#64748b',
  }));

  const runningCount = activeRuns.filter(r => r.status === 'triggered' || r.status === 'running').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading pipeline data...</span>
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

  const hasExecutionData = executions.length > 0;

  return (
    <div className="space-y-8">
      {/* Execution Log Modal */}
      {modalPipeline && (
        <ExecutionLogModal
          pipelineName={modalPipeline}
          onClose={() => setModalPipeline(null)}
          fabricJobs={fabricJobs}
        />
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">Pipeline Monitor</h1>
          <p className="text-muted-foreground mt-1">
            {runningCount > 0
              ? `${runningCount} pipeline${runningCount > 1 ? 's' : ''} running`
              : hasExecutionData
                ? 'Real-time pipeline execution status'
                : `${activePipelines.length} registered pipelines across the FMD framework`
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowTechnicalNames(!showTechnicalNames)}
            className="gap-2 text-xs"
            title={showTechnicalNames ? "Show business names" : "Show technical names"}
          >
            {showTechnicalNames ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showTechnicalNames ? 'Business Names' : 'Technical Names'}
          </Button>
          <Button onClick={loadData} variant="outline" size="sm" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/20 dark:to-slate-900/10 border-slate-200/50 dark:border-slate-800/30 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <FabricIcon name="pipeline" className="w-4 h-4" />
              Total Pipelines
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display">{activePipelines.length}</div>
            <p className="text-xs text-muted-foreground">{pipelines.length - activePipelines.length} inactive</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/20 dark:to-blue-900/10 border-blue-200/50 dark:border-blue-800/30 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <FabricIcon name="copy_job" className="w-4 h-4" />
              Landing Zone
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display text-blue-600 dark:text-blue-400">{categoryCounts['Landing Zone'] || 0}</div>
            <p className="text-xs text-muted-foreground">Copy & ingestion pipelines</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/20 dark:to-amber-900/10 border-amber-200/50 dark:border-amber-800/30 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <FabricIcon name="notebook" className="w-4 h-4" />
              Transform
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display text-amber-600 dark:text-amber-400">{(categoryCounts['Bronze'] || 0) + (categoryCounts['Silver'] || 0)}</div>
            <p className="text-xs text-muted-foreground">Bronze + Silver pipelines</p>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/20 dark:to-emerald-900/10 border-emerald-200/50 dark:border-emerald-800/30 shadow-sm hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <FabricIcon name="dataflow" className="w-4 h-4" />
              Orchestration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-display text-emerald-600 dark:text-emerald-400">{categoryCounts['Orchestration'] || 0}</div>
            <p className="text-xs text-muted-foreground">Load & taskflow pipelines</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Quick Actions ── */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
          <Rocket className="w-5 h-5 text-primary" />
          Quick Actions
        </h2>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {quickActions.map((action) => {
            const Icon = action.icon;
            const isTriggering = triggeringPipeline === action.pipelineName;
            const isRunning = isPipelineRunning(action.pipelineName);
            const disabled = isTriggering || isRunning;

            return (
              <button
                key={action.pipelineName}
                onClick={() => !disabled && triggerPipeline(action.pipelineName)}
                disabled={disabled}
                className={cn(
                  "relative group flex flex-col items-start gap-2 p-4 rounded-xl border-2 transition-all duration-200",
                  action.bgColor, action.borderColor,
                  disabled ? "opacity-70 cursor-not-allowed" : cn("cursor-pointer hover:scale-[1.02] active:scale-[0.98]", action.hoverBg),
                )}
              >
                <div className="flex items-center gap-2">
                  {isTriggering || isRunning ? (
                    <Loader2 className={cn("w-5 h-5 animate-spin", action.color)} />
                  ) : (
                    <Icon className={cn("w-5 h-5", action.color)} />
                  )}
                  <span className="font-bold text-sm text-foreground">{action.label}</span>
                </div>
                <span className="text-xs text-muted-foreground leading-snug">{action.description}</span>
                {isRunning && (
                  <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Trigger Error ── */}
      {triggerError && (
        <div className="flex items-center gap-3 p-4 bg-red-50 dark:bg-red-950/30 border-2 border-red-300 dark:border-red-700 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-800 dark:text-red-200">Pipeline trigger failed</p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{triggerError}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setTriggerError(null)} className="text-red-500">
            <XCircle className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* ── Active Runs ── */}
      {activeRuns.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowActiveRuns(!showActiveRuns)}
            className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors"
          >
            <Activity className="w-4 h-4" />
            Active Runs ({activeRuns.length})
            {showActiveRuns ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            {runningCount > 0 && (
              <span className="relative flex h-2 w-2 ml-1">
                <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
            )}
          </button>
          {showActiveRuns && (
            <div className="space-y-2">
              {activeRuns.map((run, idx) => (
                <ActiveRunCard
                  key={`${run.pipelineName}-${idx}`}
                  run={run}
                  onDismiss={() => dismissRun(idx)}
                  onViewLog={() => setModalPipeline(run.pipelineName)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Execution status banner */}
      {!hasExecutionData && activeRuns.length === 0 && (
        <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
          <Info className="w-5 h-5 text-blue-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200">No execution data yet</p>
            <p className="text-xs text-blue-600 dark:text-blue-400">
              Use the Quick Actions above to trigger a pipeline run, or register sources via Source Manager first.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-8 md:grid-cols-3">
        {/* Main List */}
        <div className="md:col-span-2 space-y-6">
          <div className="flex flex-col sm:flex-row items-center gap-4 bg-muted/40 p-4 rounded-lg border border-border shadow-sm">
            <Input
              placeholder="Search pipelines..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-sm"
            />
            <Select
              value={categoryFilter}
              onValueChange={(v) => setCategoryFilter(v as PipelineCategory | "All" | "Running")}
              className="w-[180px]"
            >
              <option value="All">All Categories</option>
              <option value="Running">Running ({runningCount})</option>
              <option value="Landing Zone">Landing Zone</option>
              <option value="Bronze">Bronze</option>
              <option value="Silver">Silver</option>
              <option value="Orchestration">Orchestration</option>
              <option value="Utility">Utility</option>
            </Select>
          </div>

          <div className="space-y-3">
            {filteredPipelines.map((pipeline) => {
              const category = categorize(pipeline.Name);
              const ws = workspaces.find(w => w.WorkspaceGuid === pipeline.WorkspaceGuid);
              const running = isPipelineRunning(pipeline.Name);
              const triggering = triggeringPipeline === pipeline.Name;
              const displayName = getDisplayName(pipeline.Name);
              const latestJob = latestJobByPipeline.get(pipeline.Name);
              const jobStatus = normalizeFabricStatus(latestJob?.status);
              const isJobActive = jobStatus === 'inprogress' || jobStatus === 'running' || jobStatus === 'notstarted';
              const isJobFailed = jobStatus === 'failed';

              return (
                <div
                  key={pipeline.PipelineId}
                  className={cn(
                    "group flex flex-col p-4 rounded-xl border shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer",
                    isJobActive
                      ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-300 dark:border-blue-700"
                      : isJobFailed
                        ? "bg-red-50/30 dark:bg-red-950/10 border-red-200 dark:border-red-900/50"
                        : running
                          ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-600"
                          : "bg-card border-border hover:border-primary/30",
                  )}
                  onClick={() => setModalPipeline(pipeline.Name)}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <FabricIcon name="pipeline" className="w-4 h-4 opacity-70 flex-shrink-0" />
                        <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors truncate">
                          {showTechnicalNames ? pipeline.Name : displayName}
                        </h3>
                        <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0", categoryBadgeColors[category])}>
                          {category}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground ml-7">
                        {!showTechnicalNames && (
                          <>
                            <span className="font-mono text-[10px] opacity-60">{pipeline.Name}</span>
                            <span className="text-border">|</span>
                          </>
                        )}
                        {ws && (
                          <span className="flex items-center gap-1">
                            <FabricIcon name="fabric" className="w-3 h-3" />
                            {ws.Name}
                          </span>
                        )}
                        <span className="text-border">|</span>
                        <span className="font-mono text-[10px]">{pipeline.PipelineGuid.substring(0, 8)}...</span>
                      </div>
                      <PipelineStatusDetail job={latestJob} />
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto flex-shrink-0">
                      <PipelineStatusBadge job={latestJob} />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerPipeline(pipeline.Name);
                        }}
                        disabled={triggering || running || isJobActive}
                        className={cn(
                          "h-8 w-8 p-0 rounded-lg transition-all",
                          running || isJobActive
                            ? "text-blue-500"
                            : "text-muted-foreground hover:text-emerald-500 hover:bg-emerald-100 dark:hover:bg-emerald-900/30",
                        )}
                        title={running || isJobActive ? `${displayName} is running` : `Run ${displayName}`}
                      >
                        {triggering || running || isJobActive ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Play className="w-4 h-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredPipelines.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              {categoryFilter === 'Running' ? (
                <div className="space-y-2">
                  <Activity className="w-8 h-8 mx-auto opacity-40" />
                  <p>No pipelines currently running</p>
                  <p className="text-xs">Use Quick Actions above to start a pipeline</p>
                </div>
              ) : (
                <p>No pipelines match your search</p>
              )}
            </div>
          )}
        </div>

        {/* Sidebar / Stats */}
        <div className="space-y-6">
          <Card className="bg-gradient-to-br from-blue-50 to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/10 border-blue-200/50 dark:border-blue-800/30 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FabricIcon name="data_factory" className="w-5 h-5" />
                Pipeline Distribution
              </CardTitle>
              <CardDescription>By category</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip
                      cursor={{ fill: 'transparent' }}
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', backgroundColor: 'hsl(var(--card))' }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-br from-emerald-50 to-blue-50/50 dark:from-emerald-950/20 dark:to-blue-950/10 border-emerald-200/50 dark:border-emerald-800/30 shadow-sm">
            <CardHeader>
              <CardTitle className="text-primary flex items-center gap-2">
                <FabricIcon name="fabric" className="w-5 h-5" />
                Framework Status
              </CardTitle>
              <CardDescription>Deployment overview</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "Pipelines Deployed", value: `${activePipelines.length}`, color: "text-emerald-600 dark:text-emerald-400" },
                { label: "Workspaces", value: `${workspaces.length}`, color: "text-blue-600 dark:text-blue-400" },
                { label: "Active Runs", value: runningCount > 0 ? `${runningCount} running` : "None", color: runningCount > 0 ? "text-blue-600 dark:text-blue-400" : "text-muted-foreground" },
                { label: "Execution Logs", value: hasExecutionData ? `${executions.length} entries` : "Awaiting first run", color: hasExecutionData ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground" },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{item.label}</span>
                  <span className={cn("text-sm font-semibold", item.color)}>{item.value}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
