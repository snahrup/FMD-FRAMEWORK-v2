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
      // Backend returns { workspaces, lakehouses, database, ... } at top level.
      // Map into EnvironmentConfig when a "config" wrapper is present,
      // otherwise check for known top-level keys.
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
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Loading current configuration...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30 flex items-center justify-center">
            <Server className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Environment Setup</h1>
            <p className="text-xs text-muted-foreground">
              Configure Fabric workspaces, lakehouses, SQL database, and connections
            </p>
          </div>
        </div>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-muted p-1">
          {([
            { key: "provision" as const, icon: Rocket, label: "Provision" },
            { key: "wizard" as const, icon: Wand2, label: "Wizard" },
            { key: "settings" as const, icon: Settings2, label: "Settings" },
          ]).map(({ key, icon: Icon, label }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                mode === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {loadError && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400 flex items-center justify-between gap-3">
          <span>Could not load current config: {loadError}. Starting with empty configuration.</span>
          <button
            onClick={() => {
              const ac = new AbortController();
              loadConfig(ac.signal);
            }}
            className="flex items-center gap-1 shrink-0 px-2 py-1 rounded border border-amber-500/30 hover:bg-amber-500/20 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </button>
        </div>
      )}

      {/* Content */}
      <div className="rounded-xl border border-border/50 bg-card p-6">
        {mode === "provision" && (
          <ProvisionAll
            onComplete={(newConfig) => {
              setConfig(newConfig);
              setMode("settings");
            }}
          />
        )}
        {mode === "wizard" && (
          <SetupWizard config={config} onConfigChange={setConfig} />
        )}
        {mode === "settings" && (
          <SetupSettings config={config} onConfigChange={setConfig} />
        )}
      </div>
    </div>
  );
}
