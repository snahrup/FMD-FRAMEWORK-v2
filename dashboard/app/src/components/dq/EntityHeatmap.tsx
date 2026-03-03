import { useState } from "react";

interface HeatmapEntity {
  entityId: string;
  name: string;
  source: string;
  scores: {
    completeness: number;
    uniqueness: number;
    coverage: number;
    freshness: number;
  };
}

interface EntityHeatmapProps {
  entities: HeatmapEntity[];
  onEntityClick?: (entityId: string) => void;
  className?: string;
}

const DIMENSIONS = ["completeness", "uniqueness", "coverage", "freshness"] as const;
const DIM_LABELS: Record<string, string> = {
  completeness: "Compl.",
  uniqueness: "Uniq.",
  coverage: "Cov.",
  freshness: "Fresh.",
};

function scoreToColor(score: number): string {
  if (score >= 90) return "rgba(52,211,153,0.7)";   // emerald
  if (score >= 70) return "rgba(251,191,36,0.5)";    // amber
  if (score >= 50) return "rgba(251,146,60,0.5)";    // orange
  return "rgba(248,113,113,0.6)";                      // red
}

function scoreToTextColor(score: number): string {
  if (score >= 90) return "#34d399";
  if (score >= 70) return "#fbbf24";
  if (score >= 50) return "#fb923c";
  return "#f87171";
}

// Group entities by source
function groupBySource(entities: HeatmapEntity[]): Record<string, HeatmapEntity[]> {
  const groups: Record<string, HeatmapEntity[]> = {};
  for (const e of entities) {
    const key = e.source || "Unknown";
    (groups[key] ??= []).push(e);
  }
  return groups;
}

const SOURCE_COLORS: Record<string, string> = {
  MES: "#38bdf8",
  ETQ: "#fbbf24",
  "M3 Cloud": "#a78bfa",
  M3: "#34d399",
};

export function EntityHeatmap({ entities, onEntityClick, className = "" }: EntityHeatmapProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; entity: string; dim: string; score: number } | null>(null);
  const groups = groupBySource(entities);

  if (entities.length === 0) {
    return (
      <div className={`flex items-center justify-center py-12 text-muted-foreground text-sm ${className}`}>
        Profile entities to populate the heatmap
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto ${className}`}>
      {/* Column headers */}
      <div className="flex items-end mb-1 pl-[180px]">
        {DIMENSIONS.map((dim) => (
          <div key={dim} className="w-14 text-center text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            {DIM_LABELS[dim]}
          </div>
        ))}
      </div>

      {Object.entries(groups).map(([source, ents]) => (
        <div key={source} className="mb-3">
          {/* Source group header */}
          <div className="flex items-center gap-2 mb-1">
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: SOURCE_COLORS[source] || "#94a3b8" }}
            />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {source}
            </span>
          </div>

          {/* Entity rows */}
          {ents.map((entity) => (
            <div
              key={entity.entityId}
              className="flex items-center group cursor-pointer hover:bg-muted/20 rounded transition-colors"
              onClick={() => onEntityClick?.(entity.entityId)}
            >
              <div className="w-[180px] px-2 py-1 text-xs font-mono truncate text-foreground/80 group-hover:text-foreground">
                {entity.name}
              </div>
              {DIMENSIONS.map((dim) => {
                const score = entity.scores[dim];
                return (
                  <div
                    key={dim}
                    className="w-14 h-7 flex items-center justify-center relative"
                    onMouseEnter={(e) =>
                      setTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        entity: entity.name,
                        dim: DIM_LABELS[dim],
                        score,
                      })
                    }
                    onMouseLeave={() => setTooltip(null)}
                  >
                    <div
                      className="w-12 h-5 rounded-sm flex items-center justify-center transition-all duration-300"
                      style={{ backgroundColor: scoreToColor(score) }}
                    >
                      <span
                        className="text-[10px] font-bold tabular-nums"
                        style={{ color: scoreToTextColor(score) }}
                      >
                        {score.toFixed(0)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 px-2.5 py-1.5 rounded-lg border text-xs pointer-events-none"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 10,
            backgroundColor: "var(--bg-surface, #1F1E1B)",
            borderColor: "var(--cl-border, rgba(108,106,96,0.25))",
            color: "var(--text-primary, #EEE)",
          }}
        >
          <span className="font-mono">{tooltip.entity}</span>
          <span className="text-muted-foreground"> · {tooltip.dim}: </span>
          <span className="font-bold" style={{ color: scoreToTextColor(tooltip.score) }}>
            {tooltip.score.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}
