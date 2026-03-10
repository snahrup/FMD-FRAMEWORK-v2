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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const hours = TIME_RANGE_HOURS[timeRange];
      const [status, metrics, runsResp] = await Promise.all([
        fetchJson<EngineStatus>("/engine/status").catch(() => null),
        fetchJson<EngineMetrics>(`/engine/metrics?hours=${hours}`).catch(() => null),
        fetchJson<EngineRunsResponse>("/engine/runs?limit=20").catch(() => null),
      ]);
      if (mountedRef.current) {
        setEngineStatus(status);
        setEngineMetrics(metrics);
        setEngineRuns(runsResp?.runs || []);
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

  /** Fetch entity-level engine logs */
  const fetchEntityLogs = useCallback(async (entityId: number, limit = 10): Promise<EngineLog[]> => {
    try {
      const resp = await fetchJson<EngineLogsResponse>(`/engine/logs?entity_id=${entityId}&limit=${limit}`);
      return resp.logs || [];
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
