import type {
  LakehouseTable, ColumnMetadata, TableProfile,
  BlendSuggestion, DataLayer, Sensitivity,
} from '@/types/blender';

// ── Layer metadata ──

export const layerConfig: Record<DataLayer, { label: string; color: string; lakehouse: string }> = {
  landing: { label: 'Landing Zone', color: '#3b82f6', lakehouse: 'LH_DATA_LANDINGZONE' },
  bronze:  { label: 'Bronze',       color: '#d97706', lakehouse: 'LH_BRONZE_LAYER' },
  silver:  { label: 'Silver',       color: '#6b7280', lakehouse: 'LH_SILVER_LAYER' },
  gold:    { label: 'Gold',         color: '#eab308', lakehouse: 'LH_GOLD_LAYER' },
};

// ── Tables ──

export const mockTables: LakehouseTable[] = [
  // Landing Zone
  { id: 'lz-customers',     name: 'Customers',          layer: 'landing', lakehouse: 'LH_DATA_LANDINGZONE', schema: 'dbo', rowCount: 284500,  columnCount: 18, sizeBytes: 45_000_000,  lastUpdated: '2026-02-19T08:15:00Z', sensitivity: 'PII',          steward: 'S. Nahrup', description: 'Raw customer master from SAP' },
  { id: 'lz-orders',        name: 'SalesOrders',        layer: 'landing', lakehouse: 'LH_DATA_LANDINGZONE', schema: 'dbo', rowCount: 1_230_000, columnCount: 24, sizeBytes: 312_000_000, lastUpdated: '2026-02-19T08:15:00Z', sensitivity: 'Confidential', steward: 'S. Nahrup', description: 'Raw sales order headers from SAP' },
  { id: 'lz-orderlines',    name: 'SalesOrderLines',    layer: 'landing', lakehouse: 'LH_DATA_LANDINGZONE', schema: 'dbo', rowCount: 4_890_000, columnCount: 16, sizeBytes: 890_000_000, lastUpdated: '2026-02-19T08:15:00Z', sensitivity: 'Internal',     steward: 'S. Nahrup', description: 'Raw sales order line items from SAP' },
  { id: 'lz-products',      name: 'Products',           layer: 'landing', lakehouse: 'LH_DATA_LANDINGZONE', schema: 'dbo', rowCount: 12_800,   columnCount: 22, sizeBytes: 8_500_000,   lastUpdated: '2026-02-19T06:00:00Z', sensitivity: 'Internal',     steward: 'S. Nahrup', description: 'Raw product master from SAP' },
  { id: 'lz-employees',     name: 'Employees',          layer: 'landing', lakehouse: 'LH_DATA_LANDINGZONE', schema: 'dbo', rowCount: 3_200,    columnCount: 30, sizeBytes: 2_100_000,   lastUpdated: '2026-02-18T22:00:00Z', sensitivity: 'PII',          steward: 'S. Nahrup', description: 'Raw employee data from Workday' },
  { id: 'lz-glaccounts',    name: 'GLAccounts',         layer: 'landing', lakehouse: 'LH_DATA_LANDINGZONE', schema: 'dbo', rowCount: 1_850,    columnCount: 12, sizeBytes: 450_000,     lastUpdated: '2026-02-17T12:00:00Z', sensitivity: 'Internal',     steward: 'S. Nahrup', description: 'Chart of accounts from Oracle Financials' },

  // Bronze
  { id: 'br-customers',     name: 'Customers_Cleansed',     layer: 'bronze', lakehouse: 'LH_BRONZE_LAYER', schema: 'dbo', rowCount: 282_100,  columnCount: 20, sizeBytes: 42_000_000,  lastUpdated: '2026-02-19T08:45:00Z', sensitivity: 'PII',          steward: 'S. Nahrup', description: 'Deduplicated, validated customer records' },
  { id: 'br-orders',        name: 'SalesOrders_Cleansed',   layer: 'bronze', lakehouse: 'LH_BRONZE_LAYER', schema: 'dbo', rowCount: 1_228_500, columnCount: 26, sizeBytes: 305_000_000, lastUpdated: '2026-02-19T08:45:00Z', sensitivity: 'Confidential', steward: 'S. Nahrup', description: 'Validated sales orders with DQ flags' },
  { id: 'br-orderlines',    name: 'SalesOrderLines_Cleansed', layer: 'bronze', lakehouse: 'LH_BRONZE_LAYER', schema: 'dbo', rowCount: 4_885_000, columnCount: 18, sizeBytes: 880_000_000, lastUpdated: '2026-02-19T08:45:00Z', sensitivity: 'Internal',     steward: 'S. Nahrup', description: 'Validated order line items' },
  { id: 'br-products',      name: 'Products_Cleansed',      layer: 'bronze', lakehouse: 'LH_BRONZE_LAYER', schema: 'dbo', rowCount: 12_750,   columnCount: 24, sizeBytes: 8_200_000,   lastUpdated: '2026-02-19T06:30:00Z', sensitivity: 'Internal',     steward: 'S. Nahrup', description: 'Standardized product catalog' },

  // Silver
  { id: 'sv-customer360',   name: 'Customer360',        layer: 'silver', lakehouse: 'LH_SILVER_LAYER', schema: 'dbo', rowCount: 280_000, columnCount: 35, sizeBytes: 98_000_000,   lastUpdated: '2026-02-19T09:00:00Z', sensitivity: 'PII',          steward: 'S. Nahrup', description: 'Enriched customer view with order history aggregates' },
  { id: 'sv-salesfact',     name: 'SalesFact',          layer: 'silver', lakehouse: 'LH_SILVER_LAYER', schema: 'dbo', rowCount: 4_880_000, columnCount: 28, sizeBytes: 1_200_000_000, lastUpdated: '2026-02-19T09:00:00Z', sensitivity: 'Confidential', steward: 'S. Nahrup', description: 'Denormalized sales fact with product and customer dimensions' },
  { id: 'sv-productdim',    name: 'ProductDimension',   layer: 'silver', lakehouse: 'LH_SILVER_LAYER', schema: 'dbo', rowCount: 12_700,  columnCount: 30, sizeBytes: 12_000_000,   lastUpdated: '2026-02-19T06:45:00Z', sensitivity: 'Internal',     steward: 'S. Nahrup', description: 'Product dimension with category hierarchy and attributes' },

  // Gold
  { id: 'gd-revenueKPI',    name: 'RevenueKPIs',        layer: 'gold', lakehouse: 'LH_GOLD_LAYER', schema: 'dbo', rowCount: 365,     columnCount: 12, sizeBytes: 250_000,      lastUpdated: '2026-02-19T09:15:00Z', sensitivity: 'Confidential', steward: 'S. Nahrup', description: 'Daily revenue KPIs for executive dashboards' },
  { id: 'gd-customerLTV',   name: 'CustomerLTV',        layer: 'gold', lakehouse: 'LH_GOLD_LAYER', schema: 'dbo', rowCount: 280_000, columnCount: 8,  sizeBytes: 15_000_000,   lastUpdated: '2026-02-19T09:15:00Z', sensitivity: 'Internal',     steward: 'S. Nahrup', description: 'Customer lifetime value model output' },
];

