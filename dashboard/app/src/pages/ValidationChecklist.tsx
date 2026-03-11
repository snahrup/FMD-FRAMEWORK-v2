import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  Database, Layers, ClipboardCheck, ChevronDown, ChevronUp,
  Play, Search, Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
    case "pass": return <CheckCircle2 className={cn(cls, "text-emerald-500 shrink-0")} />;
    case "warn": return <AlertTriangle className={cn(cls, "text-amber-500 shrink-0")} />;
    case "fail": return <XCircle className={cn(cls, "text-red-500 shrink-0")} />;
    case "pending": return <Loader2 className={cn(cls, "text-muted-foreground animate-spin shrink-0")} />;
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

  // Launch engine run for selected entities
  const handleLaunchSelected = async () => {
    if (selected.size === 0) return;
    setLaunching(true);
    setLaunchResult(null);
    try {
      const result = await postJson<{ run_id: string; status: string }>("/engine/start", {
        layers: ["landing", "bronze", "silver"],
        mode: "run",
        entity_ids: Array.from(selected),
      });
      setLaunchResult(`Run started: ${result.run_id} (${selected.size} entities)`);
      setSelected(new Set());
    } catch (err) {
      setLaunchResult(`Failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setLaunching(false);
    }
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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-3 text-muted-foreground">Loading validation data...</span>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <XCircle className="h-8 w-8 text-red-500" />
        <span className="ml-3 text-red-400">{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2.5">
            <ClipboardCheck className="h-7 w-7 text-emerald-500" />
            Validation Checklist
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time entity load status across all layers — select missing entities and run them
          </p>
        </div>
        <div className="flex items-center gap-3">
          {refreshing && (
            <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Badge
            variant={overallStatus === "pass" ? "default" : overallStatus === "warn" ? "secondary" : "destructive"}
            className={cn(
              "text-xs",
              overallStatus === "pass" && "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
            )}
          >
            {overallStatus === "pass" ? "All Layers Complete"
              : overallStatus === "warn" ? "In Progress"
              : overallStatus === "fail" ? "Not Started"
              : "Loading..."}
          </Badge>
        </div>
      </div>

      {/* ── Summary Cards ── */}
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard
            label="Total Active"
            value={totals.active}
            sub={`of ${totals.entities} registered`}
            icon={<Database className="h-4 w-4 text-blue-400" />}
          />
          <SummaryCard
            label="Landing Zone"
            value={totals.lzLoaded}
            sub={pct(totals.lzLoaded, totals.active) + " loaded"}
            status={layerCheck(totals.lzLoaded, totals.active)}
            icon={<Layers className="h-4 w-4 text-cyan-400" />}
          />
          <SummaryCard
            label="Bronze"
            value={totals.bronzeLoaded}
            sub={pct(totals.bronzeLoaded, totals.active) + " loaded"}
            status={layerCheck(totals.bronzeLoaded, totals.active)}
            icon={<Layers className="h-4 w-4 text-amber-400" />}
          />
          <SummaryCard
            label="Silver"
            value={totals.silverLoaded}
            sub={pct(totals.silverLoaded, totals.active) + " loaded"}
            status={layerCheck(totals.silverLoaded, totals.active)}
            icon={<Layers className="h-4 w-4 text-slate-300" />}
          />
        </div>
      )}

      {/* ── Overall Progress Bar ── */}
      {totals && totals.active > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4 mb-2">
              <span className="text-sm font-medium text-foreground">Overall Progress</span>
              <span className="text-xs text-muted-foreground">
                {totals.digestComplete} complete / {totals.digestPartial} partial / {totals.digestNotStarted} not started
              </span>
            </div>
            <div className="w-full h-4 bg-muted rounded-full overflow-hidden flex">
              {totals.digestComplete > 0 && (
                <div
                  className="h-full bg-emerald-500 transition-all duration-700"
                  style={{ width: pct(totals.digestComplete, totals.active) }}
                  title={`Complete: ${totals.digestComplete}`}
                />
              )}
              {totals.digestPartial > 0 && (
                <div
                  className="h-full bg-amber-500 transition-all duration-700"
                  style={{ width: pct(totals.digestPartial, totals.active) }}
                  title={`Partial: ${totals.digestPartial}`}
                />
              )}
              {totals.digestNotStarted > 0 && (
                <div
                  className="h-full bg-red-500/60 transition-all duration-700"
                  style={{ width: pct(totals.digestNotStarted, totals.active) }}
                  title={`Not Started: ${totals.digestNotStarted}`}
                />
              )}
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Complete</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Partial</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500/60 inline-block" /> Not Started</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Per-Source Checklist ── */}
      {data && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Source System Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y divide-border">
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
                      className="w-full flex items-center gap-3 py-3 px-1 hover:bg-muted/50 transition-colors text-left"
                    >
                      {statusIcon(
                        lzS === "pass" && brS === "pass" && svS === "pass"
                          ? "pass" : lzLoaded > 0 ? "warn" : "fail"
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-foreground">{dsName}</span>
                        <span className="text-xs text-muted-foreground ml-2">{active} active</span>
                      </div>
                      <div className="hidden md:flex items-center gap-2">
                        <LayerBadge label="LZ" loaded={lzLoaded} total={active} />
                        <LayerBadge label="BR" loaded={brLoaded} total={active} />
                        <LayerBadge label="SV" loaded={svLoaded} total={active} />
                      </div>
                      {isExpanded
                        ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        : <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      }
                    </button>
                    {isExpanded && (
                      <div className="pb-4 pl-10 pr-4 space-y-3">
                        <div className="grid grid-cols-3 gap-4">
                          <LayerDetail layer="Landing Zone" loaded={lzLoaded} failed={num(lz?.LzFailed)} neverAttempted={num(lz?.LzNeverAttempted)} total={active} />
                          <LayerDetail layer="Bronze" loaded={brLoaded} failed={num(br?.BronzeFailed)} neverAttempted={num(br?.BronzeNeverAttempted)} total={active} />
                          <LayerDetail layer="Silver" loaded={svLoaded} failed={num(sv?.SilverFailed)} neverAttempted={num(sv?.SilverNeverAttempted)} total={active} />
                        </div>
                        {stuckCount > 0 && (
                          <div className="flex items-center gap-2 text-xs text-amber-400">
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
              <CardTitle className="text-base flex items-center gap-2">
                <Filter className="h-4 w-4 text-primary" />
                Entity Layer Status
                <span className="text-xs font-normal text-muted-foreground ml-1">
                  {filteredEntities.length} of {data.entities.length}
                </span>
              </CardTitle>
              <div className="flex items-center gap-2">
                {selected.size > 0 && (
                  <>
                    <span className="text-xs text-muted-foreground">{selected.size} selected</span>
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
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
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
                className="h-8 rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Sources</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>

              <select
                value={layerFilter}
                onChange={(e) => setLayerFilter(e.target.value as LayerFilter)}
                className="h-8 rounded-md border border-input bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Statuses</option>
                <option value="missing_lz">Missing LZ</option>
                <option value="missing_bronze">Missing Bronze</option>
                <option value="missing_silver">Missing Silver</option>
                <option value="missing_any">Missing Any Layer</option>
                <option value="complete">Complete</option>
              </select>

              <div className="flex items-center gap-1 ml-auto">
                <Button variant="outline" size="sm" className="text-xs h-7" onClick={selectAllFiltered}>
                  Select Filtered
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7 text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={() => selectMissingLayer("lz")}>
                  All Missing LZ
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7 text-amber-400 border-amber-500/30 hover:bg-amber-500/10" onClick={() => selectMissingLayer("bronze")}>
                  All Missing Bronze
                </Button>
                <Button variant="outline" size="sm" className="text-xs h-7 text-slate-300 border-slate-400/30 hover:bg-slate-500/10" onClick={() => selectMissingLayer("silver")}>
                  All Missing Silver
                </Button>
              </div>
            </div>

            {/* Launch result banner */}
            {launchResult && (
              <div className={cn(
                "text-xs px-3 py-2 rounded-md",
                launchResult.startsWith("Failed") ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400",
              )}>
                {launchResult}
              </div>
            )}

            {/* Table */}
            <div className="rounded-md border border-border overflow-hidden">
              <div className="max-h-[500px] overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 sticky top-0">
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
                      <th className="px-2 py-2 text-left text-muted-foreground font-medium w-14">ID</th>
                      <th className="px-2 py-2 text-left text-muted-foreground font-medium">Entity</th>
                      <th className="px-2 py-2 text-left text-muted-foreground font-medium">Schema</th>
                      <th className="px-2 py-2 text-left text-muted-foreground font-medium">Source</th>
                      <th className="px-2 py-2 text-center text-muted-foreground font-medium w-16">LZ</th>
                      <th className="px-2 py-2 text-center text-muted-foreground font-medium w-16">Bronze</th>
                      <th className="px-2 py-2 text-center text-muted-foreground font-medium w-16">Silver</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredEntities.slice(0, 200).map((e) => {
                      const id = num(e.EntityId);
                      const isSelected = selected.has(id);
                      return (
                        <tr
                          key={id}
                          onClick={() => toggleSelect(id)}
                          className={cn(
                            "cursor-pointer transition-colors",
                            isSelected ? "bg-primary/5" : "hover:bg-muted/50",
                          )}
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
                          <td className="px-2 py-1.5 font-mono text-muted-foreground">{id}</td>
                          <td className="px-2 py-1.5 font-medium text-foreground truncate max-w-[200px]">
                            {e.SourceName || "(empty)"}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">{e.SourceSchema || "—"}</td>
                          <td className="px-2 py-1.5 text-muted-foreground">{e.DataSource}</td>
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
                <div className="text-xs text-muted-foreground text-center py-2 border-t border-border bg-muted">
                  Showing 200 of {filteredEntities.length} — use filters to narrow results
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Pre-Run Checklist ── */}
      {totals && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Checklist</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y divide-border">
              <CheckItem
                status={totals.active > 0 ? "pass" : "fail"}
                label="Entity registration"
                detail={`${totals.active} active entities across ${data?.overview.length || 0} sources`}
              />
              <CheckItem
                status={totals.lzNever === 0 && totals.lzFailed === 0 ? "pass" : totals.lzLoaded > 0 ? "warn" : "fail"}
                label="Landing Zone loads"
                detail={`${totals.lzLoaded} loaded, ${totals.lzFailed} pending, ${totals.lzNever} never attempted`}
              />
              <CheckItem
                status={totals.stuckAtLz === 0 ? "pass" : "warn"}
                label="LZ to Bronze pipeline"
                detail={totals.stuckAtLz === 0
                  ? "All LZ entities processed through Bronze"
                  : `${totals.stuckAtLz} stuck at LZ`
                }
              />
              <CheckItem
                status={totals.bronzeLoaded === totals.active ? "pass" : totals.bronzeLoaded > 0 ? "warn" : "fail"}
                label="Bronze layer"
                detail={`${totals.bronzeLoaded}/${totals.active} entities`}
              />
              <CheckItem
                status={totals.silverLoaded === totals.active ? "pass" : totals.silverLoaded > 0 ? "warn" : "fail"}
                label="Silver layer"
                detail={`${totals.silverLoaded}/${totals.active} entities`}
              />
              <CheckItem
                status={totals.digestComplete === totals.active ? "pass" : totals.digestComplete > 0 ? "warn" : "fail"}
                label="End-to-end complete"
                detail={`${totals.digestComplete}/${totals.active} entities`}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Sub-components ──

function SummaryCard({ label, value, sub, icon, status }: {
  label: string; value: number; sub: string; icon: React.ReactNode; status?: CheckStatus;
}) {
  return (
    <Card className={cn(
      "transition-colors",
      status === "pass" && "border-emerald-500/30",
      status === "fail" && "border-red-500/30",
    )}>
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            {icon} {label}
          </span>
          {status && statusIcon(status)}
        </div>
        <div className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
      </CardContent>
    </Card>
  );
}

function LayerBadge({ label, loaded, total }: { label: string; loaded: number; total: number }) {
  const ratio = total > 0 ? loaded / total : 0;
  const color = ratio >= 1 ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
    : ratio > 0 ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
    : "bg-red-500/20 text-red-400 border-red-500/30";
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-mono", color)}>
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
        <span className="text-xs font-medium">{layer}</span>
      </div>
      <div className="space-y-0.5 text-xs text-muted-foreground pl-6">
        <div className="flex justify-between"><span>Loaded</span><span className="font-mono text-emerald-400">{loaded}</span></div>
        <div className="flex justify-between"><span>Pending</span><span className="font-mono text-amber-400">{failed}</span></div>
        <div className="flex justify-between"><span>Never attempted</span><span className="font-mono text-red-400">{neverAttempted}</span></div>
        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden mt-1">
          <div className="h-full bg-emerald-500 transition-all duration-700" style={{ width: total > 0 ? `${(loaded / total) * 100}%` : "0%" }} />
        </div>
      </div>
    </div>
  );
}

function CheckItem({ status, label, detail }: { status: CheckStatus; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      {statusIcon(status)}
      <div className="flex-1 min-w-0"><span className="text-sm font-medium text-foreground">{label}</span></div>
      <span className={cn("text-xs", status === "pass" ? "text-muted-foreground" : status === "warn" ? "text-amber-400" : "text-red-400")}>
        {detail}
      </span>
    </div>
  );
}
