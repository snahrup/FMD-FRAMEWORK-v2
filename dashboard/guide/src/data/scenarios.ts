export interface Scenario {
  id: string;
  trigger: string;
  icon: string;
  severity: 'critical' | 'warning' | 'info';
  symptoms: string[];
  steps: ScenarioStep[];
}

export interface ScenarioStep {
  action: string;
  page?: string;
  route?: string;
  detail: string;
}

export const scenarios: Scenario[] = [
  {
    id: 'data-not-loading',
    trigger: 'Data is not loading for a specific table',
    icon: 'AlertTriangle',
    severity: 'critical',
    symptoms: [
      'Entity shows "not_started" or "pending" in Execution Matrix',
      'Last load timestamp is stale (hours or days old)',
      'Bronze/Silver layers show no data for the entity',
    ],
    steps: [
      {
        action: 'Check the entity status',
        page: 'Execution Matrix',
        route: '/',
        detail:
          'Search for the table name. Check LZ Status, Bronze Status, and Silver Status columns. If LZ is "not_started", the engine never attempted extraction.',
      },
      {
        action: 'Check for errors',
        page: 'Error Intelligence',
        route: '/errors',
        detail:
          'Look for the entity in error categories. Common: gateway connection timeout, SourceName whitespace, SQL 429 throttling.',
      },
      {
        action: 'Verify the source connection',
        page: 'Control Plane',
        route: '/control',
        detail:
          'Check the Connections tab. Is the gateway connection online? Is the data source active? If the connection is offline, VPN may be down.',
      },
      {
        action: 'Check entity registration',
        page: 'Source Manager',
        route: '/sources',
        detail:
          'Search for the entity in the Entity Grid. Verify it is active (IsActive=true). Check SourceName has no whitespace. Verify the DataSource assignment is correct.',
      },
      {
        action: 'Trigger a manual load',
        page: 'Engine Control',
        route: '/engine',
        detail:
          'Select just the Landing Zone layer. Filter to the specific data source. Use Plan mode first to verify the entity appears in the worklist. Then switch to Run mode.',
      },
      {
        action: 'Watch the real-time logs',
        page: 'Engine Control',
        route: '/engine',
        detail:
          'Monitor the SSE log stream. Look for the entity ID in log messages. If extraction fails, the error message will include the SQL query and connection details.',
      },
    ],
  },
  {
    id: 'bronze-silver-mismatch',
    trigger: 'Row counts differ between Bronze and Silver',
    icon: 'GitCompare',
    severity: 'warning',
    symptoms: [
      'Record Counts page shows "mismatch" status',
      'Silver has fewer rows than Bronze',
      'Business reports show missing data',
    ],
    steps: [
      {
        action: 'Quantify the mismatch',
        page: 'Record Counts',
        route: '/counts',
        detail:
          'Filter by "mismatch" status. Note the delta column. Small deltas (< 1%) may indicate SCD deduplication. Large deltas indicate transformation issues.',
      },
      {
        action: 'Inspect the entity journey',
        page: 'Data Journey',
        route: '/journey',
        detail:
          'Enter the entity ID. Compare the schema between Bronze and Silver. Look for column type mismatches or missing columns that could cause row drops.',
      },
      {
        action: 'Profile the data',
        page: 'Data Blender',
        route: '/blender',
        detail:
          'Profile the Silver table columns. Look for high null percentages or unexpected data type distributions. Compare with Bronze profile.',
      },
      {
        action: 'Check the Silver notebook logs',
        page: 'Execution Log',
        route: '/logs',
        detail:
          'Filter logs to Silver layer for this entity. Look for MERGE operation results. The rows_written count should match the Bronze count minus any dedup/SCD exclusions.',
      },
    ],
  },
  {
    id: 'pipeline-timeout',
    trigger: 'Pipeline is running too long or timing out',
    icon: 'Clock',
    severity: 'warning',
    symptoms: [
      'Live Monitor shows a pipeline running for hours',
      'ForEach activities stuck at 100% for extended time',
      'Engine status shows "running" but no new log entries',
    ],
    steps: [
      {
        action: 'Check current execution',
        page: 'Live Monitor',
        route: '/live',
        detail:
          'Look at the pipeline/notebook activity feed. Identify which specific activity is taking long. Copy activities on large tables (>500M rows) can take 2-4 hours.',
      },
      {
        action: 'Review entity sizes',
        page: 'Data Blender',
        route: '/blender',
        detail:
          'Profile the source table row count. Tables with >100M rows will take longer. Consider if incremental loading is configured (check the watermark column).',
      },
      {
        action: 'Check for throttling',
        page: 'Error Intelligence',
        route: '/errors',
        detail:
          'SQL 429 errors indicate the Fabric SQL database is rate-limiting. This was fixed by setting ForEach batchCount=15, but check if the pipeline JSON has the fix applied.',
      },
      {
        action: 'Consider stopping and rescoping',
        page: 'Engine Control',
        route: '/engine',
        detail:
          'If a full load is taking too long, stop the engine. Then use Pipeline Runner to scope to a smaller subset of entities and run them in batches.',
      },
    ],
  },
  {
    id: 'new-source',
    trigger: 'Need to add a new data source',
    icon: 'Plus',
    severity: 'info',
    symptoms: [
      'Business requests a new database/system to be integrated',
      'A new SQL Server, Oracle, SFTP, or ADLS source needs to be registered',
    ],
    steps: [
      {
        action: 'Verify the connection',
        page: 'SQL Explorer',
        route: '/sql',
        detail:
          'Browse the source server to verify connectivity. Confirm you can see the database, schemas, and tables. If it is an on-prem server, ensure VPN is connected.',
      },
      {
        action: 'Register the connection and data source',
        page: 'Source Manager',
        route: '/sources',
        detail:
          'Add the gateway connection (if new) and create a data source entry. Set the namespace, type, and description. The namespace determines the folder structure in OneLake.',
      },
      {
        action: 'Discover and register tables',
        page: 'Source Manager',
        route: '/sources',
        detail:
          'Use the Source Onboarding Wizard. Select the gateway connection, discover tables, pick which ones to register. Registration auto-cascades to LZ + Bronze + Silver entities.',
      },
      {
        action: 'Run load optimization',
        page: 'Data Blender',
        route: '/blender',
        detail:
          'Analyze the source tables to discover primary keys and watermark columns. This enables incremental loading, which dramatically reduces subsequent run times.',
      },
      {
        action: 'Trigger initial load',
        page: 'Engine Control',
        route: '/engine',
        detail:
          'Run the engine for all three layers (Landing, Bronze, Silver). The first run is always a full load. Monitor the logs for errors.',
      },
      {
        action: 'Verify the data',
        page: 'Record Counts',
        route: '/counts',
        detail:
          'After the load completes, verify row counts match between Bronze and Silver. Check the Execution Matrix for any failed entities.',
      },
    ],
  },
  {
    id: 'engine-failed',
    trigger: 'Engine run failed mid-execution',
    icon: 'XCircle',
    severity: 'critical',
    symptoms: [
      'Engine status shows "error" or "stopped"',
      'Some entities loaded, others did not',
      'Error message in Engine Control logs',
    ],
    steps: [
      {
        action: 'Check what succeeded and what failed',
        page: 'Engine Control',
        route: '/engine',
        detail:
          'Review the KPI cards. Note the Failed count. Scroll the log pane to find ERROR entries. Each failed entity will have an error message with details.',
      },
      {
        action: 'Categorize the errors',
        page: 'Error Intelligence',
        route: '/errors',
        detail:
          'Errors are auto-categorized. Common patterns: Connection refused (VPN down), Login failed (credentials expired), OutOfMemory (table too large), SourceName mismatch.',
      },
      {
        action: 'Retry just the failed entities',
        page: 'Engine Control',
        route: '/engine',
        detail:
          'Use the Retry button on the failed run. This re-runs only entities that failed, skipping those that succeeded. Much faster than re-running everything.',
      },
      {
        action: 'Check if the issue is systemic',
        page: 'Control Plane',
        route: '/control',
        detail:
          'If many entities from the same source failed, the issue is likely the source connection. Check gateway health. If entities across sources failed, check the Fabric SQL database connectivity.',
      },
    ],
  },
  {
    id: 'stale-data',
    trigger: 'Data in reports is outdated',
    icon: 'CalendarClock',
    severity: 'warning',
    symptoms: [
      'Power BI reports show yesterday\'s data',
      'Last load timestamps are old',
      'Business users report missing recent transactions',
    ],
    steps: [
      {
        action: 'Check last load times',
        page: 'Execution Matrix',
        route: '/',
        detail:
          'Sort by "LZ Last Load" descending. If the most recent loads are hours old, the engine may not be running. Check Engine Control for scheduled run status.',
      },
      {
        action: 'Verify incremental loading',
        page: 'Source Manager',
        route: '/sources',
        detail:
          'Check if the entity has IsIncremental=true and a valid watermark column. If full load only, the engine must reload the entire table each time, which takes longer.',
      },
      {
        action: 'Check the watermark value',
        page: 'Execution Matrix',
        route: '/',
        detail:
          'Expand the entity row. Check the last watermark value. If it is far behind the current date, the incremental window may be too large. Consider resetting the watermark.',
      },
      {
        action: 'Trigger a fresh load',
        page: 'Engine Control',
        route: '/engine',
        detail:
          'Run the engine for all three layers. Incremental entities will only extract rows since the last watermark, so it should be fast.',
      },
    ],
  },
  {
    id: 'environment-setup',
    trigger: 'Setting up a new environment (dev/staging/prod)',
    icon: 'Server',
    severity: 'info',
    symptoms: [
      'New Fabric capacity provisioned',
      'Need to create workspaces, lakehouses, and deploy pipelines',
      'Starting from scratch',
    ],
    steps: [
      {
        action: 'Use the Environment Setup page',
        page: 'Environment Setup',
        route: '/setup',
        detail:
          'Choose "Provision" mode for one-click deployment, or "Wizard" mode for step-by-step. Provision runs all 17 phases of deploy_from_scratch.py automatically.',
      },
      {
        action: 'Monitor deployment progress',
        page: 'Settings',
        route: '/settings',
        detail:
          'The Deployment Manager tab shows real-time SSE streaming of deployment progress. Each of the 17 phases reports status.',
      },
      {
        action: 'Run validation',
        page: 'Validation Checklist',
        route: '/validation',
        detail:
          'After deployment, run the validation checklist to confirm all workspaces, lakehouses, pipelines, and SQL schemas were created correctly.',
      },
      {
        action: 'Register entities',
        page: 'Source Manager',
        route: '/sources',
        detail:
          'Use the onboarding wizard to register data sources and entities. Or edit config/entity_registration.json and re-run Phase 13 of the deploy script.',
      },
    ],
  },
];
