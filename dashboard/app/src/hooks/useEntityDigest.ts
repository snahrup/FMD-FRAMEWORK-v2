// ============================================================================
// useEntityDigest — Shared hook for consuming the Entity Digest Engine
//
// The digest is the single source of truth for entity state across all
// medallion layers. Use this hook instead of calling /api/entities,
// /api/bronze-entities, /api/silver-entities individually.
//
// The backend caches the digest for 2 min (TTL). The hook caches the response
// in a module-level singleton so multiple components mounting simultaneously
// don't fire duplicate requests.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8787";

// ── Types ──

export interface EntityConnection {
  server: string;
  database: string;
  connectionName: string;
}

export interface EntityError {
  message: string;
  layer: string;
  time: string;
}

export interface DigestEntity {
  id: number;
  tableName: string;
  sourceSchema: string;
  source: string;
  isActive: boolean;
  isIncremental: boolean;
  watermarkColumn: string;
  bronzeId: number | null;
  bronzePKs: string;
  silverId: number | null;
  lzStatus: "loaded" | "pending" | "not_started";
  lzLastLoad: string;
  bronzeStatus: "loaded" | "pending" | "not_started";
  bronzeLastLoad: string;
  silverStatus: "loaded" | "pending" | "not_started";
  silverLastLoad: string;
  lastError: EntityError | null;
  diagnosis: string;
  overall: "complete" | "error" | "pending" | "partial" | "not_started";
  connection: EntityConnection | null;
}

export interface DigestSourceSummary {
  total: number;
  complete: number;
  pending: number;
  error: number;
  partial: number;
  not_started: number;
}

export interface DigestSource {
  key: string;
  name: string;
  connection: EntityConnection | null;
  entities: DigestEntity[];
  summary: DigestSourceSummary;
}

export interface DigestResponse {
  generatedAt: string;
  buildTimeMs: number;
  totalEntities: number;
  sources: Record<string, DigestSource>;
}

export interface DigestFilters {
  source?: string;
  layer?: string;
  status?: string;
}

// ── Module-level cache (shared across all hook instances) ──

interface CacheEntry {
  data: DigestResponse;
  fetchedAt: number;
  key: string;
}

const CLIENT_TTL_MS = 30_000; // 30s client-side (server has 2min TTL)
let _cache: CacheEntry | null = null;
let _inflight: Promise<DigestResponse> | null = null;

function cacheKey(filters: DigestFilters): string {
  return `${filters.source || ""}|${filters.layer || ""}|${filters.status || ""}`;
}

async function fetchDigest(filters: DigestFilters): Promise<DigestResponse> {
  const params = new URLSearchParams();
  if (filters.source) params.set("source", filters.source);
  if (filters.layer) params.set("layer", filters.layer);
  if (filters.status) params.set("status", filters.status);

  const key = cacheKey(filters);

  // Return cache if fresh
  if (_cache && _cache.key === key && Date.now() - _cache.fetchedAt < CLIENT_TTL_MS) {
    return _cache.data;
  }

  // Deduplicate concurrent requests for the same key
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const resp = await fetch(`${API}/api/entity-digest?${params}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: DigestResponse = await resp.json();
      _cache = { data, fetchedAt: Date.now(), key };
      return data;
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

/** Invalidate the client-side cache (e.g., after a mutation). */
export function invalidateDigestCache(): void {
  _cache = null;
}

// ── Hook ──

export function useEntityDigest(filters: DigestFilters = {}) {
  const [data, setData] = useState<DigestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const digest = await fetchDigest(filters);
      if (mountedRef.current) {
        setData(digest);
      }
    } catch (e: unknown) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load digest");
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [filters.source, filters.layer, filters.status]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => { mountedRef.current = false; };
  }, [load]);

  const refresh = useCallback(() => {
    invalidateDigestCache();
    load();
  }, [load]);

  // ── Derived helpers ──

  /** Flat list of all entities across all sources */
  const allEntities: DigestEntity[] = data
    ? Object.values(data.sources).flatMap((s) => s.entities)
    : [];

  /** Source list sorted by key */
  const sourceList: DigestSource[] = data
    ? Object.values(data.sources).sort((a, b) => a.key.localeCompare(b.key))
    : [];

  /** Aggregate summary across all sources */
  const totalSummary: DigestSourceSummary = sourceList.reduce(
    (acc, s) => ({
      total: acc.total + s.summary.total,
      complete: acc.complete + s.summary.complete,
      pending: acc.pending + s.summary.pending,
      error: acc.error + s.summary.error,
      partial: acc.partial + s.summary.partial,
      not_started: acc.not_started + s.summary.not_started,
    }),
    { total: 0, complete: 0, pending: 0, error: 0, partial: 0, not_started: 0 },
  );

  /** Find a specific entity by table name (case-insensitive) */
  const findEntity = useCallback(
    (tableName: string, schema?: string): DigestEntity | undefined => {
      const tLower = tableName.toLowerCase();
      return allEntities.find((e) => {
        if (e.tableName.toLowerCase() !== tLower) return false;
        if (schema && e.sourceSchema.toLowerCase() !== schema.toLowerCase()) return false;
        return true;
      });
    },
    [allEntities],
  );

  /** Filter entities by source key */
  const entitiesBySource = useCallback(
    (sourceKey: string): DigestEntity[] => {
      return data?.sources[sourceKey]?.entities || [];
    },
    [data],
  );

  return {
    data,
    loading,
    error,
    refresh,
    allEntities,
    sourceList,
    totalSummary,
    findEntity,
    entitiesBySource,
  };
}
