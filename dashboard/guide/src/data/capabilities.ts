export interface Stat {
  label: string;
  value: number;
  suffix?: string;
  prefix?: string;
  description: string;
}

export interface Capability {
  title: string;
  description: string;
  icon: string;
}

export interface Limitation {
  title: string;
  description: string;
}

/** Known source systems — update this list when sources change */
const KNOWN_SOURCES = ['MES', 'ETQ', 'M3 Cloud', 'M3 ERP'] as const;

export const stats: Stat[] = [
  { label: 'Registered Entities', value: 1700, suffix: '+', description: 'Tables tracked across all medallion layers' },
  { label: 'Data Sources', value: 4, description: 'On-prem SQL servers feeding the framework' },
  { label: 'Pipelines', value: 23, description: 'Fabric data pipelines (8 COMMAND, 10 COPY, 5 orchestration)' },
  { label: 'Dashboard Pages', value: 27, description: 'Interactive operations, data, and admin views' },
  { label: 'API Endpoints', value: 90, suffix: '+', description: 'REST endpoints powering the dashboard' },
  { label: 'Deployment Phases', value: 17, description: 'Fully automated environment provisioning' },
  { label: 'Concurrent Workers', value: 8, description: 'Parallel entity extraction threads' },
  { label: 'Source Tables Available', value: 4777, suffix: '+', description: `Across ${KNOWN_SOURCES.join(', ')}` },
];

export const capabilities: Capability[] = [
  {
    title: 'Metadata-Driven',
    description:
      'Every pipeline is generic. Source, target, schema, query, watermark, and file path are all driven by SQL metadata. Zero code changes to add new tables.',
    icon: 'Database',
  },
  {
    title: 'Incremental Loading',
    description:
      'Watermark-based incremental extraction. First run is full, subsequent runs extract only new/changed rows. Cuts runtime from 53 minutes to under 10.',
    icon: 'TrendingUp',
  },
  {
    title: 'Auto-Cascade Registration',
    description:
      'Register a table once at the Landing Zone level. Bronze and Silver entities are created automatically with linked IDs and metadata.',
    icon: 'Layers',
  },
  {
    title: 'Real-Time Monitoring',
    description:
      'SSE-powered live log streaming. Watch entities extract, load, and transform in real time. Color-coded severity. Filterable by entity, layer, and level.',
    icon: 'Radio',
  },
  {
    title: 'Self-Healing Deployment',
    description:
      '17-phase deployment script with state persistence. If any phase fails, resume from where it left off. Every phase is idempotent — safe to re-run.',
    icon: 'RefreshCw',
  },
  {
    title: 'Error Intelligence',
    description:
      'Pattern-matched error categorization. Instead of 500 raw error logs, you get "714 entities have empty SourceName" with actionable fix suggestions.',
    icon: 'Brain',
  },
  {
    title: 'Multi-Source Support',
    description:
      'SQL Server, Oracle, SFTP, FTP, Azure SQL, ADLS, OneLake, ADF, and custom notebooks. Each source type has a dedicated COMMAND + COPY pipeline pair.',
    icon: 'Cable',
  },
  {
    title: 'Entity Digest Engine',
    description:
      'Pre-computed entity status across all layers. Sub-second dashboard queries over 1,700+ entities. Updated in real-time as loads complete.',
    icon: 'Zap',
  },
];

export const limitations: Limitation[] = [
  {
    title: 'VPN Required for On-Prem Sources',
    description:
      'The engine connects directly to on-prem SQL servers via pyodbc. VPN must be active for extraction. Load optimization analysis also requires VPN.',
  },
  {
    title: 'InvokePipeline Broken for SP Auth',
    description:
      'Fabric\'s InvokePipeline activity ignores Service Principal connections by design. The Engine v3 REST orchestrator was built as the workaround.',
  },
  {
    title: 'Fabric SQL 429 Throttling',
    description:
      'The Fabric SQL database rate-limits concurrent queries. ForEach batchCount is set to 15 to prevent throttling, which limits parallelism in pipeline mode.',
  },
  {
    title: 'Large Table OutOfMemory',
    description:
      'Tables with >500M rows can cause OutOfMemory in single-copy activities. The engine uses chunked reads (500K rows/chunk) but pipeline COPY activities do not.',
  },
  {
    title: 'Single-Region Deployment',
    description:
      'Currently deployed to a single Fabric capacity. Cross-region replication and disaster recovery are not yet configured.',
  },
  {
    title: 'Gold Layer Not Yet Automated',
    description:
      'Landing Zone, Bronze, and Silver are fully automated. Gold layer (dimensional models, MLVs) requires manual notebook execution.',
  },
];

export const benefits = [
  {
    before: 'Manually writing ETL for each table',
    after: 'Register once, auto-cascade through all layers',
    impact: 'Minutes instead of days per table',
  },
  {
    before: 'Full reload of entire database every run',
    after: 'Watermark-based incremental extraction',
    impact: '53 min → under 10 min for subsequent loads',
  },
  {
    before: 'Checking 4 databases and 3 lakehouses for status',
    after: 'Single Execution Matrix with all 1,700+ entities',
    impact: 'Instant visibility into every table\'s state',
  },
  {
    before: 'Reading 500 raw error logs',
    after: 'Pattern-matched error categories with fix suggestions',
    impact: 'Minutes to diagnose instead of hours',
  },
  {
    before: 'Manual deployment across 5 workspaces',
    after: 'One-click 17-phase automated provisioning',
    impact: 'New environment in 20 minutes, not 2 days',
  },
  {
    before: 'Asking "what happened to my data?"',
    after: 'Data Journey traces every table through every layer',
    impact: 'Full transparency for stakeholders',
  },
];
