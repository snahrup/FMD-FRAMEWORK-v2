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
  bronze: "/load-center",
  silver: "/load-center",
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
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (coveragePct / 100) * circumference;

  return (
    <button
      onClick={() => navigate(NAV_MAP[layerKey] || "/load-center")}
      className="estate-layer-zone group relative rounded-xl border text-left transition-all w-full"
      style={{
        "--i": index,
        animation: `fadeIn 400ms calc(300ms + var(--i) * 80ms) var(--ease-claude) both`,
        background: isGhost ? "transparent" : "var(--bp-surface-1)",
        borderColor: isGhost ? "var(--bp-border)" : "var(--bp-border-strong)",
        borderStyle: isGhost ? "dashed" : "solid",
        opacity: isGhost ? 0.4 : 1,
      } as React.CSSProperties}
    >
      {/* Status rail */}
      <div
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl transition-colors"
        style={{
          background: failed > 0 ? "var(--bp-fault)" : hasData ? colors.accent : "var(--bp-border)",
        }}
      />

      {/* Hover state */}
      <style>{`
        .estate-layer-zone:not([style*="dashed"]):hover {
          background: var(--bp-surface-inset) !important;
          border-color: ${colors.accent} !important;
        }
      `}</style>

      <div className="pl-4 pr-3 py-2.5 flex items-center gap-3">
        {/* Left: badge + name + stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 mb-1">
            {/* Layer badge */}
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold tracking-wider flex-shrink-0"
              style={{
                background: isGhost ? "var(--bp-border)" : colors.bg,
                color: isGhost ? "var(--bp-ink-muted)" : colors.accent,
              }}
            >
              {colors.label}
            </div>
            <div className="min-w-0">
              <div
                className="text-xs font-semibold truncate"
                style={{
                  color: isGhost ? "var(--bp-ink-muted)" : "var(--bp-ink-primary)",
                  fontFamily: "var(--bp-font-display)",
                }}
              >
                {name}
              </div>
              <div className="text-[10px] tabular-nums" style={{ color: "var(--bp-ink-tertiary)" }}>
                {registered.toLocaleString()} registered
              </div>
            </div>
          </div>

          {/* Stats row */}
          {hasData && (
            <div className="flex items-center gap-3 text-[10px] pl-[38px]" style={{ color: "var(--bp-ink-tertiary)" }}>
              <span className="tabular-nums">
                <strong style={{ color: "var(--bp-operational)" }}>{loaded.toLocaleString()}</strong> loaded
              </span>
              {failed > 0 && (
                <span className="tabular-nums">
                  <strong style={{ color: "var(--bp-fault)" }}>{failed}</strong> missing
                </span>
              )}
              {lastLoad && (
                <span className="tabular-nums" style={{ color: "var(--bp-ink-muted)" }}>
                  {new Date(lastLoad).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
              )}
            </div>
          )}

          {isGhost && (
            <div className="text-[10px] mt-0.5 pl-[38px] italic" style={{ color: "var(--bp-ink-muted)" }}>
              Awaiting first load
            </div>
          )}
        </div>

        {/* Right: coverage ring */}
        {!isGhost && (
          <div className="flex-shrink-0">
            <svg width="40" height="40" viewBox="0 0 40 40">
              <circle
                cx="20" cy="20" r={radius}
                fill="none"
                stroke="var(--bp-border)"
                strokeWidth="2.5"
              />
              <circle
                cx="20" cy="20" r={radius}
                fill="none"
                stroke={colors.accent}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 20 20)"
                style={{ transition: "stroke-dashoffset 0.8s var(--ease-claude)" }}
              />
              <text
                x="20" y="21" textAnchor="middle" dominantBaseline="central"
                fill="var(--bp-ink-secondary)"
                fontSize="9" fontWeight="600"
                fontFamily="var(--bp-font-body)"
                className="tabular-nums"
              >
                {Math.round(coveragePct)}%
              </text>
            </svg>
          </div>
        )}
      </div>
    </button>
  );
}
