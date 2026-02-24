import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Rows3, Columns3, ShieldCheck, Clock, ArrowUpDown,
  ExternalLink, Loader2, AlertTriangle, Zap,
} from 'lucide-react';
import { getTableProfile, formatNumber, mockTables } from '@/data/blenderMockData';
import type { LiveTableProfile } from '@/types/blender';

interface TableProfilerProps {
  tableId: string;
}

type SortKey = 'name' | 'dataType' | 'nullPercentage' | 'distinctCount' | 'completeness';

export function TableProfiler({ tableId }: TableProfilerProps) {
  const [liveProfile, setLiveProfile] = useState<LiveTableProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLive, setIsLive] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);
  const [purviewEntity, setPurviewEntity] = useState<Record<string, string> | null>(null);

  const tableInfo = mockTables.find(t => t.id === tableId);

  useEffect(() => {
    loadProfile();
  }, [tableId]);

  async function loadProfile() {
    setLoading(true);
    setIsLive(false);
    setLiveProfile(null);

    let lakehouse = '', schema = 'dbo', tableName = '';

    if (tableId.startsWith('lh-')) {
      const rest = tableId.replace('lh-', '');
      const lastDash = rest.lastIndexOf('-');
      const secondLastDash = rest.lastIndexOf('-', lastDash - 1);
      tableName = rest.substring(lastDash + 1);
      schema = rest.substring(secondLastDash + 1, lastDash);
      lakehouse = rest.substring(0, secondLastDash);
    } else if (tableInfo) {
      lakehouse = tableInfo.lakehouse;
      schema = tableInfo.schema;
      tableName = tableInfo.name;
    }

    if (lakehouse && tableName) {
      try {
        const resp = await fetch(
          `/api/blender/profile?lakehouse=${encodeURIComponent(lakehouse)}&schema=${encodeURIComponent(schema)}&table=${encodeURIComponent(tableName)}`
        );
        if (resp.ok) {
          const data: LiveTableProfile = await resp.json();
          if (!data.error && data.columns && data.columns.length > 0) {
            setLiveProfile(data);
            setIsLive(true);
            fetchPurview(tableName);
            setLoading(false);
            return;
          }
        }
      } catch {
        // Fall through to mock
      }
    }

    fetchPurview(tableName || tableInfo?.name || '');
    setLoading(false);
  }

  async function fetchPurview(name: string) {
    if (!name) return;
    try {
      const resp = await fetch(`/api/purview/search?q=${encodeURIComponent(name)}`);
      if (resp.ok) {
        const results = await resp.json();
        if (results.length > 0) setPurviewEntity(results[0]);
      }
    } catch { /* Purview not available */ }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        <span className="text-sm">Profiling table...</span>
      </div>
    );
  }

  // Live profile mode
  if (isLive && liveProfile) {
    return <LiveProfileView profile={liveProfile} purviewEntity={purviewEntity} />;
  }

  // No live profile available — show empty state
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 px-8 text-center">
      <AlertTriangle className="w-8 h-8 opacity-20" />
      <p className="text-sm font-medium text-foreground/60">No profile data available</p>
      <p className="text-xs leading-relaxed">
        The API server could not retrieve column-level profiling for this table.
        Ensure the API is running and the lakehouse SQL endpoint is accessible.
      </p>
    </div>
  );
}


// ── Live Profile View (real data from lakehouse SQL endpoints) ──

