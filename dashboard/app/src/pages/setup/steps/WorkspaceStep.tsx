import { FabricDropdown } from "../components/FabricDropdown";
import type { FabricEntity, EnvironmentConfig, NAMING_CONVENTIONS } from "../types";
import { FolderOpen } from "lucide-react";

const WORKSPACE_FIELDS: {
  key: keyof EnvironmentConfig["workspaces"];
  label: string;
  defaultName: string;
  description: string;
}[] = [
  { key: "data_dev", label: "Data Workspace (Dev)", defaultName: "INTEGRATION DATA (D)", description: "Lakehouses and data assets" },
  { key: "code_dev", label: "Code Workspace (Dev)", defaultName: "INTEGRATION CODE (D)", description: "Pipelines, notebooks, and code" },
  { key: "config", label: "Config Workspace", defaultName: "INTEGRATION CONFIG", description: "SQL database and variable libraries" },
  { key: "data_prod", label: "Data Workspace (Prod)", defaultName: "INTEGRATION DATA (P)", description: "Production lakehouses" },
  { key: "code_prod", label: "Code Workspace (Prod)", defaultName: "INTEGRATION CODE (P)", description: "Production pipelines and notebooks" },
];

interface WorkspaceStepProps {
  workspaces: EnvironmentConfig["workspaces"];
  capacityId: string | null;
  onChange: (key: keyof EnvironmentConfig["workspaces"], value: FabricEntity | null) => void;
}

export function WorkspaceStep({ workspaces, capacityId, onChange }: WorkspaceStepProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4" style={{ color: 'var(--bp-copper)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>Select or Create Workspaces</h3>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
        FMD uses 5 workspaces to separate code from data and dev from prod.
        Select existing workspaces or create new ones with the standard naming convention.
      </p>

      <div className="space-y-3">
        {WORKSPACE_FIELDS.map((field) => (
          <div key={field.key} className="rounded-md p-3" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
            <FabricDropdown
              label={field.label}
              endpoint="/fabric/workspaces"
              responseKey="workspaces"
              value={workspaces[field.key]}
              onChange={(e) => onChange(field.key, e)}
              canCreate={!!capacityId}
              createEndpoint="/setup/create-workspace"
              createPayload={capacityId ? { capacityId } : {}}
              defaultCreateName={field.defaultName}
              subtitle={field.description}
            />
          </div>
        ))}
      </div>

      {!capacityId && (
        <p className="text-[10px] italic" style={{ color: 'var(--bp-caution)' }}>
          Select a capacity in Step 1 to enable workspace creation.
        </p>
      )}
    </div>
  );
}
