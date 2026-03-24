import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ObjectTree } from '@/components/sql-explorer/ObjectTree';
import { TableDetail } from '@/components/sql-explorer/TableDetail';
import { Database, Server, Table2, ArrowRight } from 'lucide-react';
import type { SelectedTable } from '@/types/sqlExplorer';

export default function SqlExplorer() {
  const [searchParams] = useSearchParams();
  const [selectedTable, setSelectedTable] = useState<SelectedTable | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const isResizing = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const initialSelection = useMemo<SelectedTable | null>(() => {
    const server = searchParams.get('server');
    const database = searchParams.get('database');
    const schema = searchParams.get('schema');
    const table = searchParams.get('table');
    // Source server deep-link: ?server=X&database=Y&schema=Z&table=W
    if (server) {
      return { server, database: database || '', schema: schema || 'dbo', table: table || '', type: 'source' };
    }
    // Lakehouse deep-link (from DataBlender): ?database=X&schema=Y&table=Z (no server)
    if (database) {
      return { server: database, database, schema: schema || 'dbo', table: table || '', type: 'lakehouse' };
    }
    return null;
  }, [searchParams]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
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

  return (
    <div className="gs-page-enter flex flex-col h-[calc(100vh-3rem)]" style={{ backgroundColor: "var(--bp-canvas)" }}>
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          className="flex-shrink-0 overflow-hidden flex flex-col"
          style={{ width: sidebarWidth, borderRight: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-2)" }}
        >
          <ObjectTree
            selectedTable={selectedTable}
            onSelectTable={setSelectedTable}
            initialSelection={initialSelection}
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
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="gs-page-enter flex flex-col items-center justify-center h-full select-none" style={{ backgroundColor: "var(--bp-canvas)", color: "var(--bp-ink-secondary)" }}>
      {/* Icon */}
      <div className="gs-float relative mb-6">
        <div className="flex items-center justify-center h-16 w-16 rounded-xl" style={{ border: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
          <Database className="h-7 w-7" style={{ color: "var(--bp-ink-muted)" }} />
        </div>
        <div className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full" style={{ backgroundColor: "var(--bp-copper)" }} />
      </div>

      <h2 className="text-base font-semibold mb-1.5" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>SQL Object Explorer</h2>
      <p className="text-sm max-w-sm text-center leading-relaxed mb-5" style={{ color: "var(--bp-ink-secondary)" }}>
        Browse databases, schemas, and tables across your connected servers.
        Select any table to inspect its schema or preview data.
      </p>

      {/* Flow hint */}
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

      <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider" style={{ border: "1px solid var(--bp-copper-soft)", color: "var(--bp-copper)", backgroundColor: "var(--bp-copper-light)" }}>
        Read-Only Mode
      </span>
    </div>
  );
}
