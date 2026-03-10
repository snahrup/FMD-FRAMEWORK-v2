// ============================================================================
// useMicroscope — Cross-layer row inspection hooks for Data Microscope
//
// Follows the useEntityDigest pattern: module-level cache, request dedup,
// mountedRef for safe async state updates.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

export interface TransformationStep {
  step: number;
  layer: string;
  operation: string;
  description: string;
  columns?: string[];
  impact: string;
  details?: string;
}

export interface MicroscopeData {
  entityId: number;
  entityName: string;
  primaryKeys: string[];
  pkValue: string;
  source: {
    available: boolean;
    server?: string | null;
    database?: string | null;
    row: Record<string, unknown> | null;
  };
  landing: {
    available: boolean;
    note: string;
    row: null;
  };
  bronze: {
    available: boolean;
    lakehouse?: string | null;
    row: Record<string, unknown> | null;
  };
  silver: {
    available: boolean;
    lakehouse?: string | null;
    versions: Record<string, unknown>[];
    currentVersion: number;
  };
  cleansingRules: {
    bronze: Record<string, unknown>[];
    silver: Record<string, unknown>[];
  };
  transformations: TransformationStep[];
  error?: string;
}

export interface PkSearchResult {
  values: string[];
  pkColumn?: string;
  error?: string;
}

// ── Module-level cache ──

interface MicroscopeCache {
  data: MicroscopeData;
  fetchedAt: number;
  key: string;
}

const CLIENT_TTL_MS = 60_000; // 60s — microscope data is specific, cache longer
let _cache: MicroscopeCache | null = null;
let _inflight: Promise<MicroscopeData> | null = null;

function cacheKey(entityId: number | null, pkValue: string): string {
  return `${entityId || 0}|${pkValue}`;
}

async function fetchMicroscope(
  entityId: number,
  pkValue: string
): Promise<MicroscopeData> {
  const key = cacheKey(entityId, pkValue);

  // Return cache if fresh
  if (
    _cache &&
    _cache.key === key &&
    Date.now() - _cache.fetchedAt < CLIENT_TTL_MS
  ) {
    return _cache.data;
  }

  // Deduplicate concurrent requests
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const params = new URLSearchParams();
      params.set("entity", String(entityId));
      if (pkValue) params.set("pk", pkValue);
      const resp = await fetch(`${API}/api/microscope?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: MicroscopeData = await resp.json();
      _cache = { data, fetchedAt: Date.now(), key };
      return data;
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

/** Invalidate the client-side microscope cache. */
export function invalidateMicroscopeCache(): void {
  _cache = null;
}

// ── Main Hook ──

export function useMicroscope(entityId: number | null, pkValue: string) {
  const [data, setData] = useState<MicroscopeData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!entityId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMicroscope(entityId, pkValue);
      if (mountedRef.current) {
        if (result.error) {
          setError(result.error);
          setData(null);
        } else {
          setData(result);
        }
      }
    } catch (e: unknown) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load microscope data");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [entityId, pkValue]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const refresh = useCallback(() => {
    invalidateMicroscopeCache();
    load();
  }, [load]);

  return { data, loading, error, refresh };
}

// ── PK Autocomplete Hook ──

export function useMicroscopePks(
  entityId: number | null,
  searchQuery: string,
  limit: number = 20
) {
  const [pks, setPks] = useState<string[]>([]);
  const [pkColumn, setPkColumn] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!entityId) {
      setPks([]);
      setLoading(false);
      return;
    }

    // Debounce search
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("entity", String(entityId));
        if (searchQuery) params.set("q", searchQuery);
        params.set("limit", String(limit));
        const resp = await fetch(`${API}/api/microscope/pks?${params}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const result: PkSearchResult = await resp.json();
        if (mountedRef.current) {
          setPks(result.values || []);
          setPkColumn(result.pkColumn || "");
          if (result.error) setError(result.error);
        }
      } catch (e: unknown) {
        if (mountedRef.current) {
          setError(e instanceof Error ? e.message : "PK search failed");
          setPks([]);
        }
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [entityId, searchQuery, limit]);

  return { pks, pkColumn, loading, error };
}
