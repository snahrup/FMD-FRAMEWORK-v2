import { useState, useEffect, useCallback } from "react";
import { Loader2, Server, Wand2, Settings2, Rocket, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { SetupWizard } from "./setup/SetupWizard";
import { SetupSettings } from "./setup/SetupSettings";
import { ProvisionAll } from "./setup/ProvisionAll";
import type { EnvironmentConfig, SetupMode } from "./setup/types";
import { EMPTY_CONFIG } from "./setup/types";

const API = "/api";

export default function EnvironmentSetup() {
  const [mode, setMode] = useState<SetupMode>("provision");
  const [config, setConfig] = useState<EnvironmentConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadConfig = useCallback(async (signal: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await fetch(`${API}/setup/current-config`, { signal });
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
      const ct = resp.headers.get("content-type") ?? "";
      if (!ct.includes("application/json")) {
        throw new Error(`Expected JSON response but got ${ct || "unknown content-type"}`);
      }
      const data = await resp.json();
      if (signal.aborted) return;
      const cfg = data.config ?? (data.workspaces ? data : null);
      if (cfg) {
        setConfig({ ...EMPTY_CONFIG, ...cfg });
        if (cfg.workspaces?.data_dev?.id) {
          setMode("settings");
        }
      }
    } catch (ex) {
      if (signal.aborted) return;
      setLoadError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    loadConfig(ac.signal);
    return () => ac.abort();
  }, [loadConfig]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="flex items-center gap-3" style={{ color: 'var(--bp-ink-muted)' }}>
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm" style={{ fontFamily: 'var(--bp-font-body)' }}>Loading current configuration...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" style={{ padding: '32px', maxWidth: '1280px' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--bp-copper-light)', border: '1px solid var(--bp-border)' }}>
            <Server className="h-5 w-5" style={{ color: 'var(--bp-copper)' }} />
          </div>
          <div>
            <h1 style={{ fontFamily: 'var(--bp-font-display)', fontSize: '32px', color: 'var(--bp-ink-primary)' }}>Environment Setup</h1>
            <p className="text-xs" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
              Configure Fabric workspaces, lakehouses, SQL database, and connections
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 rounded-lg p-1" role="tablist" aria-label="Setup mode" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-inset)' }}>
          {([
            { key: "provision" as const, icon: Rocket, label: "Provision" },
            { key: "wizard" as const, icon: Wand2, label: "Wizard" },
            { key: "settings" as const, icon: Settings2, label: "Settings" },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={mode === key}
              aria-controls={`panel-${key}`}
              onClick={() => setMode(key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
              )}
              style={{
                background: mode === key ? 'var(--bp-surface-1)' : 'transparent',
                color: mode === key ? 'var(--bp-ink-primary)' : 'var(--bp-ink-tertiary)',
                boxShadow: mode === key ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                fontFamily: 'var(--bp-font-body)',
              }}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <div role="alert" className="rounded-md p-3 text-xs flex items-center justify-between gap-3" style={{ border: '1px solid var(--bp-caution)', background: 'var(--bp-caution-light)', color: 'var(--bp-caution)' }}>
          <span>Could not load current config: {loadError}. Starting with empty configuration.</span>
          <button
            onClick={() => {
              const ac = new AbortController();
              loadConfig(ac.signal);
            }}
            aria-label="Retry loading configuration"
            className="flex items-center gap-1 shrink-0 px-2 py-1 rounded transition-colors"
            style={{ border: '1px solid var(--bp-caution)', color: 'var(--bp-caution)' }}
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* Content */}
      <div className="rounded-xl p-6" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
        {mode === "provision" && (
          <div id="panel-provision" role="tabpanel">
            <ProvisionAll
              onComplete={(newConfig) => {
                setConfig(newConfig);
                setMode("settings");
              }}
            />
          </div>
        )}
        {mode === "wizard" && (
          <div id="panel-wizard" role="tabpanel">
            <SetupWizard config={config} onConfigChange={setConfig} />
          </div>
        )}
        {mode === "settings" && (
          <div id="panel-settings" role="tabpanel">
            <SetupSettings config={config} onConfigChange={setConfig} />
          </div>
        )}
      </div>
    </div>
  );
}
