export interface DashboardPage {
  name: string;
  route: string;
  group: 'operations' | 'data' | 'admin' | 'labs';
  icon: string;
  tagline: string;
  description: string;
  keyFeatures: string[];
  connectedTo: string[];
  whyItMatters: string;
}

/** Known source systems — update this list when sources change */
const KNOWN_SOURCES = ['MES', 'ETQ', 'M3_ERP', 'M3C', 'OPTIVA'] as const;

export const dashboardPages: DashboardPage[] = [
  // === OPERATIONS ===
  {
    name: 'Execution Matrix',
    route: '/',
    group: 'operations',
    icon: 'Grid3X3',
    tagline: 'The command center for all 1,700+ entities',
    description:
      'Real-time status grid showing every entity across all medallion layers. Sort, filter, search, and drill into any entity to see its complete load history, errors, and watermark state.',
    keyFeatures: [
      'Per-entity status across Landing Zone, Bronze, and Silver',
      'Filterable by source, status, layer, or search term',
      'Expandable rows reveal engine logs per entity',
      'CSV export for offline analysis',
      'Right-click watermark reset for incremental reload',
      'Auto-refresh toggle (5-second polling)',
    ],
    connectedTo: ['Entity Digest API', 'Engine Metrics', 'Engine Logs'],
    whyItMatters:
      'This is your single pane of glass. Instead of checking 4 databases, 3 lakehouses, and 23 pipelines individually, you see the status of every single table in one view.',
  },
  {
    name: 'Engine Control',
    route: '/engine',
    group: 'operations',
    icon: 'Cog',
    tagline: 'Launch, monitor, and control data loads',
    description:
      'The cockpit for the Engine v3 orchestrator. Select which layers to run (Landing/Bronze/Silver), choose specific data sources or entities, preview the plan, then execute with real-time streaming logs.',
    keyFeatures: [
      'Plan mode (dry-run before commit)',
      'Layer selection (Landing, Bronze, Silver)',
      'Real-time SSE log streaming with color-coded levels',
      'KPI cards: Processed, OK, Failed, Duration, Rows',
      'Run history sidebar',
      'Graceful stop mid-execution',
    ],
    connectedTo: ['Engine v3 REST API', 'SSE Log Stream', 'SQL Audit Tables'],
    whyItMatters:
      'Replaces the broken InvokePipeline chain. You control exactly what runs, when, and watch it happen in real time. No more blind pipeline triggers.',
  },
  {
    name: 'Validation Checklist',
    route: '/validation',
    group: 'operations',
    icon: 'Sparkles',
    tagline: 'Pre-go-live readiness assessment',
    description:
      'Comprehensive validation of all entities across all layers. Identifies what has loaded, what is stuck, what has never been attempted. Built for pre-production sign-off.',
    keyFeatures: [
      'Layer-by-layer completion tracking',
      'Stuck entity detection (loaded LZ but never Bronze)',
      'Per-source breakdown with pass/warn/fail status',
      'Bulk action: trigger LZ pipeline for selected entities',
      'Entity digest completeness scoring',
    ],
    connectedTo: ['Entity Digest API', 'Pipeline Trigger API'],
    whyItMatters:
      'Before go-live, you need to prove every table made it through every layer. This page answers that question definitively.',
  },
  {
    name: 'Live Monitor',
    route: '/live',
    group: 'operations',
    icon: 'Radio',
    tagline: 'Real-time pipeline execution feed',
    description:
      'Live activity feed showing all active pipeline runs, notebook executions, and copy activities across the last 4 hours. Auto-refreshes every 5 seconds.',
    keyFeatures: [
      'Pipeline, notebook, and copy activity feeds',
      'Status badges (Running, Succeeded, Failed)',
      'Duration tracking per activity',
      'Configurable time window (1h to all)',
    ],
    connectedTo: ['Fabric Jobs API', 'Logging Tables', 'Pipeline Executions'],
    whyItMatters:
      'When a load is running, you need to know what is happening right now. Not what happened yesterday.',
  },
  {
    name: 'Control Plane',
    route: '/control',
    group: 'operations',
    icon: 'Gauge',
    tagline: 'Infrastructure health at a glance',
    description:
      'Shows the health of all infrastructure components: connections, data sources, entities, pipelines, lakehouses, and workspaces. Tab-based views for metadata, execution, connections, and infrastructure.',
    keyFeatures: [
      'Health status badge (Healthy/Warning/Critical)',
      'Connection and data source counts with active flags',
      'Per-source entity breakdown',
      'Entity metadata table with watermark details',
      'Recent pipeline run history',
    ],
    connectedTo: ['Control Plane API', 'Load Config API', 'Entity Metadata'],
    whyItMatters:
      'If something breaks, you need to know whether it is the connection, the pipeline, the notebook, or the data. This page shows system health.',
  },
  {
    name: 'Error Intelligence',
    route: '/errors',
    group: 'operations',
    icon: 'Activity',
    tagline: 'Pattern-matched error analysis with fix suggestions',
    description:
      'Aggregates all errors across pipelines, categorizes them by pattern (gateway, throttling, OOM, timeout, schema), and provides actionable remediation suggestions.',
    keyFeatures: [
      'Top issue banner with most common error',
      'Error categorization by severity (Critical/Warning/Info)',
      'Severity breakdown donut chart',
      'Top error types bar chart',
      'Actionable fix suggestions per category',
      'Expandable error detail modals',
    ],
    connectedTo: ['Error Intelligence API', 'Fabric Jobs', 'Logging Tables'],
    whyItMatters:
      'Instead of reading through 500 raw error messages, you see patterns. "714 entities have empty SourceName" is more useful than 714 individual error logs.',
  },
  {
    name: 'Execution Log',
    route: '/logs',
    group: 'operations',
    icon: 'ScrollText',
    tagline: 'Historical execution log viewer',
    description:
      'Search and filter through all past pipeline executions. Query by entity, status, time range, or pipeline name.',
    keyFeatures: [
      'Full-text search across logs',
      'Filter by status, time range, pipeline',
      'Paginated results with row details',
      'Rows read/written, duration, error messages',
    ],
    connectedTo: ['Execution Log API', 'SQL Logging Tables'],
    whyItMatters:
      'When you need to answer "what happened to table X last Tuesday?", this is where you go.',
  },
  {
    name: 'Pipeline Runner',
    route: '/runner',
    group: 'operations',
    icon: 'Play',
    tagline: 'Scoped pipeline triggering',
    description:
      `Manually trigger pipelines for specific data sources or entity subsets. Scope a run to just ${KNOWN_SOURCES[0]}, just ${KNOWN_SOURCES[1]}, or a hand-picked list of tables.`,
    keyFeatures: [
      'Data source selector with entity counts',
      'Entity-level selection for targeted runs',
      'Layer selection (LZ, Bronze, Silver)',
      'State backup/restore for IsActive flags',
      'Progress tracking during execution',
    ],
    connectedTo: ['Runner API', 'Pipeline Trigger API', 'Entity Registry'],
    whyItMatters:
      `You do not always want to run everything. Sometimes you need to reprocess 3 tables from ${KNOWN_SOURCES[0]}. This lets you do exactly that.`,
  },
  // === DATA ===
  {
    name: 'Source Manager',
    route: '/sources',
    group: 'data',
    icon: 'Cable',
    tagline: 'Register and manage data sources',
    description:
      'Manage gateway connections, data sources, and entities. Includes a multi-step onboarding wizard for discovering and bulk-registering tables from new sources.',
    keyFeatures: [
      'Gateway connection browser (Fabric REST API)',
      'Data source registry with namespace/type',
      'Source Onboarding Wizard (3-step)',
      'Table discovery from on-prem SQL sources',
      'Bulk entity registration with auto-cascade (LZ + Bronze + Silver)',
      'Entity grid with load history and watermark details',
    ],
    connectedTo: ['Gateway Connections API', 'Data Sources API', 'Entity Registration API'],
    whyItMatters:
      'Adding a new source used to require direct SQL inserts across 6 tables. Now it is a 3-step wizard that handles everything.',
  },
  {
    name: 'Data Blender',
    route: '/blender',
    group: 'data',
    icon: 'FlaskConical',
    tagline: 'Data lineage and exploration',
    description:
      'Explore data across lakehouses. Profile columns (nulls, distinct values, types), sample rows, and run ad-hoc SQL queries against Bronze and Silver lakehouses.',
    keyFeatures: [
      'Table browser across all lakehouses',
      'Column-level profiling (completeness, distinctness)',
      'Row sampling (up to 1,000 rows)',
      'Ad-hoc SQL query execution',
      'Load optimization configuration',
    ],
    connectedTo: ['Blender API', 'Lakehouse SQL Endpoints', 'Load Config API'],
    whyItMatters:
      'After data lands in Bronze/Silver, you need to verify it looks right. This lets you inspect without leaving the dashboard.',
  },
  {
    name: 'Data Journey',
    route: '/journey',
    group: 'data',
    icon: 'Route',
    tagline: 'Trace one entity through every layer',
    description:
      'Deep dive into a single entity showing its complete path from source through Landing Zone, Bronze, Silver, and Gold. Includes schema comparison across layers.',
    keyFeatures: [
      'Visual layer flow diagram (Source -> LZ -> Bronze -> Silver -> Gold)',
      'Per-layer details: row count, file type, timestamps',
      'Schema comparison table (Bronze vs Silver)',
      'Column diff highlighting (type changes, additions)',
      'Incremental load details (watermark column, last value)',
    ],
    connectedTo: ['Journey API', 'Entity Profile API', 'Lakehouse Schemas'],
    whyItMatters:
      'When a stakeholder asks "what happens to my data?", you pull up this page and walk them through every transformation.',
  },
  {
    name: 'Flow Explorer',
    route: '/flow',
    group: 'data',
    icon: 'GitBranch',
    tagline: 'Data lineage swimlane visualization',
    description:
      'Swimlane diagram showing all entities flowing from sources through each medallion layer. Expandable lanes reveal individual entity cards.',
    keyFeatures: [
      'Swimlane layout (Source -> LZ -> Bronze -> Silver -> Gold)',
      'Entity cards per lane with counts',
      'Expandable lanes for individual entities',
      'Arrow connections showing flow direction',
    ],
    connectedTo: ['Flow Diagram API', 'Entity Digest'],
    whyItMatters:
      'Big-picture view of all data flowing through the system. Perfect for architecture presentations.',
  },
  {
    name: 'Record Counts',
    route: '/counts',
    group: 'data',
    icon: 'Hash',
    tagline: 'Bronze vs Silver row count verification',
    description:
      'Side-by-side row count comparison between Bronze and Silver layers. Identifies matches, mismatches, and tables that exist in only one layer.',
    keyFeatures: [
      'Per-table Bronze vs Silver row counts',
      'Status: match, mismatch, bronze-only, silver-only',
      'Delta column showing row count differences',
      'Cache status with force-refresh option',
      'Filterable by status and searchable by name',
    ],
    connectedTo: ['Lakehouse Counts API', 'Entity Digest API'],
    whyItMatters:
      'Row count mismatches between Bronze and Silver mean data is being lost or duplicated during transformation. This catches it.',
  },
  {
    name: 'SQL Explorer',
    route: '/sql',
    group: 'data',
    icon: 'Database',
    tagline: 'Browse source SQL structure',
    description:
      'Tree-based browser for on-prem SQL servers and Fabric lakehouses. Explore servers, databases, schemas, tables, and columns without leaving the dashboard.',
    keyFeatures: [
      'Server -> Database -> Schema -> Table tree navigation',
      'Column details with data types and PK indicators',
      'Row count display per table',
      'Deep-link support (URL query params)',
      'Fabric Lakehouse tree (parallel view)',
    ],
    connectedTo: ['SQL Explorer API', 'On-prem SQL Servers', 'Fabric Lakehouses'],
    whyItMatters:
      'When planning which tables to register, you need to see what exists in the source. This eliminates the need for SSMS.',
  },
  // === ADMIN ===
  {
    name: 'Executive Dashboard',
    route: '/dashboard',
    group: 'admin',
    icon: 'BarChart3',
    tagline: 'C-suite summary view',
    description:
      'High-level overview for leadership. KPI cards, per-source progress bars, pipeline success rates, and health trends over time.',
    keyFeatures: [
      'Overall health badge (Healthy/Warning/Critical)',
      'KPI cards: entities, layers, sources, pipelines',
      'Per-source progress bars by layer',
      'Success rate trend chart',
      'Recent pipeline activity list',
    ],
    connectedTo: ['Executive Dashboard API', 'Metrics Store'],
    whyItMatters:
      'Executives do not care about entity IDs. They care about "is it working?" and "how much is done?" This answers both.',
  },
  {
    name: 'Admin Governance',
    route: '/admin',
    group: 'admin',
    icon: 'ShieldCheck',
    tagline: 'System component inventory',
    description:
      'Complete inventory of all system components: connections, data sources, entities, pipelines, lakehouses, and workspaces in a swimlane governance view.',
    keyFeatures: [
      'Component swimlane diagram',
      'Per-source drill-down with entity counts',
      'Entity metadata table',
      'Connection and datasource management',
    ],
    connectedTo: ['All metadata APIs', 'Entity Digest'],
    whyItMatters:
      'Governance requires knowing exactly what is deployed, where, and how it connects. This is the inventory.',
  },
  {
    name: 'Config Manager',
    route: '/config',
    group: 'admin',
    icon: 'Wrench',
    tagline: 'View and edit framework configuration',
    description:
      'Browse and edit the YAML configuration that drives the framework. View workspace IDs, connection GUIDs, lakehouse mappings, and variable library values.',
    keyFeatures: [
      'YAML configuration viewer',
      'GUID reference search',
      'Inline config editing',
      'Jira integration links',
    ],
    connectedTo: ['Config Manager API', 'item_config.yaml'],
    whyItMatters:
      'Configuration drives everything. When a pipeline fails because of a wrong GUID, this is where you check.',
  },
  {
    name: 'Environment Setup',
    route: '/setup',
    group: 'admin',
    icon: 'Server',
    tagline: 'Initial provisioning and configuration',
    description:
      'Three-mode setup page: one-click Provision (runs deploy_from_scratch.py), step-by-step Wizard (Capacity -> Workspaces -> Connections -> Lakehouses -> DB), or flat Settings view.',
    keyFeatures: [
      'One-click full environment provisioning',
      '6-step guided setup wizard',
      'Current config settings editor',
      'Real-time deployment progress streaming',
    ],
    connectedTo: ['Setup APIs', 'Fabric REST API', 'Deploy Script'],
    whyItMatters:
      'Standing up a new environment (dev, staging, prod) requires creating 5 workspaces, 6 lakehouses, 4 connections, a SQL database, 12 notebooks, and 23 pipelines. This does it in one click.',
  },
  {
    name: 'Settings',
    route: '/settings',
    group: 'admin',
    icon: 'Settings',
    tagline: 'Feature flags and deployment manager',
    description:
      'Enable or disable Labs features (DQ Scorecard, SCD Audit, Gold MLV, Cleansing Rules). Also includes the Deployment Manager for triggering and monitoring deployments.',
    keyFeatures: [
      '4 Labs feature toggles',
      'Deployment Manager with live log streaming',
      'Preflight check runner',
      'Deploy confirmation flow',
    ],
    connectedTo: ['localStorage (feature flags)', 'Deploy APIs'],
    whyItMatters:
      'Labs features let you preview experimental capabilities without affecting production. The deployment manager gives you deploy control from the UI.',
  },
  // === LABS ===
  {
    name: 'Cleansing Rule Editor',
    route: '/labs/cleansing',
    group: 'labs',
    icon: 'Sparkles',
    tagline: 'DQ cleansing rules management',
    description:
      'Create and manage data quality cleansing rules. Define validation constraints, transformation rules, and alert thresholds per entity or globally.',
    keyFeatures: [
      'Rule creation with SQL-like syntax',
      'Per-entity or global scope',
      'Severity levels (Error, Warning, Info)',
      'Rule testing against live data',
    ],
    connectedTo: ['DQ Cleansing API', 'NB_FMD_DQ_CLEANSING notebook'],
    whyItMatters:
      'Data quality rules catch bad data before it reaches Silver/Gold. Phone numbers with letters, dates in the future, negative quantities.',
  },
  {
    name: 'DQ Scorecard',
    route: '/labs/dq-scorecard',
    group: 'labs',
    icon: 'ShieldCheck',
    tagline: 'Data quality metrics dashboard',
    description:
      'Visual scorecard showing data quality scores per entity and layer. Radial progress rings, trend charts, column-level quality bars, and freshness indicators.',
    keyFeatures: [
      'Animated score rings (0-100)',
      'Per-column completeness bars',
      'Freshness indicators (time since last load)',
      'Entity heatmap (entities x layers)',
      'DQ trend charts over time',
    ],
    connectedTo: ['DQ API', 'Metrics Store', 'Entity Digest'],
    whyItMatters:
      'A number is better than a feeling. Instead of "I think the data is good," you get "97.3% complete, 99.1% valid, loaded 2 hours ago."',
  },
  {
    name: 'SCD Audit',
    route: '/labs/scd-audit',
    group: 'labs',
    icon: 'ClipboardCheck',
    tagline: 'SCD Type 2 change tracking',
    description:
      'Audit trail for Slowly Changing Dimension Type 2 records. See which records changed, when, and what the previous values were.',
    keyFeatures: [
      'Change history per entity',
      'Before/after value comparison',
      'Effective date ranges',
      'Change frequency analysis',
    ],
    connectedTo: ['SCD Audit API', 'Silver Layer Tables'],
    whyItMatters:
      'In a dimensional model, knowing when a customer changed their address or when a product changed categories is critical for historical reporting accuracy.',
  },
  {
    name: 'Gold / MLV Manager',
    route: '/labs/gold-mlv',
    group: 'labs',
    icon: 'Layers3',
    tagline: 'Gold layer semantic model management',
    description:
      'Manage Materialized Lakehouse Views (MLVs) in the Gold layer. Define dimensional models, map Silver tables to Gold structures, and generate Power BI semantic layers.',
    keyFeatures: [
      'MLV definition editor',
      'Silver-to-Gold mapping builder',
      'Power BI semantic model generation',
      'Cross-domain join configuration',
    ],
    connectedTo: ['Gold API', 'NB_LOAD_GOLD notebook', 'Power BI Service'],
    whyItMatters:
      'Gold layer is where data becomes useful. MLVs create the business-ready views that Power BI reports consume.',
  },
];

export const pageGroups = [
  { key: 'operations' as const, label: 'Operations', color: 'terracotta' },
  { key: 'data' as const, label: 'Data', color: 'blue' },
  { key: 'admin' as const, label: 'Admin', color: 'amber' },
  { key: 'labs' as const, label: 'Labs', color: 'violet' },
];
