// ── Environment Setup — Type Definitions ──

export interface FabricEntity {
  id: string;
  displayName: string;
}

export interface FabricCapacity extends FabricEntity {
  sku: string;
  state: string;
}

export interface FabricSqlDatabase extends FabricEntity {
  serverFqdn: string;
  databaseName: string;
}

export interface FabricConnection extends FabricEntity {
  type?: string;
}

export interface LakehouseAssignment extends FabricEntity {
  workspaceGuid?: string;
}

export interface EnvironmentConfig {
  capacity: FabricCapacity | null;
  workspaces: {
    data_dev: FabricEntity | null;
    code_dev: FabricEntity | null;
    config: FabricEntity | null;
    data_prod: FabricEntity | null;
    code_prod: FabricEntity | null;
  };
  connections: Record<string, FabricConnection | null>;
  lakehouses: {
    LH_DATA_LANDINGZONE: LakehouseAssignment | null;
    LH_BRONZE_LAYER: LakehouseAssignment | null;
    LH_SILVER_LAYER: LakehouseAssignment | null;
  };
  notebooks: {
    NB_FMD_LOAD_LANDING_BRONZE: FabricEntity | null;
    NB_FMD_LOAD_BRONZE_SILVER: FabricEntity | null;
  };
  pipelines: {
    PL_FMD_LDZ_COPY_SQL: FabricEntity | null;
  };
  database: FabricSqlDatabase | null;
}

export type SetupMode = "deploy" | "profiles" | "settings";
export type WizardStep = 1 | 2 | 3 | 4 | 5 | 6;

export type DeploymentAuthMode = "service_principal" | "delegated_oauth";
export type DeploymentStage = "auth" | "names" | "preview" | "execute" | "validate" | "activate";
export type DeploymentStepStatus = "pending" | "running" | "succeeded" | "warning" | "failed" | "skipped";
export type DeploymentAction = "create" | "reuse" | "blocked" | "warning";
export type DeploymentProfileStatus =
  | "draft"
  | "planned"
  | "deploying"
  | "failed"
  | "deployed"
  | "validated"
  | "active"
  | "archived";

export interface DeploymentAuthModeStatus {
  available: boolean;
  reason?: string;
}

export interface DeploymentAuthStatus {
  authModes: Record<DeploymentAuthMode, DeploymentAuthModeStatus>;
  activeMode: DeploymentAuthMode;
  scopes: string[];
}

export interface DeploymentOAuthStart {
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  message?: string;
}

export interface DeploymentResourceNames {
  profileKey: string;
  displayName: string;
  authMode: DeploymentAuthMode;
  capacityId: string;
  capacityDisplayName: string;
  workspaces: Record<"data_dev" | "code_dev" | "config" | "data_prod" | "code_prod", string>;
  lakehouses: Record<"landing" | "bronze" | "silver", string>;
  database: { metadata: string };
  items: {
    landingBronzeNotebook: string;
    bronzeSilverNotebook: string;
    copySqlPipeline: string;
  };
}

export interface DeploymentStep {
  stepKey: string;
  displayName: string;
  status: DeploymentStepStatus;
  action: DeploymentAction;
  required?: boolean;
  fabricResourceId?: string;
  fabricWorkspaceId?: string;
  details?: string | Record<string, unknown>;
  errorMessage?: string;
}

export interface DeploymentPreviewResult {
  profileKey: string;
  status?: DeploymentProfileStatus;
  steps: DeploymentStep[];
  warnings?: string[];
}

export interface DeploymentExecuteResult {
  profileKey: string;
  status: DeploymentProfileStatus;
  steps: DeploymentStep[];
  config?: Partial<EnvironmentConfig> | Record<string, unknown>;
  propagation?: SaveResult[];
  warnings?: string[];
}

export interface DeploymentProofCheck {
  id: string;
  label?: string;
  status: "passed" | "warning" | "failed" | "skipped" | "not_run";
  details?: string;
  evidence?: string | Record<string, unknown>;
}

