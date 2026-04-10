import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  ClipboardCheck, ChevronDown, ChevronUp,
  Play, Search, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import CompactPageHeader from "@/components/layout/CompactPageHeader";
import TableCardList from "@/components/ui/TableCardList";

// ── Types ──

interface SourceOverview {
  DataSource: string;
  TotalEntities: number;
  Active: number;
  Inactive: number;
}

interface LayerStatus {
  DataSource: string;
  LzLoaded?: number;
  LzFailed?: number;
  LzNeverAttempted?: number;
  BronzeLoaded?: number;
  BronzeFailed?: number;
  BronzeNeverAttempted?: number;
  SilverLoaded?: number;
  SilverFailed?: number;
  SilverNeverAttempted?: number;
}

interface DigestEntry {
  OverallStatus: string;
  EntityCount: number;
}

interface StuckEntry {
  DataSource: string;
  StuckCount: number;
}

interface EntityRow {
  EntityId: number;
  DataSource: string;
  SourceSchema: string;
  SourceName: string;
  IsIncremental: boolean | number;
  LzStatus: number;     // 1=loaded, 0=pending, -1=never
  BronzeStatus: number;
  SilverStatus: number;
}

interface ValidationData {
  overview: SourceOverview[];
  lz_status: LayerStatus[];
  bronze_status: LayerStatus[];
  silver_status: LayerStatus[];
  digest: DigestEntry[];
  never_attempted: { EntityId: number; DataSource: string; SourceSchema: string; SourceName: string }[];
  stuck_at_lz: StuckEntry[];
  entities: EntityRow[];
}

// ── API ──

const API = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
  }
  return res.json();
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `API error: ${res.status}`);
  }
  return res.json();
}

// ── Helpers ──

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseInt(v, 10) || 0;
  return 0;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

type CheckStatus = "pass" | "warn" | "fail" | "pending";

function statusIcon(s: CheckStatus, size: "sm" | "md" = "md") {
  const cls = size === "sm" ? "h-3.5 w-3.5" : "h-5 w-5";
  switch (s) {
    case "pass": return <CheckCircle2 className={cn(cls, "shrink-0")} style={{ color: "var(--bp-operational)" }} />;
    case "warn": return <AlertTriangle className={cn(cls, "shrink-0")} style={{ color: "var(--bp-caution)" }} />;
    case "fail": return <XCircle className={cn(cls, "shrink-0")} style={{ color: "var(--bp-fault)" }} />;
    case "pending": return <Loader2 className={cn(cls, "animate-spin shrink-0")} style={{ color: "var(--bp-ink-muted)" }} />;
  }
}

function layerCheck(loaded: number, total: number): CheckStatus {
  if (total === 0) return "pending";
  if (loaded >= total) return "pass";
  if (loaded > 0) return "warn";
  return "fail";
}

function layerCellStatus(v: number): CheckStatus {
  if (v === 1) return "pass";
  if (v === 0) return "warn";
  return "fail";
}

function entityRowKey(entity: EntityRow): string {
  return [
    num(entity.EntityId),
    entity.DataSource || "unknown",
    entity.SourceSchema || "schema",
    entity.SourceName || "table",
  ].join(":");
}

type LayerFilter = "all" | "missing_lz" | "missing_bronze" | "missing_silver" | "missing_any" | "complete";

// ── Component ──

