import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  Eye,
  Code,
  ArrowUpDown,
  Database,
  Copy,
  FileText,
} from 'lucide-react';

// ── Types ──

interface PipelineRun {
  [key: string]: string | null;
}

type ViewMode = 'business' | 'technical';
type LogTab = 'pipelines' | 'copies' | 'notebooks';

// ── Helpers ──

function humanDuration(startStr: string | null, endStr: string | null): string {
  if (!startStr || !endStr) return '—';
  const start = new Date(startStr).getTime();
  const end = new Date(endStr).getTime();
  const diff = end - start;
  if (isNaN(diff) || diff < 0) return '—';
  if (diff < 1000) return '<1s';
  if (diff < 60000) return `${Math.round(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ${Math.round((diff % 60000) / 1000)}s`;
  return `${Math.floor(diff / 3600000)}h ${Math.round((diff % 3600000) / 60000)}m`;
}

function timeAgo(isoDate: string | null): string {
  if (!isoDate) return '—';
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  if (isNaN(then)) return '—';
  const diff = now - then;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    return iso;
  }
}

function getStatusInfo(status: string | null) {
  const s = (status || '').toLowerCase();
  if (s === 'succeeded') return { label: 'Succeeded', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', Icon: CheckCircle };
  if (s === 'failed') return { label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', Icon: XCircle };
  if (s === 'inprogress' || s === 'running') return { label: 'Running', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', Icon: Loader2 };
  if (s === 'cancelled' || s === 'canceled') return { label: 'Cancelled', color: 'text-gray-400', bg: 'bg-gray-500/10 border-gray-500/20', Icon: XCircle };
  if (s === 'queued') return { label: 'Queued', color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', Icon: Clock };
  return { label: status || 'Unknown', color: 'text-muted-foreground', bg: 'bg-muted border-border', Icon: Clock };
}

/** Turn a raw pipeline run into a plain-English sentence for business users */
function businessSummary(run: PipelineRun): string {
  const name = run.PipelineName || run.Name || 'Pipeline';
  const status = (run.Status || '').toLowerCase();
  const duration = humanDuration(run.StartTime || null, run.EndTime || null);

  if (status === 'succeeded') {
    return `${name} completed successfully in ${duration}`;
  }
  if (status === 'failed') {
    const error = run.ErrorMessage || run.Error || '';
    return `${name} failed after ${duration}${error ? ` — ${error.substring(0, 120)}` : ''}`;
  }
  if (status === 'inprogress' || status === 'running') {
    return `${name} is currently running (started ${timeAgo(run.StartTime || null)})`;
  }
  if (status === 'cancelled' || status === 'canceled') {
    return `${name} was cancelled`;
  }
  return `${name} — ${status || 'status unknown'}`;
}

// ── Component ──

export default function ExecutionLog() {
  const [pipelineRuns, setPipelineRuns] = useState<PipelineRun[]>([]);
  const [copyRuns, setCopyRuns] = useState<PipelineRun[]>([]);
  const [notebookRuns, setNotebookRuns] = useState<PipelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('business');
  const [activeTab, setActiveTab] = useState<LogTab>('pipelines');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [plRes, cpRes, nbRes] = await Promise.all([
        fetch('/api/pipeline-executions'),
        fetch('/api/copy-executions'),
        fetch('/api/notebook-executions'),
      ]);
      if (!plRes.ok && !cpRes.ok && !nbRes.ok) throw new Error('API server not responding');
      const pl = plRes.ok ? await plRes.json() : [];
      const cp = cpRes.ok ? await cpRes.json() : [];
      const nb = nbRes.ok ? await nbRes.json() : [];
      setPipelineRuns(pl);
      setCopyRuns(cp);
      setNotebookRuns(nb);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Current dataset based on active tab
  const currentData = useMemo(() => {
    const raw = activeTab === 'pipelines' ? pipelineRuns
              : activeTab === 'copies' ? copyRuns
              : notebookRuns;

    let filtered = raw;

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => (r.Status || '').toLowerCase() === statusFilter);
    }

    // Search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(r =>
        Object.values(r).some(v => v && String(v).toLowerCase().includes(term))
      );
    }

    // Sort by first column (usually ID = chronological)
    if (sortDir === 'asc') {
      filtered = [...filtered].reverse();
    }

    return filtered;
  }, [activeTab, pipelineRuns, copyRuns, notebookRuns, statusFilter, searchTerm, sortDir]);

  // Columns from the data
  const columns = useMemo(() => {
    if (currentData.length === 0) return [];
    return Object.keys(currentData[0]);
  }, [currentData]);

  // Stats
  const stats = useMemo(() => {
    const raw = activeTab === 'pipelines' ? pipelineRuns
              : activeTab === 'copies' ? copyRuns
              : notebookRuns;
    const succeeded = raw.filter(r => (r.Status || '').toLowerCase() === 'succeeded').length;
    const failed = raw.filter(r => (r.Status || '').toLowerCase() === 'failed').length;
    const running = raw.filter(r => ['inprogress', 'running'].includes((r.Status || '').toLowerCase())).length;
    return { total: raw.length, succeeded, failed, running, other: raw.length - succeeded - failed - running };
  }, [activeTab, pipelineRuns, copyRuns, notebookRuns]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading execution logs...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center max-w-md">
          <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-4" />
          <p className="text-foreground font-medium mb-2">Cannot Load Execution Logs</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <button onClick={loadData} className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors mx-auto">
            <RefreshCw className="h-4 w-4" /> Retry
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
          <h1 className="text-3xl font-display font-bold tracking-tight text-foreground">Execution Log</h1>
          <p className="text-muted-foreground mt-1">Pipeline, copy, and notebook execution history</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {/* View mode toggle */}
          <div className="flex items-center bg-muted rounded-lg border border-border p-0.5">
            <button
              onClick={() => setViewMode('business')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                viewMode === 'business'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              Business
            </button>
            <button
              onClick={() => setViewMode('technical')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                viewMode === 'technical'
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Code className="h-3.5 w-3.5" />
              Technical
            </button>
          </div>
          <button
            onClick={loadData}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 border border-border rounded-lg text-muted-foreground transition-colors"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Tab selector + Stats */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Tabs */}
        <div className="flex items-center bg-muted rounded-lg border border-border p-0.5">
          {([
            { key: 'pipelines' as LogTab, label: 'Pipeline Runs', icon: FileText, count: pipelineRuns.length },
            { key: 'copies' as LogTab, label: 'Copy Activities', icon: Copy, count: copyRuns.length },
            { key: 'notebooks' as LogTab, label: 'Notebook Runs', icon: Database, count: notebookRuns.length },
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => { setActiveTab(tab.key); setExpandedRow(null); }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md transition-colors ${
                activeTab === tab.key
                  ? 'bg-card text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
              <span className={`ml-1 px-1.5 py-0.5 text-[10px] rounded-full font-medium ${
                activeTab === tab.key ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Quick stats */}
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-emerald-400 font-medium">{stats.succeeded}</span>
            <span className="text-muted-foreground">succeeded</span>
          </span>
          <span className="flex items-center gap-1.5">
            <XCircle className="h-3.5 w-3.5 text-red-400" />
            <span className="text-red-400 font-medium">{stats.failed}</span>
            <span className="text-muted-foreground">failed</span>
          </span>
          {stats.running > 0 && (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />
              <span className="text-blue-400 font-medium">{stats.running}</span>
              <span className="text-muted-foreground">running</span>
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search logs..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm bg-muted border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Statuses</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
            <option value="inprogress">Running</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button
          onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-muted hover:bg-muted/80 border border-border rounded-lg text-muted-foreground transition-colors"
          title={sortDir === 'desc' ? 'Newest first' : 'Oldest first'}
        >
          <ArrowUpDown className="h-4 w-4" />
          {sortDir === 'desc' ? 'Newest' : 'Oldest'}
        </button>
      </div>

      {/* Content */}
      {currentData.length === 0 ? (
        <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/20 dark:to-slate-900/10 rounded-xl border border-slate-200/50 dark:border-slate-800/30 p-12 text-center shadow-sm">
          <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-foreground font-medium mb-1">No Execution Logs</p>
          <p className="text-sm text-muted-foreground">
            {stats.total === 0
              ? 'No runs recorded yet. Logs will appear here after pipelines execute.'
              : 'No runs match your current filters.'}
          </p>
        </div>
      ) : viewMode === 'business' ? (
        /* ━━━ BUSINESS VIEW ━━━ */
        <div className="space-y-3">
          {currentData.map((run, i) => {
            const key = run.PipelineExecutionId || run.CopyActivityExecutionId || run.NotebookExecutionId || String(i);
            const statusInfo = getStatusInfo(run.Status);
            const StatusIcon = statusInfo.Icon;
            const isExpanded = expandedRow === key;
            const isRunning = (run.Status || '').toLowerCase() === 'inprogress' || (run.Status || '').toLowerCase() === 'running';

            return (
              <div key={key} className={`rounded-xl border ${statusInfo.bg} overflow-hidden transition-all`}>
                <button
                  onClick={() => setExpandedRow(isExpanded ? null : key)}
                  className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/[0.02] transition-colors"
                >
                  <StatusIcon className={`h-5 w-5 shrink-0 ${statusInfo.color} ${isRunning ? 'animate-spin' : ''}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{businessSummary(run)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {timeAgo(run.StartTime || null)}
                      {run.StartTime && <span className="ml-2 text-muted-foreground/50">({formatTimestamp(run.StartTime)})</span>}
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 shrink-0 text-xs">
                    <span className="text-muted-foreground font-mono">
                      {humanDuration(run.StartTime || null, run.EndTime || null)}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full font-medium ${statusInfo.bg} ${statusInfo.color}`}>
                      {statusInfo.label}
                    </span>
                  </div>
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-border/30 bg-black/10 p-4">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                      {Object.entries(run).map(([col, val]) => (
                        <div key={col}>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{col}</p>
                          <p className="text-foreground font-mono text-xs break-all mt-0.5">{val || '—'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ━━━ TECHNICAL VIEW ━━━ */
        <div className="bg-gradient-to-br from-slate-50/50 to-slate-100/30 dark:from-slate-950/10 dark:to-slate-900/5 rounded-xl border border-slate-200/50 dark:border-slate-800/30 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left py-3 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium w-8" />
                  {columns.map(col => (
                    <th key={col} className="text-left py-3 px-3 text-xs uppercase tracking-wider text-muted-foreground font-medium whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentData.map((run, i) => {
                  const key = run.PipelineExecutionId || run.CopyActivityExecutionId || run.NotebookExecutionId || String(i);
                  const statusInfo = getStatusInfo(run.Status);
                  const StatusIcon = statusInfo.Icon;
                  const isRunning = (run.Status || '').toLowerCase() === 'inprogress' || (run.Status || '').toLowerCase() === 'running';
                  const isExpanded = expandedRow === key;

                  return (
                    <tr
                      key={key}
                      onClick={() => setExpandedRow(isExpanded ? null : key)}
                      className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-3">
                        <StatusIcon className={`h-4 w-4 ${statusInfo.color} ${isRunning ? 'animate-spin' : ''}`} />
                      </td>
                      {columns.map(col => (
                        <td key={col} className="py-2.5 px-3 font-mono text-xs text-foreground whitespace-nowrap max-w-[200px] truncate">
                          {col === 'Status' ? (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusInfo.bg} ${statusInfo.color}`}>
                              {run[col] || '—'}
                            </span>
                          ) : (
                            run[col] || '—'
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Row count footer */}
          <div className="border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            Showing {currentData.length} of {stats.total} records
            {searchTerm && <span> (filtered by "{searchTerm}")</span>}
          </div>
        </div>
      )}
    </div>
  );
}