// ── Column profiles (for Customers_Cleansed as example) ──

export const mockColumnProfiles: Record<string, ColumnMetadata[]> = {
  'br-customers': [
    { name: 'CustomerId',      dataType: 'integer',  nullable: false, distinctCount: 282100,  nullPercentage: 0,    sampleValues: ['10001', '10002', '10003'],        sensitivity: 'Internal', description: 'Unique customer identifier' },
    { name: 'FirstName',       dataType: 'string',   nullable: false, distinctCount: 45200,   nullPercentage: 0,    sampleValues: ['James', 'Maria', 'Chen'],         sensitivity: 'PII',      description: 'Customer first name',           purviewClassification: 'MICROSOFT.PERSONAL.NAME' },
    { name: 'LastName',        dataType: 'string',   nullable: false, distinctCount: 98400,   nullPercentage: 0,    sampleValues: ['Smith', 'Garcia', 'Johnson'],     sensitivity: 'PII',      description: 'Customer last name',            purviewClassification: 'MICROSOFT.PERSONAL.NAME' },
    { name: 'Email',           dataType: 'string',   nullable: true,  distinctCount: 278900,  nullPercentage: 1.1,  sampleValues: ['j.smith@corp.com', 'mg@test.io'], sensitivity: 'PII',      description: 'Primary email address',         purviewClassification: 'MICROSOFT.PERSONAL.EMAIL' },
    { name: 'Phone',           dataType: 'string',   nullable: true,  distinctCount: 265000,  nullPercentage: 6.1,  sampleValues: ['+1-555-0100', '+44-20-7946'],    sensitivity: 'PII',      description: 'Primary phone number',          purviewClassification: 'MICROSOFT.PERSONAL.PHONE' },
    { name: 'Country',         dataType: 'string',   nullable: false, distinctCount: 42,      nullPercentage: 0,    sampleValues: ['US', 'DE', 'UK', 'FR'],           sensitivity: 'Internal', description: 'ISO country code' },
    { name: 'Segment',         dataType: 'string',   nullable: false, distinctCount: 4,       nullPercentage: 0,    sampleValues: ['Enterprise', 'SMB', 'Consumer'],  sensitivity: 'Internal', description: 'Customer segment classification' },
    { name: 'CreatedDate',     dataType: 'datetime', nullable: false, distinctCount: 2800,    nullPercentage: 0,    minValue: '2019-01-15', maxValue: '2026-02-19',   sensitivity: 'Internal', description: 'Account creation timestamp', sampleValues: [] },
    { name: 'IsActive',        dataType: 'boolean',  nullable: false, distinctCount: 2,       nullPercentage: 0,    sampleValues: ['true', 'false'],                  sensitivity: 'Internal', description: 'Active customer flag' },
    { name: 'AnnualRevenue',   dataType: 'decimal',  nullable: true,  distinctCount: 189000,  nullPercentage: 4.2,  minValue: '0.00', maxValue: '48500000.00',         sensitivity: 'Confidential', description: 'Estimated annual revenue', sampleValues: [] },
    { name: 'DQ_Score',        dataType: 'decimal',  nullable: false, distinctCount: 95,      nullPercentage: 0,    minValue: '0.42', maxValue: '1.00',               sensitivity: 'Internal', description: 'Data quality score from Bronze cleansing', sampleValues: [] },
    { name: 'DQ_Flags',        dataType: 'string',   nullable: true,  distinctCount: 28,      nullPercentage: 78.5, sampleValues: ['PHONE_INVALID', 'EMAIL_BOUNCED'],  sensitivity: 'Internal', description: 'Data quality issue flags' },
  ],
  'lz-orders': [
    { name: 'OrderId',         dataType: 'integer',  nullable: false, distinctCount: 1230000, nullPercentage: 0,    sampleValues: ['500001', '500002'],                sensitivity: 'Internal',     description: 'SAP sales order number' },
    { name: 'CustomerId',      dataType: 'integer',  nullable: false, distinctCount: 195000,  nullPercentage: 0,    sampleValues: ['10001', '10455'],                  sensitivity: 'Internal',     description: 'Foreign key to customer' },
    { name: 'OrderDate',       dataType: 'date',     nullable: false, distinctCount: 1825,    nullPercentage: 0,    minValue: '2021-01-01', maxValue: '2026-02-19',    sensitivity: 'Internal',     description: 'Order placement date', sampleValues: [] },
    { name: 'TotalAmount',     dataType: 'decimal',  nullable: false, distinctCount: 890000,  nullPercentage: 0,    minValue: '1.50', maxValue: '2450000.00',          sensitivity: 'Confidential', description: 'Order total in base currency', sampleValues: [] },
    { name: 'Currency',        dataType: 'string',   nullable: false, distinctCount: 8,       nullPercentage: 0,    sampleValues: ['USD', 'EUR', 'GBP'],               sensitivity: 'Internal',     description: 'ISO currency code' },
    { name: 'Status',          dataType: 'string',   nullable: false, distinctCount: 5,       nullPercentage: 0,    sampleValues: ['Completed', 'Pending', 'Shipped'], sensitivity: 'Internal',     description: 'Order fulfillment status' },
    { name: 'SalesRep',        dataType: 'string',   nullable: true,  distinctCount: 320,     nullPercentage: 2.1,  sampleValues: ['T. Mueller', 'A. Johnson'],        sensitivity: 'PII',          description: 'Assigned sales representative' },
  ],
  'sv-salesfact': [
    { name: 'SalesFactId',     dataType: 'integer',  nullable: false, distinctCount: 4880000, nullPercentage: 0,    sampleValues: ['1', '2', '3'],                     sensitivity: 'Internal',     description: 'Surrogate key' },
    { name: 'OrderId',         dataType: 'integer',  nullable: false, distinctCount: 1228500, nullPercentage: 0,    sampleValues: ['500001'],                          sensitivity: 'Internal',     description: 'Order ID from Bronze' },
    { name: 'CustomerId',      dataType: 'integer',  nullable: false, distinctCount: 195000,  nullPercentage: 0,    sampleValues: ['10001'],                           sensitivity: 'Internal',     description: 'Customer dimension key' },
    { name: 'ProductId',       dataType: 'integer',  nullable: false, distinctCount: 12750,   nullPercentage: 0,    sampleValues: ['3001'],                            sensitivity: 'Internal',     description: 'Product dimension key' },
    { name: 'OrderDate',       dataType: 'date',     nullable: false, distinctCount: 1825,    nullPercentage: 0,    minValue: '2021-01-01', maxValue: '2026-02-19',    sensitivity: 'Internal',     description: 'Order date', sampleValues: [] },
    { name: 'Quantity',        dataType: 'integer',  nullable: false, distinctCount: 500,     nullPercentage: 0,    minValue: '1', maxValue: '10000',                  sensitivity: 'Internal',     description: 'Quantity ordered', sampleValues: [] },
    { name: 'UnitPrice',       dataType: 'decimal',  nullable: false, distinctCount: 8500,    nullPercentage: 0,    minValue: '0.50', maxValue: '45000.00',            sensitivity: 'Confidential', description: 'Unit price at time of sale', sampleValues: [] },
    { name: 'LineTotal',       dataType: 'decimal',  nullable: false, distinctCount: 2100000, nullPercentage: 0,    minValue: '0.50', maxValue: '2450000.00',          sensitivity: 'Confidential', description: 'Quantity * UnitPrice', sampleValues: [] },
    { name: 'CustomerSegment', dataType: 'string',   nullable: false, distinctCount: 4,       nullPercentage: 0,    sampleValues: ['Enterprise', 'SMB'],               sensitivity: 'Internal',     description: 'Denormalized from Customer360' },
    { name: 'ProductCategory', dataType: 'string',   nullable: false, distinctCount: 45,      nullPercentage: 0,    sampleValues: ['Electronics', 'Machinery'],        sensitivity: 'Internal',     description: 'Denormalized from ProductDimension' },
  ],
};

