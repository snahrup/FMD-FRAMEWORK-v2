import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Key, Loader2, ChevronRight, Rows3, Columns3, RefreshCw, Cloud } from 'lucide-react';
import type { SelectedTable, TableInfo, TablePreview } from '@/types/sqlExplorer';

interface TableDetailProps {
  table: SelectedTable;
}

export function TableDetail({ table }: TableDetailProps) {
  const [activeTab, setActiveTab] = useState<'columns' | 'data'>('columns');
  const [colInfo, setColInfo] = useState<TableInfo | null>(null);
  const [preview, setPreview] = useState<TablePreview | null>(null);
  const [colLoading, setColLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [colError, setColError] = useState<string | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);

  const isLakehouse = table.type === 'lakehouse';

  function buildUrl(endpoint: string, extra = '') {
    if (isLakehouse) {
      const lhQs = `lakehouse=${encodeURIComponent(table.database)}&schema=${encodeURIComponent(table.schema)}&table=${encodeURIComponent(table.table)}`;
      return `/api/sql-explorer/lakehouse-${endpoint}?${lhQs}${extra}`;
    }
    const qs = `server=${encodeURIComponent(table.server)}&database=${encodeURIComponent(table.database)}&schema=${encodeURIComponent(table.schema)}&table=${encodeURIComponent(table.table)}`;
    return `/api/sql-explorer/${endpoint}?${qs}${extra}`;
  }

  useEffect(() => {
    setColInfo(null);
    setPreview(null);
    setActiveTab('columns');
    setColError(null);
    setDataError(null);
    fetchColumns();
  }, [table.server, table.database, table.schema, table.table]);

  useEffect(() => {
    if (activeTab === 'data' && !preview && !dataLoading) {
      fetchPreview();
    }
  }, [activeTab]);

  async function fetchColumns() {
    setColLoading(true);
    setColError(null);
    try {
      const resp = await fetch(buildUrl('columns'));
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      setColInfo(await resp.json());
    } catch (e: any) {
      setColError(e.message || 'Failed to load columns');
    } finally {
      setColLoading(false);
    }
  }

  async function fetchPreview() {
    setDataLoading(true);
    setDataError(null);
    try {
      const resp = await fetch(buildUrl('preview', '&limit=500'));
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      setPreview(await resp.json());
    } catch (e: any) {
      setDataError(e.message || 'Failed to load preview');
    } finally {
      setDataLoading(false);
    }
  }

  const tabs = [
    { id: 'columns' as const, label: 'Columns', icon: Columns3, count: colInfo?.columns.length },
    { id: 'data' as const, label: 'Data', icon: Rows3, count: preview?.rowCount },
  ];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn(
            "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border flex-shrink-0",
            isLakehouse
              ? "border-emerald-500/20 text-emerald-500 bg-emerald-500/5"
              : "border-primary/20 text-primary bg-primary/5"
          )}>
            {isLakehouse ? 'Fabric' : 'Read-Only'}
          </span>
          <nav className="flex items-center gap-1 text-[13px] min-w-0">
            {isLakehouse ? (
              <>
                <Cloud className="h-3.5 w-3.5 text-emerald-500/60 flex-shrink-0" />
                <span className="text-muted-foreground">{table.database}</span>
                <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/30" />
              </>
            ) : (
              <>
                <span className="text-muted-foreground/60">{table.server}</span>
                <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/30" />
                <span className="text-muted-foreground">{table.database}</span>
                <ChevronRight className="h-3 w-3 flex-shrink-0 text-muted-foreground/30" />
              </>
            )}
            <span className="font-medium text-foreground truncate">
              <span className="text-muted-foreground">{table.schema}</span>
              <span className="text-muted-foreground/40">.</span>
              {table.table}
            </span>
          </nav>
        </div>
        {colInfo && colInfo.rowCount >= 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-border text-[11px] font-mono text-muted-foreground flex-shrink-0">
            <Rows3 className="h-3 w-3 text-muted-foreground/60" />
            {colInfo.rowCount.toLocaleString()} rows
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 px-5 border-b border-border bg-muted">
        {tabs.map(tab => {
          const active = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium transition-colors cursor-pointer",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground/80"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
              {tab.count !== undefined && (
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded font-mono",
                  active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                )}>
                  {tab.count}
                </span>
              )}
              {active && (
                <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full bg-primary" />
              )}
            </button>
          );
        })}
        <button
          onClick={() => { if (activeTab === 'columns') fetchColumns(); else fetchPreview(); }}
          className="ml-auto p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'columns' ? (
          <ColumnsTab info={colInfo} loading={colLoading} error={colError} />
        ) : (
          <DataTab preview={preview} loading={dataLoading} error={dataError} />
        )}
      </div>
    </div>
  );
}


/* ── Columns Tab ── */

