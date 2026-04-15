import type { DigestEntity } from "@/hooks/useEntityDigest";

const SUCCESS_STATUSES = new Set([
  "loaded",
  "succeeded",
  "success",
  "completed",
  "complete",
  "idle",
]);

const ERROR_STATUSES = new Set([
  "error",
  "failed",
  "warning",
  "aborted",
]);

function normalizeStatus(status?: string | null): string {
  return (status || "").toLowerCase().replace(/[\s-]+/g, "_");
}

export function isSuccessStatus(status?: string | null): boolean {
  return SUCCESS_STATUSES.has(normalizeStatus(status));
}

export function isErrorStatus(status?: string | null): boolean {
  return ERROR_STATUSES.has(normalizeStatus(status));
}

export function getLoadedLayerCount(entity: DigestEntity): number {
  return [
    isSuccessStatus(entity.lzStatus),
    isSuccessStatus(entity.bronzeStatus),
    isSuccessStatus(entity.silverStatus),
  ].filter(Boolean).length;
}

export function getEntityMissingLayers(entity: DigestEntity): Array<"landing" | "bronze" | "silver"> {
  const missing: Array<"landing" | "bronze" | "silver"> = [];
  if (!isSuccessStatus(entity.lzStatus)) missing.push("landing");
  if (!isSuccessStatus(entity.bronzeStatus)) missing.push("bronze");
  if (!isSuccessStatus(entity.silverStatus)) missing.push("silver");
  return missing;
}

export function hasFullPipelineCoverage(entity: DigestEntity): boolean {
  return getEntityMissingLayers(entity).length === 0;
}

export function isEntityInPipelineScope(entity: DigestEntity): boolean {
  return Boolean(entity.isActive);
}

export function isEntityToolReady(entity: DigestEntity): boolean {
  return isEntityInPipelineScope(entity) && hasFullPipelineCoverage(entity) && !entity.lastError;
}

export function getToolReadyEntities(entities: DigestEntity[]): DigestEntity[] {
  return entities.filter((entity) => isEntityToolReady(entity));
}

export function getBlockedEntities(entities: DigestEntity[]): DigestEntity[] {
  return entities.filter((entity) => isEntityInPipelineScope(entity) && !isEntityToolReady(entity));
}

export function getEntityLakehouseSchema(entity: DigestEntity): string {
  return entity.onelakeSchema || entity.targetSchema || entity.source || entity.sourceSchema;
}

function buildQuery(params: Record<string, string | undefined | null>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  return search.toString();
}

export function buildEntityCatalogUrl(entity: DigestEntity): string {
  return `/catalog?${buildQuery({
    table: entity.tableName,
    schema: entity.sourceSchema,
    source: entity.source,
  })}`;
}

export function buildEntityLineageUrl(entity: DigestEntity): string {
  return `/lineage?${buildQuery({
    table: entity.tableName,
    schema: entity.sourceSchema,
    source: entity.source,
  })}`;
}

export function buildEntityProfileUrl(
  entity: DigestEntity,
  layer: "landing" | "bronze" | "silver" | "gold" = "silver",
): string {
  const lakehouse = layer === "silver"
    ? "LH_SILVER_LAYER"
    : layer === "landing"
      ? "LH_DATA_LANDINGZONE"
      : layer === "gold"
        ? "LH_GOLD_LAYER"
        : "LH_BRONZE_LAYER";
  return `/profile?${buildQuery({
    lakehouse,
    schema: getEntityLakehouseSchema(entity),
    table: entity.tableName,
    layer,
  })}`;
}

export function buildEntityBlenderUrl(
  entity: DigestEntity,
  layer: "landing" | "bronze" | "silver" | "gold" = "silver",
): string {
  return `/blender?${buildQuery({
    schema: getEntityLakehouseSchema(entity),
    table: entity.tableName,
    layer,
  })}`;
}

export function buildEntityJourneyUrl(entity: DigestEntity): string {
  return `/journey?${buildQuery({
    entity: String(entity.id),
  })}`;
}

export function buildEntityLoadCenterUrl(entity: DigestEntity): string {
  return `/load-center?${buildQuery({
    entity: String(entity.id),
    table: entity.tableName,
    source: entity.source,
    schema: entity.sourceSchema,
  })}`;
}

export function buildEntityMissionControlUrl(entity: DigestEntity): string {
  return buildEntityLoadCenterUrl(entity);
}

export function buildEntitySourceManagerUrl(entity: DigestEntity): string {
  return `/sources?${buildQuery({
    table: entity.tableName,
    source: entity.source,
    schema: entity.sourceSchema,
  })}`;
}

export function buildEntityEvolutionUrl(entity: DigestEntity): string {
  return `/columns?${buildQuery({
    entity: String(entity.id),
  })}`;
}

export function buildEntityMicroscopeUrl(entity: DigestEntity, pk?: string | null): string {
  return `/microscope?${buildQuery({
    entity: String(entity.id),
    pk,
  })}`;
}

