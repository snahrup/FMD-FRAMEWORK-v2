import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from "react";

// ── Types ──

export interface BackgroundTask {
  id: string;
  label: string;
  done: number;
  total: number;
  errors: number;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number;
}

export interface EntityRegistrationPayload {
  dataSourceName: string;
  dataSourceType: string;
  tables: { schema: string; tableName: string; fileName: string; filePath: string }[];
}

interface BackgroundTaskContextType {
  tasks: BackgroundTask[];
  /** Start a bulk entity registration that runs in the background */
  startEntityRegistration: (label: string, payload: EntityRegistrationPayload) => string;
  /** Cancel a running task */
  cancelTask: (taskId: string) => void;
  /** Dismiss a completed/failed/cancelled task from the list */
  dismissTask: (taskId: string) => void;
  /** Check if any task is currently running */
  isRunning: boolean;
}

const BackgroundTaskContext = createContext<BackgroundTaskContextType | null>(null);

export function useBackgroundTasks() {
  const ctx = useContext(BackgroundTaskContext);
  if (!ctx) throw new Error("useBackgroundTasks must be used within BackgroundTaskProvider");
  return ctx;
}

// ── Provider ──

let taskCounter = 0;

export function BackgroundTaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<BackgroundTask[]>([]);
  const cancelledRef = useRef<Set<string>>(new Set());

  const updateTask = useCallback((id: string, updates: Partial<BackgroundTask>) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  }, []);

  const startEntityRegistration = useCallback(
    (label: string, payload: EntityRegistrationPayload): string => {
      const id = `task-${++taskCounter}-${Date.now()}`;
      const task: BackgroundTask = {
        id,
        label,
        done: 0,
        total: payload.tables.length,
        errors: 0,
        status: "running",
        startedAt: Date.now(),
      };
      setTasks((prev) => [...prev, task]);
      cancelledRef.current.delete(id);

      // Run the registration loop as a detached async — not tied to any component lifecycle
      (async () => {
        let done = 0;
        let errors = 0;
        for (const table of payload.tables) {
          // Check for cancellation
          if (cancelledRef.current.has(id)) {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === id
                  ? { ...t, done, errors, status: "cancelled" as const, endedAt: Date.now() }
                  : t
              )
            );
            return;
          }

          try {
            const res = await fetch("/api/entities", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                dataSourceName: payload.dataSourceName,
                dataSourceType: payload.dataSourceType,
                sourceSchema: table.schema,
                sourceName: table.tableName,
                fileName: table.fileName,
                filePath: table.filePath,
                isIncremental: false,
                incrementalColumn: "",
              }),
            });
            if (!res.ok) errors++;
          } catch {
            errors++;
          }
          done++;

          // Batch state updates — every entity or every 5 for large sets
          if (payload.tables.length < 50 || done % 5 === 0 || done === payload.tables.length) {
            setTasks((prev) =>
              prev.map((t) => (t.id === id ? { ...t, done, errors } : t))
            );
          }
        }

        // Final state
        const succeeded = done - errors;
        setTasks((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  done,
                  errors,
                  status: (succeeded > 0 ? "completed" : "failed") as BackgroundTask["status"],
                  endedAt: Date.now(),
                }
              : t
          )
        );
      })();

      return id;
    },
    []
  );

  const cancelTask = useCallback((taskId: string) => {
    cancelledRef.current.add(taskId);
  }, []);

  const dismissTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const isRunning = tasks.some((t) => t.status === "running");

  return (
    <BackgroundTaskContext.Provider
      value={{ tasks, startEntityRegistration, cancelTask, dismissTask, isRunning }}
    >
      {children}
    </BackgroundTaskContext.Provider>
  );
}
