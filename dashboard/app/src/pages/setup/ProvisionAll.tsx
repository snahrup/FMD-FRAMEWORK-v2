import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Rocket,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FolderOpen,
  Database,
  Server,
  Zap,
  Link2,
  Copy,
  ExternalLink,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FabricDropdown } from "./components/FabricDropdown";
import type { EnvironmentConfig, FabricCapacity } from "./types";

const API = "/api";

interface ProvisionStep {
  name: string;
  status: "creating" | "ok" | "error" | "warning";
  id?: string;
  details?: string;
}

interface ProvisionAllProps {
  onComplete: (config: EnvironmentConfig) => void;
}

const STEP_ICONS: Record<string, typeof Server> = {
  Connections: Link2,
  Workspace: FolderOpen,
  Lakehouse: Database,
  SQL: Server,
  Save: Zap,
};

function getStepIcon(name: string) {
  for (const [prefix, Icon] of Object.entries(STEP_ICONS)) {
    if (name.startsWith(prefix)) return Icon;
  }
  return Zap;
}

const STATUS_STYLES = {
  creating: { color: "text-blue-400", bg: "bg-blue-500/10" },
  ok: { color: "text-emerald-400", bg: "bg-emerald-500/10" },
  error: { color: "text-red-400", bg: "bg-red-500/10" },
  warning: { color: "text-amber-400", bg: "bg-amber-500/10" },
};

