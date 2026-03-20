import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ShieldCheck, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { SaveResults, ValidationResultsView } from "../components/ValidationResults";
import type { EnvironmentConfig, SaveResult, ValidationCheck } from "../types";

const API = "/api";

interface ReviewStepProps {
  config: EnvironmentConfig;
}

function ReviewRow({ label, value, sub }: { label: string; value: string | null; sub?: string }) {
  const isSet = !!value;
  return (
    <tr style={{ borderBottom: '1px solid var(--bp-border-subtle)' }}>
      <td className="py-1.5 pr-4 text-xs whitespace-nowrap" style={{ color: 'var(--bp-ink-tertiary)' }}>{label}</td>
      <td className="py-1.5 text-xs">
        {isSet ? (
          <div>
            <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>{value}</span>
            {sub && <span className="ml-2 text-[10px]" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-muted)' }}>{sub}</span>}
          </div>
        ) : (
          <span className="italic" style={{ color: 'var(--bp-ink-muted)' }}>Not configured</span>
        )}
      </td>
      <td className="py-1.5 pl-3 w-6">
        {isSet ? (
          <CheckCircle2 className="h-3.5 w-3.5" style={{ color: 'var(--bp-operational)' }} />
        ) : (
          <XCircle className="h-3.5 w-3.5" style={{ color: 'var(--bp-ink-muted)' }} />
        )}
      </td>
    </tr>
  );
}

export function ReviewStep({ config }: ReviewStepProps) {
  const [saving, setSaving] = useState(false);
  const [saveResults, setSaveResults] = useState<SaveResult[]>([]);
  const [validating, setValidating] = useState(false);
  const [validationChecks, setValidationChecks] = useState<ValidationCheck[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveResults([]);
    setValidationChecks([]);
    try {
      const resp = await fetch(`${API}/setup/save-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await resp.json();
      if (data.error) {
        setSaveError(data.error);
        return;
      }
      setSaveResults(data.results || []);

      // Auto-run validation after save
      setValidating(true);
      try {
        const vResp = await fetch(`${API}/setup/validate`);
        const vData = await vResp.json();
        setValidationChecks(vData.checks || []);
      } catch {
        // Validation is optional
      } finally {
        setValidating(false);
      }
    } catch (ex) {
      setSaveError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setSaving(false);
    }
  };

  const ws = config.workspaces;
  const lh = config.lakehouses;
  const nb = config.notebooks;
  const pl = config.pipelines;
  const db = config.database;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4" style={{ color: 'var(--bp-operational)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>Review Configuration</h3>
      </div>

      <div className="rounded-md p-4" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--bp-border)' }}>
              <th className="pb-1.5 text-left text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--bp-ink-muted)' }}>Setting</th>
              <th className="pb-1.5 text-left text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--bp-ink-muted)' }}>Value</th>
              <th className="pb-1.5 w-6"></th>
            </tr>
          </thead>
          <tbody>
            <ReviewRow label="Capacity" value={config.capacity?.displayName || null} sub={config.capacity?.id} />
            <ReviewRow label="Data Workspace (Dev)" value={ws.data_dev?.displayName || null} sub={ws.data_dev?.id} />
            <ReviewRow label="Code Workspace (Dev)" value={ws.code_dev?.displayName || null} sub={ws.code_dev?.id} />
            <ReviewRow label="Config Workspace" value={ws.config?.displayName || null} sub={ws.config?.id} />
            <ReviewRow label="Data Workspace (Prod)" value={ws.data_prod?.displayName || null} sub={ws.data_prod?.id} />
            <ReviewRow label="Code Workspace (Prod)" value={ws.code_prod?.displayName || null} sub={ws.code_prod?.id} />
            <ReviewRow label="Landing Zone" value={lh.LH_DATA_LANDINGZONE?.displayName || null} sub={lh.LH_DATA_LANDINGZONE?.id} />
            <ReviewRow label="Bronze Layer" value={lh.LH_BRONZE_LAYER?.displayName || null} sub={lh.LH_BRONZE_LAYER?.id} />
            <ReviewRow label="Silver Layer" value={lh.LH_SILVER_LAYER?.displayName || null} sub={lh.LH_SILVER_LAYER?.id} />
            <ReviewRow label="SQL Database" value={db?.displayName || null} sub={db?.id} />
            <ReviewRow label="NB Landing → Bronze" value={nb.NB_FMD_LOAD_LANDING_BRONZE?.displayName || null} sub={nb.NB_FMD_LOAD_LANDING_BRONZE?.id} />
            <ReviewRow label="NB Bronze → Silver" value={nb.NB_FMD_LOAD_BRONZE_SILVER?.displayName || null} sub={nb.NB_FMD_LOAD_BRONZE_SILVER?.id} />
            <ReviewRow label="PL LDZ Copy SQL" value={pl.PL_FMD_LDZ_COPY_SQL?.displayName || null} sub={pl.PL_FMD_LDZ_COPY_SQL?.id} />
            {Object.entries(config.connections).map(([key, conn]) => (
              <ReviewRow key={key} label={key} value={conn?.displayName || null} sub={conn?.id} />
            ))}
          </tbody>
        </table>
      </div>

      {saveError && (
        <div className="rounded-md p-3 text-xs" style={{ border: '1px solid var(--bp-fault)', background: 'var(--bp-fault-light)', color: 'var(--bp-fault)' }}>
          {saveError}
        </div>
      )}

      <SaveResults results={saveResults} />
      <ValidationResultsView checks={validationChecks} />

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? "Saving..." : "Save & Propagate"}
        </Button>
        {validating && (
          <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--bp-ink-muted)' }}>
            <Loader2 className="h-3 w-3 animate-spin" />
            Validating...
          </span>
        )}
        {saveResults.length > 0 && saveResults.every((r) => r.status === "ok") && (
          <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--bp-operational)' }}>
            <CheckCircle2 className="h-3.5 w-3.5" />
            All targets updated successfully
          </span>
        )}
      </div>

      {saveResults.length > 0 && (
        <p className="text-[10px]" style={{ color: 'var(--bp-ink-muted)' }}>
          Changes to config.json require a server restart to take effect.
        </p>
      )}
    </div>
  );
}
