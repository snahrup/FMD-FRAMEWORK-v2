export type DataLayer = 'landing' | 'bronze' | 'silver' | 'gold' | 'unknown';
export type Sensitivity = 'PII' | 'Confidential' | 'Internal' | 'Public';
export type JoinType = 'inner' | 'left' | 'right' | 'full';
export type Cardinality = '1:1' | '1:N' | 'N:1' | 'N:M';
export type ColumnDataType = 'string' | 'integer' | 'decimal' | 'boolean' | 'date' | 'datetime' | 'binary';

export interface LakehouseTable {
  id: string;
  name: string;
  layer: DataLayer;
  lakehouse: string;
  schema: string;
  source?: 'metadata' | 'lakehouse';
  rowCount?: number;
  columnCount?: number;
  sizeBytes?: number;
  lastUpdated?: string;
  sensitivity?: Sensitivity;
  steward?: string;
  description?: string;
  purviewAssetId?: string;
  dataSource?: string;
}

export interface ColumnProfile {
  name: string;
  dataType: string;
  nullable: boolean;
  maxLength?: string | null;
  precision?: string | null;
  scale?: string | null;
  ordinal: number;
  distinctCount: number;
  nullCount: number;
  nullPercentage: number;
  minValue?: string | null;
  maxValue?: string | null;
  uniqueness?: number;
  completeness?: number;
}

export interface LiveTableProfile {
  lakehouse: string;
  schema: string;
  table: string;
  rowCount: number;
  columnCount: number;
  profiledColumns: number;
  columns: ColumnProfile[];
  error?: string;
}

// Legacy types for mock data compatibility
export interface ColumnMetadata {
  name: string;
  dataType: ColumnDataType;
  nullable: boolean;
  distinctCount: number;
  nullPercentage: number;
  minValue?: string;
  maxValue?: string;
  sampleValues: string[];
  sensitivity: Sensitivity;
  description?: string;
  purviewClassification?: string;
}

export interface TableProfile {
  table: LakehouseTable;
  columns: ColumnMetadata[];
  qualityScore: number;
  completeness: number;
  freshness: string;
}

export interface SampleData {
  lakehouse: string;
  schema: string;
  table: string;
  rowCount: number;
  rows: Record<string, string | null>[];
}

export interface QueryResult {
  success?: boolean;
  error?: string;
  rowCount?: number;
  rows?: Record<string, string | null>[];
  sql?: string;
}

export interface BlendSuggestion {
  id: string;
  sourceTable: LakehouseTable;
  targetTable: LakehouseTable;
  matchScore: number;
  joinKeys: { source: string; target: string }[];
  joinType: JoinType;
  cardinality: Cardinality;
  estimatedRows: number;
  explanation: string;
}

export interface BlendRecipe {
  id: string;
  name: string;
  source: { table: string; layer: DataLayer; columns: string[] };
  target: { table: string; layer: DataLayer; columns: string[] };
  joinConfig: { sourceKey: string; targetKey: string; type: JoinType };
  cardinality: Cardinality;
  destinationLayer: DataLayer;
  createdAt: string;
}

export interface PurviewEntity {
  id: string;
  qualifiedName: string;
  typeName: string;
  classifications: string[];
  glossaryTerms: string[];
  owners: string[];
  experts: string[];
  description?: string;
}
