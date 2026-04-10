import { useMemo, useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExploreWorkbenchHeader } from '@/components/explore/ExploreWorkbenchHeader';
import { PipelineResolutionPanel } from '@/components/explore/PipelineResolutionPanel';
import { TableBrowser } from '@/components/datablender/TableBrowser';
import type { BlenderTable } from '@/components/datablender/TableBrowser';
import { TableProfiler } from '@/components/datablender/TableProfiler';
import { BlendSuggestions } from '@/components/datablender/BlendSuggestions';
import { BlendPreview } from '@/components/datablender/BlendPreview';
import { SqlWorkbench } from '@/components/datablender/SqlWorkbench';
import { Database, BookOpen, Loader2, Network, Sparkles } from 'lucide-react';
import { useEntityDigest } from '@/hooks/useEntityDigest';
import {
  buildEntityCatalogUrl,
  buildEntityLineageUrl,
  getEntityResolutionAction,
  buildEntitySourceSqlUrl,
  findEntityFromParams,
  isEntityToolReady,
} from '@/lib/exploreWorksurface';

type Tab = 'profile' | 'blend' | 'preview';

export default function DataBlender() {
  const [searchParams] = useSearchParams();
  const { allEntities, loading: digestLoading } = useEntityDigest();
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
  const matchedEntity = useMemo(() => selectedTable
    ? findEntityFromParams(allEntities, { table: selectedTable.name, schema: selectedTable.schema })
    : null, [allEntities, selectedTable]);
  const activeEntity = matchedEntity && isEntityToolReady(matchedEntity) ? matchedEntity : null;
  const blockedEntity = matchedEntity && !isEntityToolReady(matchedEntity) ? matchedEntity : null;
  const resolutionAction = blockedEntity ? getEntityResolutionAction(blockedEntity) : null;
  const sourceSql = (activeEntity || blockedEntity) ? buildEntitySourceSqlUrl(activeEntity || blockedEntity) : null;

  const tabs: { id: Tab; label: string; disabled?: boolean }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'blend', label: 'Blend Suggestions' },
    { id: 'preview', label: 'Preview', disabled: !selectedBlendId },
  ];

  return (
    <div className="gs-page-enter flex flex-col h-[calc(100vh-3rem)]" style={{ backgroundColor: "var(--bp-canvas)" }}>
      <div className="px-4 pt-4 pb-3">
        <ExploreWorkbenchHeader
          title="Data Blender"
          summary="Profile a table, discover blend opportunities, and preview whether the relationship is worth operationalizing."
          meta={selectedTable ? `${selectedTable.layer} layer focus` : 'No table selected'}
          facts={[
            {
              label: "Selected Table",
              value: selectedTable ? `${selectedTable.schema}.${selectedTable.name}` : "Choose a table to begin",
              detail: selectedTable ? selectedTable.lakehouse || "Connected object" : "Use the left browser to set the current working table.",
              tone: selectedTable ? "accent" : "neutral",
            },
            {
              label: "Blend Stage",
              value: activeTab === 'blend' ? "Reviewing suggestions" : activeTab === 'preview' ? "Previewing join output" : "Profiling source table",
              detail: activeTab === 'profile' ? "Start with structure and column shape." : activeTab === 'blend' ? "Review system-generated candidates." : "Validate whether the blended result is worth promoting.",
              tone: activeTab === 'preview' ? "positive" : "neutral",
            },
            {
              label: "Purview",
              value: purviewConnected == null ? "Checking..." : purviewConnected ? "Connected" : "Offline",
              detail: purviewConnected ? "Governance context is available for this session." : "The workbench still runs, but governance enrichment is limited.",
              tone: purviewConnected ? "positive" : "warning",
            },
          ]}
          actions={[
            { label: "Explore hub", to: "/explore", tone: "quiet", icon: BookOpen },
            activeEntity ? { label: "Open lineage", to: buildEntityLineageUrl(activeEntity), tone: "secondary", icon: Network } : undefined,
            activeEntity ? { label: "Open catalog", to: buildEntityCatalogUrl(activeEntity), tone: "secondary", icon: BookOpen } : undefined,
            blockedEntity && resolutionAction ? { label: "Open Load Center", to: resolutionAction.to, tone: "primary", icon: Network } : undefined,
            sourceSql ? { label: "Inspect source", to: sourceSql, tone: "secondary", icon: Database } : undefined,
            selectedTable && !blockedEntity ? { label: "Profile mode", onClick: () => setActiveTab('profile'), tone: activeTab === 'profile' ? 'primary' : 'secondary', icon: Sparkles } : undefined,
          ].filter(Boolean) as never[]}
        />
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
            digestLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center space-y-3">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: "var(--bp-ink-tertiary)" }} />
                  <p className="text-sm" style={{ color: "var(--bp-ink-secondary)" }}>
                    Resolving whether this table is ready for tool mode...
                  </p>
                </div>
              </div>
            ) : (
            blockedEntity && resolutionAction ? (
              <div className="flex-1 overflow-auto p-4">
                <PipelineResolutionPanel
                  entity={blockedEntity}
                  action={resolutionAction}
                  summary="This table maps to a registered entity that has not finished the managed load path. Blender stops here and routes the user to Load Center instead of exposing half-working profiling and blend tabs."
                />
              </div>
            ) : (
            <>
              {/* Tabs */}
              <div className="flex items-center gap-0 px-4" style={{ borderBottom: "1px solid var(--bp-border)", backgroundColor: "var(--bp-surface-1)" }}>
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => !tab.disabled && setActiveTab(tab.id)}
                    disabled={tab.disabled}
                    className="px-4 py-2.5 transition-colors border-b-[2.5px] -mb-px cursor-pointer"
                    style={
                      activeTab === tab.id
                        ? { fontSize: 14, fontWeight: 700, borderBottomColor: "var(--bp-copper)", borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderTopLeftRadius: 2, borderTopRightRadius: 2, color: "var(--bp-ink-primary)" }
                        : tab.disabled
                          ? { fontSize: 14, fontWeight: 500, borderBottomColor: "transparent", color: "var(--bp-ink-muted)", opacity: 0.4, cursor: "not-allowed" }
                          : { fontSize: 14, fontWeight: 500, borderBottomColor: "transparent", color: "var(--bp-ink-muted)" }
                    }
                    onMouseEnter={(e) => {
                      if (activeTab !== tab.id && !tab.disabled) {
                        (e.currentTarget as HTMLButtonElement).style.color = "var(--bp-ink-secondary)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (activeTab !== tab.id && !tab.disabled) {
                        (e.currentTarget as HTMLButtonElement).style.color = "var(--bp-ink-muted)";
                      }
                    }}
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
            )
            )
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="text-4xl">
                  <img src="/icons/lakehouse.svg" alt="" className="gs-float h-12 w-12 mx-auto opacity-30" />
                </div>
                <h2 className="text-base font-semibold" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-secondary)" }}>Select a table to explore</h2>
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