export interface DeploymentValidationResult {
  ok: boolean;
  checks: DeploymentProofCheck[];
  warnings?: string[];
}

export interface DeploymentProfileSummary {
  profileKey: string;
  displayName: string;
  status: DeploymentProfileStatus;
  authMode?: DeploymentAuthMode;
  capacityId?: string;
  capacityName?: string;
  activatedAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface DeploymentProfilesResponse {
  activeProfileKey?: string;
  profiles: DeploymentProfileSummary[];
}

export interface StepDef {
  step: WizardStep;
  label: string;
  description: string;
}

export const WIZARD_STEPS: StepDef[] = [
  { step: 1, label: "Capacity", description: "Select Fabric capacity" },
  { step: 2, label: "Workspaces", description: "Select or create workspaces" },
  { step: 3, label: "Connections", description: "Select Fabric connections" },
  { step: 4, label: "Lakehouses", description: "Select or create lakehouses" },
  { step: 5, label: "Database", description: "Select or create SQL database" },
  { step: 6, label: "Review", description: "Review and save configuration" },
];

export interface SaveResult {
  target: string;
  status: "ok" | "warning" | "error";
  details?: string;
}

export interface ValidationCheck {
  check: string;
  status: "ok" | "warning" | "error";
  details?: string;
}

// Default naming conventions for "Create New"
export const NAMING_CONVENTIONS = {
  workspaces: {
    data_dev: "INTEGRATION DATA (D)",
    code_dev: "INTEGRATION CODE (D)",
    config: "INTEGRATION CONFIG",
    data_prod: "INTEGRATION DATA (P)",
    code_prod: "INTEGRATION CODE (P)",
  },
  lakehouses: {
    LH_DATA_LANDINGZONE: "LH_DATA_LANDINGZONE",
    LH_BRONZE_LAYER: "LH_BRONZE_LAYER",
    LH_SILVER_LAYER: "LH_SILVER_LAYER",
  },
  database: "SQL_INTEGRATION_FRAMEWORK",
} as const;

export const DEFAULT_DEPLOYMENT_NAMES: DeploymentResourceNames = {
  profileKey: "ipcorp-dev",
  displayName: "IP Corp Dev",
  authMode: "delegated_oauth",
  capacityId: "",
  capacityDisplayName: "",
  workspaces: {
    data_dev: "IPCorp FMD Data Dev",
    code_dev: "IPCorp FMD Code Dev",
    config: "IPCorp FMD Config",
    data_prod: "IPCorp FMD Data Prod",
    code_prod: "IPCorp FMD Code Prod",
  },
  lakehouses: {
    landing: "LH_FMD_LANDING",
    bronze: "LH_FMD_BRONZE",
    silver: "LH_FMD_SILVER",
  },
  database: {
    metadata: "SQL_FMD_CONTROL_PLANE",
  },
  items: {
    landingBronzeNotebook: "NB_FMD_LOAD_LANDING_BRONZE",
    bronzeSilverNotebook: "NB_FMD_LOAD_BRONZE_SILVER",
    copySqlPipeline: "PL_FMD_LDZ_COPY_SQL",
  },
};

export const EMPTY_CONFIG: EnvironmentConfig = {
  capacity: null,
  workspaces: {
    data_dev: null,
    code_dev: null,
    config: null,
    data_prod: null,
    code_prod: null,
  },
  connections: {
    CON_FMD_FABRIC_SQL: null,
    CON_FMD_FABRIC_PIPELINES: null,
    CON_FMD_ADF_PIPELINES: null,
    CON_FMD_FABRIC_NOTEBOOKS: null,
  },
  lakehouses: {
    LH_DATA_LANDINGZONE: null,
    LH_BRONZE_LAYER: null,
    LH_SILVER_LAYER: null,
  },
  notebooks: {
    NB_FMD_LOAD_LANDING_BRONZE: null,
    NB_FMD_LOAD_BRONZE_SILVER: null,
  },
  pipelines: {
    PL_FMD_LDZ_COPY_SQL: null,
  },
  database: null,
};
