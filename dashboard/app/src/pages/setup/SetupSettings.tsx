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
  FileCode2,
  Workflow,
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
    <div className="rounded-lg border border-border/40 bg-card">
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

  const updateNotebook = (key: keyof EnvironmentConfig["notebooks"], value: FabricEntity | null) => {
    onConfigChange({ ...config, notebooks: { ...config.notebooks, [key]: value } });
  };

  const updatePipeline = (key: keyof EnvironmentConfig["pipelines"], value: FabricEntity | null) => {
    onConfigChange({ ...config, pipelines: { ...config.pipelines, [key]: value } });
  };

  const dataWsId = config.workspaces.data_dev?.id || null;
  const codeWsId = config.workspaces.code_dev?.id || null;
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

      {/* Notebooks */}
      <SettingsSection
        icon={<FileCode2 className="h-4 w-4 text-orange-400" />}
        title="Notebooks"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(
            [
              ["NB_FMD_LOAD_LANDING_BRONZE", "Landing → Bronze"],
              ["NB_FMD_LOAD_BRONZE_SILVER", "Bronze → Silver"],
            ] as const
          ).map(([key, label]) => (
            <FabricDropdown
              key={key}
              label={label}
              endpoint={codeWsId ? `/setup/workspaces/${codeWsId}/notebooks` : ""}
              responseKey="items"
              value={config.notebooks[key]}
              onChange={(e) => updateNotebook(key, e)}
              disabled={!codeWsId}
              disabledMessage="Select a Code workspace first"
            />
          ))}
        </div>
      </SettingsSection>

      {/* Pipelines */}
      <SettingsSection
        icon={<Workflow className="h-4 w-4 text-blue-400" />}
        title="Pipelines"
      >
        <FabricDropdown
          label="LDZ Copy SQL"
          endpoint={codeWsId ? `/setup/workspaces/${codeWsId}/pipelines` : ""}
          responseKey="items"
          value={config.pipelines.PL_FMD_LDZ_COPY_SQL}
          onChange={(e) => updatePipeline("PL_FMD_LDZ_COPY_SQL", e)}
          disabled={!codeWsId}
          disabledMessage="Select a Code workspace first"
        />
      </SettingsSection>

      {/* Save */}
      <ReviewStep config={config} />
    </div>
  );
}