export function ProvisionAll({ onComplete }: ProvisionAllProps) {
  const [capacity, setCapacity] = useState<FabricCapacity | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [steps, setSteps] = useState<ProvisionStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const configRef = useRef<EnvironmentConfig | null>(null);

  const handleProvision = async () => {
    if (!capacity) return;
    setProvisioning(true);
    setSteps([]);
    setError(null);
    setDone(false);

    const placeholders: ProvisionStep[] = [
      { name: "Connections: carry forward", status: "creating" },
      { name: "Workspace: INTEGRATION DATA (D)", status: "creating" },
      { name: "Workspace: INTEGRATION CODE (D)", status: "creating" },
      { name: "Workspace: INTEGRATION CONFIG", status: "creating" },
      { name: "Workspace: INTEGRATION DATA (P)", status: "creating" },
      { name: "Workspace: INTEGRATION CODE (P)", status: "creating" },
      { name: "Lakehouse: LH_DATA_LANDINGZONE", status: "creating" },
      { name: "Lakehouse: LH_BRONZE_LAYER", status: "creating" },
      { name: "Lakehouse: LH_SILVER_LAYER", status: "creating" },
      { name: "SQL Database: SQL_INTEGRATION_FRAMEWORK", status: "creating" },
      { name: "Save & propagate config", status: "creating" },
    ];
    setSteps(placeholders);

    try {
      const resp = await fetch(`${API}/setup/provision-all`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capacityId: capacity.id,
          capacityDisplayName: capacity.displayName,
        }),
      });
      const data = await resp.json();
      if (data.error) {
        setError(data.error);
        setSteps([]);
        return;
      }

      setSteps(data.steps || []);
      setDone(true);

      if (data.config) {
        const newConfig: EnvironmentConfig = {
          capacity,
          workspaces: {
            data_dev: data.config.workspaces?.data_dev || null,
            code_dev: data.config.workspaces?.code_dev || null,
            config: data.config.workspaces?.config || null,
            data_prod: data.config.workspaces?.data_prod || null,
            code_prod: data.config.workspaces?.code_prod || null,
          },
          connections: data.config.connections || {},
          lakehouses: {
            LH_DATA_LANDINGZONE: data.config.lakehouses?.LH_DATA_LANDINGZONE || null,
            LH_BRONZE_LAYER: data.config.lakehouses?.LH_BRONZE_LAYER || null,
            LH_SILVER_LAYER: data.config.lakehouses?.LH_SILVER_LAYER || null,
          },
          database: data.config.database || null,
          notebooks: data.config.notebooks || {},
          pipelines: data.config.pipelines || {},
        };
        configRef.current = newConfig;
        // Don't auto-navigate — let user review the results first
      }
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
      setSteps([]);
    } finally {
      setProvisioning(false);
    }
  };

  const handleCopyIds = () => {
    const lines: string[] = [];
    for (const step of steps) {
      if (step.id) lines.push(`${step.name}: ${step.id}`);
    }
    navigator.clipboard.writeText(lines.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGoToSettings = () => {
    if (configRef.current) onComplete(configRef.current);
  };

  const successCount = steps.filter((s) => s.status === "ok").length;
  const errorCount = steps.filter((s) => s.status === "error").length;

  return (
    <div className="space-y-5">
      {/* Hero banner */}
      <div className="rounded-lg border border-dashed border-blue-500/30 bg-gradient-to-br from-blue-500/5 to-purple-500/5 p-6">
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30 flex items-center justify-center shrink-0">
            <Rocket className="h-6 w-6 text-blue-400" />
          </div>
          <div className="space-y-2 flex-1">
            <h3 className="text-lg font-bold">Provision Fresh Environment</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              One click creates <strong>5 workspaces</strong>, <strong>3 lakehouses</strong>, and{" "}
              <strong>1 SQL database</strong> with correct naming conventions. Assigns Service
              Principal + FabricAdmins admin access to every workspace. Saves all IDs to every
              config target automatically.
            </p>
            <p className="text-xs text-muted-foreground/60">
              Idempotent — safe to run again. Existing resources with matching names will be reused,
              not duplicated.
            </p>
          </div>
        </div>
      </div>

      {/* Capacity picker — only before provisioning */}
      {!done && (
        <div className="max-w-sm">
          <FabricDropdown
            label="Fabric Capacity"
            endpoint="/setup/capacities"
            responseKey="capacities"
            value={capacity}
            onChange={(e) => setCapacity(e as FabricCapacity | null)}
            subtitle="Select the capacity for the new workspaces"
          />
        </div>
      )}

      {/* Provision button */}
      {!done && (
        <Button
          onClick={handleProvision}
          disabled={!capacity || provisioning}
          size="lg"
          className="gap-2"
        >
          {provisioning ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Rocket className="h-4 w-4" />
          )}
          {provisioning ? "Provisioning..." : "Provision Everything"}
        </Button>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Progress steps */}
      {steps.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium text-muted-foreground">
              {provisioning ? "Provisioning..." : done ? "Provisioning Complete" : "Progress"}
            </h4>
            <div className="flex items-center gap-2">
              {done && (
                <span className="text-xs text-muted-foreground">
                  {successCount} succeeded{errorCount > 0 ? `, ${errorCount} failed` : ""}
                </span>
              )}
              {done && (
                <button
                  onClick={handleCopyIds}
                  className="text-[10px] text-muted-foreground/60 hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? "Copied!" : "Copy IDs"}
                </button>
              )}
            </div>
          </div>

          <div className="rounded-md border border-border/40 bg-card divide-y divide-border/20">
            {steps.map((step, i) => {
              const style = STATUS_STYLES[step.status];
              const Icon = getStepIcon(step.name);
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <Icon className={cn("h-4 w-4 shrink-0", style.color)} />
                  <span className="text-sm font-medium flex-1">{step.name}</span>
                  {step.status === "creating" && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                  )}
                  {step.status === "ok" && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  )}
                  {step.status === "error" && (
                    <XCircle className="h-3.5 w-3.5 text-red-400" />
                  )}
                  {step.status === "warning" && (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                  )}
                  {step.details && (
                    <span
                      className={cn(
                        "text-[10px] max-w-[200px] truncate",
                        step.status === "error" ? "text-red-400" : "text-muted-foreground/60",
                      )}
                      title={step.details}
                    >
                      {step.details}
                    </span>
                  )}
                  {step.id && (
                    <span
                      className="text-[9px] font-mono text-muted-foreground/40 max-w-[180px] truncate"
                      title={step.id}
                    >
                      {step.id}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Success confirmation panel ── */}
      {done && errorCount === 0 && (
        <div className="rounded-lg border border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-green-500/5 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-base font-bold text-emerald-400">
                Environment Provisioned Successfully
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                All {successCount} resources created. Config saved to <strong>item_config.yaml</strong>,{" "}
                <strong>config.json</strong>, <strong>SQL metadata</strong>, and{" "}
                <strong>variable libraries</strong>.
              </p>
            </div>
          </div>

          {/* Resource summary grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md border border-border/30 bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Workspaces</div>
              <div className="text-2xl font-bold text-foreground">5</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">2 DEV + 2 PROD + 1 CONFIG</div>
            </div>
            <div className="rounded-md border border-border/30 bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">Lakehouses</div>
              <div className="text-2xl font-bold text-foreground">3</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">LZ + Bronze + Silver</div>
            </div>
            <div className="rounded-md border border-border/30 bg-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-1">SQL Database</div>
              <div className="text-2xl font-bold text-foreground">1</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Metadata DB</div>
            </div>
          </div>

          {/* Config targets confirmation */}
          <div className="rounded-md border border-border/30 bg-card p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Config Propagated To
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                "config/item_config.yaml",
                "dashboard/app/api/config.json",
                "SQL metadata tables",
                "Variable libraries",
              ].map((target) => (
                <div key={target} className="flex items-center gap-1.5 text-[11px]">
                  <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                  <span className="text-muted-foreground">{target}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3 pt-1">
            <Button onClick={handleGoToSettings} variant="outline" size="sm" className="gap-1.5">
              <Settings2 className="h-3.5 w-3.5" />
              Review in Settings
            </Button>
            <a
              href="https://app.fabric.microsoft.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open Fabric Portal
            </a>
            <Button
              onClick={() => {
                setDone(false);
                setSteps([]);
                setCapacity(null);
                configRef.current = null;
              }}
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
            >
              <Rocket className="h-3.5 w-3.5" />
              Provision Again
            </Button>
          </div>
        </div>
      )}

      {/* Partial success with errors */}
      {done && errorCount > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-gradient-to-br from-amber-500/5 to-orange-500/5 p-5 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-400">
                Provisioned with {errorCount} error{errorCount > 1 ? "s" : ""}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {successCount} resources succeeded, {errorCount} failed. Review errors above and
                re-run — idempotent, won't duplicate existing resources.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => {
                setDone(false);
                setSteps([]);
              }}
              variant="outline"
              size="sm"
              className="gap-1.5"
            >
              <Rocket className="h-3.5 w-3.5" />
              Retry
            </Button>
            {configRef.current && (
              <Button onClick={handleGoToSettings} variant="ghost" size="sm" className="gap-1.5">
                <Settings2 className="h-3.5 w-3.5" />
                Review in Settings
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