// ── Table profiles ──

export function getTableProfile(tableId: string): TableProfile | null {
  const table = mockTables.find(t => t.id === tableId);
  if (!table) return null;
  const columns = mockColumnProfiles[tableId] || generateGenericColumns(table);
  const avgNull = columns.reduce((sum, c) => sum + c.nullPercentage, 0) / columns.length;
  return {
    table,
    columns,
    qualityScore: Math.round(100 - avgNull * 0.8),
    completeness: Math.round((100 - avgNull) * 10) / 10,
    freshness: getRelativeTime(table.lastUpdated),
  };
}

function generateGenericColumns(table: LakehouseTable): ColumnMetadata[] {
  const cols: ColumnMetadata[] = [
    { name: `${table.name}Id`, dataType: 'integer', nullable: false, distinctCount: table.rowCount, nullPercentage: 0, sampleValues: ['1', '2', '3'], sensitivity: 'Internal', description: 'Primary key' },
    { name: 'Name',            dataType: 'string',  nullable: false, distinctCount: Math.floor(table.rowCount * 0.8), nullPercentage: 0, sampleValues: ['Sample A', 'Sample B'], sensitivity: 'Internal', description: 'Name field' },
    { name: 'CreatedDate',     dataType: 'datetime', nullable: false, distinctCount: Math.min(table.rowCount, 3000), nullPercentage: 0, sampleValues: [], sensitivity: 'Internal', description: 'Record creation timestamp' },
    { name: 'ModifiedDate',    dataType: 'datetime', nullable: true,  distinctCount: Math.min(table.rowCount, 2500), nullPercentage: 5.2, sampleValues: [], sensitivity: 'Internal', description: 'Last modification timestamp' },
    { name: 'IsActive',        dataType: 'boolean',  nullable: false, distinctCount: 2, nullPercentage: 0, sampleValues: ['true', 'false'], sensitivity: 'Internal', description: 'Active record flag' },
  ];
  return cols;
}

function getRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Blend suggestions ──

export const mockBlendSuggestions: BlendSuggestion[] = [
  {
    id: 'blend-1',
    sourceTable: mockTables.find(t => t.id === 'br-customers')!,
    targetTable: mockTables.find(t => t.id === 'br-orders')!,
    matchScore: 94,
    joinKeys: [{ source: 'CustomerId', target: 'CustomerId' }],
    joinType: 'inner',
    cardinality: '1:N',
    estimatedRows: 1_228_500,
    explanation: 'Strong key match on CustomerId. 1:N relationship — each customer has multiple orders. High join coverage (97.2%).',
  },
  {
    id: 'blend-2',
    sourceTable: mockTables.find(t => t.id === 'br-orders')!,
    targetTable: mockTables.find(t => t.id === 'br-orderlines')!,
    matchScore: 98,
    joinKeys: [{ source: 'OrderId', target: 'OrderId' }],
    joinType: 'inner',
    cardinality: '1:N',
    estimatedRows: 4_885_000,
    explanation: 'Perfect key match on OrderId. Standard order-to-line-items relationship. 100% join coverage.',
  },
  {
    id: 'blend-3',
    sourceTable: mockTables.find(t => t.id === 'sv-salesfact')!,
    targetTable: mockTables.find(t => t.id === 'sv-productdim')!,
    matchScore: 91,
    joinKeys: [{ source: 'ProductId', target: 'ProductDimensionId' }],
    joinType: 'inner',
    cardinality: 'N:1',
    estimatedRows: 4_880_000,
    explanation: 'Fact-to-dimension join on ProductId. Standard star schema pattern. 99.6% coverage.',
  },
  {
    id: 'blend-4',
    sourceTable: mockTables.find(t => t.id === 'sv-salesfact')!,
    targetTable: mockTables.find(t => t.id === 'sv-customer360')!,
    matchScore: 89,
    joinKeys: [{ source: 'CustomerId', target: 'CustomerId' }],
    joinType: 'left',
    cardinality: 'N:1',
    estimatedRows: 4_880_000,
    explanation: 'Fact-to-dimension join on CustomerId. Left join recommended — some orders may reference inactive customers.',
  },
  {
    id: 'blend-5',
    sourceTable: mockTables.find(t => t.id === 'br-customers')!,
    targetTable: mockTables.find(t => t.id === 'lz-employees')!,
    matchScore: 42,
    joinKeys: [{ source: 'Email', target: 'WorkEmail' }],
    joinType: 'left',
    cardinality: '1:1',
    estimatedRows: 1_850,
    explanation: 'Weak match via email fields. Low coverage (0.7%) — only matches employees who are also customers. Use with caution.',
  },
];

