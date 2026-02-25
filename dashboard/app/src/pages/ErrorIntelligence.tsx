import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Info, AlertCircle, CheckCircle,
  ChevronDown, ChevronUp, ChevronRight, Wrench, Clock, Repeat, Eye, EyeOff,
  MessageSquare, Brain, Zap, BarChart3, RefreshCw, Loader2,
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
}

interface ErrorIntelligenceData {
  summaries: ErrorSummary[];
  errors: ErrorRecord[];
  patternCounts: Record<string, number>;
  severityCounts: Record<string, number>;
  totalErrors: number;
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

// ===== AI Streaming Simulation Hook =====
function useAiStream(text: string, enabled: boolean) {
  const [displayed, setDisplayed] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isThinking, setIsThinking] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setDisplayed("");
      setIsStreaming(false);
      setIsThinking(false);
      return;
    }

    setIsThinking(true);
    setDisplayed("");

    const thinkTimer = setTimeout(() => {
      setIsThinking(false);
      setIsStreaming(true);

      let i = 0;
      const interval = setInterval(() => {
        const chunkSize = Math.floor(Math.random() * 6) + 3;
        i += chunkSize;
        if (i >= text.length) {
          setDisplayed(text);
          setIsStreaming(false);
          clearInterval(interval);
        } else {
          setDisplayed(text.slice(0, i));
        }
      }, 20);

      return () => clearInterval(interval);
    }, 1200);

    return () => clearTimeout(thinkTimer);
  }, [text, enabled]);

  return { displayed, isStreaming, isThinking };
}

// ===== Thinking Dots =====
function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 py-2">
      <div className="w-2 h-2 rounded-full bg-primary animate-[cl-thinking_1.4s_ease-in-out_infinite]" />
      <div className="w-2 h-2 rounded-full bg-primary animate-[cl-thinking_1.4s_ease-in-out_0.2s_infinite]" />
      <div className="w-2 h-2 rounded-full bg-primary animate-[cl-thinking_1.4s_ease-in-out_0.4s_infinite]" />
    </div>
  );
}

