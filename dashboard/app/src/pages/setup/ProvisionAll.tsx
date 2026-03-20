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
  creating: { color: "var(--bp-copper)", bg: "var(--bp-copper-light)" },
  ok: { color: "var(--bp-operational)", bg: "var(--bp-operational-light)" },
  error: { color: "var(--bp-fault)", bg: "var(--bp-fault-light)" },
  warning: { color: "var(--bp-caution)", bg: "var(--bp-caution-light)" },
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
      <div className="rounded-lg p-6" style={{ border: '1px dashed var(--bp-border-strong)', background: 'var(--bp-copper-light)' }}>
        <div className="flex items-start gap-4">
          <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-border)' }}>
            <Rocket className="h-6 w-6" style={{ color: 'var(--bp-copper)' }} />
          </div>
          <div className="space-y-2 flex-1">
            <h3 className="text-lg font-bold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-display)' }}>Provision Fresh Environment</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--bp-ink-secondary)', fontFamily: 'var(--bp-font-body)' }}>
              One click creates <strong>5 workspaces</strong>, <strong>3 lakehouses</strong>, and{" "}
              <strong>1 SQL database</strong> with correct naming conventions. Assigns Service
              Principal + FabricAdmins admin access to every workspace. Saves all IDs to every
              config target automatically.
            </p>
            <p className="text-xs" style={{ color: 'var(--bp-ink-muted)' }}>
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
          className="gap-2 bp-btn-primary"
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
        <div className="rounded-md p-3 text-xs" style={{ border: '1px solid var(--bp-fault)', background: 'var(--bp-fault-light)', color: 'var(--bp-fault)' }}>
          {error}
        </div>
      )}

      {/* Progress steps */}
      {steps.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-medium" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
              {provisioning ? "Provisioning..." : done ? "Provisioning Complete" : "Progress"}
            </h4>
            <div className="flex items-center gap-2">
              {done && (
                <span className="text-xs" style={{ color: 'var(--bp-ink-tertiary)' }}>
                  {successCount} succeeded{errorCount > 0 ? `, ${errorCount} failed` : ""}
                </span>
              )}
              {done && (
                <button
                  onClick={handleCopyIds}
                  className="text-[10px] flex items-center gap-1 transition-colors"
                  style={{ color: copied ? 'var(--bp-operational)' : 'var(--bp-ink-muted)' }}
                >
                  <Copy className="h-3 w-3" />
                  {copied ? "Copied!" : "Copy IDs"}
                </button>
              )}
            </div>
          </div>

          <div className="rounded-md divide-y" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
            {steps.map((step, i) => {
              const style = STATUS_STYLES[step.status];
              const Icon = getStepIcon(step.name);
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5" style={{ borderColor: 'var(--bp-border-subtle)' }}>
                  <Icon className="h-4 w-4 shrink-0" style={{ color: style.color }} />
                  <span className="text-sm font-medium flex-1" style={{ color: 'var(--bp-ink-primary)' }}>{step.name}</span>
                  {step.status === "creating" && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--bp-copper)' }} />
                  )}
                  {step.status === "ok" && (
                    <CheckCircle2 className="h-3.5 w-3.5" style={{ color: 'var(--bp-operational)' }} />
                  )}
                  {step.status === "error" && (
                    <XCircle className="h-3.5 w-3.5" style={{ color: 'var(--bp-fault)' }} />
                  )}
                  {step.status === "warning" && (
                    <AlertTriangle className="h-3.5 w-3.5" style={{ color: 'var(--bp-caution)' }} />
                  )}
                  {step.details && (
                    <span
                      className="text-[10px] max-w-[200px] truncate"
                      style={{ color: step.status === "error" ? 'var(--bp-fault)' : 'var(--bp-ink-muted)' }}
                      title={step.details}
                    >
                      {step.details}
                    </span>
                  )}
                  {step.id && (
                    <span
                      className="text-[9px] max-w-[180px] truncate"
                      style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-muted)' }}
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

      {/* Success confirmation panel */}
      {done && errorCount === 0 && (
        <div className="rounded-lg p-6 space-y-4" style={{ border: '1px solid var(--bp-operational)', background: 'var(--bp-operational-light)' }}>
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--bp-surface-1)', border: '1px solid var(--bp-operational)' }}>
              <CheckCircle2 className="h-5 w-5" style={{ color: 'var(--bp-operational)' }} />
            </div>
            <div>
              <h3 className="text-base font-bold" style={{ color: 'var(--bp-operational)' }}>
                Environment Provisioned Successfully
              </h3>
              <p className="text-xs mt-1" style={{ color: 'var(--bp-ink-secondary)' }}>
                All {successCount} resources created. Config saved to <strong>item_config.yaml</strong>,{" "}
                <strong>config.json</strong>, <strong>SQL metadata</strong>, and{" "}
                <strong>variable libraries</strong>.
              </p>
            </div>
          </div>

          {/* Resource summary grid */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-md p-3" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--bp-ink-muted)' }}>Workspaces</div>
              <div className="text-2xl font-bold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>5</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--bp-ink-tertiary)' }}>2 DEV + 2 PROD + 1 CONFIG</div>
            </div>
            <div className="rounded-md p-3" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--bp-ink-muted)' }}>Lakehouses</div>
              <div className="text-2xl font-bold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>3</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--bp-ink-tertiary)' }}>LZ + Bronze + Silver</div>
            </div>
            <div className="rounded-md p-3" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
              <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--bp-ink-muted)' }}>SQL Database</div>
              <div className="text-2xl font-bold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-mono)', fontVariantNumeric: 'tabular-nums' }}>1</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--bp-ink-tertiary)' }}>Metadata DB</div>
            </div>
          </div>

          {/* Config targets confirmation */}
          <div className="rounded-md p-3" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
            <div className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--bp-ink-muted)' }}>
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
                  <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: 'var(--bp-operational)' }} />
                  <span style={{ color: 'var(--bp-ink-tertiary)' }}>{target}</span>
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
              className="flex items-center gap-1.5 text-xs transition-colors"
              style={{ color: 'var(--bp-ink-tertiary)' }}
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
              className="gap-1.5"
              style={{ color: 'var(--bp-ink-tertiary)' }}
            >
              <Rocket className="h-3.5 w-3.5" />
              Provision Again
            </Button>
          </div>
        </div>
      )}

      {/* Partial success with errors */}
      {done && errorCount > 0 && (
        <div className="rounded-lg p-5 space-y-3" style={{ border: '1px solid var(--bp-caution)', background: 'var(--bp-caution-light)' }}>
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: 'var(--bp-caution)' }} />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--bp-caution)' }}>
                Provisioned with {errorCount} error{errorCount > 1 ? "s" : ""}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--bp-ink-secondary)' }}>
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
