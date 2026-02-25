import { useState, useEffect, useCallback, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Loader2, XCircle, Clock, Info,
  Play, Rocket, CheckCircle2, AlertCircle, Activity,
  ChevronDown, ChevronUp, X, Eye, EyeOff, Terminal,
  Copy, ArrowRight, Ban, Timer, SkipForward, Search, Download,
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
  icon: typeof Rocket;
}

const quickActions: QuickAction[] = [
  { label: 'Landing Zone', pipelineName: 'PL_FMD_LOAD_LANDINGZONE', icon: Download },
  { label: 'Bronze', pipelineName: 'PL_FMD_LOAD_BRONZE', icon: Activity },
  { label: 'Silver', pipelineName: 'PL_FMD_LOAD_SILVER', icon: Activity },
  { label: 'Full Load', pipelineName: 'PL_FMD_LOAD_ALL', icon: Rocket },
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

/** Parse a Fabric ISO timestamp into epoch ms.
 *  Fabric timestamps are real UTC — parse directly so the browser
 *  converts to the user's local timezone for display. */
function parseFabricTime(iso?: string | null): number {
  if (!iso) return Date.now();
  return new Date(iso).getTime();
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
  const diff = Date.now() - parseFabricTime(isoString);
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
  const start = parseFabricTime(startUtc);
  const end = endUtc ? parseFabricTime(endUtc) : Date.now();
  const secs = Math.floor((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

// ── Error interpretation ──
// Translates raw Fabric error messages into plain-English explanations with actionable suggestions

function interpretFailureReason(reason: string | Record<string, unknown> | null | undefined): { summary: string; suggestion: string } | null {
  if (!reason) return null;
  const raw = typeof reason === 'string' ? reason : ((reason as Record<string, string>)?.message || JSON.stringify(reason));
  if (!raw || raw === '{}' || raw === 'null') return null;
  const lower = raw.toLowerCase();

  // Gateway issues
  if (lower.includes('gateway') || lower.includes('on-premises data gateway') || lower.includes('personal gateway')) {
    return {
      summary: 'On-premises data gateway is unreachable',
      suggestion: 'Verify the gateway machine is powered on, the gateway service is running, and VPN is connected. Check gateway status in Fabric > Manage connections and gateways.',
    };
  }

  // Connection / login failures
  if (lower.includes('login failed') || lower.includes('cannot open database') || lower.includes('cannot connect') || lower.includes('connection string')) {
    return {
      summary: 'Database connection failed',
      suggestion: 'The SQL Server may be down, the database name may have changed, or credentials have expired. Check the connection in Fabric > Manage connections and gateways.',
    };
  }

  // SSL / certificate
  if (lower.includes('certificate') || lower.includes('ssl') || lower.includes('tls') || lower.includes('trust server')) {
    return {
      summary: 'SSL/TLS certificate error',
      suggestion: 'The source server has a self-signed or untrusted certificate. Enable "TrustServerCertificate" in the connection settings, or install the server certificate on the gateway machine.',
    };
  }

  // Timeout
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('operation took too long')) {
    return {
      summary: 'Operation timed out',
      suggestion: 'The source query exceeded the timeout limit. This typically happens with very large tables. Enable incremental loading (watermark-based) to reduce data volume per run.',
    };
  }

  // Capacity / throttling
  if (lower.includes('capacity') || lower.includes('throttl') || lower.includes('429') || lower.includes('too many requests') || lower.includes('rate limit')) {
    return {
      summary: 'Fabric capacity limit reached',
      suggestion: 'The workspace hit its compute capacity limit. Wait for other jobs to complete, reduce the parallel copy degree in pipeline settings, or request a capacity upgrade.',
    };
  }

  // Permission / auth
  if (lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('access denied') || lower.includes('403') || lower.includes('401') || lower.includes('permission')) {
    return {
      summary: 'Authentication or permission error',
      suggestion: 'The service principal or connection credentials lack the required permissions. Verify the connection auth type (ServicePrincipal vs WorkspaceIdentity) in Fabric > Manage connections.',
    };
  }

  // Schema / column issues
  if (lower.includes('column') && (lower.includes('not found') || lower.includes('invalid') || lower.includes('does not exist'))) {
    return {
      summary: 'Schema mismatch — column not found',
      suggestion: 'The source table schema changed since the entity was registered. Re-run source analysis from Source Manager to update the entity configuration.',
    };
  }

  // Delta / merge errors
  if (lower.includes('delta') || lower.includes('merge') || lower.includes('concurrentappend') || lower.includes('concurrent')) {
    return {
      summary: 'Delta table write conflict',
      suggestion: 'Two operations tried to write to the same Delta table simultaneously. This usually resolves on retry. If persistent, check that no other pipelines target the same Bronze/Silver table.',
    };
  }

  // Notebook / Spark
  if (lower.includes('notebook') || lower.includes('spark') || lower.includes('livy') || lower.includes('session') || lower.includes('py4j')) {
    return {
      summary: 'Notebook execution failed',
      suggestion: 'Check the notebook logs in Fabric for the full Spark stack trace. Common causes: missing lakehouse reference, Python import error, or data type mismatch in Delta merge.',
    };
  }

  // Copy activity specific
  if (lower.includes('copy activity') || lower.includes('copyactivity') || lower.includes('data movement')) {
    return {
      summary: 'Data copy operation failed',
      suggestion: 'The Copy activity could not transfer data from source to destination. Check the source connection, verify the table exists, and confirm the gateway is online.',
    };
  }

  // Cancelled
  if (lower.includes('cancel') || lower.includes('abort') || lower.includes('user request')) {
    return {
      summary: 'Run was cancelled',
      suggestion: 'This run was manually cancelled or terminated by a parent pipeline. No action needed unless this was unexpected.',
    };
  }

  // Deduplication
  if (lower.includes('dedup') || lower.includes('already running') || lower.includes('concurrent execution')) {
    return {
      summary: 'Duplicate run skipped',
      suggestion: 'This pipeline was already running when a new trigger arrived. Fabric skipped the duplicate. This is normal behavior — the original run is still active.',
    };
  }

  // Nested pipeline failure — "Activity failed because an inner activity failed"
  if (lower.includes('inner activity failed') || lower.includes('an inner activity failed')) {
    // Try to extract the inner activity name and nested error
    const innerMatch = raw.match(/Inner activity name:\s*([^,]+)/i);
    const innerName = innerMatch ? innerMatch[1].trim() : null;
    // Try to extract nested error message from embedded JSON
    const nestedJsonMatch = raw.match(/Error:\s*\{(.*)\}/s);
    let nestedMsg = '';
    if (nestedJsonMatch) {
      try {
        const parsed = JSON.parse('{' + nestedJsonMatch[1] + '}');
        nestedMsg = parsed.message || parsed.errorMessage || '';
      } catch {
        // Try regex extraction if JSON parse fails
        const msgMatch = nestedJsonMatch[1].match(/"message"\s*:\s*"([^"]+)"/);
        nestedMsg = msgMatch ? msgMatch[1] : '';
      }
    }
    // Recursively interpret the nested error if we extracted it
    if (nestedMsg) {
      const nested = interpretFailureReason(nestedMsg);
      if (nested && nested.summary !== 'Pipeline execution error') {
        return {
          summary: innerName ? `${innerName}: ${nested.summary}` : nested.summary,
          suggestion: nested.suggestion,
        };
      }
    }
    return {
      summary: innerName ? `Failure in nested activity: ${innerName}` : 'A nested pipeline activity failed',
      suggestion: nestedMsg
        ? nestedMsg.substring(0, 200)
        : 'Use the "Investigate root cause" button below to trace through the pipeline chain and find the actual failing activity.',
    };
  }

  // BadRequest — missing or invalid configuration
  if (lower.includes('badrequest') || lower.includes('bad request') || (lower.includes('missing') && lower.includes('invalid'))) {
    // Try to extract the actual message from embedded JSON
    const msgMatch = raw.match(/"message"\s*:\s*"([^"]+)"/);
    const detail = msgMatch ? msgMatch[1] : '';
    if (detail.toLowerCase().includes('missing') || detail.toLowerCase().includes('invalid')) {
      return {
        summary: 'Invalid pipeline configuration',
        suggestion: 'A required parameter or connection is missing or misconfigured. Check that all connection references, lakehouse names, and pipeline parameters are correctly set in the metadata database.',
      };
    }
    return {
      summary: 'Bad request to Fabric API',
      suggestion: detail || 'The pipeline sent an invalid request. This usually means a connection, parameter, or entity reference is misconfigured in the metadata database.',
    };
  }

  // Operation on target failed — wrapper error from ForEach/ExecutePipeline
  if (lower.includes('operation on target') && lower.includes('failed')) {
    const targetMatch = raw.match(/Operation on target\s+(\S+)\s+failed/i);
    const targetName = targetMatch ? targetMatch[1] : null;
    // Try to extract the inner error
    const innerErrorMatch = raw.match(/failed:\s*(.+)/is);
    if (innerErrorMatch) {
      const innerResult = interpretFailureReason(innerErrorMatch[1]);
      if (innerResult && innerResult.summary !== 'Pipeline execution error') {
        return {
          summary: targetName ? `${targetName} failed: ${innerResult.summary}` : innerResult.summary,
          suggestion: innerResult.suggestion,
        };
      }
    }
    return {
      summary: targetName ? `Activity "${targetName}" failed` : 'A pipeline activity failed',
      suggestion: 'Use the "Investigate root cause" button to trace the failure chain to the actual source of the error.',
    };
  }

  // Generic — show the raw error with a helpful framing
  // Try to extract a meaningful message from JSON blobs
  let displayMsg = raw;
  const jsonMsgMatch = raw.match(/"message"\s*:\s*"([^"]{10,})"/);
  if (jsonMsgMatch) {
    displayMsg = jsonMsgMatch[1];
  }
  const truncated = displayMsg.length > 200 ? displayMsg.substring(0, 200) + '...' : displayMsg;
  return {
    summary: 'Pipeline execution error',
    suggestion: truncated,
  };
}