// ── Sample blend preview rows ──

export function generateBlendPreviewRows(blendId: string): Record<string, string>[] {
  if (blendId === 'blend-1') {
    return [
      { CustomerId: '10001', FirstName: 'James',  LastName: 'Smith',   Segment: 'Enterprise', OrderId: '500001', OrderDate: '2026-02-15', TotalAmount: '24500.00', Status: 'Completed' },
      { CustomerId: '10001', FirstName: 'James',  LastName: 'Smith',   Segment: 'Enterprise', OrderId: '500089', OrderDate: '2026-02-18', TotalAmount: '8900.00',  Status: 'Pending' },
      { CustomerId: '10002', FirstName: 'Maria',  LastName: 'Garcia',  Segment: 'SMB',        OrderId: '500002', OrderDate: '2026-02-14', TotalAmount: '3200.00',  Status: 'Completed' },
      { CustomerId: '10003', FirstName: 'Chen',   LastName: 'Wei',     Segment: 'Enterprise', OrderId: '500003', OrderDate: '2026-02-13', TotalAmount: '156000.00', Status: 'Shipped' },
      { CustomerId: '10003', FirstName: 'Chen',   LastName: 'Wei',     Segment: 'Enterprise', OrderId: '500145', OrderDate: '2026-02-19', TotalAmount: '42000.00', Status: 'Pending' },
      { CustomerId: '10004', FirstName: 'Aisha',  LastName: 'Patel',   Segment: 'Consumer',   OrderId: '500004', OrderDate: '2026-02-12', TotalAmount: '89.99',    Status: 'Completed' },
      { CustomerId: '10005', FirstName: 'Erik',   LastName: 'Olsen',   Segment: 'SMB',        OrderId: '500005', OrderDate: '2026-02-11', TotalAmount: '12400.00', Status: 'Completed' },
      { CustomerId: '10006', FirstName: 'Sophie', LastName: 'Mueller', Segment: 'Enterprise', OrderId: '500006', OrderDate: '2026-02-10', TotalAmount: '78000.00', Status: 'Shipped' },
    ];
  }
  return [
    { Id: '1', Col_A: 'value_a1', Col_B: 'value_b1', Col_C: 'value_c1' },
    { Id: '2', Col_A: 'value_a2', Col_B: 'value_b2', Col_C: 'value_c2' },
    { Id: '3', Col_A: 'value_a3', Col_B: 'value_b3', Col_C: 'value_c3' },
  ];
}

// ── Format helpers ──

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
