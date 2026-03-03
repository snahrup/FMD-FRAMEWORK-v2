import { FabricDropdown } from "./components/FabricDropdown";
import { ReviewStep } from "./steps/ReviewStep";
import type {
  EnvironmentConfig,
  FabricEntity,
  FabricConnection,
  FabricSqlDatabase,
  LakehouseAssignment,
} from "./types";
import {
  FolderOpen,
  Cable,
  Database,
  Server,
  Cpu,
} from "lucide-react";

interface SetupSettingsProps {
  config: EnvironmentConfig;
  onConfigChange: (config: EnvironmentConfig) => void;
}

function SettingsSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/40 bg-card/30">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/20">
        {icon}
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

export function SetupSettings({ config, onConfigChange }: SetupSettingsProps) {
  const updateWorkspace = (key: keyof EnvironmentConfig["workspaces"], value: FabricEntity | null) => {
    onConfigChange({ ...config, workspaces: { ...config.workspaces, [key]: value } });
  };

  const updateConnection = (key: string, value: FabricConnection | null) => {
    onConfigChange({ ...config, connections: { ...config.connections, [key]: value } });
  };

  const updateLakehouse = (key: keyof EnvironmentConfig["lakehouses"], value: LakehouseAssignment | null) => {
    onConfigChange({ ...config, lakehouses: { ...config.lakehouses, [key]: value } });
  };

  const dataWsId = config.workspaces.data_dev?.id || null;
  const configWsId = config.workspaces.config?.id || null;

  return (
    <div className="space-y-6">
      {/* Workspaces */}
      <SettingsSection
        icon={<FolderOpen className="h-4 w-4 text-amber-400" />}
        title="Workspaces"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(
            [
              ["data_dev", "Data (Dev)"],
              ["code_dev", "Code (Dev)"],
              ["config", "Config"],
              ["data_prod", "Data (Prod)"],
              ["code_prod", "Code (Prod)"],
            ] as const
          ).map(([key, label]) => (
            <FabricDropdown
              key={key}
              label={label}
              endpoint="/fabric/workspaces"
              responseKey="workspaces"
              value={config.workspaces[key]}
              onChange={(e) => updateWorkspace(key, e)}
            />
          ))}
        </div>
      </SettingsSection>

      {/* Lakehouses */}
      <SettingsSection
        icon={<Database className="h-4 w-4 text-emerald-400" />}
        title="Lakehouses"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(
            [
              ["LH_DATA_LANDINGZONE", "Landing Zone"],
              ["LH_BRONZE_LAYER", "Bronze Layer"],
              ["LH_SILVER_LAYER", "Silver Layer"],
            ] as const
          ).map(([key, label]) => (
            <FabricDropdown
              key={key}
              label={label}
              endpoint={dataWsId ? `/setup/workspaces/${dataWsId}/lakehouses` : ""}
              responseKey="items"
              value={config.lakehouses[key]}
              onChange={(e) => {
                if (e) {
                  updateLakehouse(key, { ...e, workspaceGuid: dataWsId || "" });
                } else {
                  updateLakehouse(key, null);
                }
              }}
              canCreate={!!dataWsId}
              createEndpoint="/setup/create-lakehouse"
              createPayload={dataWsId ? { workspaceId: dataWsId } : {}}
              defaultCreateName={key}
              disabled={!dataWsId}
              disabledMessage="Select a Data workspace first"
            />
          ))}
        </div>
      </SettingsSection>

      {/* SQL Database */}
      <SettingsSection
        icon={<Server className="h-4 w-4 text-cyan-400" />}
        title="SQL Database"
      >
        <FabricDropdown
          label="Metadata Database"
          endpoint={configWsId ? `/setup/workspaces/${configWsId}/sql-databases` : ""}
          responseKey="items"
          value={config.database}
          onChange={(e) => onConfigChange({ ...config, database: e as FabricSqlDatabase | null })}
          canCreate={!!configWsId}
          createEndpoint="/setup/create-sql-database"
          createPayload={configWsId ? { workspaceId: configWsId } : {}}
          defaultCreateName="SQL_INTEGRATION_FRAMEWORK"
          disabled={!configWsId}
          disabledMessage="Select a Config workspace first"
        />
      </SettingsSection>

      {/* Connections */}
      <SettingsSection
        icon={<Cable className="h-4 w-4 text-purple-400" />}
        title="Connections"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.keys(config.connections).map((key) => (
            <FabricDropdown
              key={key}
              label={key.replace("CON_FMD_", "").replace(/_/g, " ")}
              endpoint="/fabric/connections"
              responseKey="connections"
              value={config.connections[key]}
              onChange={(e) => updateConnection(key, e as FabricConnection | null)}
            />
          ))}
        </div>
      </SettingsSection>

      {/* Save */}
      <ReviewStep config={config} />
    </div>
  );
}
