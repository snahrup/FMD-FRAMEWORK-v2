import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import {
  Search, ChevronRight, ChevronDown, Table2, Database,
  Layers, AlertCircle, Loader2,
} from 'lucide-react';
import { mockTables, layerConfig } from '@/data/blenderMockData';
import type { DataLayer } from '@/types/blender';

interface BlenderTable {
  id: string;
  name: string;
  layer: DataLayer;
  lakehouse: string;
  schema: string;
  dataSource?: string;
}

interface TableBrowserProps {
  selectedTableId: string | null;
  onSelectTable: (tableId: string) => void;
}

export function TableBrowser({ selectedTableId, onSelectTable }: TableBrowserProps) {
  const [search, setSearch] = useState('');
  const [tables, setTables] = useState<BlenderTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set(['landing', 'bronze', 'silver', 'gold']));
  const [expandedLakehouses, setExpandedLakehouses] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchTables();
  }, []);

  async function fetchTables() {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/blender/tables');
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      setTables(data);
    } catch {
      // API unavailable — show empty state
      setTables([]);
      setError('offline');
    } finally {
      setLoading(false);
    }
  }

  const filtered = tables.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.lakehouse.toLowerCase().includes(search.toLowerCase())
  );

  // Group by layer → lakehouse
  const grouped = filtered.reduce<Record<string, Record<string, BlenderTable[]>>>((acc, t) => {
    if (!acc[t.layer]) acc[t.layer] = {};
    if (!acc[t.layer][t.lakehouse]) acc[t.layer][t.lakehouse] = [];
    acc[t.layer][t.lakehouse].push(t);
    return acc;
  }, {});

  const toggleLayer = (layer: string) => {
    const next = new Set(expandedLayers);
    next.has(layer) ? next.delete(layer) : next.add(layer);
    setExpandedLayers(next);
  };

  const toggleLakehouse = (key: string) => {
    const next = new Set(expandedLakehouses);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpandedLakehouses(next);
  };

  const layerOrder: DataLayer[] = ['landing', 'bronze', 'silver', 'gold'];

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search tables..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-7 text-xs"
          />
        </div>
        {error === 'offline' && (
          <div className="flex items-center gap-1.5 mt-2 text-[10px] text-warning">
            <AlertCircle className="h-3 w-3" />
            <span>Offline — showing sample data</span>
          </div>
        )}
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto p-1">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-xs">Loading tables...</span>
          </div>
        ) : (
          layerOrder.map(layer => {
            const lakehouses = grouped[layer];
            if (!lakehouses) return null;
            const config = layerConfig[layer];
            const isExpanded = expandedLayers.has(layer);
            const tableCount = Object.values(lakehouses).flat().length;

            return (
              <div key={layer} className="mb-0.5">
                {/* Layer header */}
                <button
                  onClick={() => toggleLayer(layer)}
                  className="flex items-center gap-2 w-full px-2 py-1.5 rounded-[var(--radius-md)] hover:bg-accent text-xs font-medium transition-colors cursor-pointer"
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <div className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: config.color }} />
                  <span>{config.label}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{tableCount}</span>
                </button>

                {isExpanded && Object.entries(lakehouses).map(([lhName, lhTables]) => {
                  const lhKey = `${layer}:${lhName}`;
                  const lhExpanded = expandedLakehouses.has(lhKey);

                  return (
                    <div key={lhKey} className="ml-3">
                      {/* Lakehouse header */}
                      <button
                        onClick={() => toggleLakehouse(lhKey)}
                        className="flex items-center gap-2 w-full px-2 py-1 rounded-[var(--radius-sm)] hover:bg-accent/50 text-[11px] text-muted-foreground transition-colors cursor-pointer"
                      >
                        {lhExpanded ? <ChevronDown className="h-2.5 w-2.5" /> : <ChevronRight className="h-2.5 w-2.5" />}
                        <Database className="h-3 w-3" />
                        <span className="truncate">{lhName}</span>
                        <span className="ml-auto text-[10px]">{lhTables.length}</span>
                      </button>

                      {lhExpanded && lhTables.map(table => (
                        <button
                          key={table.id}
                          onClick={() => onSelectTable(table.id)}
                          className={cn(
                            "flex items-center gap-2 w-full ml-3 px-2 py-1 rounded-[var(--radius-sm)] text-[11px] transition-colors cursor-pointer",
                            selectedTableId === table.id
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-foreground/80 hover:bg-accent/50"
                          )}
                        >
                          <Table2 className="h-3 w-3 flex-shrink-0" />
                          <span className="truncate">{table.name}</span>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>

      {/* Footer stats */}
      <div className="p-3 border-t border-border">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Layers className="h-3 w-3" />
          <span>{tables.length} tables across {new Set(tables.map(t => t.layer)).size} layers</span>
        </div>
      </div>
    </div>
  );
}
