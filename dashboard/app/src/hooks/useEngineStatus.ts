// ============================================================================
// useEngineStatus — Shared hook for consuming Engine REST endpoints
//
// Provides engine status, metrics, runs, and entity-level logs.
// Used by ExecutionMatrix and any future page that needs engine health data.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

export interface EngineStatus {
  status: string;
  current_run_id: string | null;
  uptime_seconds: number;
  engine_version: string;
  last_run: {
    run_id: number;
    started_at: string;
    ended_at: string;
    status: string;
    duration_seconds: number;
  } | null;
}

export interface LayerMetric {
  Layer: string;
  TotalTasks: number;
  Succeeded: number;
  Failed: number;
  TotalRowsRead: number;
  AvgDurationSeconds: number;
}

export interface SlowestEntity {
  entity_id: number;
  entity_name: string;
  layer: string;
  duration_seconds: number;
}

export interface TopError {
  error_message: string;
  count: number;
}

export interface EngineMetrics {
  runs: number;
  layers: LayerMetric[];
  slowest_entities: SlowestEntity[];
  top_errors: TopError[];
}

export interface EngineRun {
  run_id: number;
  started_at: string;
  ended_at: string | null;
  status: string;
  total_tasks: number;
  succeeded: number;
  failed: number;
  duration_seconds: number | null;
}

export interface EngineRunsResponse {
  runs: EngineRun[];
  count: number;
}

export interface EngineLog {
  log_id: number;
  run_id: number;
  entity_id: number;
  entity_name: string;
  layer: string;
  status: string;
  rows_read: number;
  rows_written: number;
  duration_seconds: number;
  error_message: string | null;
  started_at: string;
  ended_at: string;
}

export interface EngineLogsResponse {
  logs: EngineLog[];
  count: number;
}

// ── Fetchers ──

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/api${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function postJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
  }
  return res.json();
}

// ── Response normalizers ──
// The backend has multiple code paths (SQLite vs engine API vs Fabric SQL)
// that return subtly different shapes. These normalizers paper over the
// differences so the rest of the frontend can rely on a single contract.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEngineStatus(raw: any): EngineStatus | null {
  if (!raw) return null;

  // Both paths return a "status" string at the top level — use it directly.
  const status = raw.status ?? "unknown";

  // SQLite path uses "lastRun" (camelCase), engine API uses "last_run" (snake_case).
  const rawRun = raw.last_run ?? raw.lastRun ?? null;

  let lastRun: EngineStatus["last_run"] = null;
  if (rawRun && typeof rawRun === "object" && !rawRun.error) {
    // Engine API maps to: run_id, started, completed, status, duration_seconds, ...
    // SQLite raw row has: RunId, StartedAt, EndedAt, Status, TotalDurationSeconds, ...
    // We normalize to the frontend EngineStatus["last_run"] shape.
    const runId = rawRun.run_id ?? rawRun.RunId ?? 0;
    const startedAt = rawRun.started_at ?? rawRun.started ?? rawRun.StartedAt ?? rawRun.StartedAtUtc ?? "";
    const endedAt = rawRun.ended_at ?? rawRun.completed ?? rawRun.EndedAt ?? rawRun.CompletedAtUtc ?? "";
    const runStatus = rawRun.status ?? rawRun.Status ?? "unknown";
    const durationSeconds = rawRun.duration_seconds ?? rawRun.TotalDurationSeconds ?? rawRun.ElapsedSeconds ?? null;

    lastRun = {
      run_id: typeof runId === "string" ? parseInt(runId, 10) || 0 : runId,
      started_at: String(startedAt),
      ended_at: String(endedAt),
      status: String(runStatus).toLowerCase(),
      duration_seconds: durationSeconds != null ? Number(durationSeconds) : 0,
    };
  }

  return {
    status,
    current_run_id: raw.current_run_id ?? null,
    uptime_seconds: raw.uptime_seconds ?? 0,
    engine_version: raw.engine_version ?? "",
    last_run: lastRun,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEngineMetrics(raw: any): EngineMetrics | null {
  if (!raw) return null;

  // "runs" — engine API returns an array of run metric rows. The frontend
  // displays it as a count, so coerce to a number.
  let runs: number;
  if (typeof raw.runs === "number") {
    runs = raw.runs;
  } else if (Array.isArray(raw.runs)) {
    runs = raw.runs.length;
  } else {
    runs = 0;
  }

  // "layers" — may come with PascalCase keys from Fabric SQL.
  // Frontend expects Layer, TotalTasks, Succeeded, Failed, TotalRowsRead, AvgDurationSeconds.
  // The SQL query already returns these in PascalCase, so this should be fine.
  const layers: LayerMetric[] = (raw.layers ?? []).map((l: Record<string, unknown>) => ({
    Layer: String(l.Layer ?? l.layer ?? ""),
    TotalTasks: Number(l.TotalTasks ?? l.total_tasks ?? 0),
    Succeeded: Number(l.Succeeded ?? l.succeeded ?? 0),
    Failed: Number(l.Failed ?? l.failed ?? 0),
    TotalRowsRead: Number(l.TotalRowsRead ?? l.total_rows_read ?? 0),
    AvgDurationSeconds: Number(l.AvgDurationSeconds ?? l.avg_duration_seconds ?? 0),
  }));

  // "slowest_entities" — SQL returns PascalCase (EntityId, SourceName, Layer, DurationSeconds)
  // but frontend expects snake_case (entity_id, entity_name, layer, duration_seconds).
  const slowest_entities: SlowestEntity[] = (raw.slowest_entities ?? []).map(
    (s: Record<string, unknown>) => ({
      entity_id: Number(s.entity_id ?? s.EntityId ?? 0),
      entity_name: String(s.entity_name ?? s.SourceName ?? s.EntityName ?? ""),
      layer: String(s.layer ?? s.Layer ?? ""),
      duration_seconds: Number(s.duration_seconds ?? s.DurationSeconds ?? 0),
    })
  );

  // "top_errors" — SQL returns ErrorMessage + Occurrences,
  // frontend expects error_message + count.
  const top_errors: TopError[] = (raw.top_errors ?? []).map(
    (e: Record<string, unknown>) => ({
      error_message: String(e.error_message ?? e.ErrorMessage ?? "Unknown"),
      count: Number(e.count ?? e.Occurrences ?? 0),
    })
  );

  return { runs, layers, slowest_entities, top_errors };
}

// ── Time range mapping ──

export type TimeRange = "1h" | "6h" | "24h" | "7d";

export const TIME_RANGE_HOURS: Record<TimeRange, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "7d": 168,
};

