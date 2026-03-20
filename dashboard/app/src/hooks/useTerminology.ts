// ============================================================================
// useTerminology — Maps technical terms to business-friendly labels based on persona
//
// Usage in components:
//   const { t, layer } = useTerminology();
//   t("Entity")        → "Data Asset"  (business) | "Entity"  (engineering)
//   layer("bronze")    → "validated"   (business) | "bronze"  (engineering)
//
// Outside React (e.g. utils, formatters):
//   translateTerm("Pipeline", "business") → "Data Flow"
//
// Follow the same pattern as useSourceConfig: module-level map, standalone helper,
// hook wraps the helper with persona from context.
// ============================================================================

import { usePersona, type Persona } from "@/contexts/PersonaContext";

// ── Terminology map (technical → business) ──

const TERMINOLOGY_MAP: Record<string, string> = {
  Entity:             "Data Asset",
  Entities:           "Data Assets",
  "Landing Zone":     "Incoming Data",
  Bronze:             "Validated Data",
  Silver:             "Business-Ready Data",
  Gold:               "Analytics Data",
  "Pipeline Run":     "Data Refresh",
  Pipeline:           "Data Flow",
  "Execution Matrix": "Data Health",
  "Source Manager":   "Data Sources",
  "SCD Type 2":       "Change History",
  Watermark:          "Sync Marker",
  "Primary Key":      "Unique Identifier",
  DataSource:         "Source System",
  Namespace:          "Source System",
  Register:           "Connect",
  IsActive:           "Included in Updates",
  landing:            "incoming",
  bronze:             "validated",
  silver:             "business-ready",
  GUID:               "ID",
};

// ── Standalone helper (works outside React components) ──

/**
 * Translate a term based on persona. Safe to call from non-component code
 * as long as you pass the persona explicitly.
 */
export function translateTerm(term: string, persona: Persona): string {
  if (persona !== "business") return term;
  return TERMINOLOGY_MAP[term] ?? term;
}

// ── Hook ──

export function useTerminology() {
  const { persona } = usePersona();

  /** Translate any mapped term. Returns as-is for engineering persona. */
  function t(term: string): string {
    return translateTerm(term, persona);
  }

  /**
   * Specialized translator for layer names (landing / bronze / silver / gold).
   * Input is lowercase raw layer name; output is persona-appropriate label.
   */
  function layer(raw: string): string {
    if (persona !== "business") return raw;
    return TERMINOLOGY_MAP[raw.toLowerCase()] ?? raw;
  }

  return { t, layer };
}
