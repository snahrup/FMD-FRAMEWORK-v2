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
  // Track active listeners so useEffect cleanup can remove them on unmount
  const cleanupRef = useRef<(() => void) | null>(null);

  // Deep-link support: read ?server=X&database=Y&schema=Z&table=T from URL
  const initialSelection = useMemo<SelectedTable | null>(() => {
    const server = searchParams.get('server');
    const database = searchParams.get('database');
    const schema = searchParams.get('schema');
    const table = searchParams.get('table');
    if (!server) return null;
    return { server, database: database || '', schema: schema || 'dbo', table: table || '' };
  }, [searchParams]);

  // Cleanup document listeners on unmount to prevent memory leaks
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
    // Store cleanup so unmount can remove listeners if resize is in-progress
    cleanupRef.current = onMouseUp;
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] bg-background">
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          className="border-r border-border bg-card flex-shrink-0 overflow-hidden flex flex-col"
          style={{ width: sidebarWidth }}
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
          className="w-[3px] flex-shrink-0 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors"
          title="Drag to resize"
        />

        {/* Detail panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
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
    <div className="flex flex-col items-center justify-center h-full bg-background text-muted-foreground select-none">
      {/* Icon */}
      <div className="relative mb-6">
        <div className="flex items-center justify-center h-16 w-16 rounded-xl border border-border bg-card">
          <Database className="h-7 w-7 text-muted-foreground/60" />
        </div>
        <div className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-primary" />
      </div>

      <h2 className="text-base font-semibold text-foreground mb-1.5">SQL Object Explorer</h2>
      <p className="text-sm text-muted-foreground max-w-sm text-center leading-relaxed mb-5">
        Browse databases, schemas, and tables across your connected servers.
        Select any table to inspect its schema or preview data.
      </p>

      {/* Flow hint */}
      <div className="flex items-center gap-2.5 text-xs text-muted-foreground/60 mb-6">
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

      <span className="inline-flex items-center px-3 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider border border-primary/20 text-primary bg-primary/5">
        Read-Only Mode
      </span>
    </div>
  );
}