export default function ValidationChecklist() {
  const [data, setData] = useState<ValidationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);

  // Entity table state
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [layerFilter, setLayerFilter] = useState<LayerFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mobileExpandedEntityId, setMobileExpandedEntityId] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const fetchData = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true);
    else setRefreshing(true);
    try {
      const result = await fetchJson<ValidationData>("/engine/validation");
      setData(result);
      setError(null);
      setLastUpdated(new Date());
      hasLoadedOnce.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch validation data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Auto-poll every 15s
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ── Compute aggregate stats ──
  const totals = useMemo(() => {
    if (!data) return null;
    return {
      entities: data.overview.reduce((s, r) => s + num(r.TotalEntities), 0),
      active: data.overview.reduce((s, r) => s + num(r.Active), 0),
      lzLoaded: data.lz_status.reduce((s, r) => s + num(r.LzLoaded), 0),
      lzFailed: data.lz_status.reduce((s, r) => s + num(r.LzFailed), 0),
      lzNever: data.lz_status.reduce((s, r) => s + num(r.LzNeverAttempted), 0),
      bronzeLoaded: data.bronze_status.reduce((s, r) => s + num(r.BronzeLoaded), 0),
      bronzeFailed: data.bronze_status.reduce((s, r) => s + num(r.BronzeFailed), 0),
      bronzeNever: data.bronze_status.reduce((s, r) => s + num(r.BronzeNeverAttempted), 0),
      silverLoaded: data.silver_status.reduce((s, r) => s + num(r.SilverLoaded), 0),
      silverFailed: data.silver_status.reduce((s, r) => s + num(r.SilverFailed), 0),
      silverNever: data.silver_status.reduce((s, r) => s + num(r.SilverNeverAttempted), 0),
      stuckAtLz: data.stuck_at_lz.reduce((s, r) => s + num(r.StuckCount), 0),
      digestComplete: num(data.digest.find(d => d.OverallStatus === "complete")?.EntityCount),
      digestPartial: num(data.digest.find(d => d.OverallStatus === "partial")?.EntityCount),
      digestNotStarted: num(data.digest.find(d => d.OverallStatus === "not_started")?.EntityCount),
    };
  }, [data]);

  // ── Filtered entities ──
  const filteredEntities = useMemo(() => {
    if (!data?.entities) return [];
    let rows = data.entities;

    // Source filter
    if (sourceFilter !== "all") {
      rows = rows.filter(r => r.DataSource === sourceFilter);
    }

    // Layer filter
    switch (layerFilter) {
      case "missing_lz":
        rows = rows.filter(r => num(r.LzStatus) !== 1);
        break;
      case "missing_bronze":
        rows = rows.filter(r => num(r.BronzeStatus) !== 1);
        break;
      case "missing_silver":
        rows = rows.filter(r => num(r.SilverStatus) !== 1);
        break;
      case "missing_any":
        rows = rows.filter(r => num(r.LzStatus) !== 1 || num(r.BronzeStatus) !== 1 || num(r.SilverStatus) !== 1);
        break;
      case "complete":
        rows = rows.filter(r => num(r.LzStatus) === 1 && num(r.BronzeStatus) === 1 && num(r.SilverStatus) === 1);
        break;
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.SourceName || "").toLowerCase().includes(q) ||
        (r.SourceSchema || "").toLowerCase().includes(q) ||
        String(r.EntityId).includes(q)
      );
    }

    return rows;
  }, [data, sourceFilter, layerFilter, search]);

  // Sources for dropdown
  const sources = useMemo(() => {
    if (!data) return [];
    return data.overview.map(r => r.DataSource as string).sort();
  }, [data]);

  const visibleEntities = useMemo(
    () =>
      filteredEntities.slice(0, 200).map((entity, index) => ({
        entity,
        rowKey: `${entityRowKey(entity)}:${index}`,
      })),
    [filteredEntities]
  );

  // Selection helpers
  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelected(prev => {
      const next = new Set(prev);
      filteredEntities.forEach(e => next.add(num(e.EntityId)));
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const selectMissingLayer = (layer: "lz" | "bronze" | "silver") => {
    if (!data?.entities) return;
    const ids = data.entities
      .filter(e => {
        if (layer === "lz") return num(e.LzStatus) !== 1;
        if (layer === "bronze") return num(e.BronzeStatus) !== 1;
        return num(e.SilverStatus) !== 1;
      })
      .map(e => num(e.EntityId));
    setSelected(new Set(ids));
  };

  const launchEntities = useCallback(async (entityIds: number[]) => {
    if (entityIds.length === 0) return;
    setLaunching(true);
    setLaunchResult(null);
    try {
      const result = await postJson<{ run_id: string; status: string }>("/engine/start", {
        layers: ["landing", "bronze", "silver"],
        mode: "run",
        entity_ids: entityIds,
      });
      setLaunchResult(`Run started: ${result.run_id} (${entityIds.length} entities)`);
      setSelected(new Set());
    } catch (err) {
      setLaunchResult(`Failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLaunching(false);
    }
  }, []);

  // Launch engine run for selected entities
  const handleLaunchSelected = async () => {
    await launchEntities(Array.from(selected));
  };

  // Overall health
  const overallStatus: CheckStatus = totals
    ? totals.active > 0 && totals.lzLoaded === totals.active && totals.bronzeLoaded === totals.active && totals.silverLoaded === totals.active
      ? "pass"
      : totals.lzLoaded > 0
        ? "warn"
        : "fail"
    : "pending";

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--bp-copper)" }} />
        <span className="ml-3" style={{ color: "var(--bp-ink-muted)" }}>Loading validation data...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <XCircle className="h-8 w-8" style={{ color: "var(--bp-fault)" }} />
        <span className="ml-3" style={{ color: "var(--bp-fault)" }}>{error}</span>
      </div>
    );
  }

  return (
    <div className="bp-page-shell space-y-6">
      <CompactPageHeader
        eyebrow="Quality"
        title="Validation Checklist"
        summary="See exactly which staged entities are still missing a layer, then launch only the unresolved work instead of hunting through multiple run surfaces."
        meta={lastUpdated ? `last refreshed ${lastUpdated.toLocaleTimeString()}` : "live validation posture"}
        status={
          <Badge
            variant={overallStatus === "pass" ? "default" : overallStatus === "warn" ? "secondary" : "destructive"}
            className="text-xs"
            style={
              overallStatus === "pass"
                ? { background: "var(--bp-operational-light)", color: "var(--bp-operational)", border: "1px solid rgba(61,124,79,0.2)" }
                : overallStatus === "warn"
                ? { background: "var(--bp-caution-light)", color: "var(--bp-caution)", border: "1px solid rgba(194,122,26,0.2)" }
                : overallStatus === "fail"
                ? { background: "var(--bp-fault-light)", color: "var(--bp-fault)", border: "1px solid rgba(185,58,42,0.2)" }
                : {}
            }
          >
            {overallStatus === "pass" ? "All Layers Complete"
              : overallStatus === "warn" ? "In Progress"
              : overallStatus === "fail" ? "Not Started"
              : "Loading..."}
          </Badge>
        }
        actions={
          <div className="flex items-center gap-2">
            {refreshing ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--bp-ink-muted)" }} />
            ) : null}
            <Button variant="outline" size="sm" onClick={fetchData} disabled={refreshing}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        }
        facts={totals ? [
          { label: "Active", value: `${totals.active} of ${totals.entities} registered`, tone: "accent" },
          { label: "Landing", value: `${totals.lzLoaded} loaded`, tone: totals.lzLoaded === totals.active ? "positive" : "warning" },
          { label: "Bronze", value: `${totals.bronzeLoaded} loaded`, tone: totals.bronzeLoaded === totals.active ? "positive" : "warning" },
          { label: "Silver", value: `${totals.silverLoaded} loaded`, tone: totals.silverLoaded === totals.active ? "positive" : "warning" },
        ] : []}
      />

      {totals && totals.active > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <span className="text-sm font-medium" style={{ fontFamily: "var(--bp-font-body)", fontWeight: 600, color: "var(--bp-ink-primary)" }}>
                  Validation posture
                </span>
                <p className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>
                  One read on what is production-usable, partially staged, or still unresolved.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                  Complete: <strong>{totals.digestComplete}</strong>
                </span>
                <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                  Partial: <strong>{totals.digestPartial}</strong>
                </span>
                <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                  Unresolved: <strong>{totals.digestNotStarted}</strong>
                </span>
                <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                  Stuck at landing: <strong>{totals.stuckAtLz}</strong>
                </span>
              </div>
            </div>
            <div className="mt-4 space-y-2">
            <div className="w-full h-4 rounded-full overflow-hidden flex" style={{ background: "var(--bp-surface-inset)" }}>
              {totals.digestComplete > 0 && (
                <div
                  className="h-full transition-all duration-700"
                  style={{ width: pct(totals.digestComplete, totals.active), background: "var(--bp-operational)" }}
                  title={`Complete: ${totals.digestComplete}`}
                />
              )}
              {totals.digestPartial > 0 && (
                <div
                  className="h-full transition-all duration-700"
                  style={{ width: pct(totals.digestPartial, totals.active), background: "var(--bp-caution)" }}
                  title={`Partial: ${totals.digestPartial}`}
                />
              )}
              {totals.digestNotStarted > 0 && (
                <div
                  className="h-full transition-all duration-700"
                  style={{ width: pct(totals.digestNotStarted, totals.active), background: "var(--bp-fault)", opacity: 0.6 }}
                  title={`Not Started: ${totals.digestNotStarted}`}
                />
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs" style={{ color: "var(--bp-ink-muted)" }}>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "var(--bp-operational)" }} /> Complete</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "var(--bp-caution)" }} /> Partial</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "var(--bp-fault)", opacity: 0.6 }} /> Not Started</span>
            </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Per-Source Checklist ── */}
      {data && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle style={{ fontFamily: "var(--bp-font-body)", fontWeight: 600, fontSize: 18, color: "var(--bp-ink-primary)" }}>Source System Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y" style={{ borderColor: "var(--bp-border)" }}>
              {data.overview.map((src) => {
                const active = num(src.Active);
                const dsName = src.DataSource as string;
                const lz = data.lz_status.find(r => r.DataSource === dsName);
                const br = data.bronze_status.find(r => r.DataSource === dsName);
                const sv = data.silver_status.find(r => r.DataSource === dsName);
                const stuck = data.stuck_at_lz.find(r => r.DataSource === dsName);

                const lzLoaded = num(lz?.LzLoaded);
                const brLoaded = num(br?.BronzeLoaded);
                const svLoaded = num(sv?.SilverLoaded);
                const stuckCount = num(stuck?.StuckCount);

                const lzS = layerCheck(lzLoaded, active);
                const brS = layerCheck(brLoaded, active);
                const svS = layerCheck(svLoaded, active);
                const isExpanded = expandedSource === dsName;

                return (
                  <div key={dsName}>
                    <button
                      onClick={() => setExpandedSource(isExpanded ? null : dsName)}
                      className="w-full flex items-center gap-3 py-3 px-1 transition-colors text-left hover:bg-[var(--bp-surface-2)]"
                    >
                      {statusIcon(
                        lzS === "pass" && brS === "pass" && svS === "pass"
                          ? "pass" : lzLoaded > 0 ? "warn" : "fail"
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium" style={{ color: "var(--bp-ink-primary)" }}>{dsName}</span>
                        <span className="text-xs ml-2" style={{ color: "var(--bp-ink-muted)" }}>{active} active</span>
                      </div>
                      <div className="hidden md:flex items-center gap-2">
                        <VLayerBadge label="LZ" loaded={lzLoaded} total={active} />
                        <VLayerBadge label="BR" loaded={brLoaded} total={active} />
                        <VLayerBadge label="SV" loaded={svLoaded} total={active} />
                      </div>
                      {isExpanded
                        ? <ChevronUp className="h-4 w-4" style={{ color: "var(--bp-ink-muted)" }} />
                        : <ChevronDown className="h-4 w-4" style={{ color: "var(--bp-ink-muted)" }} />
                      }
                    </button>
                    {isExpanded && (
                      <div className="pb-4 pl-10 pr-4 space-y-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                          <LayerDetail layer="Landing Zone" loaded={lzLoaded} failed={num(lz?.LzFailed)} neverAttempted={num(lz?.LzNeverAttempted)} total={active} />
                          <LayerDetail layer="Bronze" loaded={brLoaded} failed={num(br?.BronzeFailed)} neverAttempted={num(br?.BronzeNeverAttempted)} total={active} />
                          <LayerDetail layer="Silver" loaded={svLoaded} failed={num(sv?.SilverFailed)} neverAttempted={num(sv?.SilverNeverAttempted)} total={active} />
                        </div>
                        {stuckCount > 0 && (
                          <div className="flex items-center gap-2 text-xs" style={{ color: "var(--bp-caution)" }}>
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {stuckCount} entities stuck at LZ (Bronze never processed)
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Entity Table with Selection ── */}
      {data?.entities && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2" style={{ fontFamily: "var(--bp-font-body)", fontWeight: 600, fontSize: 18, color: "var(--bp-ink-primary)" }}>
                <Filter className="h-4 w-4" style={{ color: "var(--bp-copper)" }} />
                Entity Layer Status
                <span className="text-xs font-normal ml-1" style={{ color: "var(--bp-ink-muted)" }}>
                  {filteredEntities.length} of {data.entities.length}
                </span>
              </CardTitle>
              <div className="flex items-center gap-2">
                {selected.size > 0 && (
                  <>
                    <span className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>{selected.size} selected</span>
                    <Button variant="ghost" size="sm" onClick={clearSelection} className="text-xs h-7">
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleLaunchSelected}
                      disabled={launching}
                      className="gap-1.5 h-7"
                    >
                      {launching ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      Run {selected.size} Selected
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {/* Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: "var(--bp-ink-muted)" }} />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tables..."
                  className="pl-8 h-8 text-xs"
                />
              </div>

              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="h-8 rounded-md px-2.5 text-xs focus:outline-none focus:ring-1"
                style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }}
              >
                <option value="all">All Sources</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>

              <select
                value={layerFilter}
                onChange={(e) => setLayerFilter(e.target.value as LayerFilter)}
                className="h-8 rounded-md px-2.5 text-xs focus:outline-none focus:ring-1"
                style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)", color: "var(--bp-ink-primary)" }}
              >
                <option value="all">All Statuses</option>
                <option value="missing_lz">Missing LZ</option>
                <option value="missing_bronze">Missing Bronze</option>
                <option value="missing_silver">Missing Silver</option>
                <option value="missing_any">Missing Any Layer</option>
                <option value="complete">Complete</option>
              </select>

              <div className="flex w-full flex-wrap items-center gap-1 md:ml-auto md:w-auto md:justify-end">
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={selectAllFiltered}>
                  Select Filtered
                </Button>
                <Button
                  variant="outline" size="sm" className="text-xs h-7"
                  style={{ color: "var(--bp-fault)", borderColor: "rgba(185,58,42,0.3)" }}
                  onClick={() => selectMissingLayer("lz")}
                >
                  All Missing LZ
                </Button>
                <Button
                  variant="outline" size="sm" className="text-xs h-7"
                  style={{ color: "var(--bp-caution)", borderColor: "rgba(194,122,26,0.3)" }}
                  onClick={() => selectMissingLayer("bronze")}
                >
                  All Missing Bronze
                </Button>
                <Button
                  variant="outline" size="sm" className="text-xs h-7"
                  style={{ color: "var(--bp-ink-muted)", borderColor: "var(--bp-border)" }}
                  onClick={() => selectMissingLayer("silver")}
                >
                  All Missing Silver
                </Button>
              </div>
            </div>

            {/* Launch result banner */}
            {launchResult && (
              <div
                className="text-xs px-3 py-2 rounded-md"
                style={launchResult.startsWith("Failed")
                  ? { background: "var(--bp-fault-light)", color: "var(--bp-fault)" }
                  : { background: "var(--bp-operational-light)", color: "var(--bp-operational)" }
                }
              >
                {launchResult}
              </div>
            )}

            <div className="lg:hidden">
              <TableCardList
                items={visibleEntities}
                getId={(row) => row.rowKey}
                getTitle={(row) => row.entity.SourceName || "(empty)"}
                getSubtitle={(row) => `${row.entity.SourceSchema || "—"} · ${row.entity.DataSource}`}
                getStats={(row) => [
                  { label: "LZ", value: layerCellStatus(num(row.entity.LzStatus)) === "pass" ? "Ready" : "Missing" },
                  { label: "Bronze", value: layerCellStatus(num(row.entity.BronzeStatus)) === "pass" ? "Ready" : "Missing" },
                  { label: "Silver", value: layerCellStatus(num(row.entity.SilverStatus)) === "pass" ? "Ready" : "Missing" },
                  { label: "Selected", value: selected.has(num(row.entity.EntityId)) ? "Yes" : "No" },
                ]}
                onCardClick={(row) => toggleSelect(num(row.entity.EntityId))}
                expandedItemId={mobileExpandedEntityId}
                onExpandedItemChange={(itemId) => setMobileExpandedEntityId(itemId)}
                renderExpanded={(row) => {
                  const id = num(row.entity.EntityId);
                  const missingLayers: string[] = [];
                  if (num(row.entity.LzStatus) !== 1) missingLayers.push("Landing");
                  if (num(row.entity.BronzeStatus) !== 1) missingLayers.push("Bronze");
                  if (num(row.entity.SilverStatus) !== 1) missingLayers.push("Silver");
                  return (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-2 text-[11px]">
                        <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                          Entity ID: <strong>{id}</strong>
                        </span>
                        <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                          Load Type: <strong>{num(row.entity.IsIncremental) ? "Incremental" : "Full"}</strong>
                        </span>
                        <span className="rounded-full border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-3 py-1.5">
                          Missing: <strong>{missingLayers.length ? missingLayers.join(", ") : "None"}</strong>
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => toggleSelect(id)}>
                          {selected.has(id) ? "Deselect entity" : "Select entity"}
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setSelected(new Set([id]));
                            void launchEntities([id]);
                          }}
                          disabled={launching}
                        >
                          {launching ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Play className="mr-1.5 h-3 w-3" />}
                          Run this entity
                        </Button>
                      </div>
                    </div>
                  );
                }}
                emptyState={
                  <div className="rounded-xl border border-[var(--bp-border)] bg-[var(--bp-surface-1)] px-4 py-10 text-center">
                    <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-[var(--bp-ink-muted)]/20" />
                    <p className="text-sm text-[var(--bp-ink-muted)]">No entities match the current filters</p>
                  </div>
                }
              />
              {filteredEntities.length > 200 && (
                <div className="mt-3 text-center text-xs" style={{ color: "var(--bp-ink-muted)" }}>
                  Showing 200 of {filteredEntities.length}. Use filters to narrow the list before acting.
                </div>
              )}
            </div>

            {/* Table */}
            <div className="hidden rounded-md overflow-hidden lg:block" style={{ border: "1px solid var(--bp-border)" }}>
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0" style={{ background: "var(--bp-surface-2)" }}>
                    <tr>
                      <th className="px-2 py-2 text-left w-8">
                        <input
                          type="checkbox"
                          checked={filteredEntities.length > 0 && filteredEntities.every(e => selected.has(num(e.EntityId)))}
                          onChange={(e) => {
                            if (e.target.checked) selectAllFiltered();
                            else {
                              setSelected(prev => {
                                const next = new Set(prev);
                                filteredEntities.forEach(r => next.delete(num(r.EntityId)));
                                return next;
                              });
                            }
                          }}
                          className="rounded"
                        />
                      </th>
                      <th className="px-2 py-2 text-left font-medium w-14" style={{ color: "var(--bp-ink-tertiary)" }}>ID</th>
                      <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>Entity</th>
                      <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>Schema</th>
                      <th className="px-2 py-2 text-left font-medium" style={{ color: "var(--bp-ink-tertiary)" }}>Source</th>
                      <th className="px-2 py-2 text-center font-medium w-16" style={{ color: "var(--bp-ink-tertiary)" }}>LZ</th>
                      <th className="px-2 py-2 text-center font-medium w-16" style={{ color: "var(--bp-ink-tertiary)" }}>Bronze</th>
                      <th className="px-2 py-2 text-center font-medium w-16" style={{ color: "var(--bp-ink-tertiary)" }}>Silver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: "var(--bp-border-subtle)" }}>
                    {visibleEntities.map(({ entity: e, rowKey }) => {
                      const id = num(e.EntityId);
                      const isSelected = selected.has(id);
                      return (
                        <tr
                          key={rowKey}
                          onClick={() => toggleSelect(id)}
                          className="cursor-pointer transition-colors"
                          style={isSelected ? { background: "var(--bp-copper-light)" } : {}}
                          onMouseEnter={(ev) => { if (!isSelected) (ev.currentTarget as HTMLElement).style.background = "var(--bp-surface-2)"; }}
                          onMouseLeave={(ev) => { if (!isSelected) (ev.currentTarget as HTMLElement).style.background = ""; }}
                        >
                          <td className="px-2 py-1.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(id)}
                              onClick={(ev) => ev.stopPropagation()}
                              className="rounded"
                            />
                          </td>
                          <td className="px-2 py-1.5" style={{ fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--bp-ink-muted)" }}>{id}</td>
                          <td className="px-2 py-1.5 font-medium truncate max-w-[200px]" style={{ color: "var(--bp-ink-primary)" }}>
                            {e.SourceName || "(empty)"}
                          </td>
                          <td className="px-2 py-1.5" style={{ color: "var(--bp-ink-tertiary)" }}>{e.SourceSchema || "\u2014"}</td>
                          <td className="px-2 py-1.5" style={{ color: "var(--bp-ink-tertiary)" }}>{e.DataSource}</td>
                          <td className="px-2 py-1.5 text-center">
                            {statusIcon(layerCellStatus(num(e.LzStatus)), "sm")}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {statusIcon(layerCellStatus(num(e.BronzeStatus)), "sm")}
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            {statusIcon(layerCellStatus(num(e.SilverStatus)), "sm")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredEntities.length > 200 && (
                <div className="text-xs text-center py-2" style={{ color: "var(--bp-ink-muted)", background: "var(--bp-surface-inset)", borderTop: "1px solid var(--bp-border)" }}>
                  Showing 200 of {filteredEntities.length} — use filters to narrow results
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}

// ── Sub-components ──

function VLayerBadge({ label, loaded, total }: { label: string; loaded: number; total: number }) {
  const ratio = total > 0 ? loaded / total : 0;
  const style = ratio >= 1
    ? { background: "var(--bp-operational-light)", color: "var(--bp-operational)", border: "1px solid rgba(61,124,79,0.3)" }
    : ratio > 0
    ? { background: "var(--bp-caution-light)", color: "var(--bp-caution)", border: "1px solid rgba(194,122,26,0.3)" }
    : { background: "var(--bp-fault-light)", color: "var(--bp-fault)", border: "1px solid rgba(185,58,42,0.3)" };
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ ...style, fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums" }}>
      {label} {loaded}/{total}
    </span>
  );
}

function LayerDetail({ layer, loaded, failed, neverAttempted, total }: {
  layer: string; loaded: number; failed: number; neverAttempted: number; total: number;
}) {
  const check = layerCheck(loaded, total);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {statusIcon(check)}
        <span className="text-xs font-medium" style={{ color: "var(--bp-ink-primary)" }}>{layer}</span>
      </div>
      <div className="space-y-0.5 text-xs pl-6" style={{ color: "var(--bp-ink-tertiary)" }}>
        <div className="flex justify-between"><span>Loaded</span><span style={{ fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--bp-operational)" }}>{loaded}</span></div>
        <div className="flex justify-between"><span>Failed</span><span style={{ fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--bp-caution)" }}>{failed}</span></div>
        <div className="flex justify-between"><span>Never attempted</span><span style={{ fontFamily: "var(--bp-font-mono)", fontVariantNumeric: "tabular-nums", color: "var(--bp-fault)" }}>{neverAttempted}</span></div>
        <div className="w-full h-1.5 rounded-full overflow-hidden mt-1" style={{ background: "var(--bp-surface-inset)" }}>
          <div className="h-full transition-all duration-700" style={{ width: total > 0 ? `${(loaded / total) * 100}%` : "0%", background: "var(--bp-operational)" }} />
        </div>
      </div>
    </div>
  );
}

