// ============================================================================
// Dataset Detail — Single table/entity detail page for Business Portal.
//
// Design system: Industrial Precision, Light Mode
// All styles use BP CSS custom properties (--bp-*)
// Route: /catalog-portal/:id
//   - entity-{N} → LZ entity lookup from control-plane
//   - domain-{N} → Gold domain detail (stub, graceful 404)
//   - otherwise  → Gold model detail
// ============================================================================

import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { resolveSourceLabel, getSourceColor } from "@/hooks/useSourceConfig";
import {
  BusinessIntentHeader,
  StatusRail,
  toRailStatus,
  SourceBadge,
  QualityTierBadge,
  scoreToTier,
  ProgressRing,
} from "@/components/business";
import { ArrowLeft, ChevronDown, ChevronRight, Clock, Database, Layers, Info } from "lucide-react";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

interface LZEntity {
  LandingzoneEntityId: number;
  SourceName: string;         // source system name
  SourceDisplayName?: string; // display name for the source
  SchemaName: string;
  TableName: string;
  DataSourceId: number;
  IsActive: boolean;
  LastLoadDate?: string | null;
  BronzeStatus?: string | null;
  SilverStatus?: string | null;
  LoadType?: string | null;
  PrimaryKeyColumns?: string | null;
  WatermarkColumn?: string | null;
}

interface BronzeEntity {
  BronzeLayerEntityId: number;
  LandingzoneEntityId: number;
  IsActive: boolean;
  LastLoadDate?: string | null;
}

interface SilverEntity {
  SilverLayerEntityId: number;
  LandingzoneEntityId?: number;
  BronzeLayerEntityId?: number;
  IsActive: boolean;
  LastLoadDate?: string | null;
}

interface DataSourceInfo {
  DataSourceId: number;
  Name: string;
  DisplayName?: string;
  ServerName?: string;
  DatabaseName?: string;
}

interface GlossaryData {
  business_name?: string;
  description?: string;
  domain?: string;
  tags?: string[];
  terms?: Array<{ term: string; definition: string }>;
}

interface QualityScore {
  entity_id: number;
  score: number;
}

interface GoldModel {
  id: number | string;
  name: string;
  description?: string;
  domain?: string;
  columns?: Array<{ name: string; type: string; description?: string }>;
}

