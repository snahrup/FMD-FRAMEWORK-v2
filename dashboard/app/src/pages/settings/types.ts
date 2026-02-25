// Deployment Manager TypeScript interfaces

export type DeployStatus = 'idle' | 'configuring' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface DeployConfig {
  env: 'dev' | 'prod' | 'all';
  dryRun: boolean;
  resume: boolean;
  skipPhases: number[];
  startPhase: number;
  capacityId: string;
  capacityName: string;
  manualConnections: Record<string, string>;
}

export interface PhaseState {
  num: number;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  items: PhaseItem[];
  elapsed: number;
}

export interface PhaseItem {
  message: string;
  status: 'created' | 'exists' | 'ok' | 'failed' | 'skipped' | 'warning' | 'dry_run' | 'manual';
}

export interface LogEntry {
  ts: number;
  level: 'info' | 'warning' | 'error';
  message: string;
}

export interface DeployResult {
  workspace_ids: Record<string, string>;
  connection_ids: Record<string, string>;
  lakehouse_ids: Record<string, string>;
  sql_db: { id?: string; server?: string; database?: string };
  item_count: number;
  mapping_count: number;
  elapsed: number;
}

export interface DeployState {
  status: DeployStatus;
  phase: number;
  phase_name: string;
  phases: PhaseState[];
  logs: LogEntry[];
  started_at: number | null;
  completed_at: number | null;
  config_used: Partial<DeployConfig>;
  result: Partial<DeployResult>;
  cancel_requested: boolean;
}

// SSE event payloads
export interface PhaseStartEvent {
  phase: number;
  name: string;
}

export interface PhaseCompleteEvent {
  phase: number;
  name: string;
  elapsed: number;
}

export interface PhaseFailedEvent {
  phase: number;
  name: string;
  error: string;
  elapsed: number;
}

export interface ItemStatusEvent {
  phase: number;
  status: string;
  message: string;
}

export interface DeployCompleteEvent {
  success: boolean;
  elapsed: number;
  cancelled?: boolean;
  error?: string;
  result?: DeployResult;
}

// Phase definitions (mirrors deploy_from_scratch.py PHASES)
export const PHASE_DEFS: { num: number; name: string; itemHint: string }[] = [
  { num: 1, name: 'Auth & Config', itemHint: '~2 checks' },
  { num: 2, name: 'Resolve Capacity', itemHint: '1 capacity' },
  { num: 3, name: 'Create Workspaces', itemHint: '~5 workspaces' },
  { num: 4, name: 'Create Connections', itemHint: '4 connections' },
  { num: 5, name: 'Create Lakehouses', itemHint: '3-6 lakehouses' },
  { num: 6, name: 'Create SQL Database', itemHint: '1 database' },
  { num: 7, name: 'Deploy Notebooks', itemHint: '~7 notebooks' },
  { num: 8, name: 'Deploy Var Libs & Env', itemHint: '~6 items' },
  { num: 9, name: 'Deploy Pipelines', itemHint: '~22 pipelines' },
  { num: 10, name: 'Populate SQL Metadata', itemHint: '~20 statements' },
  { num: 11, name: 'Update Local Config', itemHint: '3 files' },
  { num: 12, name: 'Workspace Icons', itemHint: '~5 icons' },
];
