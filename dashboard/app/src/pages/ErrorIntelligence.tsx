import { useState, useEffect, useMemo, useRef } from "react";
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
const API = '';

const severityConfig: Record<ErrorSeverity, { label: string; colorHex: string; bgHex: string; borderStyle: string; icon: React.ElementType }> = {
  critical: {
    label: 'Critical',
    colorHex: 'var(--bp-fault)',
    bgHex: 'var(--bp-fault-light)',
    borderStyle: '1px solid var(--bp-fault)',
    icon: AlertCircle,
  },
  warning: {
    label: 'Warning',
    colorHex: 'var(--bp-caution)',
    bgHex: 'var(--bp-caution-light)',
    borderStyle: '1px solid var(--bp-caution)',
    icon: AlertTriangle,
  },
  info: {
    label: 'Info',
    colorHex: 'var(--bp-ink-muted)',
    bgHex: 'var(--bp-surface-2)',
    borderStyle: '1px solid var(--bp-border)',
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
  const pct = topIssue.totalErrors > 0 ? Math.round((topIssue.count / topIssue.totalErrors) * 100) : 0;
  return (
    <div className="rounded-lg p-4" style={{ background: 'var(--bp-caution-light)', border: '1px solid var(--bp-caution)' }}>
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--bp-caution-light)' }}>
          <Zap className="w-4 h-4" style={{ color: 'var(--bp-caution)' }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>
            Top Issue: {topIssue.count} of {topIssue.totalErrors} errors ({pct}%) — {topIssue.label}
          </p>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--bp-ink-secondary)' }}>
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
  const catErrors = useMemo(() => errors.filter(e => e.category === summary.category), [errors, summary.category]);
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
    <div
      className="rounded-lg overflow-hidden transition-all duration-[var(--duration-normal)]"
      style={{ border: config.borderStyle }}
    >
      {/* Header — always visible */}
      <div
        className="p-4 cursor-pointer"
        style={{ background: config.bgHex }}
        onClick={onToggleExpand}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0"
              style={{ background: config.bgHex }}
            >
              <SeverityIcon className="w-4 h-4" style={{ color: config.colorHex }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)', fontWeight: 600 }}>{summary.title}</h3>
                <Badge variant="outline" className="text-[10px]" style={{ color: config.colorHex, borderColor: config.colorHex }}>
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
              <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'var(--bp-ink-secondary)' }}>
                <Wrench className="w-3 h-3 inline mr-1 relative -top-px opacity-50" />
                {summary.suggestion}
              </p>
              {/* Affected pipelines */}
              {summary.affectedPipelines.length > 0 && (
                <p className="text-[10px] mt-1 line-clamp-1" style={{ color: 'var(--bp-ink-tertiary)' }}>
                  Pipelines: {summary.affectedPipelines.map(p => getDisplayName(p)).join(', ')}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {summary.latestTime && (
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-mono flex items-center justify-end" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                  <Clock className="w-3 h-3 mr-1" />
                  {fmtTime(summary.latestTime)}
                </p>
              </div>
            )}
            {isExpanded ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--bp-ink-muted)' }} /> : <ChevronDown className="w-4 h-4" style={{ color: 'var(--bp-ink-muted)' }} />}
          </div>
        </div>
      </div>

      {/* Expanded: Error occurrences with inline detail */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--bp-border)' }}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)', fontWeight: 600 }}>
                {catErrors.length} Occurrence{catErrors.length !== 1 ? 's' : ''}
              </h4>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleRaw(); }}
                className="flex items-center text-[10px] transition-colors"
                style={{ color: 'var(--bp-ink-tertiary)' }}
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
                      className="w-full text-left p-2.5 rounded-md border border-dashed transition-colors"
                      style={{ background: 'var(--bp-surface-2)', borderColor: 'var(--bp-border)' }}
                    >
                      <p className="text-xs" style={{ color: 'var(--bp-ink-tertiary)' }}>
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
                    className="p-2.5 rounded-md"
                    style={{ background: 'var(--bp-surface-2)', border: '1px solid var(--bp-border-subtle)' }}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Severity dot */}
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5"
                        style={{ backgroundColor: config.colorHex }}
                      />

                      <div className="min-w-0 flex-1">
                        {/* Pipeline + Entity */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-medium" style={{ color: 'var(--bp-ink-primary)' }}>
                            {getDisplayName(err.pipelineName)}
                            {hasEntity && (
                              <span style={{ color: 'var(--bp-ink-secondary)', fontWeight: 400 }}> — {err.entityName}</span>
                            )}
                          </p>
                          <Badge variant="outline" className="text-[9px] flex-shrink-0">
                            {err.source === 'fabric' ? 'Fabric' : 'SQL'}
                          </Badge>
                        </div>

                        {/* Error summary — always visible */}
                        {hasSummary && (
                          <p className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--bp-ink-secondary)' }}>{err.summary}</p>
                        )}

                        {/* Timestamp */}
                        <p className="text-[10px] mt-1" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                          {fmtTime(err.startTime)}
                        </p>

                        {/* Raw error (toggled) */}
                        {showRaw && (
                          <pre className="mt-2 p-2 rounded text-[10px] whitespace-pre-wrap break-all max-h-32 overflow-y-auto" style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border-subtle)', color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-mono)' }}>
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
                  className="w-full text-center p-2 text-xs transition-colors"
                  style={{ color: 'var(--bp-ink-tertiary)' }}
                >
                  Show fewer
                </button>
              )}

              {catErrors.length === 0 && (
                <p className="text-xs py-2" style={{ color: 'var(--bp-ink-muted)' }}>No individual error records available.</p>
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
  const hasLoadedOnce = useRef(false);
  const mountedRef = useRef(true);

  const fetchData = () => {
    if (!hasLoadedOnce.current) setLoading(true);
    setError(null);
    fetch(`${API}/api/error-intelligence`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((d: ErrorIntelligenceData) => {
        if (mountedRef.current) {
          setData(d);
          setLoading(false);
          hasLoadedOnce.current = true;
        }
      })
      .catch(e => {
        if (mountedRef.current) {
          setError(e.message);
          setLoading(false);
        }
      });
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    return () => { mountedRef.current = false; };
  }, []);

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
    <div className="space-y-6" style={{ padding: 32, maxWidth: 1280, margin: '0 auto' }}>
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 style={{ fontFamily: 'var(--bp-font-display)', fontSize: 32, color: 'var(--bp-ink-primary)', fontWeight: 400, lineHeight: 1.2 }}>Error Intelligence</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--bp-ink-secondary)' }}>Pipeline error analysis — what happened and how to fix it</p>
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
            <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--bp-copper)' }} />
            <span className="text-sm" style={{ color: 'var(--bp-ink-secondary)' }}>Loading pipeline errors...</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="rounded-lg p-6" style={{ background: 'var(--bp-fault-light)', border: '1px solid var(--bp-fault)' }}>
          <div className="flex items-start gap-4">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--bp-fault)' }} />
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)' }}>Failed to load error data</h3>
              <p className="text-sm mt-1" style={{ color: 'var(--bp-ink-secondary)' }}>{error}</p>
              <button className="mt-2 text-xs font-medium" style={{ color: 'var(--bp-copper)' }} onClick={fetchData}>
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
            {([
              { key: 'all' as const, label: 'Total', value: totalErrors, colorHex: 'var(--bp-ink-secondary)', bgHex: 'var(--bp-surface-1)', Icon: AlertCircle },
              { key: 'critical' as const, label: 'Critical', value: criticalCount, colorHex: 'var(--bp-fault)', bgHex: 'var(--bp-fault-light)', Icon: AlertCircle },
              { key: 'warning' as const, label: 'Warnings', value: warningCount, colorHex: 'var(--bp-caution)', bgHex: 'var(--bp-caution-light)', Icon: AlertTriangle },
              { key: 'info' as const, label: 'Info', value: infoCount, colorHex: 'var(--bp-ink-muted)', bgHex: 'var(--bp-surface-2)', Icon: Info },
            ]).map(({ key, label, value, colorHex, bgHex, Icon }) => {
              const isActive = filterSeverity === key;
              return (
                <button
                  key={key}
                  onClick={() => setFilterSeverity(filterSeverity === key ? 'all' : key)}
                  className="text-left rounded-lg p-4 transition-all"
                  style={{
                    background: bgHex,
                    border: isActive ? `2px solid ${colorHex}` : '1px solid var(--bp-border)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: colorHex, fontFamily: 'var(--bp-font-body)' }}>{label}</p>
                      <p className="text-2xl mt-1" style={{ fontFamily: 'var(--bp-font-display)', color: colorHex, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
                    </div>
                    <div className="w-10 h-10 rounded-md flex items-center justify-center" style={{ background: bgHex }}>
                      <Icon className="w-5 h-5" style={{ color: colorHex }} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Top Issue Banner */}
          {topIssue && <TopIssueBanner topIssue={topIssue} />}

          {/* Filters: Pipeline + Search */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            {/* Pipeline filter */}
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5" style={{ color: 'var(--bp-ink-muted)' }} />
              <select
                value={filterPipeline}
                onChange={(e) => setFilterPipeline(e.target.value)}
                className="text-xs rounded-md px-2.5 py-1.5 focus:outline-none"
                style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border)', color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}
              >
                <option value="all">All Pipelines</option>
                {uniquePipelines.map(p => (
                  <option key={p} value={p}>{getDisplayName(p)}</option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--bp-ink-muted)' }} />
              <input
                type="text"
                placeholder="Search errors..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs rounded-md pl-8 pr-3 py-1.5 focus:outline-none"
                style={{ background: 'var(--bp-surface-inset)', border: '1px solid var(--bp-border)', color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}
              />
            </div>

            {/* Active filter indicator */}
            {(filterPipeline !== 'all' || searchQuery || filterSeverity !== 'all') && (
              <button
                onClick={() => { setFilterPipeline('all'); setSearchQuery(''); setFilterSeverity('all'); }}
                className="text-[10px] transition-colors"
                style={{ color: 'var(--bp-copper)' }}
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
            <div className="rounded-lg p-12 text-center" style={{ background: 'var(--bp-operational-light)', border: '1px solid var(--bp-operational)' }}>
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto" style={{ background: 'var(--bp-operational-light)' }}>
                <CheckCircle className="w-7 h-7" style={{ color: 'var(--bp-operational)' }} />
              </div>
              <h3 className="text-sm font-semibold mt-4" style={{ color: 'var(--bp-ink-primary)' }}>
                {totalErrors === 0 ? 'No Pipeline Errors' : 'No Matching Errors'}
              </h3>
              <p className="text-xs mt-1" style={{ color: 'var(--bp-ink-secondary)' }}>
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
