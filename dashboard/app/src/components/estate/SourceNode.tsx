import { useNavigate } from "react-router-dom";

interface SourceNodeProps {
  name: string;
  displayName: string;
  status: "operational" | "degraded" | "offline";
  entityCount: number;
  loadedCount: number;
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
  lastRefreshed,
  index,
  isGhost,
}: SourceNodeProps) {
  const navigate = useNavigate();
  const isLive = !isGhost && status !== "offline";

  return (
    <button
      onClick={() => navigate("/sources")}
      className="estate-source-node group relative w-full text-left rounded-xl border transition-all"
      style={{
        animationDelay: `${index * 60}ms`,
        background: isGhost ? "transparent" : "var(--bp-surface-1)",
        borderColor: isGhost ? "var(--bp-border)" : "var(--bp-border-strong)",
        borderStyle: isGhost ? "dashed" : "solid",
        opacity: isGhost ? 0.45 : 1,
      }}
    >
      {/* Status rail */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl transition-colors"
        style={{ background: isLive ? STATUS_COLORS[status] : "var(--bp-border)" }}
      />

      <div className="pl-4 pr-3 py-3">
        {/* Source name */}
        <div className="flex items-center gap-2 mb-1">
          {/* Live pulse */}
          {isLive && (
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{
                background: STATUS_COLORS[status],
                animation: status === "operational" ? "pulse-status 2s ease infinite" : undefined,
              }}
            />
          )}
          <span
            className="text-xs font-semibold tracking-wide uppercase"
            style={{ color: isGhost ? "var(--bp-ink-muted)" : "var(--bp-ink-primary)" }}
          >
            {displayName}
          </span>
        </div>

        {/* Stats row */}
        <div className="flex items-baseline gap-3 text-[10px]" style={{ color: "var(--bp-ink-tertiary)" }}>
          <span className="tabular-nums">
            <strong style={{ color: isGhost ? "var(--bp-ink-muted)" : "var(--bp-ink-secondary)" }}>
              {entityCount}
            </strong>{" "}
            entities
          </span>
          {loadedCount > 0 && (
            <span className="tabular-nums">
              {loadedCount} loaded
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
          <div className="text-[9px] mt-1" style={{ color: "var(--bp-ink-muted)" }}>
            Not yet loaded
          </div>
        )}
      </div>
    </button>
  );
}
