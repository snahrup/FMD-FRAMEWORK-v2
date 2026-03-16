// ── Governance, Classification, Lineage & Catalog Types ──
// Ported from fabric_toolbox/fabric-docs-portal/src/types/catalog.ts
// and adapted for the FMD medallion architecture.

// ── Classification ──

export type SensitivityLevel = "public" | "internal" | "confidential" | "restricted" | "pii";

export type CertificationStatus = "certified" | "pending" | "draft" | "deprecated" | "none";

export type DataQualityTier = "gold" | "silver" | "bronze" | "unclassified";

export type ClassifiedBy = `auto:pattern` | `auto:presidio` | `auto:claude` | `manual:${string}`;

export interface ColumnClassification {
  entityId: number;
  layer: MedallionLayer;
  columnName: string;
  sensitivityLevel: SensitivityLevel;
  certificationStatus: CertificationStatus;
  businessName?: string;
  description?: string;
  classifiedBy: ClassifiedBy;
  classifiedAt: string;
  confidence?: number;
  piiEntities?: string;
  dataType?: string;
  sourceSchema?: string;
  sourceName?: string;
  source?: string;
}

// ── Lineage ──

export type MedallionLayer = "source" | "landing" | "bronze" | "silver" | "gold";

export type LineageRelationshipType =
  | "passthrough"   // 1:1 column copy across layers
  | "computed"      // Framework-generated (HashedPKColumn, IsCurrent, etc.)
  | "cleansed"      // Modified by DQ/cleansing rule
  | "aggregated"    // Aggregation in Gold MLV
  | "derived"       // Calculated from multiple columns
  | "joined";       // Result of a join operation

export interface LineageNode {
  entityId: number;
  layer: MedallionLayer;
  name: string;
  schema: string;
  displayName?: string;
  dataSource?: string;
  server?: string;
  database?: string;
}

export interface LineageEdge {
  sourceNode: LineageNode;
  targetNode: LineageNode;
  relationship: LineageRelationshipType;
}

export interface ColumnLineage {
  sourceEntityId: number;
  sourceColumn: string;
  sourceLayer: MedallionLayer;
  targetEntityId: number;
  targetColumn: string;
  targetLayer: MedallionLayer;
  transformationType: LineageRelationshipType;
  transformationDetail?: string; // JSON for cleansing rule params
}

export interface EntityLineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface ColumnLineageChain {
  column: string;
  chain: Array<{
    layer: MedallionLayer;
    entityId: number;
    entityName: string;
    columnName: string;
    transformation: LineageRelationshipType;
  }>;
}

// ── Column Metadata ──

export interface ColumnMetadata {
  entityId: number;
  layer: MedallionLayer;
  columnName: string;
  dataType: string;
  ordinalPosition: number;
  isNullable: boolean;
  isPrimaryKey: boolean;
  isSystemColumn: boolean; // HashedPKColumn, IsDeleted, IsCurrent, etc.
  capturedAt: string;
}

// ── Data Catalog ──

export interface DataOwner {
  name: string;
  email?: string;
  role: "owner" | "steward" | "sme" | "analyst";
  department?: string;
}

export interface DataTag {
  name: string;
  color: string;
  category: "domain" | "use-case" | "compliance" | "environment";
}

export interface CatalogEntity {
  entityId: number;
  name: string;
  schema: string;
  dataSource: string;
  layerCoverage: MedallionLayer[];     // which layers this entity exists in
  certification: CertificationStatus;
  sensitivity: SensitivityLevel;
  qualityTier: DataQualityTier;
  columnCount: number;
  rowCount?: number;
  lastLoadedAt?: string;
  owners: DataOwner[];
  tags: DataTag[];
  description?: string;
  businessName?: string;
}

// ── Impact Analysis ──

export interface ImpactNode {
  entityId: number;
  entityName: string;
  layer: MedallionLayer;
  columnName?: string;         // if column-level impact
  impactType: "direct" | "transitive";
  depth: number;               // hops from origin
}

export interface ImpactAnalysisResult {
  origin: {
    entityId: number;
    entityName: string;
    layer: MedallionLayer;
    columnName?: string;
  };
  impactedEntities: ImpactNode[];
  impactedColumns: Array<ImpactNode & { columnName: string }>;
  totalImpact: number;
}

// ── Classification Summary (for heatmap/dashboard) ──

export interface ClassificationSummary {
  totalEntities: number;
  totalColumns: number;
  classifiedColumns: number;
  coveragePercent: number;
  bySensitivity: Record<SensitivityLevel, number>;
  byCertification: Record<CertificationStatus, number>;
  bySource: Array<{
    source: string;
    total: number;
    classified: number;
    piiCount: number;
    confidentialCount: number;
  }>;
}
