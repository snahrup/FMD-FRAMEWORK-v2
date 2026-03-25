import { useNavigate } from "react-router-dom";

interface LayerZoneProps {
  name: string;
  layerKey: string;
  registered: number;
  loaded: number;
  failed: number;
  coveragePct: number;
  lastLoad: string | null;
  index: number;
}

const LAYER_COLORS: Record<string, { accent: string; bg: string; label: string }> = {
  landing: { accent: "var(--bp-lz)", bg: "var(--bp-lz-light, #E3EDF5)", label: "LZ" },
  bronze: { accent: "var(--bp-bronze)", bg: "var(--bp-bronze-light, #F4E0D0)", label: "BR" },
  silver: { accent: "var(--bp-silver)", bg: "var(--bp-silver-light, #E2E8F0)", label: "SL" },
  gold: { accent: "var(--bp-gold)", bg: "var(--bp-gold-light, #F5E6C8)", label: "AU" },
};

const NAV_MAP: Record<string, string> = {
  landing: "/load-center",
  bronze: "/load-mission-control",
  silver: "/load-mission-control",
  gold: "/gold/ledger",
};

export function LayerZone({
  name,
  layerKey,
  registered,
  loaded,
  failed,
  coveragePct,
  lastLoad,
  index,
}: LayerZoneProps) {
  const navigate = useNavigate();
  const colors = LAYER_COLORS[layerKey] || LAYER_COLORS.landing;
  const isGhost = registered === 0 && loaded === 0;
  const hasData = loaded > 0;

  // Coverage ring (SVG)
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (coveragePct / 100) * circumference;

  return (
    <button
      onClick={() => navigate(NAV_MAP[layerKey] || "/load-center")}
      className="estate-layer-zone group relative rounded-xl border text-left transition-all w-full"
      style={{
        animationDelay: `${300 + index * 80}ms`,
        background: isGhost ? "transparent" : "var(--bp-surface-1)",
        borderColor: isGhost ? "var(--bp-border)" : "var(--bp-border-strong)",
        borderStyle: isGhost ? "dashed" : "solid",
        opacity: isGhost ? 0.4 : 1,
      }}
    >
      {/* Status rail */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
        style={{
          background: failed > 0 ? "var(--bp-fault)" : hasData ? colors.accent : "var(--bp-border)",
        }}
      />

      <div className="pl-4 pr-3 py-3">
        {/* Header: badge + name */}
        <div className="flex items-center gap-2.5 mb-2">
          {/* Layer badge */}
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold tracking-wider"
            style={{
              background: isGhost ? "var(--bp-border)" : colors.bg,
              color: isGhost ? "var(--bp-ink-muted)" : colors.accent,
            }}
          >
            {colors.label}
          </div>
          <div>
            <div
              className="text-xs font-semibold"
              style={{ color: isGhost ? "var(--bp-ink-muted)" : "var(--bp-ink-primary)" }}
            >
              {name}
            </div>
            <div className="text-[10px]" style={{ color: "var(--bp-ink-tertiary)" }}>
              {registered} registered
            </div>
          </div>

          {/* Coverage ring */}
          {!isGhost && (
            <div className="ml-auto flex-shrink-0">
              <svg width="44" height="44" viewBox="0 0 44 44">
                <circle
                  cx="22" cy="22" r={radius}
                  fill="none"
                  stroke="var(--bp-border)"
                  strokeWidth="3"
                />
                <circle
                  cx="22" cy="22" r={radius}
                  fill="none"
                  stroke={colors.accent}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  transform="rotate(-90 22 22)"
                  style={{ transition: "stroke-dashoffset 0.8s var(--ease-claude)" }}
                />
                <text
                  x="22" y="23" textAnchor="middle" dominantBaseline="central"
                  fill="var(--bp-ink-secondary)"
                  fontSize="9" fontWeight="600"
                  fontFamily="var(--bp-font-body)"
                >
                  {Math.round(coveragePct)}%
                </text>
              </svg>
            </div>
          )}
        </div>

        {/* Stats */}
        {hasData && (
          <div className="flex items-center gap-3 text-[10px]" style={{ color: "var(--bp-ink-tertiary)" }}>
            <span className="tabular-nums">
              <strong style={{ color: "var(--bp-operational)" }}>{loaded}</strong> loaded
            </span>
            {failed > 0 && (
              <span className="tabular-nums">
                <strong style={{ color: "var(--bp-fault)" }}>{failed}</strong> failed
              </span>
            )}
          </div>
        )}

        {/* Last load */}
        {lastLoad && (
          <div className="text-[9px] mt-1 tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
            {new Date(lastLoad).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}

        {isGhost && (
          <div className="text-[10px] mt-1" style={{ color: "var(--bp-ink-muted)" }}>
            Awaiting first load
          </div>
        )}
      </div>
    </button>
  );
}