function LiveProfileView({ profile, purviewEntity }: {
  profile: LiveTableProfile;
  purviewEntity: Record<string, string> | null;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortAsc, setSortAsc] = useState(true);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const avgCompleteness = profile.columns.length > 0
    ? Math.round(profile.columns.reduce((sum, c) => sum + (c.completeness ?? (100 - c.nullPercentage)), 0) / profile.columns.length)
    : 100;

  // Identify garbage signals — this is what Patrick wants to see
  const garbageSignals: string[] = [];
  for (const col of profile.columns) {
    if (col.nullPercentage > 50) garbageSignals.push(`${col.name}: ${col.nullPercentage}% nulls`);
    if (col.distinctCount === 1 && profile.rowCount > 10) garbageSignals.push(`${col.name}: single value (constant column)`);
    if (col.distinctCount === profile.rowCount && profile.rowCount > 1 && col.dataType?.toLowerCase().includes('char'))
      garbageSignals.push(`${col.name}: every value unique — potential free-text garbage`);
  }

  const sorted = [...profile.columns].sort((a, b) => {
    let cmp = 0;
    switch (sortKey) {
      case 'name': cmp = a.name.localeCompare(b.name); break;
      case 'dataType': cmp = a.dataType.localeCompare(b.dataType); break;
      case 'nullPercentage': cmp = a.nullPercentage - b.nullPercentage; break;
      case 'distinctCount': cmp = a.distinctCount - b.distinctCount; break;
      case 'completeness': cmp = (a.completeness ?? 0) - (b.completeness ?? 0); break;
    }
    return sortAsc ? cmp : -cmp;
  });

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-display font-semibold">{profile.table}</h2>
            <Badge variant="default" className="text-[9px] gap-1">
              <Zap className="h-2.5 w-2.5" /> Live
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {profile.lakehouse} &middot; {profile.schema}
          </p>
        </div>
        {purviewEntity && (
          <a className="flex items-center gap-1 text-[10px] text-primary hover:underline" href="#" title="View in Purview">
            <ExternalLink className="h-3 w-3" /> Purview
          </a>
        )}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={Rows3} label="Rows" value={formatNumber(profile.rowCount)} />
        <StatCard icon={Columns3} label="Columns" value={String(profile.columnCount)} />
        <StatCard icon={ShieldCheck} label="Completeness"
          value={`${avgCompleteness}%`}
          valueClass={avgCompleteness < 80 ? 'text-destructive' : avgCompleteness < 95 ? 'text-warning' : ''}
        />
        <StatCard icon={AlertTriangle} label="Warnings"
          value={String(garbageSignals.length)}
          valueClass={garbageSignals.length > 0 ? 'text-warning' : ''}
        />
      </div>

      {/* Garbage warnings panel */}
      {garbageSignals.length > 0 && (
        <div className="border border-warning/30 bg-warning/5 rounded-[var(--radius-lg)] p-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            <span className="text-xs font-medium text-warning">Data Quality Warnings</span>
          </div>
          <ul className="space-y-1">
            {garbageSignals.slice(0, 10).map((sig, i) => (
              <li key={i} className="text-[11px] text-muted-foreground font-mono">{sig}</li>
            ))}
            {garbageSignals.length > 10 && (
              <li className="text-[11px] text-muted-foreground">...and {garbageSignals.length - 10} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Column table with min/max */}
      <div className="border border-border rounded-[var(--radius-lg)] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/50 border-b border-border">
              <SortHeader label="Column" sortKey="name" currentKey={sortKey} onSort={handleSort} />
              <SortHeader label="Type" sortKey="dataType" currentKey={sortKey} onSort={handleSort} />
              <SortHeader label="Distinct" sortKey="distinctCount" currentKey={sortKey} onSort={handleSort} align="right" />
              <SortHeader label="Nulls" sortKey="nullPercentage" currentKey={sortKey} onSort={handleSort} align="right" />
              <th className="text-left px-3 py-2 font-medium">Min</th>
              <th className="text-left px-3 py-2 font-medium">Max</th>
              <SortHeader label="Quality" sortKey="completeness" currentKey={sortKey} onSort={handleSort} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((col, i) => (
              <tr key={col.name} className={`${i % 2 === 0 ? '' : 'bg-muted/20'} ${col.nullPercentage > 50 ? 'bg-destructive/5' : ''}`}>
                <td className="px-3 py-1.5 font-mono font-medium">{col.name}</td>
                <td className="px-3 py-1.5 text-muted-foreground">{col.dataType}</td>
                <td className="px-3 py-1.5 text-right font-mono">{formatNumber(col.distinctCount)}</td>
                <td className={`px-3 py-1.5 text-right font-mono ${col.nullPercentage > 20 ? 'text-warning' : ''} ${col.nullPercentage > 50 ? 'text-destructive font-bold' : ''}`}>
                  {col.nullPercentage.toFixed(1)}%
                </td>
                <td className="px-3 py-1.5 text-[10px] font-mono text-muted-foreground truncate max-w-[120px]" title={col.minValue ?? ''}>
                  {col.minValue ?? '—'}
                </td>
                <td className="px-3 py-1.5 text-[10px] font-mono text-muted-foreground truncate max-w-[120px]" title={col.maxValue ?? ''}>
                  {col.maxValue ?? '—'}
                </td>
                <td className="px-3 py-1.5"><QualityBar nullPct={col.nullPercentage} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ── Shared Components ──

function StatCard({ icon: Icon, label, value, valueClass }: {
  icon: typeof Rows3; label: string; value: string; valueClass?: string;
}) {
  return (
    <Card className="hover:shadow-none">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-[10px] uppercase tracking-wider">{label}</span>
        </div>
        <span className={`text-lg font-semibold font-mono ${valueClass || ''}`}>{value}</span>
      </CardContent>
    </Card>
  );
}

function SortHeader({ label, sortKey, currentKey, onSort, align }: {
  label: string; sortKey: SortKey; currentKey: SortKey;
  onSort: (key: SortKey) => void; align?: 'right';
}) {
  return (
    <th
      className={`${align === 'right' ? 'text-right' : 'text-left'} px-3 py-2 font-medium cursor-pointer hover:text-primary`}
      onClick={() => onSort(sortKey)}
    >
      <span className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
        {label} {currentKey === sortKey && <ArrowUpDown className="h-3 w-3" />}
      </span>
    </th>
  );
}

function QualityBar({ nullPct }: { nullPct: number }) {
  const quality = Math.max(0, 100 - nullPct);
  const color = quality >= 95 ? 'bg-success' : quality >= 80 ? 'bg-warning' : 'bg-destructive';
  return (
    <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${quality}%` }} />
    </div>
  );
}
