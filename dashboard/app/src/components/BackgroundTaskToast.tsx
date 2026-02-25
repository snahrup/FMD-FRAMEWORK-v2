import { useState } from "react";
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
          {isRunning && <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin flex-shrink-0" />}
          {isDone && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />}
          {isFailed && <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
          {isCancelled && <Ban className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />}
          <span className="text-xs font-medium text-foreground truncate">{task.label}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isRunning && (
            <button
              onClick={() => cancelTask(task.id)}
              className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors"
              title="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {!isRunning && (
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

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isRunning ? "bg-blue-500" : isDone ? "bg-emerald-500" : isFailed ? "bg-red-500" : "bg-amber-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Stats line */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {task.done} / {task.total}
          {task.errors > 0 && <span className="text-red-400 ml-1">({task.errors} failed)</span>}
        </span>
        <span>{formatElapsed(task.startedAt, task.endedAt)}</span>
      </div>
    </div>
  );
}

export function BackgroundTaskToast() {
  const { tasks } = useBackgroundTasks();
  const [expanded, setExpanded] = useState(true);

  if (tasks.length === 0) return null;

  const runningCount = tasks.filter((t) => t.status === "running").length;
  const totalDone = tasks.reduce((s, t) => s + t.done, 0);
  const totalTotal = tasks.reduce((s, t) => s + t.total, 0);

  return (
    <div className="fixed bottom-4 right-4 z-[90] w-72 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
      {/* Header — always visible, clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {runningCount > 0 ? (
            <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          )}
          <span className="text-xs font-medium text-foreground">
            {runningCount > 0
              ? `Processing... ${totalDone}/${totalTotal}`
              : `Done — ${totalDone} items`}
          </span>
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {/* Collapsed: show just a thin progress bar */}
      {!expanded && runningCount > 0 && (
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${totalTotal > 0 ? Math.round((totalDone / totalTotal) * 100) : 0}%` }}
          />
        </div>
      )}

      {/* Expanded: show all tasks */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 max-h-64 overflow-y-auto">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}
