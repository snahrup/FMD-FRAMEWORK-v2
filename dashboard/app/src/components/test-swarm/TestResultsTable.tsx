import { cn } from "@/lib/utils";
import { CheckCircle2, XCircle, MinusCircle, ChevronDown } from "lucide-react";
import { useState } from "react";

interface TestResult {
  name: string;
  status: "passed" | "failed" | "skipped" | "error";
  duration?: number;
  error?: string;
  file?: string;
}

interface TestResultsTableProps {
  tests: TestResult[];
  className?: string;
}

const STATUS_ICON = {
  passed: { icon: CheckCircle2, color: "text-[var(--cl-success)]" },
  failed: { icon: XCircle, color: "text-[var(--cl-error)]" },
  error: { icon: XCircle, color: "text-[var(--cl-error)]" },
  skipped: { icon: MinusCircle, color: "text-muted-foreground" },
};

function TestRow({ test }: { test: TestResult }) {
  const [expanded, setExpanded] = useState(false);
  const { icon: Icon, color } = STATUS_ICON[test.status] || STATUS_ICON.error;

  return (
    <div className="border-b border-border/20 last:border-0">
      <button
        onClick={() => test.error && setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors",
          test.error ? "cursor-pointer hover:bg-muted/50" : "cursor-default"
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", color)} />
        <span className="flex-1 text-sm text-foreground truncate">{test.name}</span>
        {test.file && (
          <span className="text-xs text-muted-foreground/70 font-mono truncate max-w-[200px]">{test.file}</span>
        )}
        {test.duration !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">{test.duration > 1000 ? `${(test.duration / 1000).toFixed(1)}s` : `${test.duration}ms`}</span>
        )}
        {test.error && (
          <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")} />
        )}
      </button>

      {expanded && test.error && (
        <div className="px-3 pb-3 pl-10">
          <pre className="text-xs text-[var(--cl-error)] bg-[var(--cl-error)]/5 rounded-[var(--radius)] p-3 overflow-x-auto font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto">
            {test.error}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function TestResultsTable({ tests, className }: TestResultsTableProps) {
  const [filter, setFilter] = useState<"all" | "failed" | "passed">("all");

  const filtered = tests.filter(t => {
    if (filter === "failed") return t.status === "failed" || t.status === "error";
    if (filter === "passed") return t.status === "passed";
    return true;
  });

  const failCount = tests.filter(t => t.status === "failed" || t.status === "error").length;
  const passCount = tests.filter(t => t.status === "passed").length;

  return (
    <div className={cn("rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm overflow-hidden", className)}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/20">
        <h4 className="text-sm font-medium text-foreground">Test Results</h4>
        <div className="flex items-center gap-1">
          {(["all", "failed", "passed"] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-2.5 py-1 rounded-[var(--radius)] text-xs font-medium transition-colors",
                filter === f ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f === "all" ? `All (${tests.length})` : f === "failed" ? `Failed (${failCount})` : `Passed (${passCount})`}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">No tests match filter</div>
        ) : (
          filtered.map((test, idx) => <TestRow key={`${test.name}-${idx}`} test={test} />)
        )}
      </div>
    </div>
  );
}
