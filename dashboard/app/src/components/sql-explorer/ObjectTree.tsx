import { useState, useEffect, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  Search, ChevronRight, ChevronDown, Server, Database, Layers,
  Table2, Loader2, AlertCircle, EyeOff, Eye, Cloud, FolderOpen, FileText,
  CheckCircle2, Square, CheckSquare,
} from 'lucide-react';
import type {
  SourceServer, SourceDatabase, SourceSchema, SourceTable, SelectedTable,
  FabricLakehouse, OneLakeFileEntry,
} from '@/types/sqlExplorer';

export interface CheckedTable {
  server: string;
  database: string;
  schema: string;
  table: string;
}

interface ObjectTreeProps {
  selectedTable: SelectedTable | null;
  onSelectTable: (t: SelectedTable) => void;
  /** Optional deep-link: auto-expand tree to this table on mount */
  initialSelection?: SelectedTable | null;
  /** Tables checked for registration */
  checkedTables?: CheckedTable[];
  /** Toggle a table's checked state */
  onToggleCheck?: (t: CheckedTable) => void;
}

export function ObjectTree({ selectedTable, onSelectTable, initialSelection, checkedTables = [], onToggleCheck }: ObjectTreeProps) {
  const [search, setSearch] = useState('');
  const [servers, setServers] = useState<SourceServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [databases, setDatabases] = useState<Record<string, SourceDatabase[]>>({});
  const [schemas, setSchemas] = useState<Record<string, SourceSchema[]>>({});
  const [tables, setTables] = useState<Record<string, SourceTable[]>>({});

  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  const [expandedTableFolders, setExpandedTableFolders] = useState<Set<string>>(new Set());

  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [errorNodes, setErrorNodes] = useState<Set<string>>(new Set());
  const [showEmptyDbs, setShowEmptyDbs] = useState(false);

  // Inline server label editing
  const [editingServer, setEditingServer] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');

  // Fabric Lakehouse state
  const [lakehouses, setLakehouses] = useState<FabricLakehouse[]>([]);
  const [lhLoading, setLhLoading] = useState(true);
  const [lhSchemas, setLhSchemas] = useState<Record<string, SourceSchema[]>>({});
  const [lhTables, setLhTables] = useState<Record<string, SourceTable[]>>({});
  const [expandedLakehouses, setExpandedLakehouses] = useState<Set<string>>(new Set());
  const [expandedLhSchemas, setExpandedLhSchemas] = useState<Set<string>>(new Set());
  const [expandedLhTableFolders, setExpandedLhTableFolders] = useState<Set<string>>(new Set());

  // OneLake Files browsing state
  const [lhFileNamespaces, setLhFileNamespaces] = useState<Record<string, OneLakeFileEntry[]>>({});
  const [lhFileTables, setLhFileTables] = useState<Record<string, OneLakeFileEntry[]>>({});
  const [expandedLhFiles, setExpandedLhFiles] = useState<Set<string>>(new Set());
  const [expandedLhFileNs, setExpandedLhFileNs] = useState<Set<string>>(new Set());
  const [expandedLhFileTblFolders, setExpandedLhFileTblFolders] = useState<Set<string>>(new Set());

  const deepLinkApplied = useRef(false);

  useEffect(() => { fetchServers(); fetchLakehouses(); }, []);

  // ── Deep-link: auto-expand tree to initialSelection on mount ──
  useEffect(() => {
    if (!initialSelection || deepLinkApplied.current) return;

    const { server, database, schema, table, type } = initialSelection;
    if (!server) return;

    // Lakehouse deep-link path (from DataBlender: ?database=LH_BRONZE_LAYER&schema=dbo&table=X)
    if (type === 'lakehouse') {
      if (lhLoading || lakehouses.length === 0) return;

      const matchedLh = lakehouses.find(
        l => l.name.toLowerCase() === server.toLowerCase() && l.status === 'online'
      );
      if (!matchedLh) return;

      deepLinkApplied.current = true;
      const lhName = matchedLh.name;

      (async () => {
        try {
          // 1. Expand lakehouse (fetches schemas)
          setExpandedLakehouses(new Set([lhName]));
          const schResp = await fetch(`/api/sql-explorer/lakehouse-schemas?lakehouse=${encodeURIComponent(lhName)}`);
          const schData = schResp.ok ? await schResp.json() : [];
          setLhSchemas(prev => ({ ...prev, [lhName]: schData }));

          // 2. Expand schema (fetches tables)
          if (schema) {
            const schKey = `${lhName}::${schema}`;
            setExpandedLhSchemas(new Set([schKey]));
            const tblFolderKey = `${schKey}::Tables`;
            setExpandedLhTableFolders(new Set([tblFolderKey]));
            const tblResp = await fetch(`/api/sql-explorer/lakehouse-tables?lakehouse=${encodeURIComponent(lhName)}&schema=${encodeURIComponent(schema)}`);
            if (tblResp.ok) {
              const tblData = await tblResp.json();
              setLhTables(prev => ({ ...prev, [schKey]: tblData }));

              // 3. Select the table
              if (table) {
                onSelectTable({ server: lhName, database: lhName, schema, table, type: 'lakehouse' });
              }
            }
          }
        } catch (e) {
          console.warn('[ObjectTree] Lakehouse deep-link expansion failed:', e);
        }
      })();
      return;
    }

    // Source server deep-link path
    if (loading || servers.length === 0) return;

    // Find matching server (case-insensitive)
    const matchedServer = servers.find(
      s => s.server.toLowerCase() === server.toLowerCase() && s.status === 'online'
    );
    if (!matchedServer) return;

    deepLinkApplied.current = true;

    // Chain: expand server → expand database → expand schema → select table
    (async () => {
      // 1. Expand server (fetches databases)
      const srvName = matchedServer.server;
      setExpandedServers(new Set([srvName]));
      if (!databases[srvName]) {
        try {
          const resp = await fetch(`/api/sql-explorer/databases?server=${encodeURIComponent(srvName)}`);
          if (resp.ok) {
            const data = await resp.json();
            setDatabases(prev => ({ ...prev, [srvName]: data }));

            // 2. Expand database (fetches schemas)
            if (database) {
              const dbKey = `${srvName}::${database}`;
              setExpandedDbs(new Set([dbKey]));
              const schemaResp = await fetch(`/api/sql-explorer/schemas?server=${encodeURIComponent(srvName)}&database=${encodeURIComponent(database)}`);
              if (schemaResp.ok) {
                const schemaData = await schemaResp.json();
                setSchemas(prev => ({ ...prev, [dbKey]: schemaData }));

                // 3. Expand schema (fetches tables)
                if (schema) {
                  const schemaKey = `${srvName}::${database}::${schema}`;
                  setExpandedSchemas(new Set([schemaKey]));
                  const tblFolderKey = `${schemaKey}::Tables`;
                  setExpandedTableFolders(new Set([tblFolderKey]));
                  const tblResp = await fetch(`/api/sql-explorer/tables?server=${encodeURIComponent(srvName)}&database=${encodeURIComponent(database)}&schema=${encodeURIComponent(schema)}`);
                  if (tblResp.ok) {
                    const tblData = await tblResp.json();
                    setTables(prev => ({ ...prev, [schemaKey]: tblData }));

                    // 4. Select the table
                    if (table) {
                      onSelectTable({ server: srvName, database, schema, table, type: 'source' });
                    }
                  }
                }
              }
            }
          }
        } catch (e) {
          console.warn('[ObjectTree] Deep-link expansion failed:', e);
        }
      }
    })();
  }, [initialSelection, loading, servers, lhLoading, lakehouses]);

  async function fetchServers() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/sql-explorer/servers');
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      setServers(await resp.json());
    } catch {
      setError('offline');
      setServers([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchLakehouses() {
    setLhLoading(true);
    try {
      const resp = await fetch('/api/sql-explorer/lakehouses');
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      setLakehouses(await resp.json());
    } catch {
      setLakehouses([]);
    } finally {
      setLhLoading(false);
    }
  }

  const addLoading = useCallback((key: string) => {
    setLoadingNodes(prev => new Set(prev).add(key));
  }, []);

  const removeLoading = useCallback((key: string) => {
    setLoadingNodes(prev => { const s = new Set(prev); s.delete(key); return s; });
  }, []);

  async function toggleServer(serverName: string) {
    const next = new Set(expandedServers);
    if (next.has(serverName)) {
      next.delete(serverName);
    } else {
      next.add(serverName);
      if (!databases[serverName]) {
        addLoading(serverName);
        setErrorNodes(prev => { const s = new Set(prev); s.delete(serverName); return s; });
        try {
          const resp = await fetch(`/api/sql-explorer/databases?server=${encodeURIComponent(serverName)}`);
          if (resp.ok) {
            const data = await resp.json();
            setDatabases(prev => ({ ...prev, [serverName]: data }));
          } else {
            setErrorNodes(prev => new Set(prev).add(serverName));
          }
        } catch {
          setErrorNodes(prev => new Set(prev).add(serverName));
        } finally { removeLoading(serverName); }
      }
    }
    setExpandedServers(next);
  }

  async function toggleDatabase(serverName: string, dbName: string) {
    const key = `${serverName}::${dbName}`;
    const next = new Set(expandedDbs);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (!schemas[key]) {
        addLoading(key);
        setErrorNodes(prev => { const s = new Set(prev); s.delete(key); return s; });
        try {
          const resp = await fetch(`/api/sql-explorer/schemas?server=${encodeURIComponent(serverName)}&database=${encodeURIComponent(dbName)}`);
          if (resp.ok) {
            const data = await resp.json();
            setSchemas(prev => ({ ...prev, [key]: data }));
          } else {
            setErrorNodes(prev => new Set(prev).add(key));
          }
        } catch {
          setErrorNodes(prev => new Set(prev).add(key));
        } finally { removeLoading(key); }
      }
    }
    setExpandedDbs(next);
  }

  async function toggleSchema(serverName: string, dbName: string, schemaName: string) {
    const key = `${serverName}::${dbName}::${schemaName}`;
    const next = new Set(expandedSchemas);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (!tables[key]) {
        addLoading(key);
        setErrorNodes(prev => { const s = new Set(prev); s.delete(key); return s; });
        try {
          const resp = await fetch(`/api/sql-explorer/tables?server=${encodeURIComponent(serverName)}&database=${encodeURIComponent(dbName)}&schema=${encodeURIComponent(schemaName)}`);
          if (resp.ok) {
            const data = await resp.json();
            setTables(prev => ({ ...prev, [key]: data }));
          } else {
            setErrorNodes(prev => new Set(prev).add(key));
          }
        } catch {
          setErrorNodes(prev => new Set(prev).add(key));
        } finally { removeLoading(key); }
      }
    }
    setExpandedSchemas(next);
  }

  function toggleTableFolder(key: string) {
    const next = new Set(expandedTableFolders);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpandedTableFolders(next);
  }

  async function toggleLakehouse(lhName: string) {
    const next = new Set(expandedLakehouses);
    if (next.has(lhName)) {
      next.delete(lhName);
    } else {
      next.add(lhName);
      if (!lhSchemas[lhName]) {
        addLoading(`lh::${lhName}`);
        try {
          const resp = await fetch(`/api/sql-explorer/lakehouse-schemas?lakehouse=${encodeURIComponent(lhName)}`);
          const data = resp.ok ? await resp.json() : [];
          setLhSchemas(prev => ({ ...prev, [lhName]: data }));
        } catch {
          setLhSchemas(prev => ({ ...prev, [lhName]: [] }));
        } finally { removeLoading(`lh::${lhName}`); }
      }
    }
    setExpandedLakehouses(next);
  }

  async function toggleLhSchema(lhName: string, schemaName: string) {
    const key = `${lhName}::${schemaName}`;
    const next = new Set(expandedLhSchemas);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (!lhTables[key]) {
        addLoading(`lh::${key}`);
        try {
          const resp = await fetch(`/api/sql-explorer/lakehouse-tables?lakehouse=${encodeURIComponent(lhName)}&schema=${encodeURIComponent(schemaName)}`);
          if (resp.ok) {
            const data = await resp.json();
            setLhTables(prev => ({ ...prev, [key]: data }));
          }
        } finally { removeLoading(`lh::${key}`); }
      }
    }
    setExpandedLhSchemas(next);
  }

  function toggleLhTableFolder(key: string) {
    const next = new Set(expandedLhTableFolders);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpandedLhTableFolders(next);
  }

  async function toggleLhFilesFolder(lhName: string) {
    const key = `lh-files::${lhName}`;
    const next = new Set(expandedLhFiles);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (!lhFileNamespaces[lhName]) {
        addLoading(key);
        try {
          const resp = await fetch(`/api/sql-explorer/lakehouse-files?lakehouse=${encodeURIComponent(lhName)}`);
          if (resp.ok) {
            const data: OneLakeFileEntry[] = await resp.json();
            setLhFileNamespaces(prev => ({ ...prev, [lhName]: data }));
          }
        } finally { removeLoading(key); }
      }
    }
    setExpandedLhFiles(next);
  }

  async function toggleLhFileNamespace(lhName: string, nsName: string) {
    const key = `lh-fns::${lhName}::${nsName}`;
    const next = new Set(expandedLhFileNs);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      const tblKey = `${lhName}::${nsName}`;
      if (!lhFileTables[tblKey]) {
        addLoading(key);
        try {
          const resp = await fetch(`/api/sql-explorer/lakehouse-file-tables?lakehouse=${encodeURIComponent(lhName)}&namespace=${encodeURIComponent(nsName)}`);
          if (resp.ok) {
            const data: OneLakeFileEntry[] = await resp.json();
            setLhFileTables(prev => ({ ...prev, [tblKey]: data }));
          }
        } finally { removeLoading(key); }
      }
    }
    setExpandedLhFileNs(next);
  }

  function toggleLhFileTblFolder(key: string) {
    const next = new Set(expandedLhFileTblFolders);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpandedLhFileTblFolders(next);
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  async function saveServerLabel(serverName: string, label: string) {
    const trimmed = label.trim();
    if (!trimmed) { setEditingServer(null); return; }
    // Optimistic update
    setServers(prev => prev.map(s => s.server === serverName ? { ...s, display: trimmed } : s));
    setEditingServer(null);
    try {
      await fetch('/api/sql-explorer/server-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server: serverName, label: trimmed }),
      });
    } catch { /* label already updated locally */ }
  }

  const isSelected = (srv: string, db: string, sch: string, tbl: string) =>
    selectedTable?.server === srv && selectedTable?.database === db &&
    selectedTable?.schema === sch && selectedTable?.table === tbl;

  const matchesSearch = (name: string) =>
    !search || name.toLowerCase().includes(search.toLowerCase());

  const isChecked = (srv: string, dbName: string, sch: string, tbl: string) =>
    checkedTables.some(c => c.server === srv && c.database === dbName && c.schema === sch && c.table === tbl);

  /** Re-fetch tables for a schema key to refresh registration badges after registration */
  const refreshTables = useCallback(async (serverName: string, dbName: string, schemaName: string) => {
    const key = `${serverName}::${dbName}::${schemaName}`;
    try {
      const resp = await fetch(`/api/sql-explorer/tables?server=${encodeURIComponent(serverName)}&database=${encodeURIComponent(dbName)}&schema=${encodeURIComponent(schemaName)}`);
      if (resp.ok) {
        const data = await resp.json();
        setTables(prev => ({ ...prev, [key]: data }));
      }
    } catch { /* silent */ }
  }, []);

  // Expose refresh for parent to call after registration
  useEffect(() => {
    (window as any).__objectTreeRefreshTables = refreshTables;
    return () => { delete (window as any).__objectTreeRefreshTables; };
  }, [refreshTables]);

  return (
    <div className="flex flex-col h-full">
      {/* Search + empty-db toggle */}
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tables..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-7 text-xs"
            />
          </div>
          <button
            onClick={() => setShowEmptyDbs(prev => !prev)}
            className={cn(
              "flex-shrink-0 p-1.5 rounded-[var(--radius-md)] transition-colors cursor-pointer",
              showEmptyDbs
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
            title={showEmptyDbs ? 'Hide empty databases' : 'Show empty databases'}
          >
            {showEmptyDbs ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-1">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-xs">Connecting to servers...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-1.5 px-3 py-4 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>Cannot reach API server</span>
          </div>
        ) : (
          <div role="tree" aria-label="SQL Object Explorer">
            {/* Section label */}
            <div className="flex items-center gap-2 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span>Connections</span>
              <span className="opacity-50">{servers.filter(s => s.status === 'online').length}/{servers.length}</span>
            </div>

            {servers.length > 0 && servers.every(s => s.status !== 'online') && (
              <div className="flex items-center gap-1.5 px-3 py-2 text-[10px] text-muted-foreground/60 italic">
                <AlertCircle className="h-3 w-3" />
                All servers offline
              </div>
            )}

            {servers.map(srv => {
              const srvExpanded = expandedServers.has(srv.server);
              const srvLoading = loadingNodes.has(srv.server);
              const srvDbsRaw = databases[srv.server] || [];
              const srvDbs = showEmptyDbs
                ? srvDbsRaw
                : srvDbsRaw.filter(d => parseInt(d.table_count || '0', 10) > 0);
              const isOnline = srv.status === 'online';

              return (
                <div key={srv.server}>
                  {/* Server node */}
                  <div
                    role="treeitem"
                    aria-expanded={srvExpanded}
                    aria-label={`Server: ${srv.display}, ${isOnline ? 'online' : 'offline'}`}
                    onClick={() => isOnline && editingServer !== srv.server && toggleServer(srv.server)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingServer(srv.server);
                      setEditLabel(srv.display);
                    }}
                    className={cn(
                      "flex items-center gap-2 w-full px-2 py-1.5 rounded-[var(--radius-md)] text-xs transition-colors",
                      isOnline ? "hover:bg-accent cursor-pointer" : "opacity-40 cursor-not-allowed",
                      srvExpanded && "bg-accent/50"
                    )}
                  >
                    <span className="flex-shrink-0 w-4 flex justify-center">
                      {srvLoading ? (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      ) : srvExpanded ? (
                        <ChevronDown className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3 w-3 text-muted-foreground" />
                      )}
                    </span>
                    <Server className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    {editingServer === srv.server ? (
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        onBlur={() => saveServerLabel(srv.server, editLabel)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveServerLabel(srv.server, editLabel);
                          if (e.key === 'Escape') setEditingServer(null);
                        }}
                        onClick={e => e.stopPropagation()}
                        className="font-medium text-foreground bg-background border border-primary/50 rounded px-1 py-0 text-xs w-full max-w-[140px] outline-none focus:border-primary"
                      />
                    ) : (
                      <span className="font-medium text-foreground truncate" title="Double-click to rename">{srv.display}</span>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      <div className={cn(
                        "h-2 w-2 rounded-full flex-shrink-0",
                        isOnline ? "bg-[var(--bp-operational)]" : "bg-destructive"
                      )} />
                    </div>
                  </div>

                  {/* Databases */}
                  {srvExpanded && (
                    <div className="ml-5" role="group">
                      {errorNodes.has(srv.server) && (
                        <div className="flex items-center gap-1 px-2 py-1 text-[10px] text-destructive ml-2">
                          <AlertCircle className="h-3 w-3 flex-shrink-0" />
                          <span>Failed to load databases</span>
                        </div>
                      )}
                      {srvDbs.length === 0 && !srvLoading && !errorNodes.has(srv.server) && (
                        <div className="px-2 py-1 text-[10px] text-muted-foreground/60 italic ml-2">No databases</div>
                      )}
                      {srvDbs.map(db => {
                        const dbKey = `${srv.server}::${db.name}`;
                        const dbExpanded = expandedDbs.has(dbKey);
                        const dbLoading = loadingNodes.has(dbKey);
                        const dbSchemas = schemas[dbKey] || [];
                        const dbTableCount = parseInt(db.table_count || '0', 10);
                        const dbEmpty = dbTableCount === 0;

                        return (
                          <div key={dbKey}>
                            <button
                              onClick={() => !dbEmpty && toggleDatabase(srv.server, db.name)}
                              disabled={dbEmpty}
                              className={cn(
                                "flex items-center gap-2 w-full px-2 py-1 ml-1 rounded-[var(--radius-md)] text-[11px] transition-colors",
                                dbEmpty ? "opacity-30 cursor-default" : "hover:bg-accent cursor-pointer",
                                dbExpanded && "bg-accent/50"
                              )}
                            >
                              <span className="flex-shrink-0 w-4 flex justify-center">
                                {dbLoading ? (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                                ) : dbExpanded ? (
                                  <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                                )}
                              </span>
                              <Database className={cn("h-3 w-3 flex-shrink-0", dbEmpty ? "text-muted-foreground/30" : db.isRegistered ? "text-[var(--bp-caution)]" : "text-[var(--bp-copper)]")} />
                              <span className={cn("truncate", dbEmpty ? "text-muted-foreground/40" : db.isRegistered ? "text-[var(--bp-caution)] font-semibold" : "text-foreground/80")}>{db.name}</span>
                              {db.isRegistered && (
                                <span className="text-[8px] px-1 py-px rounded bg-[var(--bp-caution)]/15 text-[var(--bp-caution)] border border-[var(--bp-caution)]/30 font-semibold uppercase tracking-wider flex-shrink-0">
                                  In Scope
                                </span>
                              )}
                              {dbTableCount > 0 && (
                                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono flex-shrink-0">
                                  {dbTableCount}
                                </span>
                              )}
                            </button>

                            {/* Schemas */}
                            {dbExpanded && (
                              <div className="ml-5">
                                {dbSchemas.length === 0 && !dbLoading && (
                                  <div className="px-2 py-1 text-[10px] text-muted-foreground/60 italic ml-2">No schemas with tables</div>
                                )}
                                {dbSchemas.map(sch => {
                                  const schKey = `${srv.server}::${db.name}::${sch.schema_name}`;
                                  const schExpanded = expandedSchemas.has(schKey);
                                  const schLoading = loadingNodes.has(schKey);
                                  const schTables = tables[schKey] || [];
                                  const tblFolderKey = `tbls::${schKey}`;
                                  const tblFolderExpanded = expandedTableFolders.has(tblFolderKey);

                                  return (
                                    <div key={schKey}>
                                      <button
                                        onClick={() => toggleSchema(srv.server, db.name, sch.schema_name)}
                                        className="flex items-center gap-2 w-full px-2 py-1 ml-1 rounded-[var(--radius-md)] text-[11px] hover:bg-accent transition-colors cursor-pointer"
                                      >
                                        <span className="flex-shrink-0 w-4 flex justify-center">
                                          {schLoading ? (
                                            <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                                          ) : schExpanded ? (
                                            <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                                          ) : (
                                            <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                                          )}
                                        </span>
                                        <Layers className="h-3 w-3 text-purple-400 flex-shrink-0" />
                                        <span className="text-foreground/80">{sch.schema_name}</span>
                                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono">
                                          {sch.table_count}
                                        </span>
                                      </button>

                                      {/* Tables folder */}
                                      {schExpanded && schTables.length > 0 && (
                                        <div className="ml-5">
                                          <button
                                            onClick={() => toggleTableFolder(tblFolderKey)}
                                            className="flex items-center gap-2 w-full px-2 py-1 rounded-[var(--radius-md)] text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
                                          >
                                            <span className="flex-shrink-0 w-4 flex justify-center">
                                              {tblFolderExpanded ? (
                                                <ChevronDown className="h-2.5 w-2.5" />
                                              ) : (
                                                <ChevronRight className="h-2.5 w-2.5" />
                                              )}
                                            </span>
                                            <Table2 className="h-3 w-3" />
                                            <span>Tables</span>
                                            <span className="ml-auto text-[10px] font-mono opacity-60">{schTables.length}</span>
                                          </button>

                                          {tblFolderExpanded && schTables
                                            .filter(t => matchesSearch(t.TABLE_NAME))
                                            .map(tbl => {
                                              const sel = isSelected(srv.server, db.name, sch.schema_name, tbl.TABLE_NAME);
                                              const registered = tbl.is_registered === true;
                                              const checked = !registered && isChecked(srv.server, db.name, sch.schema_name, tbl.TABLE_NAME);
                                              return (
                                                <div
                                                  key={tbl.TABLE_NAME}
                                                  className={cn(
                                                    "group flex items-center gap-1 w-full px-1 py-1 ml-3 rounded-[var(--radius-md)] text-[11px] transition-colors",
                                                    sel
                                                      ? "bg-primary/10 text-primary font-medium border-l-2 border-primary"
                                                      : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                                  )}
                                                >
                                                  {/* Checkbox for unregistered tables */}
                                                  {onToggleCheck && !registered && (
                                                    <button
                                                      onClick={(e) => {
                                                        e.stopPropagation();
                                                        onToggleCheck({ server: srv.server, database: db.name, schema: sch.schema_name, table: tbl.TABLE_NAME });
                                                      }}
                                                      className="flex-shrink-0 p-0.5 rounded transition-colors hover:bg-accent cursor-pointer"
                                                      title={checked ? "Deselect" : "Select to load"}
                                                    >
                                                      {checked ? (
                                                        <CheckSquare className="h-3 w-3 text-[var(--bp-copper)]" />
                                                      ) : (
                                                        <Square className="h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground/70" />
                                                      )}
                                                    </button>
                                                  )}
                                                  {/* In Pipeline badge for registered tables */}
                                                  {registered && (
                                                    <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-[var(--bp-operational)]" />
                                                  )}
                                                  <button
                                                    onClick={() => onSelectTable({
                                                      server: srv.server, database: db.name,
                                                      schema: sch.schema_name, table: tbl.TABLE_NAME,
                                                    })}
                                                    className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer"
                                                  >
                                                    <Table2 className={cn("h-3 w-3 flex-shrink-0", sel ? "text-primary" : registered ? "text-[var(--bp-operational)]/60" : "text-muted-foreground/50")} />
                                                    <span className="truncate">{tbl.TABLE_NAME}</span>
                                                  </button>
                                                  {registered && (
                                                    <span className="flex-shrink-0 text-[8px] px-1 py-px rounded bg-[var(--bp-operational)]/10 text-[var(--bp-operational)] border border-[var(--bp-operational)]/20 font-semibold uppercase tracking-wider">
                                                      Loaded
                                                    </span>
                                                  )}
                                                </div>
                                              );
                                            })}
                                        </div>
                                      )}
                                      {schExpanded && schTables.length === 0 && !schLoading && (
                                        <div className="ml-10 px-2 py-1 text-[10px] text-muted-foreground/60 italic">No tables</div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* ── Fabric Lakehouses Section ── */}
            {!lhLoading && lakehouses.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-2 py-1.5 mt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t border-border/50 pt-3">
                  <Cloud className="h-3 w-3 text-[var(--bp-operational)]/70" />
                  <span>Fabric Lakehouses</span>
                  <span className="opacity-50">{lakehouses.filter(l => l.status === 'online').length}/{lakehouses.length}</span>
                </div>

                {lakehouses.map(lh => {
                  const lhExpanded = expandedLakehouses.has(lh.name);
                  const lhNodeLoading = loadingNodes.has(`lh::${lh.name}`);
                  const isOnline = lh.status === 'online';
                  const lhSchemaList = lhSchemas[lh.name] || [];

                  return (
                    <div key={lh.name}>
                      {/* Lakehouse node */}
                      <button
                        onClick={() => isOnline && toggleLakehouse(lh.name)}
                        disabled={!isOnline}
                        className={cn(
                          "flex items-center gap-2 w-full px-2 py-1.5 rounded-[var(--radius-md)] text-xs transition-colors",
                          isOnline ? "hover:bg-accent cursor-pointer" : "opacity-40 cursor-not-allowed",
                          lhExpanded && "bg-accent/50"
                        )}
                      >
                        <span className="flex-shrink-0 w-4 flex justify-center">
                          {lhNodeLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                          ) : lhExpanded ? (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          )}
                        </span>
                        <Database className="h-3.5 w-3.5 text-[var(--bp-operational)] flex-shrink-0" />
                        <span className="font-medium text-foreground truncate">{lh.display}</span>
                        <div className="ml-auto flex items-center gap-1.5">
                          <div className={cn(
                            "h-2 w-2 rounded-full flex-shrink-0",
                            isOnline ? "bg-[var(--bp-operational)]" : "bg-destructive"
                          )} />
                        </div>
                      </button>

                      {/* Lakehouse content: Files for Landing, Tables for Bronze/Silver */}
                      {lhExpanded && (() => {
                        const isLandingZone = lh.layer === 'landing';
                        const isBronzeOrSilver = lh.layer === 'bronze' || lh.layer === 'silver';
                        return (
                        <div className="ml-5">
                          {/* ── Delta Tables (SQL Analytics) — only for Bronze/Silver ── */}
                          {!isLandingZone && lhSchemaList.length === 0 && !lhNodeLoading && (
                            <div className="px-2 py-1 text-[10px] text-muted-foreground/50 italic ml-1">No delta tables</div>
                          )}
                          {!isLandingZone && lhSchemaList.length > 0 && (
                            <>
                              <div className="px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/50 mt-1">
                                Delta Tables
                              </div>
                              {lhSchemaList.map(sch => {
                                const schKey = `${lh.name}::${sch.schema_name}`;
                                const schExpanded = expandedLhSchemas.has(schKey);
                                const schLoading = loadingNodes.has(`lh::${schKey}`);
                                const schTables = lhTables[schKey] || [];
                                const tblFolderKey = `lh-tbls::${schKey}`;
                                const tblFolderExpanded = expandedLhTableFolders.has(tblFolderKey);

                                return (
                                  <div key={schKey}>
                                    <button
                                      onClick={() => toggleLhSchema(lh.name, sch.schema_name)}
                                      className="flex items-center gap-2 w-full px-2 py-1 ml-1 rounded-[var(--radius-md)] text-[11px] hover:bg-accent transition-colors cursor-pointer"
                                    >
                                      <span className="flex-shrink-0 w-4 flex justify-center">
                                        {schLoading ? (
                                          <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                                        ) : schExpanded ? (
                                          <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                                        ) : (
                                          <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                                        )}
                                      </span>
                                      <Layers className="h-3 w-3 text-purple-400 flex-shrink-0" />
                                      <span className="text-foreground/80">{sch.schema_name}</span>
                                      <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground font-mono">
                                        {sch.table_count}
                                      </span>
                                    </button>

                                    {schExpanded && schTables.length > 0 && (
                                      <div className="ml-5">
                                        <button
                                          onClick={() => toggleLhTableFolder(tblFolderKey)}
                                          className="flex items-center gap-2 w-full px-2 py-1 rounded-[var(--radius-md)] text-[11px] font-medium text-muted-foreground hover:bg-accent transition-colors cursor-pointer"
                                        >
                                          <span className="flex-shrink-0 w-4 flex justify-center">
                                            {tblFolderExpanded ? (
                                              <ChevronDown className="h-2.5 w-2.5" />
                                            ) : (
                                              <ChevronRight className="h-2.5 w-2.5" />
                                            )}
                                          </span>
                                          <Table2 className="h-3 w-3" />
                                          <span>Tables</span>
                                          <span className="ml-auto text-[10px] font-mono opacity-60">{schTables.length}</span>
                                        </button>

                                        {tblFolderExpanded && schTables
                                          .filter(t => matchesSearch(t.TABLE_NAME))
                                          .map(tbl => {
                                            const sel = isSelected(lh.name, lh.name, sch.schema_name, tbl.TABLE_NAME);
                                            return (
                                              <button
                                                key={tbl.TABLE_NAME}
                                                onClick={() => onSelectTable({
                                                  server: lh.name, database: lh.name,
                                                  schema: sch.schema_name, table: tbl.TABLE_NAME,
                                                  type: 'lakehouse',
                                                })}
                                                className={cn(
                                                  "flex items-center gap-2 w-full px-2 py-1 ml-3 rounded-[var(--radius-md)] text-[11px] transition-colors cursor-pointer",
                                                  sel
                                                    ? "bg-[var(--bp-operational-light)] text-[var(--bp-operational)] font-medium border-l-2 border-[var(--bp-operational)]"
                                                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                                )}
                                              >
                                                <Table2 className={cn("h-3 w-3 flex-shrink-0", sel ? "text-[var(--bp-operational)]" : "text-muted-foreground/50")} />
                                                <span className="truncate">{tbl.TABLE_NAME}</span>
                                              </button>
                                            );
                                          })}
                                      </div>
                                    )}
                                    {schExpanded && schTables.length === 0 && !schLoading && (
                                      <div className="ml-10 px-2 py-1 text-[10px] text-muted-foreground/60 italic">No tables</div>
                                    )}
                                  </div>
                                );
                              })}
                            </>
                          )}

                          {/* ── OneLake Files (Parquet) — only for Landing Zone ── */}
                          {!isBronzeOrSilver && (() => {
                            const filesKey = `lh-files::${lh.name}`;
                            const filesExpanded = expandedLhFiles.has(filesKey);
                            const filesLoading = loadingNodes.has(filesKey);
                            const namespaces = lhFileNamespaces[lh.name] || [];

                            return (
                              <>
                                <button
                                  onClick={() => toggleLhFilesFolder(lh.name)}
                                  className={cn(
                                    "flex items-center gap-2 w-full px-2 py-1.5 ml-1 rounded-[var(--radius-md)] text-[11px] font-medium transition-colors cursor-pointer mt-0.5",
                                    filesExpanded ? "bg-[var(--bp-caution-light)] text-[var(--bp-caution)]" : "text-muted-foreground hover:bg-accent"
                                  )}
                                >
                                  <span className="flex-shrink-0 w-4 flex justify-center">
                                    {filesLoading ? (
                                      <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                                    ) : filesExpanded ? (
                                      <ChevronDown className="h-2.5 w-2.5" />
                                    ) : (
                                      <ChevronRight className="h-2.5 w-2.5" />
                                    )}
                                  </span>
                                  <FolderOpen className={cn("h-3 w-3 flex-shrink-0", filesExpanded ? "text-[var(--bp-caution)]" : "text-[var(--bp-caution)]/60")} />
                                  <span>Files</span>
                                  {filesExpanded && namespaces.length > 0 && (
                                    <span className="ml-auto text-[10px] font-mono opacity-60">{namespaces.length}</span>
                                  )}
                                </button>

                                {filesExpanded && (
                                  <div className="ml-5">
                                    {namespaces.length === 0 && !filesLoading && (
                                      <div className="px-2 py-1 text-[10px] text-muted-foreground/60 italic ml-2">No files</div>
                                    )}
                                    {namespaces.map(ns => {
                                      const nsKey = `lh-fns::${lh.name}::${ns.name}`;
                                      const nsExpanded = expandedLhFileNs.has(nsKey);
                                      const nsLoading = loadingNodes.has(nsKey);
                                      const nsTblKey = `${lh.name}::${ns.name}`;
                                      const nsTables = lhFileTables[nsTblKey] || [];

                                      return (
                                        <div key={nsKey}>
                                          <button
                                            onClick={() => toggleLhFileNamespace(lh.name, ns.name)}
                                            className={cn(
                                              "flex items-center gap-2 w-full px-2 py-1 ml-1 rounded-[var(--radius-md)] text-[11px] hover:bg-accent transition-colors cursor-pointer",
                                              nsExpanded && "bg-accent/50"
                                            )}
                                          >
                                            <span className="flex-shrink-0 w-4 flex justify-center">
                                              {nsLoading ? (
                                                <Loader2 className="h-2.5 w-2.5 animate-spin text-muted-foreground" />
                                              ) : nsExpanded ? (
                                                <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                                              ) : (
                                                <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                                              )}
                                            </span>
                                            <FolderOpen className="h-3 w-3 text-[var(--bp-caution)]/70 flex-shrink-0" />
                                            <span className="text-foreground/80">{ns.name}</span>
                                          </button>

                                          {nsExpanded && (
                                            <div className="ml-5">
                                              {nsTables.length === 0 && !nsLoading && (
                                                <div className="px-2 py-1 text-[10px] text-muted-foreground/60 italic ml-2">Empty</div>
                                              )}
                                              {nsTables
                                                .filter(t => matchesSearch(t.name))
                                                .map(tblFolder => {
                                                  const fileSel = isSelected(lh.name, lh.name, ns.name, tblFolder.name);
                                                  return (
                                                    <button
                                                      key={tblFolder.name}
                                                      onClick={() => onSelectTable({
                                                        server: lh.name, database: lh.name,
                                                        schema: ns.name, table: tblFolder.name,
                                                        type: 'lakehouse',
                                                      })}
                                                      className={cn(
                                                        "flex items-center gap-2 w-full px-2 py-1 ml-1 rounded-[var(--radius-md)] text-[11px] transition-colors cursor-pointer",
                                                        fileSel
                                                          ? "bg-[var(--bp-caution-light)] text-[var(--bp-caution)] font-medium border-l-2 border-[var(--bp-caution)]"
                                                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                                                      )}
                                                    >
                                                      <FileText className={cn("h-3 w-3 flex-shrink-0", fileSel ? "text-[var(--bp-caution)]" : "text-[var(--bp-caution)]/50")} />
                                                      <span className="truncate text-left">{tblFolder.name}</span>
                                                      <div className="ml-auto flex items-center gap-2">
                                                        {(tblFolder.fileCount ?? 0) > 0 && (
                                                          <span className="text-[10px] font-mono opacity-50">
                                                            {tblFolder.fileCount} file{(tblFolder.fileCount ?? 0) !== 1 ? 's' : ''}
                                                          </span>
                                                        )}
                                                        {(tblFolder.totalSize ?? 0) > 0 && (
                                                          <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-[var(--bp-caution-light)] text-[var(--bp-caution)]/70">
                                                            {formatFileSize(tblFolder.totalSize ?? 0)}
                                                          </span>
                                                        )}
                                                      </div>
                                                    </button>
                                                  );
                                                })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </>
            )}
            {lhLoading && (
              <div className="flex items-center gap-2 px-2 py-3 mt-2 text-[10px] text-muted-foreground border-t border-border/50 pt-3">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Connecting to Fabric...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
