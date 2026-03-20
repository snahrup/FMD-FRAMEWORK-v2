// ============================================================================
// useTerminology — Maps technical terms to business-friendly labels
//
// Usage in components:
//   const { t, layer } = useTerminology();
//   t("entity")        → "table"  (business) | "entity"  (engineering)
//   layer("bronze")    → "raw data" (business) | "bronze"  (engineering)
//
// Outside React:
//   translateTerm("entity", "business") → "table"
// ============================================================================

import { usePersona, type Persona } from "@/contexts/PersonaContext";

// ── Terminology map ──
// Key: lowercase technical term → business-friendly label
// Business users think in tables (what they see in source systems), not "data assets"

const TERMINOLOGY_MAP: Record<string, string> = {
  // Core vocabulary
  entity:             "table",
  entities:           "tables",
  datasource:         "source",
  namespace:          "source",
  register:           "connect",
  isactive:           "included in updates",

  // Medallion layers — hide behind plain English
  "landing zone":     "source files",
  landingzone:        "source files",
  bronze:             "raw data",
  silver:             "clean data",
  gold:               "analytics data",

  // Gold layer
  gold_domain:        "data collection",
  gold_domains:       "data collections",
  gold_model:         "dataset",
  gold_models:        "datasets",
  model_type:         "",         // hidden in business mode
  column_count:       "fields",
  row_count:          "records",

  // Pipeline / execution
  "pipeline run":     "data refresh",
  pipeline:           "data flow",
  "execution matrix": "data health",

  // Technical knobs
  watermark:          "incremental settings",
  "primary key":      "unique identifier",
  guid:               "",         // hidden in business mode
  "scd type 2":       "change history",

  // Navigation labels
  "source manager":   "data sources",

  // Layer names (lowercase, for layer() helper)
  landing:            "source files",
};

// ── Standalone helper (works outside React) ──

export function translateTerm(term: string, persona: Persona): string {
  if (persona !== "business") return term;
  const key = term.toLowerCase();
  const mapped = TERMINOLOGY_MAP[key];
  if (mapped === "") return ""; // explicitly hidden
  return mapped ?? term;
}

// ── Hook ──

export function useTerminology() {
  const { persona } = usePersona();

  /** Translate any mapped term. Returns as-is for engineering persona. */
  function t(term: string): string {
    return translateTerm(term, persona);
  }

  /**
   * Translate a layer name (landing / bronze / silver / gold).
   * Input is raw layer name; output is persona-appropriate label.
   */
  function layer(raw: string): string {
    if (persona !== "business") return raw;
    const key = raw.toLowerCase();
    return TERMINOLOGY_MAP[key] ?? raw;
  }

  /** Check if a term should be hidden in current persona mode */
  function isHidden(term: string): boolean {
    if (persona !== "business") return false;
    return TERMINOLOGY_MAP[term.toLowerCase()] === "";
  }

  return { t, layer, isHidden, persona };
}
