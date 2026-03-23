import { FabricDropdown } from "../components/FabricDropdown";
import type { FabricSqlDatabase } from "../types";
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
        <Server className="h-4 w-4" style={{ color: 'var(--bp-copper)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--bp-ink-primary)', fontFamily: 'var(--bp-font-body)' }}>Select or Create SQL Database</h3>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--bp-ink-tertiary)', fontFamily: 'var(--bp-font-body)' }}>
        The metadata SQL database stores all FMD configuration — entity registrations, connections,
        execution tracking, and audit logs. It lives in the Config workspace.
      </p>

      <div className="rounded-md p-3" style={{ border: '1px solid var(--bp-border)', background: 'var(--bp-surface-1)' }}>
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
        <div className="rounded-md p-3 space-y-1" style={{ border: '1px solid var(--bp-operational)', background: 'var(--bp-operational-light)' }}>
          <div className="grid grid-cols-1 gap-1 text-xs">
            <div>
              <span style={{ color: 'var(--bp-ink-tertiary)' }}>Database:</span>{" "}
              <span className="font-medium" style={{ color: 'var(--bp-ink-primary)' }}>{value.displayName}</span>
            </div>
            {(value as FabricSqlDatabase).serverFqdn && (
              <div>
                <span style={{ color: 'var(--bp-ink-tertiary)' }}>Endpoint:</span>{" "}
                <span className="text-[10px]" style={{ fontFamily: 'var(--bp-font-mono)', color: 'var(--bp-ink-primary)' }}>
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