// ── Helpers ──

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "\u2014";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function freshnessStatus(dateStr: string | null | undefined): "operational" | "caution" | "fault" | "neutral" {
  if (!dateStr) return "neutral";
  const hrs = (Date.now() - new Date(dateStr).getTime()) / 3_600_000;
  if (hrs < 24) return "operational";
  if (hrs < 72) return "caution";
  return "fault";
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded ${className ?? ""}`}
      style={{
        background: "linear-gradient(90deg, var(--bp-surface-inset) 25%, var(--bp-surface-2) 50%, var(--bp-surface-inset) 75%)",
        backgroundSize: "200% 100%",
        animation: "bp-skeleton-shimmer 2s ease-in-out infinite",
      }}
    />
  );
}

// ── Main Component ──

export default function DatasetDetail() {
  const { id } = useParams<{ id: string }>();

  const isEntity = id?.startsWith("entity-");
  const isGoldModel = !isEntity;
  const entityId = isEntity ? parseInt(id!.replace("entity-", ""), 10) : null;
  const goldModelId = isGoldModel ? id : null;

  // Entity mode state
  const [entity, setEntity] = useState<LZEntity | null>(null);
  const [bronzeMatch, setBronzeMatch] = useState<BronzeEntity | null>(null);
  const [silverMatch, setSilverMatch] = useState<SilverEntity | null>(null);
  const [datasource, setDatasource] = useState<DataSourceInfo | null>(null);
  const [glossary, setGlossary] = useState<GlossaryData | null>(null);
  const [qualityScore, setQualityScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Gold model mode state
  const [goldModel, setGoldModel] = useState<GoldModel | null>(null);
  const [goldLoading, setGoldLoading] = useState(true);
  const [goldNotFound, setGoldNotFound] = useState(false);

  // UI state
  const [techExpanded, setTechExpanded] = useState(false);

  // ── Fetch entity data ──
  useEffect(() => {
    if (!isEntity || entityId == null || isNaN(entityId)) {
      setLoading(false);
      if (isEntity) setNotFound(true);
      return;
    }

    async function fetchEntityData() {
      try {
        const entRes = await fetch(`${API}/api/overview/entities`);
        if (!entRes.ok) throw new Error("overview/entities failed");
        const entities: LZEntity[] = await entRes.json();

        const found = entities.find((e) => e.LandingzoneEntityId === entityId);
        if (!found) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        setEntity(found);

        // Bronze/Silver status comes from the enriched endpoint
        if (found.BronzeStatus) {
          setBronzeMatch({ BronzeLayerEntityId: 0, LandingzoneEntityId: entityId!, IsActive: true });
        }
        if (found.SilverStatus) {
          setSilverMatch({ SilverLayerEntityId: 0, IsActive: true });
        }

        // Build datasource info from entity fields
        setDatasource({
          DataSourceId: found.DataSourceId,
          Name: found.SourceName,
          DisplayName: (found as any).SourceDisplayName || found.SourceName,
        });

        // Fetch glossary (may 404)
        try {
          const gRes = await fetch(`${API}/api/glossary/entity/${entityId}`);
          if (gRes.ok) {
            const gData = await gRes.json();
            setGlossary(gData);
          }
        } catch {
          // Glossary not available — degrade gracefully
        }

        // Fetch quality score (may 404)
        try {
          const qRes = await fetch(`${API}/api/mdm/quality/scores`);
          if (qRes.ok) {
            const qData = await qRes.json();
            if (Array.isArray(qData)) {
              const match = qData.find((q: QualityScore) => q.entity_id === entityId);
              if (match) setQualityScore(match.score);
            }
          }
        } catch {
          // Quality not available — degrade gracefully
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    }

    fetchEntityData();
  }, [isEntity, entityId]);

  // ── Gold model data ──
  // TODO(P14): wire to actual endpoint — /api/gold/models/{id} does not exist yet
  // When the backend endpoint is created, replace this with a real fetch.
  useEffect(() => {
    if (!isGoldModel || !goldModelId) {
      setGoldLoading(false);
      return;
    }
    // No backend endpoint exists — immediately show "not found" state
    setGoldNotFound(true);
    setGoldLoading(false);
  }, [isGoldModel, goldModelId]);

  // ── Gold model mode ──
  if (isGoldModel) {
    if (goldLoading) {
      return (
        <div className="p-8 max-w-[1280px]">
          <BackLink />
          <Skeleton className="h-8 w-64 mb-4" />
          <Skeleton className="h-4 w-96 mb-8" />
          <Skeleton className="h-64 w-full" />
        </div>
      );
    }

    if (goldNotFound || !goldModel) {
      return (
        <div className="p-8 max-w-[1280px]">
          <BackLink />
          <NotFoundCard />
        </div>
      );
    }

    return (
      <div className="p-8 max-w-[1280px]">
        <BackLink />
        <Breadcrumb items={[goldModel.domain || "Model", goldModel.name]} />

        <BusinessIntentHeader
          title={goldModel.name}
          meta={goldModel.domain ? `${goldModel.domain} collection` : "Collection detail"}
          summary="This page explains a single business-facing collection or model so a non-technical user can understand what it represents before depending on it."
          items={[
            {
              label: "What This Page Is",
              value: "Single collection detail",
              detail: "Use this page to understand what this collection contains, how it should be interpreted, and where it fits inside the broader catalog.",
            },
            {
              label: "Why It Matters",
              value: "Trust depends on context",
              detail: "A dataset name alone is not enough. Business users need description, domain context, and confidence about what the asset is supposed to answer.",
            },
            {
              label: "What Happens Next",
              value: "Use it, verify it, or raise the gap",
              detail: "Confirm the collection fits the business need, then keep using it, inspect supporting source coverage in the catalog, or submit a request if this asset still leaves a coverage gap.",
            },
          ]}
          links={[
            { label: "Return to Catalog", to: "/catalog-portal" },
            { label: "Submit a Request", to: "/requests" },
            { label: "Open Help", to: "/help" },
          ]}
        />

        <div className="bp-card p-6">
          <div className="bp-panel-header mb-0">
            <span
              className="text-[14px] font-semibold"
              style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
            >
              About
            </span>
          </div>
          <p
            className="text-[14px] leading-relaxed mt-4"
            style={{ color: "var(--bp-ink-secondary)", fontFamily: "var(--bp-font-body)" }}
          >
            {goldModel.description || "No description available"}
          </p>
        </div>
      </div>
    );
  }

  // ── Entity mode: loading ──
  if (loading) {
    return (
      <div className="p-8 max-w-[1280px]">
        <BackLink />
        <Skeleton className="h-3 w-48 mb-4" />
        <Skeleton className="h-8 w-64 mb-2" />
        <div className="flex gap-2 mb-8">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: "20px" }}>
          <div className="flex flex-col gap-5">
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </div>
          <div className="flex flex-col gap-5">
            <Skeleton className="h-40 w-full rounded-lg" />
            <Skeleton className="h-48 w-full rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  // ── Entity mode: not found ──
  if (notFound || !entity) {
    return (
      <div className="p-8 max-w-[1280px]">
        <BackLink />
        <NotFoundCard />
      </div>
    );
  }

  // ── Entity mode: full render ──
  const displayName = glossary?.business_name || entity.TableName;
  const fullTableName = entity.SchemaName
    ? `${entity.SchemaName}.${entity.TableName}`
    : entity.TableName;
  const lastLoad = entity.LastLoadDate || null;
  const tier = scoreToTier(qualityScore);
  const fStatus = freshnessStatus(lastLoad);
  const loadType = entity.LoadType || "Full";

  const hasLZ = true; // if we found it in lz_entities, LZ layer exists
  const hasBronze = !!bronzeMatch;
  const hasSilver = !!silverMatch;

  return (
    <div className="p-8 max-w-[1280px]">
      {/* Back link */}
      <BackLink />

      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          resolveSourceLabel(entity.SourceName),
          displayName,
        ]}
      />

      <BusinessIntentHeader
        title={displayName}
        meta={`Source ${resolveSourceLabel(entity.SourceName)} · Last refreshed ${relativeTime(lastLoad)}`}
        summary="This page explains a single data asset in business terms while still preserving the technical receipts behind freshness, source ownership, and layer progression."
        items={[
          {
            label: "What This Page Is",
            value: "Single data asset detail",
            detail: "Use this page to understand what this table represents, how current it is, and which source system it comes from before you rely on it in analysis.",
          },
          {
            label: "Why It Matters",
            value: "Dataset trust is local",
            detail: "Even if the broader platform looks healthy, a single table can still be stale, poorly described, or incomplete. This page surfaces that asset-level truth.",
          },
          {
            label: "What Happens Next",
            value: "Decide whether to use or escalate",
            detail: "If the asset looks healthy, keep using it. If freshness, quality, or scope is weak, return to catalog, inspect the source, or submit a request for the missing business need.",
          },
        ]}
        links={[
          { label: "Return to Catalog", to: "/catalog-portal" },
          { label: "Browse Sources", to: "/sources-portal" },
          { label: "Submit a Request", to: "/requests" },
        ]}
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <SourceBadge source={entity.SourceName} />
            {qualityScore != null ? <QualityTierBadge tier={tier} /> : null}
          </div>
        }
      />

      {/* Two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: "20px", alignItems: "start" }}>
        {/* Left column */}
        <div className="flex flex-col gap-5">
          {/* About Card */}
          <div className="bp-card">
            <div className="bp-panel-header">
              <span
                className="text-[14px] font-semibold"
                style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
              >
                About
              </span>
            </div>
            <div className="p-5">
              <p
                className="text-[14px] leading-relaxed"
                style={{
                  color: glossary?.description ? "var(--bp-ink-secondary)" : "var(--bp-ink-muted)",
                  fontFamily: "var(--bp-font-body)",
                }}
              >
                {glossary?.description || "No description available"}
              </p>

              {glossary?.business_name && glossary.business_name !== entity.TableName && (
                <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--bp-border-subtle)" }}>
                  <span
                    className="text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: "var(--bp-ink-tertiary)" }}
                  >
                    Technical name
                  </span>
                  <div
                    className="bp-mono text-[13px] mt-1"
                    style={{ color: "var(--bp-ink-secondary)" }}
                  >
                    {fullTableName}
                  </div>
                </div>
              )}

              {glossary?.domain && (
                <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--bp-border-subtle)" }}>
                  <span
                    className="text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: "var(--bp-ink-tertiary)" }}
                  >
                    Domain
                  </span>
                  <div
                    className="text-[13px] mt-1"
                    style={{ color: "var(--bp-ink-secondary)", fontFamily: "var(--bp-font-body)" }}
                  >
                    {glossary.domain}
                  </div>
                </div>
              )}

              {glossary?.tags && glossary.tags.length > 0 && (
                <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--bp-border-subtle)" }}>
                  <span
                    className="text-[11px] font-medium uppercase tracking-wider"
                    style={{ color: "var(--bp-ink-tertiary)" }}
                  >
                    Tags
                  </span>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {glossary.tags.map((tag) => (
                      <span
                        key={tag}
                        className="bp-badge bp-badge-info"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Freshness Card */}
          <div className="bp-card relative overflow-hidden">
            <StatusRail status={toRailStatus(fStatus)} />
            <div className="bp-panel-header">
              <span
                className="text-[14px] font-semibold"
                style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
              >
                Freshness
              </span>
            </div>
            <div className="p-5">
              <div className="flex items-center gap-3 mb-3">
                <Clock className="h-4 w-4 shrink-0" style={{ color: "var(--bp-ink-tertiary)" }} />
                <div>
                  <div
                    className="text-[14px] font-medium"
                    style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
                  >
                    {lastLoad ? new Date(lastLoad).toLocaleString() : "Never loaded"}
                  </div>
                  <div
                    className="text-[12px] mt-0.5"
                    style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-body)" }}
                  >
                    {relativeTime(lastLoad)}
                  </div>
                </div>
              </div>

              <div
                className="flex items-center gap-2 mt-3 pt-3"
                style={{ borderTop: "1px solid var(--bp-border-subtle)" }}
              >
                <span
                  className="text-[11px] font-medium uppercase tracking-wider"
                  style={{ color: "var(--bp-ink-tertiary)" }}
                >
                  Load type
                </span>
                <span
                  className="bp-mono text-[13px]"
                  style={{ color: "var(--bp-ink-secondary)" }}
                >
                  {loadType}
                </span>
              </div>
            </div>
          </div>

          {/* Quality Card */}
          <div className="bp-card">
            <div className="bp-panel-header">
              <span
                className="text-[14px] font-semibold"
                style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
              >
                Quality
              </span>
            </div>
            <div className="p-5">
              {qualityScore != null ? (
                <div className="flex items-center gap-5">
                  <ProgressRing pct={qualityScore} size={72} />
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="bp-mono text-[28px] font-medium leading-none"
                        style={{ color: "var(--bp-ink-primary)" }}
                      >
                        {qualityScore.toFixed(0)}%
                      </span>
                      <QualityTierBadge tier={tier} />
                    </div>
                    <div
                      className="text-[13px]"
                      style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-body)" }}
                    >
                      {tier === "gold" && "Excellent data quality"}
                      {tier === "silver" && "Good data quality with minor issues"}
                      {tier === "bronze" && "Data quality needs attention"}
                      {tier === "unscored" && "Quality score below threshold"}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="text-center py-4 text-[14px]"
                  style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-body)" }}
                >
                  Quality scoring not yet available for this table
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-5">
          {/* Where Used Card */}
          <div className="bp-card">
            <div className="bp-panel-header">
              <span
                className="text-[14px] font-semibold"
                style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
              >
                Where Used
              </span>
            </div>
            <div className="p-5">
              <div
                className="flex flex-col items-center justify-center py-8 text-center"
                style={{ color: "var(--bp-ink-muted)" }}
              >
                <Layers className="h-8 w-8 mb-3 opacity-40" />
                <div
                  className="text-[13px]"
                  style={{ fontFamily: "var(--bp-font-body)" }}
                >
                  Coming soon — lineage visualization will appear here
                </div>
              </div>
            </div>
          </div>

          {/* Technical Details Card (collapsible) */}
          <div className="bp-card">
            <button
              onClick={() => setTechExpanded((prev) => !prev)}
              className="bp-panel-header w-full flex items-center cursor-pointer"
              style={{ background: "none", border: "none" }}
            >
              <span
                className="text-[14px] font-semibold flex-1 text-left"
                style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
              >
                Technical Details
              </span>
              <ChevronDown
                className="h-4 w-4 transition-transform"
                style={{
                  color: "var(--bp-ink-tertiary)",
                  transform: techExpanded ? "rotate(180deg)" : "rotate(0deg)",
                }}
              />
            </button>

            {techExpanded && (
              <div className="p-5">
                <div className="flex flex-col gap-4">
                  {/* Schema.Table */}
                  <TechRow label="Table" value={fullTableName} mono />

                  {/* Source server/database */}
                  {datasource?.ServerName && (
                    <TechRow label="Server" value={datasource.ServerName} mono />
                  )}
                  {datasource?.DatabaseName && (
                    <TechRow label="Database" value={datasource.DatabaseName} mono />
                  )}

                  {/* Layer status */}
                  <div>
                    <span
                      className="text-[11px] font-medium uppercase tracking-wider"
                      style={{ color: "var(--bp-ink-tertiary)" }}
                    >
                      Layer Status
                    </span>
                    <div className="flex items-center gap-3 mt-2">
                      <LayerIndicator label="Source Files" active={hasLZ} />
                      <LayerIndicator label="Raw Data" active={hasBronze} />
                      <LayerIndicator label="Clean Data" active={hasSilver} />
                    </div>
                  </div>

                  {/* Load type */}
                  <TechRow label="Load Type" value={loadType} />

                  {/* Key columns */}
                  {entity.PrimaryKeyColumns && (
                    <TechRow label="Key Columns" value={entity.PrimaryKeyColumns} mono />
                  )}

                  {/* Watermark */}
                  {entity.WatermarkColumn && (
                    <TechRow label="Watermark" value={entity.WatermarkColumn} mono />
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──

function BackLink() {
  return (
    <Link
      to="/catalog-portal"
      className="bp-link inline-flex items-center gap-1.5 text-[13px] mb-4"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      Back to Catalog
    </Link>
  );
}

function Breadcrumb({ items }: { items: string[] }) {
  return (
    <div
      className="flex items-center gap-1.5 mb-4 text-[12px]"
      style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-body)" }}
    >
      <span>Catalog</span>
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          <ChevronRight className="h-3 w-3" />
          <span>{item}</span>
        </span>
      ))}
    </div>
  );
}

function NotFoundCard() {
  return (
    <div
      className="bp-card p-12 text-center"
      style={{ color: "var(--bp-ink-muted)" }}
    >
      <Database className="h-10 w-10 mx-auto mb-3 opacity-40" />
      <div
        className="text-[16px] font-medium mb-2"
        style={{ fontFamily: "var(--bp-font-body)", color: "var(--bp-ink-secondary)" }}
      >
        Dataset not found
      </div>
      <div
        className="text-[13px] mb-4"
        style={{ fontFamily: "var(--bp-font-body)" }}
      >
        This dataset may have been removed or the link is invalid.
      </div>
      <Link to="/catalog-portal" className="bp-link text-[13px]">
        Return to Catalog
      </Link>
    </div>
  );
}

function TechRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span
        className="text-[11px] font-medium uppercase tracking-wider"
        style={{ color: "var(--bp-ink-tertiary)" }}
      >
        {label}
      </span>
      <div
        className={`text-[13px] mt-1 ${mono ? "bp-mono" : ""}`}
        style={{
          color: "var(--bp-ink-secondary)",
          fontFamily: mono ? undefined : "var(--bp-font-body)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function LayerIndicator({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[12px]"
      style={{
        color: active ? "var(--bp-operational)" : "var(--bp-ink-muted)",
        fontFamily: "var(--bp-font-body)",
      }}
    >
      <span>{active ? "\u2713" : "\u2013"}</span>
      <span>{label}</span>
    </span>
  );
}