export function buildEntityReplayUrl(entity: DigestEntity, pk?: string | null): string {
  return `/replay?${buildQuery({
    entity: String(entity.id),
    pk,
  })}`;
}

export function buildEntitySourceSqlUrl(entity: DigestEntity): string | null {
  if (!entity.connection) return null;
  return `/sql-explorer?${buildQuery({
    server: entity.connection.server,
    database: entity.connection.database,
    schema: entity.sourceSchema,
    table: entity.tableName,
  })}`;
}

export function buildEntityLakehouseSqlUrl(
  entity: DigestEntity,
  layer: "landing" | "bronze" | "silver" | "gold" = "silver",
): string {
  const database = layer === "silver"
    ? "LH_SILVER_LAYER"
    : layer === "landing"
      ? "LH_DATA_LANDINGZONE"
      : layer === "gold"
        ? "LH_GOLD_LAYER"
        : "LH_BRONZE_LAYER";
  return `/sql-explorer?${buildQuery({
    database,
    schema: getEntityLakehouseSchema(entity),
    table: entity.tableName,
  })}`;
}

export function findEntityFromParams(
  entities: DigestEntity[],
  params: {
    table?: string | null;
    schema?: string | null;
    source?: string | null;
  },
): DigestEntity | null {
  const table = params.table?.toLowerCase();
  const schema = params.schema?.toLowerCase();
  const source = params.source?.toLowerCase();
  if (!table) return null;

  return entities.find((entity) => {
    if (entity.tableName.toLowerCase() !== table) return false;
    if (source && entity.source.toLowerCase() !== source) return false;
    if (!schema) return true;
    return [
      entity.sourceSchema,
      entity.onelakeSchema,
      entity.targetSchema,
      entity.source,
    ]
      .filter(Boolean)
      .some((candidate) => candidate!.toLowerCase() === schema);
  }) || null;
}

export function findEntityById(
  entities: DigestEntity[],
  entityId?: string | number | null,
): DigestEntity | null {
  if (entityId == null || entityId === "") return null;
  const value = String(entityId);
  return entities.find((entity) => String(entity.id) === value) || null;
}

export interface EntityRecommendedAction {
  label: string;
  detail: string;
  to: string;
}

export interface EntityResolutionAction extends EntityRecommendedAction {
  reason: "registration" | "pipeline_failure" | "pipeline_completion";
}

export function getEntityResolutionAction(entity: DigestEntity): EntityResolutionAction {
  const missingLayers = getEntityMissingLayers(entity);
  const failedLayer = entity.lastError?.layer;

  if (!isSuccessStatus(entity.lzStatus)) {
    return {
      label: "Finish this import in Load Center",
      detail: "This table has not reached landing yet. Use Load Center to complete the initial import before it enters tool mode.",
      to: buildEntityLoadCenterUrl(entity),
      reason: "registration",
    };
  }

  if (entity.lastError || failedLayer) {
    return {
      label: "Resolve the broken load path",
      detail: `The pipeline stopped${failedLayer ? ` in ${failedLayer}` : ""}. Finish the load from Load Center before using this asset in Explore tools.`,
      to: buildEntityLoadCenterUrl(entity),
      reason: "pipeline_failure",
    };
  }

  return {
    label: "Complete the medallion path",
    detail: `This table is still missing ${missingLayers.join(", ")}. Finish the remaining layers in Load Center before sending it into tool mode.`,
    to: buildEntityLoadCenterUrl(entity),
    reason: "pipeline_completion",
  };
}

export function getEntityRecommendedAction(entity: DigestEntity): EntityRecommendedAction {
  if (!isEntityToolReady(entity)) {
    return getEntityResolutionAction(entity);
  }

  if (entity.lastError) {
    return {
      label: "Trace the failure path",
      detail: `The most recent issue is in ${entity.lastError.layer}. Start with lineage and follow the broken handoff.`,
      to: buildEntityLineageUrl(entity),
    };
  }

  if (isSuccessStatus(entity.silverStatus)) {
    return {
      label: "Profile the silver output",
      detail: "Silver is ready. Use profiling to validate completeness, potential keys, and downstream confidence.",
      to: buildEntityProfileUrl(entity, "silver"),
    };
  }

  if (isSuccessStatus(entity.bronzeStatus)) {
    return {
      label: "Profile the bronze shape",
      detail: "Bronze is the fastest place to inspect structure and obvious quality drift before silver logic hides it.",
      to: buildEntityProfileUrl(entity, "bronze"),
    };
  }

  const sourceSql = buildEntitySourceSqlUrl(entity);
  if (sourceSql) {
    return {
      label: "Inspect the source schema",
      detail: "The pipeline is not far enough downstream yet. Start with source shape and registration context.",
      to: sourceSql,
    };
  }

  return {
    label: "Review pipeline coverage",
    detail: "Use lineage to see where this entity stops progressing and what layer is still missing.",
    to: buildEntityLineageUrl(entity),
  };
}