// ── Failure Trace — recursive pipeline failure investigation ──

interface FailureTrailStep {
  pipelineName: string;
  activityName: string;
  activityType: string;
  status: string;
  error: string;
  depth: number;
}

interface FailureTraceResult {
  trail: FailureTrailStep[];
  rootCause: FailureTrailStep | null;
}

function FailureTracePanel({ workspaceGuid, jobInstanceId, pipelineName }: {
  workspaceGuid: string;
  jobInstanceId: string;
  pipelineName: string;
}) {
  const [trace, setTrace] = useState<FailureTraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const fetchTrace = async () => {
    if (trace) { setExpanded(!expanded); return; }
    setLoading(true);
    try {
      const result = await fetchJson<FailureTraceResult>(
        `/pipeline/failure-trace?workspaceGuid=${encodeURIComponent(workspaceGuid)}&jobInstanceId=${encodeURIComponent(jobInstanceId)}&pipelineName=${encodeURIComponent(pipelineName)}`
      );
      setTrace(result);
      setExpanded(true);
    } catch {
      setTrace({ trail: [], rootCause: null });
      setExpanded(true);
    } finally {
      setLoading(false);
    }
  };

  const rootError = trace?.rootCause ? interpretFailureReason(trace.rootCause.error) : null;

  return (
    <div className="space-y-2">
      <button
        onClick={(e) => { e.stopPropagation(); fetchTrace(); }}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-400 transition-colors"
      >
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : (
          <Search className="w-3 h-3" />
        )}
        {loading ? 'Tracing...' : trace ? (expanded ? 'Hide trace' : 'Show trace') : 'Investigate root cause'}
      </button>

      {expanded && trace && (
        <div className="space-y-1.5">
          {trace.trail.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No activity-level failure details available from Fabric API.</p>
          ) : (
            <>
              {/* Breadcrumb trail */}
              <div className="flex flex-wrap items-center gap-1 text-xs">
                {trace.trail.map((step, i) => {
                  const isLast = i === trace.trail.length - 1;
                  const isLeaf = !['executepipeline', 'invokepipeline'].includes(step.activityType.toLowerCase());
                  return (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground/50" />}
                      <span className={cn(
                        "px-1.5 py-0.5 rounded font-mono",
                        isLast && isLeaf
                          ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 font-semibold"
                          : "bg-muted text-muted-foreground",
                      )}>
                        {step.activityName}
                        {step.activityType && !isLeaf && (
                          <span className="text-[10px] opacity-60 ml-1">({step.pipelineName})</span>
                        )}
                      </span>
                    </span>
                  );
                })}
              </div>

              {/* Root cause interpretation */}
              {rootError && (
                <div className="flex items-start gap-2 mt-1">
                  <AlertCircle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-red-600 dark:text-red-400">{rootError.summary}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{rootError.suggestion}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
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
                  const activityErrorInfo = isFailed ? interpretFailureReason(errorMsg || activity.error) : null;

                  return (
                    <div
                      key={activity.activityRunId || idx}
                      className={cn(
                        "flex flex-col gap-0 rounded-lg border transition-all overflow-hidden",
                        isActive
                          ? "bg-blue-50/50 dark:bg-blue-950/20 border-blue-300 dark:border-blue-700"
                          : isFailed
                            ? "bg-red-50/30 dark:bg-red-950/10 border-red-200 dark:border-red-900/50"
                            : isSucceeded
                              ? "bg-emerald-50/30 dark:bg-emerald-950/10 border-emerald-200 dark:border-emerald-900/50"
                              : "bg-card border-border",
                      )}
                    >
                      <div className="flex items-center gap-4 p-3">
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
                        {isFailed && !activityErrorInfo && errorMsg && (
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
                      {/* Error interpretation for failed activities */}
                      {isFailed && activityErrorInfo && (
                        <div className="px-3 pb-3 pt-0 ml-12 border-t border-red-200/50 dark:border-red-900/30">
                          <div className="flex items-start gap-2 mt-2">
                            <Info className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-red-600 dark:text-red-400">{activityErrorInfo.summary}</p>
                              <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{activityErrorInfo.suggestion}</p>
                            </div>
                          </div>
                        </div>
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

  // Monitoring Hub status filter — persisted to localStorage
  type HubFilter = 'all' | 'inprogress' | 'completed' | 'failed' | 'cancelled';
  const [hubStatusFilter, setHubStatusFilter] = useState<HubFilter>(() => {
    try {
      const stored = localStorage.getItem('fmd-hub-status-filter');
      if (stored && ['all', 'inprogress', 'completed', 'failed', 'cancelled'].includes(stored)) {
        return stored as HubFilter;
      }
    } catch { /* ignore */ }
    return 'all';
  });

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }

    // Fetch Fabric jobs in background — page is already interactive at this point
    try {
      const jobs = await fetchJson<FabricJob[]>('/fabric-jobs');
      setFabricJobs(jobs);
      syncFabricJobsToActiveRuns(jobs);
    } catch { /* fabric-jobs endpoint may not be available yet */ }
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
      }
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : 'Trigger failed');
    } finally {
      setTriggeringPipeline(null);
    }
  };

  const activePipelines = pipelines.filter(p => p.IsActive === 'True');

  // Persist hub filter to localStorage
  const updateHubFilter = useCallback((f: HubFilter) => {
    setHubStatusFilter(f);
    try { localStorage.setItem('fmd-hub-status-filter', f); } catch { /* ignore */ }
  }, []);

  // Filter Monitoring Hub jobs: last 12 hours + status filter
  const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
  const filteredHubJobs = fabricJobs.filter(job => {
    // Time filter: only show jobs from last 12 hours
    const startMs = parseFabricTime(job.startTimeUtc);
    if (startMs < twelveHoursAgo) return false;
    // Status filter
    if (hubStatusFilter === 'all') return true;
    const s = normalizeFabricStatus(job.status);
    if (hubStatusFilter === 'inprogress') return s === 'inprogress' || s === 'running' || s === 'none';
    if (hubStatusFilter === 'completed') return s === 'completed';
    if (hubStatusFilter === 'failed') return s === 'failed';
    if (hubStatusFilter === 'cancelled') return s === 'cancelled' || s === 'deduped';
    return true;
  });

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

  const runningCount = fabricJobs.filter(j => {
    const s = j.status?.toLowerCase();
    return s === 'inprogress' || s === 'running' || s === 'notstarted';
  }).length || activeRuns.filter(r => r.status === 'triggered' || r.status === 'running').length;

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
        {[
          { icon: 'pipeline' as const, label: 'Total Pipelines', value: activePipelines.length, sub: `${pipelines.length - activePipelines.length} inactive` },
          { icon: 'copy_job' as const, label: 'Landing Zone', value: categoryCounts['Landing Zone'] || 0, sub: 'Copy & ingestion pipelines' },
          { icon: 'notebook' as const, label: 'Transform', value: (categoryCounts['Bronze'] || 0) + (categoryCounts['Silver'] || 0), sub: 'Bronze + Silver pipelines' },
          { icon: 'dataflow' as const, label: 'Orchestration', value: categoryCounts['Orchestration'] || 0, sub: 'Load & taskflow pipelines' },
        ].map((stat) => (
          <Card key={stat.label} className="shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
                <FabricIcon name={stat.icon} className="w-4 h-4" />
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-display">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Quick Actions ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-muted-foreground">Run:</span>
        {quickActions.map((action) => {
          const Icon = action.icon;
          const isTriggering = triggeringPipeline === action.pipelineName;
          const isRunning = isPipelineRunning(action.pipelineName);
          const disabled = isTriggering || isRunning;

          return (
            <Button
              key={action.pipelineName}
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => !disabled && triggerPipeline(action.pipelineName)}
              className="gap-2"
            >
              {isTriggering || isRunning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
              {action.label}
              {isRunning && (
                <span className="flex h-2 w-2 ml-1">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                </span>
              )}
            </Button>
          );
        })}
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

      {/* ── Monitoring Hub — Fabric API-backed job history ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" />
            Monitoring Hub
            <span className="text-xs font-normal text-muted-foreground ml-1">Last 12 hours</span>
          </h2>
          {fabricJobs.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              </span>
              Live from Fabric API
            </div>
          )}
        </div>
        {/* Status filter chips */}
        <div className="flex items-center gap-1.5">
          {(() => {
            // Compute counts once for all chips
            const recent = fabricJobs.filter(j => {
              return parseFabricTime(j.startTimeUtc) >= twelveHoursAgo;
            });
            const counts: Record<HubFilter, number> = { all: recent.length, inprogress: 0, completed: 0, failed: 0, cancelled: 0 };
            for (const j of recent) {
              const s = normalizeFabricStatus(j.status);
              if (s === 'inprogress' || s === 'running' || s === 'none') counts.inprogress++;
              else if (s === 'completed') counts.completed++;
              else if (s === 'failed') counts.failed++;
              else if (s === 'cancelled' || s === 'deduped') counts.cancelled++;
            }
            return [
              { key: 'all' as HubFilter, label: 'All', count: counts.all },
              { key: 'inprogress' as HubFilter, label: 'In Progress', count: counts.inprogress },
              { key: 'completed' as HubFilter, label: 'Succeeded', count: counts.completed },
              { key: 'failed' as HubFilter, label: 'Failed', count: counts.failed },
              { key: 'cancelled' as HubFilter, label: 'Cancelled', count: counts.cancelled },
            ];
          })().map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => updateHubFilter(key)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium transition-all",
                hubStatusFilter === key
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                count === 0 && hubStatusFilter !== key && "opacity-50",
              )}
            >
              {label}
              {count > 0 && <span className="ml-1.5 opacity-70">{count}</span>}
            </button>
          ))}
        </div>
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">Activity name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">Item type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">Duration</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">Start time</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground tracking-wide">End time</th>
                </tr>
              </thead>
              <tbody>
                {filteredHubJobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                      <div className="flex flex-col items-center gap-2">
                        <Clock className="w-8 h-8 opacity-30" />
                        <p className="font-medium">{hubStatusFilter !== 'all' ? `No ${hubStatusFilter} runs in the last 12 hours` : 'No recent runs'}</p>
                        <p className="text-xs">{hubStatusFilter !== 'all' ? 'Try a different filter or trigger a new pipeline run.' : 'Trigger a pipeline above to see execution history here.'}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredHubJobs.flatMap((job, idx) => {
                    const status = normalizeFabricStatus(job.status);
                    const config = fabricStatusConfig[status];
                    const StatusIcon = config.icon;
                    const isActive = status === 'inprogress' || status === 'running' || status === 'notstarted';
                    const isFailed = status === 'failed';
                    const errorInfo = isFailed ? interpretFailureReason(job.failureReason) : null;
                    const itemType = (job.jobType as string) || 'Pipeline';
                    const iconName = itemType.toLowerCase() === 'notebook' ? 'notebook' : 'pipeline';

                    const fmtDate = (iso?: string | null) => {
                      if (!iso) return '—';
                      const d = new Date(iso);
                      return d.toLocaleString('en-US', {
                        month: 'numeric', day: 'numeric', year: 'numeric',
                        hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
                      });
                    };

                    const duration = job.startTimeUtc
                      ? (job.endTimeUtc ? formatDuration(job.startTimeUtc, job.endTimeUtc) : '—')
                      : '—';

                    const key = job.id || `${job.pipelineName}-${idx}`;

                    const rows = [
                      <tr
                        key={`${key}-main`}
                        className={cn(
                          "border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer",
                          isActive && "bg-blue-50/30 dark:bg-blue-950/10",
                          isFailed && !errorInfo && "bg-red-50/20 dark:bg-red-950/10",
                        )}
                        onClick={() => setModalPipeline(job.pipelineName)}
                      >
                        <td className="px-4 py-3 font-medium text-sm text-foreground max-w-[300px]" title={job.pipelineName}>
                          <div className="truncate">{showTechnicalNames ? job.pipelineName : getDisplayName(job.pipelineName)}</div>
                          {!showTechnicalNames && (
                            <div className="text-[10px] text-muted-foreground font-mono truncate opacity-60">{job.pipelineName}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <FabricIcon name={iconName} className="w-4 h-4" />
                            {itemType}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("flex items-center gap-2 text-sm font-medium", config.color)}>
                            <StatusIcon className={cn("w-4 h-4", config.pulse && "animate-spin")} />
                            {config.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                          {duration}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                          {fmtDate(job.startTimeUtc)}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                          {fmtDate(job.endTimeUtc || null)}
                        </td>
                      </tr>,
                    ];

                    // Expandable error row for failed jobs — includes root cause trace
                    if (isFailed) {
                      const jobId = (job.id as string) || '';
                      rows.push(
                        <tr key={`${key}-error`} className="bg-red-50/40 dark:bg-red-950/20 border-b border-red-200/50 dark:border-red-900/30">
                          <td colSpan={6} className="px-4 py-2.5">
                            <div className="flex items-start gap-2.5">
                              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                              <div className="min-w-0 flex-1 space-y-2">
                                {errorInfo && (
                                  <>
                                    <p className="text-sm font-medium text-red-600 dark:text-red-400">{errorInfo.summary}</p>
                                    <p className="text-xs text-muted-foreground leading-relaxed">{errorInfo.suggestion}</p>
                                  </>
                                )}
                                {/* Recursive failure trace through nested pipelines */}
                                {jobId && job.workspaceGuid && (
                                  <FailureTracePanel
                                    workspaceGuid={job.workspaceGuid}
                                    jobInstanceId={jobId}
                                    pipelineName={job.pipelineName}
                                  />
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>,
                      );
                    }

                    return rows;
                  })
                )}
              </tbody>
            </table>
          </div>
          {filteredHubJobs.length > 0 && (
            <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/30 text-xs text-muted-foreground">
              <span>
                {filteredHubJobs.length} job{filteredHubJobs.length !== 1 ? 's' : ''}
                {hubStatusFilter !== 'all' && ` (filtered)`}
              </span>
              <span className="flex items-center gap-1.5">
                <Info className="w-3 h-3" />
                Click any row for activity-level detail
              </span>
            </div>
          )}
        </Card>
      </div>

      {/* Execution status banner */}
      {!hasExecutionData && fabricJobs.length === 0 && (
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
