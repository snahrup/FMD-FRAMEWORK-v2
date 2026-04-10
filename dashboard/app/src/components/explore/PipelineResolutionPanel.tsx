import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, DatabaseZap, Layers3, Wrench } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { DigestEntity } from "@/hooks/useEntityDigest";
import {
  buildEntitySourceSqlUrl,
  getEntityMissingLayers,
  type EntityResolutionAction,
} from "@/lib/exploreWorksurface";
import { resolveSourceLabel } from "@/hooks/useSourceConfig";

function reasonLabel(reason: EntityResolutionAction["reason"]): string {
  if (reason === "registration") return "Initial import is incomplete";
  if (reason === "pipeline_failure") return "A load failed mid-path";
  return "The medallion path is incomplete";
}

export function PipelineResolutionPanel({
  entity,
  action,
  title = "This asset is not ready for tool mode",
  summary,
}: {
  entity: DigestEntity;
  action: EntityResolutionAction;
  title?: string;
  summary?: string;
}) {
  const missingLayers = getEntityMissingLayers(entity);
  const sourceSql = buildEntitySourceSqlUrl(entity);

  return (
    <Card style={{ borderColor: "rgba(180,86,36,0.18)", background: "linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(244,242,237,0.98) 100%)" }}>
      <CardContent className="p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px]" style={{ background: "rgba(180,86,36,0.10)", color: "var(--bp-copper)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
              <AlertTriangle size={12} />
              Resolution required
            </div>
            <h2 className="mt-3 text-xl" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
              {title}
            </h2>
            <p className="mt-2 text-sm" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.7 }}>
              {summary || "Explore surfaces only operate on assets that have fully completed the staged path. This keeps operators out of dead-end pages and makes the next move obvious."}
            </p>
          </div>
          <div className="rounded-[20px] px-4 py-3 text-right" style={{ border: "1px solid rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.82)" }}>
            <div style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>
              Selected asset
            </div>
            <div className="mt-1 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
              {entity.businessName || entity.tableName}
            </div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-secondary)" }}>
              {resolveSourceLabel(entity.source)} · {entity.sourceSchema}.{entity.tableName}
            </div>
          </div>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-[18px] px-4 py-4" style={{ border: "1px solid rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.84)" }}>
            <div style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>
              Readiness state
            </div>
            <div className="mt-2 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
              {reasonLabel(action.reason)}
            </div>
            <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
              {action.detail}
            </p>
          </div>
          <div className="rounded-[18px] px-4 py-4" style={{ border: "1px solid rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.84)" }}>
            <div style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>
              Missing layers
            </div>
            <div className="mt-2 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
              {missingLayers.length > 0 ? missingLayers.join(" · ") : "Failure after load"}
            </div>
            <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
              Once the remaining path completes, this asset will automatically re-enter Catalog, Lineage, Blender, and Profiler with full functionality.
            </p>
          </div>
          <div className="rounded-[18px] px-4 py-4" style={{ border: "1px solid rgba(91,84,76,0.10)", background: "rgba(255,255,255,0.84)" }}>
            <div style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>
              Single fix surface
            </div>
            <div className="mt-2 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
              Load Center owns import completion
            </div>
            <p className="mt-2 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
              Pipeline execution is centralized so users stop bouncing between multiple pages trying to figure out where to finish the import path.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            to={action.to}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2.5"
            style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-surface-1)", backgroundColor: "var(--bp-copper)", textDecoration: "none", boxShadow: "0 16px 32px rgba(180,86,36,0.16)" }}
          >
            <Wrench size={14} />
            {action.label}
          </Link>
          {sourceSql ? (
            <Link
              to={sourceSql}
              className="inline-flex items-center gap-2 rounded-full px-4 py-2.5"
              style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-primary)", backgroundColor: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", textDecoration: "none" }}
            >
              <DatabaseZap size={14} />
              Inspect source contract
            </Link>
          ) : null}
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-2.5" style={{ fontSize: 12, fontWeight: 600, color: "var(--bp-ink-secondary)", backgroundColor: "rgba(255,255,255,0.82)", border: "1px solid rgba(91,84,76,0.10)" }}>
            <Layers3 size={14} />
            Returns to tool mode automatically after completion
            <ArrowRight size={14} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
