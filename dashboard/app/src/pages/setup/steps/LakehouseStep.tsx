import { FabricDropdown } from "../components/FabricDropdown";
import type { FabricEntity, LakehouseAssignment, EnvironmentConfig, NAMING_CONVENTIONS } from "../types";
import { Database } from "lucide-react";

const LAKEHOUSE_FIELDS: {
  key: keyof EnvironmentConfig["lakehouses"];
  label: string;
  defaultName: string;
  description: string;
}[] = [
  { key: "LH_DATA_LANDINGZONE", label: "Landing Zone Lakehouse", defaultName: "LH_DATA_LANDINGZONE", description: "Raw data extracted from sources (Parquet files)" },
  { key: "LH_BRONZE_LAYER", label: "Bronze Layer Lakehouse", defaultName: "LH_BRONZE_LAYER", description: "Cleaned Delta tables from landing zone data" },
  { key: "LH_SILVER_LAYER", label: "Silver Layer Lakehouse", defaultName: "LH_SILVER_LAYER", description: "Conformed, business-ready Delta tables" },
];

interface LakehouseStepProps {
  lakehouses: EnvironmentConfig["lakehouses"];
  dataWorkspaceId: string | null;
  onChange: (key: keyof EnvironmentConfig["lakehouses"], value: LakehouseAssignment | null) => void;
}

export function LakehouseStep({ lakehouses, dataWorkspaceId, onChange }: LakehouseStepProps) {
  const hasWorkspace = !!dataWorkspaceId;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-emerald-400" />
        <h3 className="text-sm font-semibold">Select or Create Lakehouses</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        FMD uses three lakehouses for the medallion architecture: Landing Zone (raw),
        Bronze (cleaned), and Silver (conformed). These live in the Data workspace.
      </p>

      <div className="space-y-3">
        {LAKEHOUSE_FIELDS.map((field) => (
          <div key={field.key} className="rounded-md border border-border/40 bg-card/50 p-3">
            <FabricDropdown
              label={field.label}
              endpoint={hasWorkspace ? `/setup/workspaces/${dataWorkspaceId}/lakehouses` : ""}
              responseKey="items"
              value={lakehouses[field.key]}
              onChange={(e) => {
                if (e) {
                  onChange(field.key, { ...e, workspaceGuid: dataWorkspaceId || "" });
                } else {
                  onChange(field.key, null);
                }
              }}
              canCreate={hasWorkspace}
              createEndpoint="/setup/create-lakehouse"
              createPayload={dataWorkspaceId ? { workspaceId: dataWorkspaceId } : {}}
              defaultCreateName={field.defaultName}
              disabled={!hasWorkspace}
              disabledMessage="Select a Data workspace in Step 2 first"
              subtitle={field.description}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
