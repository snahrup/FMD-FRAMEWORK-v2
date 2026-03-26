import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ObjectTree } from '@/components/sql-explorer/ObjectTree';
import type { CheckedTable } from '@/components/sql-explorer/ObjectTree';
import { TableDetail } from '@/components/sql-explorer/TableDetail';
import {
  Database, Server, Table2, ArrowRight, Loader2, X,
  CheckCircle2, Rocket, AlertTriangle,
} from 'lucide-react';
import type { SelectedTable } from '@/types/sqlExplorer';

export default function SqlExplorer() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [selectedTable, setSelectedTable] = useState<SelectedTable | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const isResizing = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  // ── Table loading: multi-select state ──
  const [checkedTables, setCheckedTables] = useState<CheckedTable[]>([]);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadResult, setLoadResult] = useState<{
    count: number; errors: string[];
  } | null>(null);

  const initialSelection = useMemo<SelectedTable | null>(() => {
    const server = searchParams.get('server');
    const database = searchParams.get('database');
    const schema = searchParams.get('schema');
    const table = searchParams.get('table');
    if (server) {
      return { server, database: database || '', schema: schema || 'dbo', table: table || '', type: 'source' };
    }
    if (database) {
      return { server: database, database, schema: schema || 'dbo', table: table || '', type: 'lakehouse' };
    }
    return null;
  }, [searchParams]);

  useEffect(() => {
    return () => { cleanupRef.current?.(); };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidthRef.current;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = ev.clientX - startX;
      const newWidth = Math.max(220, Math.min(520, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      cleanupRef.current = null;
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    cleanupRef.current = onMouseUp;
  }, []);

  const handleToggleCheck = useCallback((t: CheckedTable) => {
    setCheckedTables(prev => {
      const exists = prev.some(
        c => c.server === t.server && c.database === t.database && c.schema === t.schema && c.table === t.table
      );
      if (exists) {
        return prev.filter(
          c => !(c.server === t.server && c.database === t.database && c.schema === t.schema && c.table === t.table)
        );
      }
      return [...prev, t];
    });
  }, []);

  // ── Load selected tables: register behind the scenes + start engine + redirect ──
  const handleLoad = useCallback(async () => {
    setLoading(true);
    setLoadResult(null);
    try {
      // Step 1: Register tables (invisible to user)
      const regResp = await fetch('/api/sql-explorer/register-tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: checkedTables }),
      });
      const regData = await regResp.json();
      if (!regResp.ok) throw new Error(regData.error || `Failed: ${regResp.status}`);

      const entityIds: number[] = (regData.registered || []).map((r: any) => r.entity_id).filter(Boolean);

      if (entityIds.length === 0) {
        setLoadResult({
          count: 0,
          errors: ['These tables are already loaded in the warehouse.'],
        });
        _refreshCheckedSchemas();
        setCheckedTables([]);
        setLoading(false);
        return;
      }

      // Step 2: Start engine run for just these tables
      const startResp = await fetch('/api/engine/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'run',
          layers: ['landing', 'bronze', 'silver'],
          entity_ids: entityIds,
          triggered_by: 'sql-explorer',
        }),
      });
      const startData = await startResp.json();

      if (!startResp.ok) {
        if (startResp.status === 409) {
          // Engine already running — tables are set up, they'll load on the next run
          setLoadResult({
            count: entityIds.length,
            errors: [`A load is already running. Your ${entityIds.length} table${entityIds.length !== 1 ? 's' : ''} will be included in the next run automatically.`],
          });
          _refreshCheckedSchemas();
          setCheckedTables([]);
          setLoading(false);
          return;
        }
        throw new Error(startData.error || `Load failed: ${startResp.status}`);
      }

      // Step 3: Redirect to Load Mission Control to watch progress
      const runId = startData.run_id;
      setShowConfirmDialog(false);
      setCheckedTables([]);
      navigate(`/load-mission-control${runId ? `?run=${runId}` : ''}`);
    } catch (err: any) {
      setLoadResult({ count: 0, errors: [err.message] });
    } finally {
      setLoading(false);
    }
  }, [checkedTables, navigate]);

  /** Refresh table data for schemas that had checked tables (updates "Loaded" badges) */
  function _refreshCheckedSchemas() {
    const refreshFn = (window as any).__objectTreeRefreshTables;
    if (!refreshFn) return;
    const schemas = new Set(checkedTables.map(t => `${t.server}|${t.database}|${t.schema}`));
    schemas.forEach(key => {
      const [srv, db, sch] = key.split('|');
      refreshFn(srv, db, sch);
    });
  }

  const groupedChecked = useMemo(() => {
    const groups: Record<string, CheckedTable[]> = {};
    for (const t of checkedTables) {
      const key = `${t.server} / ${t.database}`;
      (groups[key] ||= []).push(t);
    }
    return groups;
  }, [checkedTables]);

  return (
    <div className="gs-page-enter flex flex-col h-[calc(100vh-3rem)]" style={{ backgroundColor: "var(--bp-canvas)" }}>
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        <div
          className="flex-shrink-0 overflow-hidden flex flex-col"
          style={{ width: sidebarWidth, borderRight: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-2)" }}
        >
          <ObjectTree
            selectedTable={selectedTable}
            onSelectTable={setSelectedTable}
            initialSelection={initialSelection}
            checkedTables={checkedTables}
            onToggleCheck={handleToggleCheck}
          />
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleMouseDown}
          className="w-[3px] flex-shrink-0 cursor-col-resize transition-colors hover:bg-[var(--bp-border-strong)]"
          style={{ backgroundColor: "transparent" }}
          role="separator"
          aria-label="Resize sidebar"
          title="Drag to resize"
        />

        {/* Detail panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0" style={{ backgroundColor: "var(--bp-surface-1)" }}>
          {selectedTable ? (
            <TableDetail table={selectedTable} />
          ) : (
            <EmptyState />
          )}
        </div>

        {/* ── Floating Action Bar ── */}
        {checkedTables.length > 0 && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-5 py-3 rounded-xl z-50"
            style={{
              backgroundColor: "var(--bp-surface-1)",
              border: "1px solid var(--bp-border-strong)",
              boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
            }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
              {checkedTables.length} table{checkedTables.length !== 1 ? 's' : ''} selected
            </span>
            <button
              onClick={() => setShowConfirmDialog(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors hover:opacity-90 cursor-pointer"
              style={{ backgroundColor: "var(--bp-copper)" }}
            >
              <Rocket className="h-4 w-4" />
              Load Tables
            </button>
            <button
              onClick={() => setCheckedTables([])}
              className="p-1.5 rounded-md transition-colors hover:bg-accent cursor-pointer"
              style={{ color: "var(--bp-ink-muted)" }}
              title="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* ── Confirmation Dialog ── */}
        {showConfirmDialog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center gs-modal-backdrop" onClick={() => !loading && setShowConfirmDialog(false)}>
            <div
              className="gs-modal-enter w-full max-w-lg mx-4 rounded-xl overflow-hidden"
              style={{ backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border-strong)" }}
              onClick={e => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--bp-border)" }}>
                <div>
                  <h3 className="text-base font-semibold" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>
                    Load {checkedTables.length} Table{checkedTables.length !== 1 ? 's' : ''} to Warehouse
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: "var(--bp-ink-secondary)" }}>
                    These tables will be loaded into the data warehouse and included in all future refreshes.
                  </p>
                </div>
                <button onClick={() => !loading && setShowConfirmDialog(false)} className="p-1 rounded-md hover:bg-accent cursor-pointer" style={{ color: "var(--bp-ink-muted)" }}>
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Table list */}
              <div className="px-5 py-4 max-h-64 overflow-y-auto" style={{ backgroundColor: "var(--bp-canvas)" }}>
                {Object.entries(groupedChecked).map(([group, tables]) => (
                  <div key={group} className="mb-3 last:mb-0">
                    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--bp-ink-muted)" }}>
                      <Server className="h-3 w-3" />
                      <span>{group}</span>
                    </div>
                    {tables.map(t => (
                      <div key={`${t.schema}.${t.table}`} className="flex items-center gap-2 py-1 px-2 text-xs" style={{ color: "var(--bp-ink-primary)" }}>
                        <Table2 className="h-3 w-3 flex-shrink-0" style={{ color: "var(--bp-ink-muted)" }} />
                        <span className="font-mono text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>{t.schema}.</span>
                        <span className="font-medium">{t.table}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {/* Result / error message */}
              {loadResult && (
                <div className="px-5 py-3" style={{ borderTop: "1px solid var(--bp-border)" }}>
                  {loadResult.errors.length > 0 ? (
                    <div className="flex items-start gap-2 text-xs">
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" style={{ color: "var(--bp-caution)" }} />
                      <div>
                        {loadResult.errors.map((e, i) => (
                          <p key={i} style={{ color: loadResult.count > 0 ? "var(--bp-ink-primary)" : "var(--bp-fault)" }}>{e}</p>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className="h-4 w-4" style={{ color: "var(--bp-operational)" }} />
                      <span className="font-medium" style={{ color: "var(--bp-operational)" }}>
                        Loading {loadResult.count} table{loadResult.count !== 1 ? 's' : ''}...
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 px-5 py-4" style={{ borderTop: "1px solid var(--bp-border)" }}>
                <button
                  onClick={() => { setShowConfirmDialog(false); setLoadResult(null); }}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-accent cursor-pointer disabled:opacity-50"
                  style={{ color: "var(--bp-ink-secondary)", border: "1px solid var(--bp-border)" }}
                >
                  Cancel
                </button>
                {!loadResult ? (
                  <button
                    onClick={handleLoad}
                    disabled={loading}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors hover:opacity-90 cursor-pointer disabled:opacity-50"
                    style={{ backgroundColor: "var(--bp-copper)" }}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                    {loading ? 'Loading...' : 'Load'}
                  </button>
                ) : (
                  <button
                    onClick={() => { setShowConfirmDialog(false); setLoadResult(null); }}
                    className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors hover:opacity-90 cursor-pointer"
                    style={{ backgroundColor: "var(--bp-copper)" }}
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="gs-page-enter flex flex-col items-center justify-center h-full select-none" style={{ backgroundColor: "var(--bp-canvas)", color: "var(--bp-ink-secondary)" }}>
      <div className="gs-float relative mb-6">
        <div className="flex items-center justify-center h-16 w-16 rounded-xl" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
          <Database className="h-7 w-7" style={{ color: "var(--bp-ink-muted)" }} />
        </div>
        <div className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full" style={{ backgroundColor: "var(--bp-copper)" }} />
      </div>

      <h2 className="text-base font-semibold mb-1.5" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>SQL Object Explorer</h2>
      <p className="text-sm max-w-sm text-center leading-relaxed mb-5" style={{ color: "var(--bp-ink-secondary)" }}>
        Browse tables across your connected servers.
        Check any table and click Load to bring it into the warehouse.
      </p>

      <div className="flex items-center gap-2.5 text-xs mb-6" style={{ color: "var(--bp-ink-muted)" }}>
        <div className="flex items-center gap-1.5">
          <Server className="h-3.5 w-3.5" />
          <span>Server</span>
        </div>
        <ArrowRight className="h-3 w-3 opacity-30" />
        <div className="flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5" />
          <span>Database</span>
        </div>
        <ArrowRight className="h-3 w-3 opacity-30" />
        <div className="flex items-center gap-1.5">
          <Table2 className="h-3.5 w-3.5" />
          <span>Table</span>
        </div>
      </div>
    </div>
  );
}