function ColumnsTab({ info, loading, error }: {
  info: TableInfo | null; loading: boolean; error: string | null;
}) {
  if (loading) return <LoadingState text="Loading columns..." />;
  if (error) return <ErrorState text={error} />;
  if (!info) return null;

  return (
    <div className="overflow-auto h-full">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-muted/50 border-b border-border">
            <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Column</th>
            <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
            <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-14">PK</th>
            <th className="px-4 py-2.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-20">Nullable</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-24">Max Len</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-28">Default</th>
          </tr>
        </thead>
        <tbody>
          {info.columns.map((col) => {
            const isPk = col.IS_PK === '1';
            return (
              <tr
                key={col.COLUMN_NAME}
                className="border-b border-border/50 transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    {isPk && <Key className="h-3 w-3 flex-shrink-0 text-amber-500" />}
                    <span className={cn("font-medium", isPk ? "text-foreground" : "text-foreground/80")}>{col.COLUMN_NAME}</span>
                  </div>
                </td>
                <td className="px-4 py-2">
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono",
                    isPk ? "bg-amber-500/10 text-amber-500" : "bg-muted text-muted-foreground"
                  )}>
                    {col.DATA_TYPE}
                  </span>
                </td>
                <td className="px-4 py-2 text-center">
                  {isPk ? (
                    <span className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-500/10">
                      <Key className="h-2.5 w-2.5 text-amber-500" />
                    </span>
                  ) : (
                    <span className="text-muted-foreground/20">-</span>
                  )}
                </td>
                <td className="px-4 py-2 text-center text-xs">
                  {col.IS_NULLABLE === 'YES' ? (
                    <span className="text-muted-foreground">yes</span>
                  ) : (
                    <span className="font-medium text-foreground/70">no</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">
                  {col.CHARACTER_MAXIMUM_LENGTH && col.CHARACTER_MAXIMUM_LENGTH !== '-1'
                    ? col.CHARACTER_MAXIMUM_LENGTH
                    : col.CHARACTER_MAXIMUM_LENGTH === '-1'
                      ? <span className="text-foreground/60">MAX</span>
                      : <span className="opacity-20">-</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono text-[11px] text-muted-foreground max-w-[120px] truncate">
                  {col.COLUMN_DEFAULT
                    ? <span title={col.COLUMN_DEFAULT}>{col.COLUMN_DEFAULT}</span>
                    : <span className="opacity-20">-</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


/* ── Data Tab ── */

function DataTab({ preview, loading, error }: {
  preview: TablePreview | null; loading: boolean; error: string | null;
}) {
  if (loading) return <LoadingState text="Loading preview data..." />;
  if (error) return <ErrorState text={error} />;
  if (!preview) return <LoadingState text="Click to load data preview..." />;

  return (
    <div className="overflow-auto h-full flex flex-col">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm min-w-max">
          <thead className="sticky top-0 z-10">
            <tr className="bg-muted/50 border-b border-border">
              {/* Row number */}
              <th className="px-3 py-2.5 text-right text-[10px] font-mono font-normal text-muted-foreground/50 w-12 border-r border-border sticky left-0 z-20 bg-muted/50">
                #
              </th>
              {preview.columns.map((col, i) => (
                <th
                  key={col}
                  className={cn(
                    "px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap",
                    i < preview.columns.length - 1 && "border-r border-border/30"
                  )}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 transition-colors hover:bg-muted/50">
                {/* Row number */}
                <td className="px-3 py-1.5 text-right text-[11px] font-mono text-muted-foreground/30 select-none border-r border-border sticky left-0 z-10 bg-background">
                  {i + 1}
                </td>
                {preview.columns.map((col, ci) => {
                  const val = row[col];
                  const isNull = val === null || val === undefined;
                  return (
                    <td
                      key={col}
                      className={cn(
                        "px-3 py-1.5 whitespace-nowrap max-w-[300px] truncate",
                        ci < preview.columns.length - 1 && "border-r border-border/20"
                      )}
                      title={val ?? 'NULL'}
                    >
                      {isNull ? (
                        <span className="italic font-mono text-[11px] text-muted-foreground/40">NULL</span>
                      ) : (
                        <span className="font-mono text-[12px] text-foreground/70">{val}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            {preview.rows.length === 0 && (
              <tr>
                <td colSpan={preview.columns.length + 1} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No rows in this table
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* Sticky footer */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 text-[11px] text-muted-foreground border-t border-border bg-muted">
        <span>Showing {preview.rows.length} of {preview.rowCount} rows (limit {preview.limit})</span>
        <span className="font-mono">{preview.columns.length} columns</span>
      </div>
    </div>
  );
}


/* ── Shared states ── */

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      <span className="text-sm">{text}</span>
    </div>
  );
}

function ErrorState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-2">
      <div className="h-8 w-8 rounded-full flex items-center justify-center bg-destructive/10">
        <span className="text-sm text-destructive font-bold">!</span>
      </div>
      <span className="text-sm text-destructive">{text}</span>
    </div>
  );
}
