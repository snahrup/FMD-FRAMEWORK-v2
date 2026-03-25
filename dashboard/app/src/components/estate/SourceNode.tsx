import { useNavigate } from "react-router-dom";
import { Server } from "lucide-react";

interface SourceNodeProps {
  name: string;
  displayName: string;
  status: "operational" | "degraded" | "offline";
  entityCount: number;
  loadedCount: number;
  errorCount: number;
  lastRefreshed: string | null;
  index: number;
  isGhost?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  operational: "var(--bp-operational)",
  degraded: "var(--bp-caution)",
  offline: "var(--bp-dismissed)",
};

export function SourceNode({
  name,
  displayName,
  status,
  entityCount,
  loadedCount,
  errorCount,
  lastRefreshed,
  index,
  isGhost,
}: SourceNodeProps) {
  const navigate = useNavigate();
  const isLive = !isGhost && status !== "offline";
  const loadPct = entityCount > 0 ? Math.round((loadedCount / entityCount) * 100) : 0;

  return (
    <button
      onClick={() => navigate("/sources")}
      className="estate-source-node group relative w-full text-left rounded-xl border transition-all"
      style={{
        "--i": index,
        animation: `fadeIn 400ms calc(var(--i) * 60ms) var(--ease-claude) both`,
        background: isGhost ? "transparent" : "var(--bp-surface-1)",
        borderColor: isGhost ? "var(--bp-border)" : "var(--bp-border-strong)",
        borderStyle: isGhost ? "dashed" : "solid",
        opacity: isGhost ? 0.45 : 1,
      } as React.CSSProperties}
    >
      {/* Status rail */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl transition-colors"
        style={{ background: isLive ? STATUS_COLORS[status] : "var(--bp-border)" }}
      />

      {/* Hover lift */}
      <style>{`
        .estate-source-node:hover:not([style*="dashed"]) {
          background: var(--bp-surface-inset) !important;
          border-color: var(--bp-copper) !important;
        }
      `}</style>

      <div className="pl-4 pr-3 py-2.5">
        {/* Header row: icon + name + pulse */}
        <div className="flex items-center gap-2 mb-1.5">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{
              background: isGhost ? "var(--bp-border)" : "var(--bp-copper-soft)",
              color: isGhost ? "var(--bp-ink-muted)" : "var(--bp-copper)",
            }}
          >
            <Server size={12} />
          </div>
          <span
            className="text-[11px] font-semibold tracking-wide uppercase truncate"
            style={{
              color: isGhost ? "var(--bp-ink-muted)" : "var(--bp-ink-primary)",
              fontFamily: "var(--bp-font-display)",
            }}
          >
            {displayName}
          </span>
          {/* Live pulse */}
          {isLive && (
            <span
              className="ml-auto inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                background: STATUS_COLORS[status],
                animation: status === "operational" ? "pulse-status 2s ease infinite" : undefined,
              }}
            />
          )}
        </div>

        {/* Progress bar — shows load coverage */}
        {!isGhost && (
          <div className="mb-1.5">
            <div className="h-[3px] rounded-full overflow-hidden" style={{ background: "var(--bp-border)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${loadPct}%`,
                  background: errorCount > 0 ? "var(--bp-caution)" : STATUS_COLORS[status],
                  transition: "width 0.8s var(--ease-claude)",
                }}
              />
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-baseline gap-2 text-[10px]" style={{ color: "var(--bp-ink-tertiary)" }}>
          <span className="tabular-nums">
            <strong style={{ color: isGhost ? "var(--bp-ink-muted)" : "var(--bp-ink-secondary)" }}>
              {entityCount.toLocaleString()}
            </strong>{" "}
            entities
          </span>
          {loadedCount > 0 && (
            <span className="tabular-nums" style={{ color: "var(--bp-operational)" }}>
              {loadedCount.toLocaleString()}
            </span>
          )}
          {errorCount > 0 && (
            <span className="tabular-nums" style={{ color: "var(--bp-fault)" }}>
              {errorCount} err
            </span>
          )}
        </div>

        {/* Last refreshed */}
        {lastRefreshed && !isGhost && (
          <div className="text-[9px] mt-1 tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
            {new Date(lastRefreshed).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}

        {isGhost && (
          <div className="text-[9px] mt-1 italic" style={{ color: "var(--bp-ink-muted)" }}>
            Awaiting first load
          </div>
        )}
      </div>
    </button>
  );
}
