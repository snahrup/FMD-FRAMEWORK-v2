export interface ArchNode {
  id: string;
  label: string;
  description: string;
  type: 'source' | 'pipeline' | 'lakehouse' | 'notebook' | 'database' | 'dashboard' | 'engine';
  details: string[];
}

export interface ArchEdge {
  from: string;
  to: string;
  label?: string;
  animated?: boolean;
}

/** Known source system IDs — update this list when sources change */
export const SOURCE_IDS = ['mes', 'etq', 'm3c', 'm3erp'] as const;

export const architectureNodes: ArchNode[] = [
  {
    id: 'mes',
    label: 'MES',
    description: 'Manufacturing Execution System',
    type: 'source',
    details: ['445 entities', 'Server: m3-db1', 'Database: mes', 'SQL Server on-prem'],
  },
  {
    id: 'etq',
    label: 'ETQ',
    description: 'Quality Management',
    type: 'source',
    details: ['29 entities', 'Server: M3-DB3', 'Database: ETQStagingPRD', 'SQL Server on-prem'],
  },
  {
    id: 'm3c',
    label: 'M3 Cloud',
    description: 'ERP Cloud Staging',
    type: 'source',
    details: ['185 entities', 'Server: sql2016live', 'Database: DI_PRD_Staging', 'SQL Server on-prem'],
  },
  {
    id: 'm3erp',
    label: 'M3 ERP',
    description: 'Core ERP System',
    type: 'source',
    details: ['3,973 tables', 'Server: sqllogshipprd', 'Database: m3fdbprd', 'Pending registration'],
  },
  {
    id: 'engine',
    label: 'Engine v3',
    description: 'Python REST Orchestrator',
    type: 'engine',
    details: [
      'Concurrent extraction (8 workers)',
      'Incremental + full loads',
      'Real-time SSE monitoring',
      'Replaces broken InvokePipeline',
    ],
  },
  {
    id: 'pipelines',
    label: '23 Pipelines',
    description: 'Fabric Data Pipelines',
    type: 'pipeline',
    details: [
      '8 COMMAND (routing)',
      '10 COPY (data movement)',
      '3 LOAD (orchestration)',
      '2 TOOLING (utility)',
    ],
  },
  {
    id: 'lz',
    label: 'Landing Zone',
    description: 'Raw Parquet Files',
    type: 'lakehouse',
    details: ['Snappy-compressed Parquet', 'Namespace-partitioned folders', 'Schema_{Table}/{timestamp}.parquet', 'Full + incremental writes'],
  },
  {
    id: 'bronze',
    label: 'Bronze Layer',
    description: 'Validated & Typed',
    type: 'lakehouse',
    details: ['Spark SQL tables', 'Schema enforcement', 'Type casting', 'Deduplication'],
  },
  {
    id: 'silver',
    label: 'Silver Layer',
    description: 'Business-Ready',
    type: 'lakehouse',
    details: ['Conformed dimensions', 'Business logic applied', 'SCD Type 2 tracking', 'Incremental merge'],
  },
  {
    id: 'gold',
    label: 'Gold Layer',
    description: 'Analytics & Reporting',
    type: 'lakehouse',
    details: ['Dimensional models', 'MLV semantic layers', 'Power BI ready', 'Cross-domain joins'],
  },
  {
    id: 'notebooks',
    label: 'Spark Notebooks',
    description: 'Transformation Logic',
    type: 'notebook',
    details: [
      'NB_FMD_LOAD_LANDING_BRONZE',
      'NB_FMD_LOAD_BRONZE_SILVER',
      'NB_FMD_DQ_CLEANSING',
      'NB_LOAD_GOLD',
    ],
  },
  {
    id: 'sqldb',
    label: 'SQL Metadata DB',
    description: 'Integration Framework',
    type: 'database',
    details: [
      'Entity registry (1,700+ entities)',
      'Connection & datasource config',
      'Execution audit logs',
      'Entity digest engine',
    ],
  },
  {
    id: 'dashboard',
    label: 'Operations Dashboard',
    description: '27 Interactive Pages',
    type: 'dashboard',
    details: [
      'Real-time execution monitoring',
      'Entity status matrix',
      'Error intelligence',
      'Source onboarding wizard',
    ],
  },
];

export const architectureEdges: ArchEdge[] = [
  { from: 'mes', to: 'engine', animated: true },
  { from: 'etq', to: 'engine', animated: true },
  { from: 'm3c', to: 'engine', animated: true },
  { from: 'm3erp', to: 'pipelines' },
  { from: 'engine', to: 'lz', label: 'Parquet upload', animated: true },
  { from: 'pipelines', to: 'lz', label: 'Copy activity' },
  { from: 'lz', to: 'bronze', label: 'Spark transform', animated: true },
  { from: 'bronze', to: 'silver', label: 'Business logic', animated: true },
  { from: 'silver', to: 'gold', label: 'Dimensional model' },
  { from: 'notebooks', to: 'bronze' },
  { from: 'notebooks', to: 'silver' },
  { from: 'notebooks', to: 'gold' },
  { from: 'sqldb', to: 'engine' },
  { from: 'sqldb', to: 'pipelines' },
  { from: 'sqldb', to: 'dashboard' },
  { from: 'engine', to: 'sqldb', label: 'Audit logs' },
];
