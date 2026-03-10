// ============================================================================
// useSourceConfig — Single source of truth for source system labels & colors
//
// Fetches /api/source-config once, caches in a module-level singleton.
// Provides resolveLabel(raw) and getColor(raw) for any raw source identifier
// (namespace, name, database, server — all resolve to the same display label).
//
// NEVER hardcode source names/colors in components. Use this hook.
// ============================================================================

import { useState, useEffect } from "react";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

export interface SourceColor {
  key: string;
  bg: string;
  text: string;
  ring: string;
  bar: string;
  hex: string;
}

export interface SourceInfo {
  id: number;
  name: string;
  namespace: string;
  label: string;
  type: string;
  description: string;
  connectionName: string;
  serverName: string;
  databaseName: string;
  isActive: boolean;
  color: SourceColor;
}

export interface SourceConfig {
  sources: SourceInfo[];
  labelMap: Record<string, string>;
  colorMap: Record<string, SourceColor>;
}

// ── Module-level singleton cache ──

let _cached: SourceConfig | null = null;
let _fetchPromise: Promise<SourceConfig> | null = null;
let _fetchedAt = 0;
const CACHE_TTL = 60_000; // 1 minute

const DEFAULT_COLOR: SourceColor = {
  key: "slate",
  bg: "bg-slate-500/10",
  text: "text-slate-400",
  ring: "ring-slate-500/30",
  bar: "bg-slate-500",
  hex: "#64748b",
};

async function fetchSourceConfig(): Promise<SourceConfig> {
  const now = Date.now();
  if (_cached && now - _fetchedAt < CACHE_TTL) return _cached;
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = fetch(`${API}/api/source-config`)
    .then((r) => r.json())
    .then((data: SourceConfig) => {
      _cached = data;
      _fetchedAt = Date.now();
      _fetchPromise = null;
      return data;
    })
    .catch((err) => {
      _fetchPromise = null;
      console.warn("useSourceConfig: fetch failed", err);
      // Return empty config on error so UI doesn't break
      return { sources: [], labelMap: {}, colorMap: {} } as SourceConfig;
    });

  return _fetchPromise;
}

// ── Standalone helpers (work with cached data, no hook needed) ──

/** Resolve any raw source identifier to its display label. */
export function resolveSourceLabel(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  if (_cached?.labelMap) {
    return _cached.labelMap[raw] || _cached.labelMap[raw.toLowerCase()] || raw;
  }
  return raw;
}

/** Get color config for any raw source identifier. */
export function getSourceColor(raw: string | null | undefined): SourceColor {
  if (!raw) return DEFAULT_COLOR;
  if (_cached?.colorMap) {
    return _cached.colorMap[raw] || _cached.colorMap[raw.toLowerCase()] || DEFAULT_COLOR;
  }
  return DEFAULT_COLOR;
}

/** Force-refresh the cache (call after saving a new label). */
export function invalidateSourceConfig(): void {
  _cached = null;
  _fetchedAt = 0;
  _fetchPromise = null;
}

// ── Hook ──

export function useSourceConfig() {
  const [config, setConfig] = useState<SourceConfig>(
    _cached || { sources: [], labelMap: {}, colorMap: {} }
  );
  const [loading, setLoading] = useState(!_cached);

  useEffect(() => {
    let cancelled = false;
    fetchSourceConfig().then((data) => {
      if (!cancelled) {
        setConfig(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  return {
    /** All registered sources with full metadata. */
    sources: config.sources,
    /** Resolve any raw source identifier to its display label. */
    resolveLabel: (raw: string | null | undefined) => resolveSourceLabel(raw),
    /** Get Tailwind color config for any raw source identifier. */
    getColor: (raw: string | null | undefined) => getSourceColor(raw),
    /** Whether the initial fetch is still in progress. */
    loading,
    /** The raw config object. */
    config,
  };
}
