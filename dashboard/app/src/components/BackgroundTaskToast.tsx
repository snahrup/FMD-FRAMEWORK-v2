import { useEffect, useState } from "react";
import { useBackgroundTasks, type BackgroundTask } from "@/contexts/BackgroundTaskContext";
import {
  Loader2, CheckCircle2, XCircle, ChevronUp, ChevronDown, X, Ban,
} from "lucide-react";

function formatElapsed(startedAt: number, endedAt?: number): string {
  const ms = (endedAt || Date.now()) - startedAt;
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

function TaskItem({ task }: { task: BackgroundTask }) {
  const { cancelTask, dismissTask } = useBackgroundTasks();
  const pct = task.total > 0 ? Math.round((task.done / task.total) * 100) : 0;
  const isRunning = task.status === "running";
  const isDone = task.status === "completed";
  const isFailed = task.status === "failed";
  const isCancelled = task.status === "cancelled";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" style={{ color: "var(--bp-copper)" }} />}
          {isDone && <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--bp-operational)" }} />}
          {isFailed && <XCircle className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--bp-fault)" }} />}
          {isCancelled && <Ban className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--bp-caution)" }} />}
          <span className="text-xs font-medium text-foreground truncate">{task.label}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isRunning ? (
            <button
              onClick={() => cancelTask(task.id)}
              className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
              title="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          ) : (
            <button
              onClick={() => dismissTask(task.id)}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: isRunning
              ? "var(--bp-copper)"
              : isDone
                ? "var(--bp-operational)"
                : isFailed
                  ? "var(--bp-fault)"
                  : "var(--bp-caution)",
            transition: "width 600ms var(--ease-claude)",
          }}
        />
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {task.done} / {task.total}
          {task.errors > 0 ? (
            <span className="ml-1" style={{ color: "var(--bp-fault)" }}>
              ({task.errors} failed)
            </span>
          ) : null}
        </span>
        <span>{formatElapsed(task.startedAt, task.endedAt)}</span>
      </div>
    </div>
  );
}

export function BackgroundTaskToast() {
  const { tasks } = useBackgroundTasks();
  const [expanded, setExpanded] = useState(false);

  const runningCount = tasks.filter((t) => t.status === "running").length;
  const totalDone = tasks.reduce((s, t) => s + t.done, 0);
  const totalTotal = tasks.reduce((s, t) => s + t.total, 0);
  const hasAttentionState = tasks.some((t) => t.status === "failed" || t.status === "cancelled");
  const completionPct = totalTotal > 0 ? Math.round((totalDone / totalTotal) * 100) : 0;

  useEffect(() => {
    if (hasAttentionState) {
      setExpanded(true);
    }
  }, [hasAttentionState]);

  if (tasks.length === 0) return null;

  const headerLabel = runningCount > 0
    ? `${runningCount} live task${runningCount === 1 ? "" : "s"}`
    : `${tasks.length} recent task${tasks.length === 1 ? "" : "s"}`;
  const headerDetail = runningCount > 0
    ? `${totalDone}/${totalTotal} checkpoints`
    : `${completionPct}% complete`;

  return (
    <div className="fixed bottom-4 right-4 z-[90]">
      <div
        className={expanded ? "gs-modal-enter" : undefined}
        style={{
          width: expanded ? 320 : 228,
          background: "var(--bp-surface-1)",
          border: "1px solid var(--bp-border-strong)",
          borderRadius: 18,
          overflow: "hidden",
        }}
      >
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/40 transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            {runningCount > 0 ? (
              <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" style={{ color: "var(--bp-copper)" }} />
            ) : hasAttentionState ? (
              <XCircle className="h-4 w-4 flex-shrink-0" style={{ color: "var(--bp-fault)" }} />
            ) : (
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: "var(--bp-operational)" }} />
            )}
            <div className="min-w-0 text-left">
              <div className="text-[11px] font-semibold text-foreground truncate">{headerLabel}</div>
              <div className="text-[10px] text-muted-foreground truncate">{headerDetail}</div>
            </div>
          </div>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </button>

        {!expanded ? (
          <div className="h-1 bg-muted">
            <div
              className="h-full"
              style={{
                width: `${completionPct}%`,
                background: hasAttentionState
                  ? "var(--bp-fault)"
                  : runningCount > 0
                    ? "var(--bp-copper)"
                    : "var(--bp-operational)",
                transition: "width 600ms var(--ease-claude)",
              }}
            />
          </div>
        ) : null}

        {expanded ? (
          <div className="px-3 pb-3 space-y-3 max-h-72 overflow-y-auto">
            {tasks.map((task) => (
              <TaskItem key={task.id} task={task} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