// ── Hook ──

export interface UseEngineStatusOptions {
  timeRange?: TimeRange;
  autoRefreshMs?: number;
}

export function useEngineStatus(options: UseEngineStatusOptions = {}) {
  const { timeRange = "24h", autoRefreshMs = 0 } = options;

  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const [engineMetrics, setEngineMetrics] = useState<EngineMetrics | null>(null);
  const [engineRuns, setEngineRuns] = useState<EngineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const hasLoadedOnce = useRef(false);

  const load = useCallback(async () => {
    // Only show loading spinner on initial load — refreshes update silently
    if (!hasLoadedOnce.current) setLoading(true);
    setError(null);
    try {
      const hours = TIME_RANGE_HOURS[timeRange];
      const [rawStatus, rawMetrics, runsResp] = await Promise.all([
        fetchJson<Record<string, unknown>>("/engine/status").catch(() => null),
        fetchJson<Record<string, unknown>>(`/engine/metrics?hours=${hours}`).catch(() => null),
        fetchJson<EngineRunsResponse>("/engine/runs?limit=20").catch(() => null),
      ]);
      if (mountedRef.current) {
        setEngineStatus(normalizeEngineStatus(rawStatus));
        setEngineMetrics(normalizeEngineMetrics(rawMetrics));
        // Normalize engine runs — SQLite path returns PascalCase column names,
        // engine API path returns mapped snake_case.
        const rawRuns = runsResp?.runs || [];
        setEngineRuns(rawRuns.map((r: Record<string, unknown>) => ({
          run_id: Number(r.run_id ?? r.RunId ?? 0),
          started_at: String(r.started_at ?? r.StartedAt ?? r.StartedAtUtc ?? ""),
          ended_at: (r.ended_at ?? r.finished_at ?? r.EndedAt ?? r.CompletedAtUtc ?? null) as string | null,
          status: String(r.status ?? r.Status ?? "unknown"),
          total_tasks: Number(r.total_tasks ?? r.TotalEntities ?? 0),
          succeeded: Number(r.succeeded ?? r.entities_succeeded ?? r.SucceededEntities ?? 0),
          failed: Number(r.failed ?? r.entities_failed ?? r.FailedEntities ?? 0),
          duration_seconds: r.duration_seconds ?? r.TotalDurationSeconds ?? r.ElapsedSeconds ?? null,
        } as EngineRun)));
        hasLoadedOnce.current = true;
      }
    } catch (e: unknown) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load engine data");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [timeRange]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefreshMs || autoRefreshMs <= 0) return;
    const id = setInterval(load, autoRefreshMs);
    return () => clearInterval(id);
  }, [autoRefreshMs, load]);

  const refresh = useCallback(() => {
    load();
  }, [load]);

  /** Fetch entity-level engine logs, normalizing column names from the backend */
  const fetchEntityLogs = useCallback(async (entityId: number, limit = 10): Promise<EngineLog[]> => {
    try {
      const resp = await fetchJson<{ logs: Record<string, unknown>[]; count: number }>(
        `/engine/logs?entity_id=${entityId}&limit=${limit}`
      );
      // The backend (engine/api.py _handle_logs) returns raw SQL column names
      // (PascalCase from sp_GetEngineTaskLogs). Normalize to the EngineLog interface.
      return (resp.logs || []).map((r) => ({
        log_id: Number(r.log_id ?? r.TaskId ?? r.LogId ?? 0),
        run_id: Number(r.run_id ?? r.RunId ?? 0),
        entity_id: Number(r.entity_id ?? r.EntityId ?? 0),
        entity_name: String(r.entity_name ?? r.SourceName ?? r.EntityName ?? ""),
        layer: String(r.layer ?? r.Layer ?? ""),
        status: String(r.status ?? r.Status ?? "unknown"),
        rows_read: Number(r.rows_read ?? r.RowsRead ?? 0),
        rows_written: Number(r.rows_written ?? r.RowsWritten ?? 0),
        duration_seconds: Number(r.duration_seconds ?? r.DurationSeconds ?? 0),
        error_message: r.error_message != null ? String(r.error_message)
          : r.ErrorMessage != null ? String(r.ErrorMessage)
          : null,
        started_at: String(r.started_at ?? r.StartedAtUtc ?? r.StartedAt ?? ""),
        ended_at: String(r.ended_at ?? r.CompletedAtUtc ?? r.EndedAt ?? ""),
      }));
    } catch {
      return [];
    }
  }, []);

  /** Reset entity watermark */
  const resetEntityWatermark = useCallback(async (entityId: number): Promise<void> => {
    await postJson(`/engine/entity/${entityId}/reset`);
  }, []);

  return {
    engineStatus,
    engineMetrics,
    engineRuns,
    loading,
    error,
    refresh,
    fetchEntityLogs,
    resetEntityWatermark,
  };
}
