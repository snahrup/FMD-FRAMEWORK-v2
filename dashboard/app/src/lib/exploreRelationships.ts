import type { DigestEntity } from "@/hooks/useEntityDigest";
import { isSuccessStatus } from "@/lib/exploreWorksurface";

const TOKEN_STOP_WORDS = new Set([
  "data",
  "dim",
  "fact",
  "tbl",
  "table",
  "vw",
  "view",
  "stg",
  "raw",
  "hist",
  "history",
  "master",
  "detail",
  "header",
  "lines",
  "line",
  "entity",
  "record",
  "records",
]);

function normalizeValue(value?: string | null): string {
  return (value || "").trim().toLowerCase();
}

function tokenize(value?: string | null): string[] {
  return normalizeValue(value)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2 && !TOKEN_STOP_WORDS.has(token));
}

function sharedTokens(a: DigestEntity, b: DigestEntity): string[] {
  const left = new Set([
    ...tokenize(a.tableName),
    ...tokenize(a.businessName),
    ...tokenize(a.description),
  ]);
  const right = new Set([
    ...tokenize(b.tableName),
    ...tokenize(b.businessName),
    ...tokenize(b.description),
  ]);
  return Array.from(left).filter((token) => right.has(token));
}

export interface DerivedRelationship {
  entity: DigestEntity;
  score: number;
  confidence: "strong" | "moderate" | "emerging";
  reasons: string[];
  edgeLabel: string;
  evidence: {
    kind: string;
    label: string;
    detail: string;
    provenance: {
      type: string;
      sourceRef: string;
      fields: string[];
    };
  }[];
}

export function deriveEntityRelationships(
  selected: DigestEntity,
  entities: DigestEntity[],
  limit = 6,
): DerivedRelationship[] {
  return entities
    .filter((candidate) => candidate.id !== selected.id)
    .map((candidate) => {
      const reasons: string[] = [];
      const evidence: DerivedRelationship["evidence"] = [];
      let score = 0;
      const sourceRef = `entity-digest#entityId=${selected.id}|entity-digest#entityId=${candidate.id}`;

      if (normalizeValue(selected.domain) && normalizeValue(selected.domain) === normalizeValue(candidate.domain)) {
        score += 32;
        reasons.push(`same ${selected.domain} domain`);
        evidence.push({
          kind: "shared_domain",
          label: "Shared business domain",
          detail: String(selected.domain),
          provenance: { type: "entity_digest", sourceRef, fields: ["domain"] },
        });
      }

      if (normalizeValue(selected.source) === normalizeValue(candidate.source)) {
        score += 18;
        reasons.push(`same ${candidate.source} source`);
        evidence.push({
          kind: "shared_source",
          label: "Shared source system",
          detail: String(candidate.source),
          provenance: { type: "entity_digest", sourceRef, fields: ["source"] },
        });
      }

      const selectedSchemas = new Set([
        normalizeValue(selected.sourceSchema),
        normalizeValue(selected.targetSchema),
        normalizeValue(selected.onelakeSchema),
      ].filter(Boolean));
      const candidateSchemas = [
        normalizeValue(candidate.sourceSchema),
        normalizeValue(candidate.targetSchema),
        normalizeValue(candidate.onelakeSchema),
      ].filter(Boolean);
      if (candidateSchemas.some((schema) => selectedSchemas.has(schema))) {
        score += 10;
        reasons.push("shared working schema");
        evidence.push({
          kind: "shared_schema",
          label: "Shared working schema",
          detail: candidateSchemas.filter((schema) => selectedSchemas.has(schema)).slice(0, 3).join(", "),
          provenance: { type: "entity_digest", sourceRef, fields: ["sourceSchema", "targetSchema", "onelakeSchema"] },
        });
      }

      const overlap = sharedTokens(selected, candidate);
      if (overlap.length > 0) {
        score += Math.min(overlap.length * 10, 30);
        reasons.push(`shared terms: ${overlap.slice(0, 3).join(", ")}`);
        evidence.push({
          kind: "shared_terms",
          label: "Shared naming/context terms",
          detail: overlap.slice(0, 4).join(", "),
          provenance: { type: "entity_digest", sourceRef, fields: ["tableName", "businessName", "description"] },
        });
      }

      if (isSuccessStatus(selected.silverStatus) && isSuccessStatus(candidate.silverStatus)) {
        score += 6;
        reasons.push("both already usable in silver");
        evidence.push({
          kind: "shared_silver_posture",
          label: "Both ready in silver",
          detail: `${selected.tableName} and ${candidate.tableName} are already loaded in silver`,
          provenance: { type: "entity_digest", sourceRef, fields: ["silverStatus"] },
        });
      } else if (isSuccessStatus(selected.bronzeStatus) && isSuccessStatus(candidate.bronzeStatus)) {
        score += 4;
        evidence.push({
          kind: "shared_bronze_posture",
          label: "Both staged in bronze",
          detail: `${selected.tableName} and ${candidate.tableName} are both loaded in bronze`,
          provenance: { type: "entity_digest", sourceRef, fields: ["bronzeStatus"] },
        });
      }

      if ((selected.qualityScore || 0) >= 80 && (candidate.qualityScore || 0) >= 80) {
        score += 4;
        reasons.push("both have high trust signals");
        evidence.push({
          kind: "trusted_pair",
          label: "High trust pair",
          detail: `${Math.round(selected.qualityScore || 0)}% and ${Math.round(candidate.qualityScore || 0)}% trust`,
          provenance: { type: "entity_digest", sourceRef, fields: ["qualityScore", "qualityTier"] },
        });
      }

      if (score < 18) return null;

      const confidence: DerivedRelationship["confidence"] =
        score >= 52 ? "strong" : score >= 34 ? "moderate" : "emerging";

      return {
        entity: candidate,
        score,
        confidence,
        reasons,
        edgeLabel: confidence === "strong"
          ? "high-context match"
          : confidence === "moderate"
            ? "likely related"
            : "possible adjacency",
        evidence,
      } satisfies DerivedRelationship;
    })
    .filter((value): value is DerivedRelationship => value !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
