import { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { TableBrowser } from '@/components/datablender/TableBrowser';
import type { BlenderTable } from '@/components/datablender/TableBrowser';
import { TableProfiler } from '@/components/datablender/TableProfiler';
import { BlendSuggestions } from '@/components/datablender/BlendSuggestions';
import { BlendPreview } from '@/components/datablender/BlendPreview';
import { SqlWorkbench } from '@/components/datablender/SqlWorkbench';
import { CheckCircle2, XCircle, Database } from 'lucide-react';

type Tab = 'profile' | 'blend' | 'preview';

export default function DataBlender() {
  const [searchParams] = useSearchParams();
  const [selectedTable, setSelectedTable] = useState<BlenderTable | null>(null);
  const [selectedBlendId, setSelectedBlendId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [purviewConnected, setPurviewConnected] = useState<boolean | null>(null);
  const deepLinkHandled = useRef(false);

  useEffect(() => {
    checkPurview();
  }, []);

  // Handle deep-link URL params from cross-page navigation
  // e.g. /blender?table=WORK_ORDER&schema=dbo&layer=bronze
  useEffect(() => {
    if (deepLinkHandled.current) return;
    const tableParam = searchParams.get('table');
    const schemaParam = searchParams.get('schema');
    const layerParam = searchParams.get('layer');
    if (tableParam) {
      deepLinkHandled.current = true;
      // Construct a synthetic BlenderTable ID for the TableBrowser to resolve
      // The TableBrowser uses IDs like "lh-{lakehouse}-{schema}-{table}" for lakehouse tables
      // We'll try to auto-select after the browser loads by searching for the table name
      const layerToLakehouse: Record<string, string> = {
        bronze: 'LH_BRONZE_LAYER',
        silver: 'LH_SILVER_LAYER',
        landing: 'LH_DATA_LANDINGZONE',
        gold: 'LH_GOLD_LAYER',
      };
      const lh = layerToLakehouse[layerParam || 'bronze'] || 'LH_BRONZE_LAYER';
      const schema = schemaParam || 'dbo';
      const validLayers = ['landing', 'bronze', 'silver', 'gold'];
      const layer = (validLayers.includes(layerParam || '') ? layerParam : 'bronze') as BlenderTable['layer'];
      const syntheticTable: BlenderTable = {
        id: `lh-${lh}-${schema}-${tableParam}`,
        name: tableParam,
        lakehouse: lh,
        schema,
        layer,
      };
      setSelectedTable(syntheticTable);
      setActiveTab('profile');
    }
  }, [searchParams]);

  async function checkPurview() {
    try {
      const resp = await fetch('/api/purview/status');
      if (resp.ok) {
        const data = await resp.json();
        setPurviewConnected(data.connected);
      }
    } catch {
      setPurviewConnected(false);
    }
  }

  const handleSelectTable = (table: BlenderTable) => {
    setSelectedTable(table);
    setSelectedBlendId(null);
    setActiveTab('profile');
  };

  const handleSelectBlend = (blendId: string) => {
    setSelectedBlendId(blendId);
    setActiveTab('preview');
  };

  const selectedTableId = selectedTable?.id ?? null;

  const tabs: { id: Tab; label: string; disabled?: boolean }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'blend', label: 'Blend Suggestions' },
    { id: 'preview', label: 'Preview', disabled: !selectedBlendId },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)]" style={{ backgroundColor: "var(--bp-canvas)" }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
        <div className="flex items-center gap-3">
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "32px", color: "var(--bp-ink-primary)", lineHeight: "1.1" }}>Data Blender</h1>
          <span className="text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>Exploration sandbox — browse, profile, preview blends</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Cross-page link to SQL Explorer for source schema inspection */}
          {selectedTable && (
            <Link
              to={`/sql-explorer?database=${encodeURIComponent(selectedTable.lakehouse || '')}&schema=${encodeURIComponent(selectedTable.schema || 'dbo')}&table=${encodeURIComponent(selectedTable.name || '')}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors"
              style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
            >
              <Database className="h-3 w-3" /> View Source Schema
            </Link>
          )}
          {purviewConnected !== null && (
            <div className="flex items-center gap-1 text-[10px]">
              {purviewConnected ? (
                <>
                  <CheckCircle2 className="h-3 w-3" style={{ color: "var(--bp-operational)" }} />
                  <span style={{ color: "var(--bp-operational)" }}>Purview</span>
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3" style={{ color: "var(--bp-ink-muted)" }} />
                  <span style={{ color: "var(--bp-ink-muted)" }}>Purview offline</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Table browser */}
        <div className="w-64 flex-shrink-0 overflow-hidden" style={{ borderRight: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-2)" }}>
          <TableBrowser
            selectedTableId={selectedTableId}
            onSelectTable={handleSelectTable}
          />
        </div>

        {/* Right panel: Content */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ backgroundColor: "var(--bp-canvas)" }}>
          {selectedTable ? (
            <>
              {/* Tabs */}
              <div className="flex items-center gap-0 px-4" style={{ borderBottom: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => !tab.disabled && setActiveTab(tab.id)}
                    disabled={tab.disabled}
                    className={cn(
                      "px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px cursor-pointer",
                      activeTab === tab.id
                        ? "border-[var(--bp-copper)] text-[var(--bp-ink-primary)]"
                        : tab.disabled
                          ? "border-transparent cursor-not-allowed"
                          : "border-transparent hover:text-[var(--bp-ink-primary)]"
                    )}
                    style={
                      activeTab === tab.id
                        ? { borderBottomColor: "var(--bp-copper)", color: "var(--bp-ink-primary)" }
                        : tab.disabled
                          ? { color: "var(--bp-ink-muted)", opacity: 0.4 }
                          : { color: "var(--bp-ink-secondary)" }
                    }
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden">
                {activeTab === 'profile' && (
                  <TableProfiler tableId={selectedTable.id} tableMeta={selectedTable} />
                )}
                {activeTab === 'blend' && (
                  <BlendSuggestions
                    sourceTableId={selectedTable.id}
                    selectedBlendId={selectedBlendId}
                    onSelectBlend={handleSelectBlend}
                  />
                )}
                {activeTab === 'preview' && selectedBlendId && (
                  <BlendPreview blendId={selectedBlendId} />
                )}
              </div>

              {/* SQL Workbench */}
              <SqlWorkbench tableId={selectedTable.id} tableMeta={selectedTable} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="text-4xl">
                  <img src="/icons/lakehouse.svg" alt="" className="h-12 w-12 mx-auto opacity-30" />
                </div>
                <h2 className="text-sm font-semibold" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-secondary)" }}>Select a table to explore</h2>
                <p className="text-xs max-w-sm" style={{ color: "var(--bp-ink-muted)" }}>
                  Browse the table tree on the left to view column profiles, find blend opportunities, and preview join results.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
