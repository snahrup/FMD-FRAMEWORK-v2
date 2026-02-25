import { useState, useEffect, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Info, AlertCircle, CheckCircle,
  ChevronDown, ChevronUp, Wrench, Clock, Repeat, Eye, EyeOff,
  Zap, RefreshCw, Loader2, Search, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ===== Types =====
type ErrorSeverity = 'critical' | 'warning' | 'info';

interface ErrorSummary {
  id: string;
  category: string;
  title: string;
  severity: ErrorSeverity;
  suggestion: string;
  occurrenceCount: number;
  affectedPipelines: string[];
  latestError: string;
  latestTime: string;
  latestPipeline: string;
}

interface ErrorRecord {
  id: string;
  source: string;
  pipelineName: string;
  workspaceName: string;
  startTime: string;
  endTime: string;
  rawError: string;
  category: string;
  jobInstanceId: string;
  workspaceGuid: string;
  summary: string;
  entityName: string;
  errorType: string;
}

interface TopIssue {
  errorType: string;
  label: string;
  count: number;
  totalErrors: number;
  suggestion: string;
}

interface ErrorIntelligenceData {
  summaries: ErrorSummary[];
  errors: ErrorRecord[];
  patternCounts: Record<string, number>;
  severityCounts: Record<string, number>;
  totalErrors: number;
  topIssue: TopIssue | null;
}

// ===== Config =====
const API = 'http://localhost:8787';

const severityConfig: Record<ErrorSeverity, { label: string; color: string; bgColor: string; borderColor: string; icon: React.ElementType }> = {
  critical: {
    label: 'Critical',
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/20',
    borderColor: 'border-red-200 dark:border-red-800',
    icon: AlertCircle,
  },
  warning: {
    label: 'Warning',
    color: 'text-amber-700 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/20',
    borderColor: 'border-amber-200 dark:border-amber-800',
    icon: AlertTriangle,
  },
  info: {
    label: 'Info',
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    icon: Info,
  },
};

const PIPELINE_DISPLAY_NAMES: Record<string, string> = {
  'PL_FMD_LOAD_ALL': 'Full Pipeline',
  'PL_FMD_LOAD_LANDINGZONE': 'Landing Zone Load',
  'PL_FMD_LOAD_BRONZE': 'Bronze Layer Load',
  'PL_FMD_LOAD_SILVER': 'Silver Layer Load',
  'PL_FMD_LDZ_COMMAND_ASQL': 'LZ Command (SQL)',
  'PL_FMD_LDZ_COPY_FROM_ASQL_01': 'LZ Copy from SQL',
  'PL_FMD_BRZ_LOAD_01': 'Bronze Merge',
  'PL_FMD_SLV_LOAD_01': 'Silver Merge',
  'PL_TOOLING_POST_ASQL_TO_FMD': 'SQL → FMD Config Sync',
};

function getDisplayName(technicalName: string): string {
  return PIPELINE_DISPLAY_NAMES[technicalName] || technicalName.replace(/^PL_(FMD_|TOOLING_)/, '').replace(/_/g, ' ');
}

function fmtTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

// ===== Top Issue Banner =====
function TopIssueBanner({ topIssue }: { topIssue: TopIssue }) {
  if (topIssue.count <= 1) return null;
  const pct = Math.round((topIssue.count / topIssue.totalErrors) * 100);
  return (
    <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/10 rounded-xl border border-amber-200/60 dark:border-amber-800/40 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center flex-shrink-0">
          <Zap className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Top Issue: {topIssue.count} of {topIssue.totalErrors} errors ({pct}%) — {topIssue.label}
          </p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            <Wrench className="w-3 h-3 inline mr-1 relative -top-px" />
            {topIssue.suggestion}
          </p>
        </div>
      </div>
    </div>
  );
}

// ===== Error Card (redesigned) =====
function ErrorCard({
  summary,
  errors,
  isExpanded,
  showRaw,
  onToggleExpand,
  onToggleRaw,
}: {
  summary: ErrorSummary;
  errors: ErrorRecord[];
  isExpanded: boolean;
  showRaw: boolean;
  onToggleExpand: () => void;
  onToggleRaw: () => void;
}) {
  const config = severityConfig[summary.severity];
  const SeverityIcon = config.icon;
  const catErrors = errors.filter(e => e.category === summary.category);
  const [showAllOccurrences, setShowAllOccurrences] = useState(false);

  // Group repeated errors by errorType for collapse
  const errorTypeGroups = useMemo(() => {
    const groups: Record<string, ErrorRecord[]> = {};
    for (const err of catErrors) {
      const key = err.errorType || 'UNKNOWN';
      if (!groups[key]) groups[key] = [];
      groups[key].push(err);
    }
    return groups;
  }, [catErrors]);

  // Build display list: show first 3 of each type, collapse the rest
  const displayErrors = useMemo(() => {
    const result: { err: ErrorRecord; isCollapsed: boolean; collapsedCount: number; errorType: string }[] = [];
    for (const [type, errs] of Object.entries(errorTypeGroups)) {
      const showCount = showAllOccurrences ? errs.length : Math.min(3, errs.length);
      for (let i = 0; i < showCount; i++) {
        result.push({ err: errs[i], isCollapsed: false, collapsedCount: 0, errorType: type });
      }
      if (!showAllOccurrences && errs.length > 3) {
        result.push({ err: errs[3], isCollapsed: true, collapsedCount: errs.length - 3, errorType: type });
      }
    }
    return result;
  }, [errorTypeGroups, showAllOccurrences]);

  return (
    <div className={cn(
      "rounded-[var(--radius-xl)] border overflow-hidden transition-all duration-[var(--duration-normal)]",
      config.borderColor,
      isExpanded ? 'shadow-[var(--shadow-card-hover)]' : 'shadow-[var(--shadow-card)]'
    )}>
      {/* Header — always visible */}
      <div
        className={cn("p-4 cursor-pointer", config.bgColor)}
        onClick={onToggleExpand}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className={cn(
              "w-9 h-9 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0",
              summary.severity === 'critical' ? 'bg-red-100 dark:bg-red-950/40' :
              summary.severity === 'warning' ? 'bg-amber-100 dark:bg-amber-950/40' : 'bg-blue-100 dark:bg-blue-950/40'
            )}>
              <SeverityIcon className={cn("w-4 h-4", config.color)} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-semibold text-foreground">{summary.title}</h3>
                <Badge variant="outline" className={cn("text-[10px]", config.color)}>
                  {config.label}
                </Badge>
                {summary.occurrenceCount > 1 && (
                  <Badge variant="secondary" className="text-[10px] gap-0.5">
                    <Repeat className="w-2.5 h-2.5" />
                    {summary.occurrenceCount}x
                  </Badge>
                )}
              </div>
              {/* Inline suggestion — always visible */}
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                <Wrench className="w-3 h-3 inline mr-1 relative -top-px opacity-50" />
                {summary.suggestion}
              </p>
              {/* Affected pipelines */}
              {summary.affectedPipelines.length > 0 && (
                <p className="text-[10px] text-muted-foreground mt-1 line-clamp-1">
                  Pipelines: {summary.affectedPipelines.map(p => getDisplayName(p)).join(', ')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {summary.latestTime && (
              <div className="text-right hidden sm:block">
                <p className="text-[10px] text-muted-foreground font-mono flex items-center justify-end">
                  <Clock className="w-3 h-3 mr-1" />
                  {fmtTime(summary.latestTime)}
                </p>
              </div>
            )}
            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
      </div>

      {/* Expanded: Error occurrences with inline detail */}
      {isExpanded && (
        <div className="border-t border-border">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-foreground">
                {catErrors.length} Occurrence{catErrors.length !== 1 ? 's' : ''}
              </h4>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleRaw(); }}
                className="flex items-center text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showRaw ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                {showRaw ? 'Hide' : 'Show'} Raw Errors
              </button>
            </div>

            <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
              {displayErrors.map((item, i) => {
                if (item.isCollapsed) {
                  return (
                    <button
                      key={`collapse-${item.errorType}`}
                      onClick={() => setShowAllOccurrences(true)}
                      className="w-full text-left p-2.5 bg-muted/50 rounded-[var(--radius-md)] border border-dashed border-border hover:border-primary/30 hover:bg-muted transition-colors"
                    >
                      <p className="text-xs text-muted-foreground">
                        + {item.collapsedCount} more similar error{item.collapsedCount > 1 ? 's' : ''} ({item.errorType.replace(/_/g, ' ').toLowerCase()})
                      </p>
                    </button>
                  );
                }

                const err = item.err;
                const hasSummary = err.summary && err.summary.length > 0;
                const hasEntity = err.entityName && err.entityName.length > 0;

                return (
                  <div
                    key={err.id || i}
                    className="p-2.5 bg-muted rounded-[var(--radius-md)] border border-border/50"
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Severity dot */}
                      <div className={cn(
                        "w-2 h-2 rounded-full flex-shrink-0 mt-1.5",
                        summary.severity === 'critical' ? 'bg-red-500' :
                        summary.severity === 'warning' ? 'bg-amber-500' : 'bg-blue-500'
                      )} />

                      <div className="min-w-0 flex-1">
                        {/* Pipeline + Entity */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-medium text-foreground">
                            {getDisplayName(err.pipelineName)}
                            {hasEntity && (
                              <span className="text-muted-foreground font-normal"> — {err.entityName}</span>
                            )}
                          </p>
                          <Badge variant="outline" className="text-[9px] flex-shrink-0">
                            {err.source === 'fabric' ? 'Fabric' : 'SQL'}
                          </Badge>
                        </div>

                        {/* Error summary — always visible */}
                        {hasSummary && (
                          <p className="text-[11px] text-foreground/70 mt-0.5 leading-snug">{err.summary}</p>
                        )}

                        {/* Timestamp */}
                        <p className="text-[10px] text-muted-foreground font-mono mt-1">
                          {fmtTime(err.startTime)}
                        </p>

                        {/* Raw error (toggled) */}
                        {showRaw && (
                          <pre className="mt-2 p-2 bg-background rounded text-[10px] font-mono text-muted-foreground whitespace-pre-wrap break-all border border-border/50 max-h-32 overflow-y-auto">
                            {err.rawError}
                          </pre>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {showAllOccurrences && catErrors.length > 10 && (
                <button
                  onClick={() => setShowAllOccurrences(false)}
                  className="w-full text-center p-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Show fewer
                </button>
              )}

              {catErrors.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">No individual error records available.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ===== Main Page =====
export default function ErrorIntelligence() {
  const [data, setData] = useState<ErrorIntelligenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedError, setExpandedError] = useState<string | null>(null);
  const [showRawError, setShowRawError] = useState<Record<string, boolean>>({});
  const [filterSeverity, setFilterSeverity] = useState<ErrorSeverity | 'all'>('all');
  const [filterPipeline, setFilterPipeline] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchData = () => {
    setLoading(true);
    setError(null);
    fetch(`${API}/api/error-intelligence`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: ErrorIntelligenceData) => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  };

  useEffect(() => { fetchData(); }, []);

  const summaries = data?.summaries || [];
  const allErrors = data?.errors || [];
  const totalErrors = data?.totalErrors || 0;
  const criticalCount = data?.severityCounts?.critical || 0;
  const warningCount = data?.severityCounts?.warning || 0;
  const infoCount = data?.severityCounts?.info || 0;
  const topIssue = data?.topIssue || null;

  // Unique pipeline names for filter dropdown
  const uniquePipelines = useMemo(() => {
    const names = new Set(allErrors.map(e => e.pipelineName).filter(Boolean));
    return Array.from(names).sort();
  }, [allErrors]);

  // Filter errors by pipeline and search
  const filteredErrors = useMemo(() => {
    let result = allErrors;
    if (filterPipeline !== 'all') {
      result = result.filter(e => e.pipelineName === filterPipeline);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e =>
        (e.rawError || '').toLowerCase().includes(q) ||
        (e.summary || '').toLowerCase().includes(q) ||
        (e.entityName || '').toLowerCase().includes(q) ||
        (e.pipelineName || '').toLowerCase().includes(q)
      );
    }
    return result;
  }, [allErrors, filterPipeline, searchQuery]);

  // Filter summaries by severity + recompute counts from filtered errors
  const filteredSummaries = useMemo(() => {
    let result = summaries;
    if (filterSeverity !== 'all') {
      result = result.filter(s => s.severity === filterSeverity);
    }
    return result;
  }, [summaries, filterSeverity]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-semibold tracking-tight text-foreground">Error Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-1">Pipeline error analysis — what happened and how to fix it</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5 h-8 text-xs">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </Button>
          {totalErrors > 0 && (
            <Badge variant="destructive" className="gap-1.5 py-1">
              <Zap className="h-3 w-3" />
              {totalErrors} error{totalErrors !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Loading pipeline errors...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="rounded-[var(--radius-xl)] border border-red-200 dark:border-red-800/50 bg-red-50/50 dark:bg-red-950/20 p-6">
          <div className="flex items-start gap-4">
            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">Failed to load error data</h3>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
              <button className="mt-2 text-xs font-medium text-primary hover:text-primary/80" onClick={fetchData}>
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      {!loading && !error && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <button onClick={() => setFilterSeverity('all')} className={cn(
              "text-left rounded-xl border p-4 shadow-sm hover:shadow-md transition-all",
              filterSeverity === 'all'
                ? "ring-2 ring-primary/50 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/30 dark:to-slate-900/20 border-primary/30"
                : "bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/20 dark:to-slate-900/10 border-slate-200/50 dark:border-slate-800/30"
            )}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total</p>
                  <p className="text-2xl font-display font-semibold text-foreground mt-1">{totalErrors}</p>
                </div>
                <div className="w-10 h-10 bg-muted rounded-[var(--radius-md)] flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
            </button>
            <button onClick={() => setFilterSeverity(filterSeverity === 'critical' ? 'all' : 'critical')} className={cn(
              "text-left rounded-xl border p-4 shadow-sm hover:shadow-md transition-all",
              filterSeverity === 'critical'
                ? "ring-2 ring-red-400/50 bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950/30 dark:to-red-900/20 border-red-300/50"
                : "bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950/20 dark:to-red-900/10 border-red-200/50 dark:border-red-800/30"
            )}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-red-600 dark:text-red-400 uppercase tracking-wider">Critical</p>
                  <p className="text-2xl font-display font-semibold text-red-700 dark:text-red-400 mt-1">{criticalCount}</p>
                </div>
                <div className="w-10 h-10 bg-red-50 dark:bg-red-950/30 rounded-[var(--radius-md)] flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
              </div>
            </button>
            <button onClick={() => setFilterSeverity(filterSeverity === 'warning' ? 'all' : 'warning')} className={cn(
              "text-left rounded-xl border p-4 shadow-sm hover:shadow-md transition-all",
              filterSeverity === 'warning'
                ? "ring-2 ring-amber-400/50 bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/20 border-amber-300/50"
                : "bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/20 dark:to-amber-900/10 border-amber-200/50 dark:border-amber-800/30"
            )}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">Warnings</p>
                  <p className="text-2xl font-display font-semibold text-amber-700 dark:text-amber-400 mt-1">{warningCount}</p>
                </div>
                <div className="w-10 h-10 bg-amber-50 dark:bg-amber-950/30 rounded-[var(--radius-md)] flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
            </button>
            <button onClick={() => setFilterSeverity(filterSeverity === 'info' ? 'all' : 'info')} className={cn(
              "text-left rounded-xl border p-4 shadow-sm hover:shadow-md transition-all",
              filterSeverity === 'info'
                ? "ring-2 ring-blue-400/50 bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border-blue-300/50"
                : "bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/20 dark:to-blue-900/10 border-blue-200/50 dark:border-blue-800/30"
            )}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Info</p>
                  <p className="text-2xl font-display font-semibold text-blue-700 dark:text-blue-400 mt-1">{infoCount}</p>
                </div>
                <div className="w-10 h-10 bg-blue-50 dark:bg-blue-950/30 rounded-[var(--radius-md)] flex items-center justify-center">
                  <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </button>
          </div>

          {/* Top Issue Banner */}
          {topIssue && <TopIssueBanner topIssue={topIssue} />}

          {/* Filters: Pipeline + Search */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* Pipeline filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <select
                value={filterPipeline}
                onChange={(e) => setFilterPipeline(e.target.value)}
                className="text-xs bg-muted border border-border rounded-[var(--radius-md)] px-2.5 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              >
                <option value="all">All Pipelines</option>
                {uniquePipelines.map(p => (
                  <option key={p} value={p}>{getDisplayName(p)}</option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search errors..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs bg-muted border border-border rounded-[var(--radius-md)] pl-8 pr-3 py-1.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>

            {/* Active filter indicator */}
            {(filterPipeline !== 'all' || searchQuery || filterSeverity !== 'all') && (
              <button
                onClick={() => { setFilterPipeline('all'); setSearchQuery(''); setFilterSeverity('all'); }}
                className="text-[10px] text-primary hover:text-primary/80 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Error Cards */}
          <div className="space-y-3">
            {filteredSummaries.map((summary) => (
              <ErrorCard
                key={summary.id}
                summary={summary}
                errors={filteredErrors}
                isExpanded={expandedError === summary.id}
                showRaw={showRawError[summary.id] || false}
                onToggleExpand={() => setExpandedError(expandedError === summary.id ? null : summary.id)}
                onToggleRaw={() => setShowRawError(prev => ({ ...prev, [summary.id]: !prev[summary.id] }))}
              />
            ))}
          </div>

          {/* Empty State */}
          {filteredSummaries.length === 0 && (
            <div className="bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/20 dark:to-emerald-900/10 rounded-xl border border-emerald-200/50 dark:border-emerald-800/30 p-12 text-center shadow-sm">
              <div className="w-14 h-14 bg-emerald-50 dark:bg-emerald-950/30 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mt-4">
                {totalErrors === 0 ? 'No Pipeline Errors' : 'No Matching Errors'}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {totalErrors === 0
                  ? 'No pipeline failures detected in recent Fabric job history or execution logs.'
                  : 'No errors match the current filters. Try adjusting your search or filter criteria.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
