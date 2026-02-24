import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { TableBrowser } from '@/components/datablender/TableBrowser';
import { TableProfiler } from '@/components/datablender/TableProfiler';
import { BlendSuggestions } from '@/components/datablender/BlendSuggestions';
import { BlendPreview } from '@/components/datablender/BlendPreview';
import { SqlWorkbench } from '@/components/datablender/SqlWorkbench';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle } from 'lucide-react';

type Tab = 'profile' | 'blend' | 'preview';

export default function DataBlender() {
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [selectedBlendId, setSelectedBlendId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [purviewConnected, setPurviewConnected] = useState<boolean | null>(null);

  useEffect(() => {
    checkPurview();
  }, []);

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

  const handleSelectTable = (tableId: string) => {
    setSelectedTableId(tableId);
    setSelectedBlendId(null);
    setActiveTab('profile');
  };

  const handleSelectBlend = (blendId: string) => {
    setSelectedBlendId(blendId);
    setActiveTab('preview');
  };

  const tabs: { id: Tab; label: string; disabled?: boolean }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'blend', label: 'Blend Suggestions' },
    { id: 'preview', label: 'Preview', disabled: !selectedBlendId },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] bg-background">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-display font-semibold">Data Blender</h1>
          <span className="text-[10px] text-muted-foreground">Exploration sandbox — browse, profile, preview blends</span>
        </div>
        <div className="flex items-center gap-2">
          {purviewConnected !== null && (
            <div className="flex items-center gap-1 text-[10px]">
              {purviewConnected ? (
                <>
                  <CheckCircle2 className="h-3 w-3 text-success" />
                  <span className="text-success">Purview</span>
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground">Purview offline</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content: sidebar + content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: Table browser */}
        <div className="w-64 border-r border-border bg-card flex-shrink-0 overflow-hidden">
          <TableBrowser
            selectedTableId={selectedTableId}
            onSelectTable={handleSelectTable}
          />
        </div>

        {/* Right panel: Content */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {selectedTableId ? (
            <>
              {/* Tabs */}
              <div className="flex items-center gap-0 px-4 border-b border-border bg-card">
                {tabs.map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => !tab.disabled && setActiveTab(tab.id)}
                    disabled={tab.disabled}
                    className={cn(
                      "px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px cursor-pointer",
                      activeTab === tab.id
                        ? "border-primary text-primary"
                        : tab.disabled
                          ? "border-transparent text-muted-foreground/40 cursor-not-allowed"
                          : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                    )}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="flex-1 overflow-hidden">
                {activeTab === 'profile' && (
                  <TableProfiler tableId={selectedTableId} />
                )}
                {activeTab === 'blend' && (
                  <BlendSuggestions
                    sourceTableId={selectedTableId}
                    selectedBlendId={selectedBlendId}
                    onSelectBlend={handleSelectBlend}
                  />
                )}
                {activeTab === 'preview' && selectedBlendId && (
                  <BlendPreview blendId={selectedBlendId} />
                )}
              </div>

              {/* SQL Workbench */}
              <SqlWorkbench tableId={selectedTableId} />
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center space-y-3">
                <div className="text-4xl">
                  <img src="/icons/lakehouse.svg" alt="" className="h-12 w-12 mx-auto opacity-30" />
                </div>
                <h2 className="text-sm font-display font-semibold text-muted-foreground">Select a table to explore</h2>
                <p className="text-xs text-muted-foreground max-w-sm">
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
