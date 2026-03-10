import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Clock, FileCode, TrendingUp, TrendingDown, Minus } from "lucide-react";
import TestResultsTable from "./TestResultsTable";
import DiffViewer from "./DiffViewer";
import AgentSessionLog from "./AgentSessionLog";

interface FileChange {
  file: string;
  added: number;
  removed: number;
}

interface IterationData {
  iteration: number;
  timestamp: number;
  duration: number;
  testsBefore: { total: number; passed: number; failed: number };
  testsAfter: { total: number; passed: number; failed: number };
  filesChanged: FileChange[];
  summary: string;
  agentLog?: string;
  diff?: string;
  persistentFailures?: string[];
  tests?: Array<{ name: string; status: "passed" | "failed" | "skipped" | "error"; duration?: number; error?: string; file?: string }>;
}

interface IterationDetailProps {
  iteration: IterationData | null;
  isOpen: boolean;
  onToggle: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function DeltaBadge({ before, after }: { before: number; after: number }) {
  const delta = after - before;
  if (delta > 0) return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--cl-success)]">
      <TrendingUp className="h-3 w-3" /> +{delta}
    </span>
  );
  if (delta < 0) return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--cl-error)]">
      <TrendingDown className="h-3 w-3" /> {delta}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
      <Minus className="h-3 w-3" /> No change
    </span>
  );
}

export default function IterationDetail({ iteration, isOpen, onToggle }: IterationDetailProps) {
  if (!iteration) return null;

  const delta = iteration.testsAfter.passed - iteration.testsBefore.passed;

  return (
    <div className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className={cn(
            "rounded-full w-8 h-8 flex items-center justify-center text-white text-xs font-bold",
            delta > 0 ? "bg-[var(--cl-success)]" : delta < 0 ? "bg-[var(--cl-error)]" : "bg-muted-foreground"
          )}>
            #{iteration.iteration}
          </div>
          <div className="text-left">
            <p className="text-sm font-medium text-foreground">
              Iteration {iteration.iteration}
              <span className="text-muted-foreground font-normal ml-2">
                {iteration.testsBefore.passed}/{iteration.testsBefore.total} → {iteration.testsAfter.passed}/{iteration.testsAfter.total}
              </span>
            </p>
            {iteration.summary && (
              <p className="text-xs text-muted-foreground mt-0.5 max-w-lg truncate">{iteration.summary}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <DeltaBadge before={iteration.testsBefore.passed} after={iteration.testsAfter.passed} />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {formatDuration(iteration.duration)}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileCode className="h-3 w-3" />
            {iteration.filesChanged.length} files
          </div>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
        </div>
      </button>

      {/* Expanded content */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4 border-t border-border/20 pt-4">
              {/* Persistent failures warning */}
              {iteration.persistentFailures && iteration.persistentFailures.length > 0 && (
                <div className="rounded-[var(--radius)] bg-[var(--cl-error)]/5 border border-[var(--cl-error)]/20 p-3">
                  <p className="text-xs font-medium text-[var(--cl-error)] mb-1">Persistent Failures</p>
                  <ul className="text-xs text-[var(--cl-error)]/80 space-y-0.5">
                    {iteration.persistentFailures.map((f, i) => (
                      <li key={i} className="font-mono">{f}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Three-panel layout */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Test results */}
                {iteration.tests && iteration.tests.length > 0 && (
                  <TestResultsTable tests={iteration.tests} />
                )}

                {/* Diff viewer */}
                {iteration.filesChanged.length > 0 && (
                  <DiffViewer files={iteration.filesChanged} patch={iteration.diff} />
                )}
              </div>

              {/* Agent log */}
              {iteration.agentLog && (
                <AgentSessionLog log={iteration.agentLog} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
