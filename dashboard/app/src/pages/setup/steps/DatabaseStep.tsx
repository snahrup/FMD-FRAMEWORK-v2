import { FabricDropdown } from "../components/FabricDropdown";
import type { FabricSqlDatabase, FabricEntity } from "../types";
import { Server } from "lucide-react";

interface DatabaseStepProps {
  value: FabricSqlDatabase | null;
  configWorkspaceId: string | null;
  onChange: (db: FabricSqlDatabase | null) => void;
}

export function DatabaseStep({ value, configWorkspaceId, onChange }: DatabaseStepProps) {
  const hasWorkspace = !!configWorkspaceId;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-cyan-400" />
        <h3 className="text-sm font-semibold">Select or Create SQL Database</h3>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        The metadata SQL database stores all FMD configuration — entity registrations, connections,
        execution tracking, and audit logs. It lives in the Config workspace.
      </p>

      <div className="rounded-md border border-border/40 bg-card/50 p-3">
        <FabricDropdown
          label="SQL Database"
          endpoint={hasWorkspace ? `/setup/workspaces/${configWorkspaceId}/sql-databases` : ""}
          responseKey="items"
          value={value}
          onChange={(e) => onChange(e as FabricSqlDatabase | null)}
          canCreate={hasWorkspace}
          createEndpoint="/setup/create-sql-database"
          createPayload={configWorkspaceId ? { workspaceId: configWorkspaceId } : {}}
          defaultCreateName="SQL_INTEGRATION_FRAMEWORK"
          disabled={!hasWorkspace}
          disabledMessage="Select a Config workspace in Step 2 first"
          subtitle="Fabric SQL database for FMD metadata"
        />
      </div>

      {value && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1">
          <div className="grid grid-cols-1 gap-1 text-xs">
            <div>
              <span className="text-muted-foreground">Database:</span>{" "}
              <span className="font-medium text-foreground">{value.displayName}</span>
            </div>
            {(value as FabricSqlDatabase).serverFqdn && (
              <div>
                <span className="text-muted-foreground">Endpoint:</span>{" "}
                <span className="font-mono text-[10px] text-foreground">
                  {(value as FabricSqlDatabase).serverFqdn}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
