// SQL Object Explorer — TypeScript interfaces

export interface SourceServer {
  server: string;
  display: string;
  status: 'online' | 'offline' | 'unknown';
  error: string | null;
}

export interface SourceDatabase {
  name: string;
  state_desc: string;
  compatibility_level: string;
  create_date: string;
  collation_name: string;
  table_count: string;
  isRegistered?: boolean;
}

export interface SourceSchema {
  schema_name: string;
  table_count: string;
}

export interface SourceTable {
  TABLE_NAME: string;
  TABLE_TYPE: string;
}

export interface SourceColumn {
  COLUMN_NAME: string;
  DATA_TYPE: string;
  IS_NULLABLE: string;
  CHARACTER_MAXIMUM_LENGTH: string | null;
  NUMERIC_PRECISION: string | null;
  NUMERIC_SCALE: string | null;
  ORDINAL_POSITION: string;
  COLUMN_DEFAULT: string | null;
  IS_PK: string;
}

export interface TableInfo {
  server: string;
  database: string;
  schema: string;
  table: string;
  rowCount: number;
  columns: SourceColumn[];
}

export interface TablePreview {
  server: string;
  database: string;
  schema: string;
  table: string;
  limit: number;
  rowCount: number;
  columns: string[];
  rows: Record<string, string | null>[];
}

export interface SelectedTable {
  server: string;
  database: string;
  schema: string;
  table: string;
  type?: 'source' | 'lakehouse';
}

export interface FabricLakehouse {
  name: string;
  display: string;
  status: 'online' | 'offline' | 'unknown';
  error: string | null;
}

export interface OneLakeFileEntry {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  contentLength: number;
  lastModified: string;
  fileCount?: number;
  totalSize?: number;
}