// ===== AI Message =====
function AiMessage({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <div className="font-serif text-[15px] leading-[1.65] text-foreground/90 whitespace-pre-line">
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
      {isStreaming && <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-[cl-pulse_1s_ease-in-out_infinite]" />}
    </div>
  );
}

// ===== Generate AI analysis text from real error data =====
function generateAiAnalysis(summary: ErrorSummary, errors: ErrorRecord[]): string {
  const catErrors = errors.filter(e => e.category === summary.category);
  const pipelines = summary.affectedPipelines.map(p => getDisplayName(p)).join(', ');
  const count = summary.occurrenceCount;
  const sampleError = summary.latestError.length > 300 ? summary.latestError.slice(0, 300) + '...' : summary.latestError;

  let analysis = `I've identified **${count} occurrence${count > 1 ? 's' : ''}** of this error pattern`;
  if (summary.affectedPipelines.length > 0) {
    analysis += ` across **${summary.affectedPipelines.length} pipeline${summary.affectedPipelines.length > 1 ? 's' : ''}** (${pipelines})`;
  }
  analysis += '.\n\n';

  analysis += `**Error Category:** ${summary.title}\n\n`;
  analysis += `**Latest occurrence:** ${sampleError}\n\n`;
  analysis += `**Recommendation:** ${summary.suggestion}`;

  if (catErrors.length > 1) {
    const timeSpan = catErrors.filter(e => e.startTime).map(e => new Date(e.startTime));
    if (timeSpan.length >= 2) {
      const earliest = new Date(Math.min(...timeSpan.map(d => d.getTime())));
      const latest = new Date(Math.max(...timeSpan.map(d => d.getTime())));
      const diffHours = Math.round((latest.getTime() - earliest.getTime()) / (1000 * 60 * 60));
      if (diffHours > 0) {
        analysis += `\n\n**Time span:** These ${count} failures occurred over a ${diffHours}-hour window, suggesting ${
          diffHours < 6 ? 'a concentrated burst, possibly from a single pipeline run cascading failures.' :
          diffHours < 24 ? 'recurring failures within the same day.' :
          'a persistent issue spanning multiple days that needs attention.'
        }`;
      }
    }
  }

  return analysis;
}

// ===== Error Card =====
function ErrorCard({
  summary,
  errors,
  isExpanded,
  showAi,
  showRaw,
  onToggleExpand,
  onToggleRaw,
  onToggleAi,
}: {
  summary: ErrorSummary;
  errors: ErrorRecord[];
  isExpanded: boolean;
  showAi: boolean;
  showRaw: boolean;
  onToggleExpand: () => void;
  onToggleRaw: () => void;
  onToggleAi: () => void;
}) {
  const config = severityConfig[summary.severity];
  const SeverityIcon = config.icon;
  const aiText = generateAiAnalysis(summary, errors);
  const aiStream = useAiStream(aiText, showAi);
  const catErrors = errors.filter(e => e.category === summary.category);

  const fmtTime = (iso?: string) => {
    if (!iso) return '';
    const cleaned = iso.replace(/Z$/i, '');
    const d = new Date(cleaned);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  };

  return (
    <div className={cn(
      "rounded-[var(--radius-xl)] border overflow-hidden transition-all duration-[var(--duration-normal)]",
      config.borderColor,
      isExpanded ? 'shadow-[var(--shadow-card-hover)]' : 'shadow-[var(--shadow-card)]'
    )}>
      {/* Header */}
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
              <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                {summary.affectedPipelines.length > 0
                  ? `Affecting: ${summary.affectedPipelines.map(p => getDisplayName(p)).join(', ')}`
                  : 'No pipeline details available'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {summary.latestTime && (
              <div className="text-right hidden sm:block">
                <p className="text-[10px] text-muted-foreground font-mono flex items-center justify-end">
                  <Clock className="w-3 h-3 mr-1" />
                  {fmtTime(summary.latestTime)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{getDisplayName(summary.latestPipeline)}</p>
              </div>
            )}
            {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-border">
          <div className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Occurrences */}
              <div>
                <h4 className="text-xs font-semibold text-foreground mb-3">Recent Occurrences</h4>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {catErrors.slice(0, 10).map((err, i) => (
                    <div key={err.id || i} className="flex items-center gap-3 p-2 bg-muted rounded-[var(--radius-md)]">
                      <div className={cn(
                        "w-2 h-2 rounded-full flex-shrink-0",
                        err.source === 'fabric' ? 'bg-blue-500' : 'bg-amber-500'
                      )} title={err.source === 'fabric' ? 'Fabric API' : 'SQL Logging'} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-foreground truncate">{getDisplayName(err.pipelineName)}</p>
                        <p className="text-[10px] text-muted-foreground font-mono">{fmtTime(err.startTime)}</p>
                      </div>
                      <Badge variant="outline" className="text-[9px] flex-shrink-0">
                        {err.source === 'fabric' ? 'Fabric' : 'SQL'}
                      </Badge>
                    </div>
                  ))}
                  {catErrors.length === 0 && (
                    <p className="text-xs text-muted-foreground">No individual error records available.</p>
                  )}
                </div>
              </div>

              {/* Resolution */}
              <div>
                <h4 className="text-xs font-semibold text-foreground mb-3">Resolution Guidance</h4>
                <div className="space-y-3">
                  <div className="flex items-start p-2.5 bg-muted rounded-[var(--radius-md)]">
                    <Wrench className="w-4 h-4 text-muted-foreground mr-2.5 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Suggested Fix</p>
                      <p className="text-xs text-foreground/80 leading-relaxed">{summary.suggestion}</p>
                    </div>
                  </div>
                  {summary.affectedPipelines.length > 0 && (
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Affected Pipelines</p>
                      <div className="flex flex-wrap gap-1.5">
                        {summary.affectedPipelines.map(p => (
                          <Badge key={p} variant="outline" className="text-[10px] font-mono">{getDisplayName(p)}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleRaw(); }}
                  className="flex items-center text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showRaw ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                  {showRaw ? 'Hide' : 'Show'} Raw Errors
                </button>
              </div>
              <Button
                size="sm"
                onClick={(e) => { e.stopPropagation(); onToggleAi(); }}
                className={cn(
                  "gap-1.5 text-xs h-7",
                  showAi ? "bg-primary/10 text-primary hover:bg-primary/20" : ""
                )}
                variant={showAi ? "ghost" : "default"}
              >
                <MessageSquare className="w-3 h-3" />
                {showAi ? 'Hide AI Analysis' : 'Analyze with Claude'}
              </Button>
            </div>

            {/* Raw Errors */}
            {showRaw && (
              <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
                {catErrors.slice(0, 5).map((err, i) => (
                  <pre key={err.id || i} className="p-3 bg-surface rounded-[var(--radius-md)] text-muted-foreground text-[10px] font-mono overflow-x-auto border border-border whitespace-pre-wrap break-all">
                    <span className="text-foreground/60 block mb-1">{getDisplayName(err.pipelineName)} — {fmtTime(err.startTime)}</span>
                    {err.rawError}
                  </pre>
                ))}
              </div>
            )}
          </div>

          {/* AI Analysis Panel */}
          {showAi && (
            <div className="border-t border-border bg-muted/30">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border">
                <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                  <Brain className="h-3 w-3 text-primary-foreground" />
                </div>
                <span className="text-[10px] font-medium text-foreground">Claude's Analysis</span>
                {aiStream.isStreaming && (
                  <span className="text-[10px] text-muted-foreground animate-[cl-pulse_2s_ease-in-out_infinite]">streaming...</span>
                )}
              </div>
              <div className="p-4">
                {aiStream.isThinking ? (
                  <div className="flex items-center gap-3">
                    <ThinkingDots />
                    <span className="text-xs text-muted-foreground">Analyzing error context...</span>
                  </div>
                ) : (
                  <AiMessage text={aiStream.displayed} isStreaming={aiStream.isStreaming} />
                )}
              </div>
            </div>
          )}
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
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, boolean>>({});

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
  const errors = data?.errors || [];
  const totalErrors = data?.totalErrors || 0;
  const criticalCount = data?.severityCounts?.critical || 0;
  const warningCount = data?.severityCounts?.warning || 0;
  const infoCount = data?.severityCounts?.info || 0;

  const filteredSummaries = filterSeverity === 'all'
    ? summaries
    : summaries.filter(s => s.severity === filterSeverity);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-semibold tracking-tight text-foreground">Error Intelligence</h1>
          <p className="text-sm text-muted-foreground mt-1">Real-time pipeline error analysis and diagnostics</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5 h-8 text-xs">
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </Button>
          <Badge variant="outline" className="gap-1.5 py-1">
            <Brain className="h-3 w-3" />
            AI-Assisted Analysis
          </Badge>
          {totalErrors > 0 && (
            <Badge variant="destructive" className="gap-1.5 py-1">
              <Zap className="h-3 w-3" />
              {totalErrors} error{totalErrors !== 1 ? 's' : ''} found
            </Badge>
          )}
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Analyzing pipeline errors...</span>
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

      {/* Main Content (only when loaded) */}
      {!loading && !error && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/20 dark:to-slate-900/10 rounded-xl border border-slate-200/50 dark:border-slate-800/30 p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Total Errors</p>
                  <p className="text-2xl font-display font-semibold text-foreground mt-1">{totalErrors}</p>
                </div>
                <div className="w-10 h-10 bg-muted rounded-[var(--radius-md)] flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-muted-foreground" />
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950/20 dark:to-red-900/10 rounded-xl border border-red-200/50 dark:border-red-800/30 p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-red-600 dark:text-red-400 uppercase tracking-wider">Critical</p>
                  <p className="text-2xl font-display font-semibold text-red-700 dark:text-red-400 mt-1">{criticalCount}</p>
                </div>
                <div className="w-10 h-10 bg-red-50 dark:bg-red-950/30 rounded-[var(--radius-md)] flex items-center justify-center">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/20 dark:to-amber-900/10 rounded-xl border border-amber-200/50 dark:border-amber-800/30 p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400 uppercase tracking-wider">Warnings</p>
                  <p className="text-2xl font-display font-semibold text-amber-700 dark:text-amber-400 mt-1">{warningCount}</p>
                </div>
                <div className="w-10 h-10 bg-amber-50 dark:bg-amber-950/30 rounded-[var(--radius-md)] flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/20 dark:to-blue-900/10 rounded-xl border border-blue-200/50 dark:border-blue-800/30 p-4 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">Info</p>
                  <p className="text-2xl font-display font-semibold text-blue-700 dark:text-blue-400 mt-1">{infoCount}</p>
                </div>
                <div className="w-10 h-10 bg-blue-50 dark:bg-blue-950/30 rounded-[var(--radius-md)] flex items-center justify-center">
                  <Info className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </div>
          </div>

          {/* Error Pattern Breakdown */}
          {Object.keys(data?.patternCounts || {}).length > 0 && (
            <div className="bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/20 dark:to-purple-900/10 rounded-xl border border-purple-200/50 dark:border-purple-800/30 p-5 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                <h2 className="text-sm font-semibold text-foreground">Error Pattern Breakdown</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {Object.entries(data?.patternCounts || {}).sort((a, b) => b[1] - a[1]).map(([pattern, count]) => (
                  <div key={pattern} className="bg-muted rounded-[var(--radius-md)] p-3 border border-border">
                    <p className="text-xs font-medium text-foreground capitalize">{pattern.replace(/_/g, ' ')}</p>
                    <p className="text-xl font-display font-semibold text-foreground/80 mt-2">{count}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 uppercase tracking-wider">occurrence{count !== 1 ? 's' : ''}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Severity Filter */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Filter:</span>
            {(['all', 'critical', 'warning', 'info'] as const).map((severity) => {
              const isActive = filterSeverity === severity;
              const filterCount = severity === 'all' ? totalErrors :
                summaries.filter(s => s.severity === severity).reduce((sum, s) => sum + s.occurrenceCount, 0);
              return (
                <button
                  key={severity}
                  onClick={() => setFilterSeverity(severity)}
                  className={cn(
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-[var(--duration-fast)] gap-1.5 inline-flex items-center",
                    isActive
                      ? severity === 'all'
                        ? 'bg-foreground text-background'
                        : severity === 'critical'
                          ? 'bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400'
                          : severity === 'warning'
                            ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'
                            : 'bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  )}
                >
                  {severity === 'all' ? 'All' : severityConfig[severity].label}
                  <span className="text-[10px] opacity-70">({filterCount})</span>
                </button>
              );
            })}
          </div>

          {/* Error Cards */}
          <div className="space-y-3">
            {filteredSummaries.map((summary) => (
              <ErrorCard
                key={summary.id}
                summary={summary}
                errors={errors}
                isExpanded={expandedError === summary.id}
                showAi={aiAnalysis[summary.id] || false}
                showRaw={showRawError[summary.id] || false}
                onToggleExpand={() => setExpandedError(expandedError === summary.id ? null : summary.id)}
                onToggleRaw={() => setShowRawError(prev => ({ ...prev, [summary.id]: !prev[summary.id] }))}
                onToggleAi={() => setAiAnalysis(prev => ({ ...prev, [summary.id]: !prev[summary.id] }))}
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
                {totalErrors === 0 ? 'No Pipeline Errors' : 'All Clear'}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {totalErrors === 0
                  ? 'No pipeline failures detected in recent Fabric job history or execution logs. All systems operational.'
                  : `No ${filterSeverity} errors found. Try a different filter.`}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
