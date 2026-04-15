import { useCallback, useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "";
const CONTRACT_CACHE_TTL_MS = 15_000;

let cachedContract: MetricContract | null = null;
let cachedAt = 0;
let inflightContract: Promise<MetricContract> | null = null;

export interface MetricValue {
  value: number;
  label: string;
  definition: string;
}

export interface MetricContract {
  generatedAt: string;
  tables: {
    inScope: MetricValue;
    landingLoaded: MetricValue;
    bronzeLoaded: MetricValue;
    silverLoaded: MetricValue;
    toolReady: MetricValue;
    blocked: MetricValue;
  };
  sources: {
    total: number;
    operational: number;
    bySource: Array<{
      source: string;
      tablesInScope: number;
      landingLoaded: number;
      bronzeLoaded: number;
      silverLoaded: number;
      toolReady: number;
      blocked: number;
    }>;
  };
  quality: {
    averageScore: number;
  };
  blockers: {
    open: number;
  };
  lastSuccess: {
    landing: string | null;
    bronze: string | null;
    silver: string | null;
  };
}

function hasFreshCache() {
  return Boolean(cachedContract) && (Date.now() - cachedAt) < CONTRACT_CACHE_TTL_MS;
}

function metricContractUrl(forceRefresh = false) {
  return `${API}/api/metric-contract${forceRefresh ? "?refresh=1" : ""}`;
}

async function fetchMetricContract(forceRefresh = false): Promise<MetricContract> {
  if (!forceRefresh && hasFreshCache() && cachedContract) {
    return cachedContract;
  }
  if (!forceRefresh && inflightContract) {
    return inflightContract;
  }

  inflightContract = fetch(metricContractUrl(forceRefresh))
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as MetricContract;
      cachedContract = payload;
      cachedAt = Date.now();
      return payload;
    })
    .finally(() => {
      inflightContract = null;
    });

  return inflightContract;
}

export function useMetricContract() {
  const [data, setData] = useState<MetricContract | null>(() => (hasFreshCache() ? cachedContract : null));
  const [loading, setLoading] = useState(() => !hasFreshCache());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && hasFreshCache() && cachedContract) {
      setData(cachedContract);
      setError(null);
      setLoading(false);
      return cachedContract;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await fetchMetricContract(forceRefresh);
      setData(payload);
      return payload;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load metric contract");
      throw loadError;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return {
    data,
    loading,
    error,
    refresh,
  };
}
