/**
 * Shared types for source/pipeline/connection data.
 *
 * Previously duplicated in FlowExplorer and SourceManager.
 */

export interface Connection {
  id: number;
  connectionName: string;
  server: string;
  database: string;
  connectionType: string;
  isActive: boolean;
  createdDate?: string;
}

export interface DataSource {
  id: number;
  dataSourceName: string;
  connectionId: number;
  sourceSchema: string;
  isActive: boolean;
  entityCount?: number;
  connection?: Connection;
}

export interface Pipeline {
  id: number;
  pipelineName: string;
  layer: string;
  fabricPipelineId: string;
  isActive: boolean;
  lastRun?: string;
  lastStatus?: string;
}

/** Check if a record is active, handling various column name patterns */
export function isActive(record: { isActive?: boolean; IsActive?: boolean | number; is_active?: boolean | number }): boolean {
  if (typeof record.isActive === "boolean") return record.isActive;
  if (typeof record.IsActive === "boolean") return record.IsActive;
  if (typeof record.IsActive === "number") return record.IsActive === 1;
  if (typeof record.is_active === "boolean") return record.is_active;
  if (typeof record.is_active === "number") return record.is_active === 1;
  return true; // default to active
}
