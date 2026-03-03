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
    <tr className="border-b border-border/20">
      <td className="py-1.5 pr-4 text-xs text-muted-foreground whitespace-nowrap">{label}</td>
      <td className="py-1.5 text-xs">
        {isSet ? (
          <div>
            <span className="font-medium text-foreground">{value}</span>
            {sub && <span className="ml-2 font-mono text-[10px] text-muted-foreground/50">{sub}</span>}
          </div>
        ) : (
          <span className="text-muted-foreground/40 italic">Not configured</span>
        )}
      </td>
      <td className="py-1.5 pl-3 w-6">
        {isSet ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-muted-foreground/30" />
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
  const db = config.database;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold">Review Configuration</h3>
      </div>

      <div className="rounded-md border border-border/40 bg-card/50 p-4">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border/30">
              <th className="pb-1.5 text-left text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Setting</th>
              <th className="pb-1.5 text-left text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Value</th>
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
            {Object.entries(config.connections).map(([key, conn]) => (
              <ReviewRow key={key} label={key} value={conn?.displayName || null} sub={conn?.id} />
            ))}
          </tbody>
        </table>
      </div>

      {saveError && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
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
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="h-3 w-3 animate-spin" />
            Validating...
          </span>
        )}
        {saveResults.length > 0 && saveResults.every((r) => r.status === "ok") && (
          <span className="text-xs text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            All targets updated successfully
          </span>
        )}
      </div>

      {saveResults.length > 0 && (
        <p className="text-[10px] text-muted-foreground/50">
          Changes to config.json require a server restart to take effect.
        </p>
      )}
    </div>
  );
}
