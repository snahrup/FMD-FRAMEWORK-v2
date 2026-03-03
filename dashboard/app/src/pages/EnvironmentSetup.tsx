import { useState, useEffect } from "react";
import { Loader2, Server, Wand2, Settings2, Rocket } from "lucide-react";
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

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${API}/setup/current-config`);
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        const data = await resp.json();
        if (data.config) {
          setConfig({ ...EMPTY_CONFIG, ...data.config });
          // If config has workspaces already set, default to Settings mode
          if (data.config.workspaces?.data_dev?.id) {
            setMode("settings");
          }
        }
      } catch (ex) {
        setLoadError(ex instanceof Error ? ex.message : String(ex));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
        <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-muted/30 p-1">
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
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
          Could not load current config: {loadError}. Starting with empty configuration.
        </div>
      )}

      {/* Content */}
      <div className="rounded-xl border border-border/50 bg-card/50 p-6">
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
