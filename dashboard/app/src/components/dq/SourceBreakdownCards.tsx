import { Database } from "lucide-react";
import { useSourceConfig } from "@/hooks/useSourceConfig";

interface SourceBreakdown {
  source: string;
  entityCount: number;
  withData: number;
  empty: number;
  totalRows: number;
  coverage: number;
}

interface SourceBreakdownCardsProps {
  sources: SourceBreakdown[];
  className?: string;
}

const DEFAULT_ACCENT = {
  bg: "bg-muted/10",
  border: "border-border",
  text: "text-muted-foreground",
  bar: "bg-muted-foreground",
};

export function SourceBreakdownCards({ sources, className = "" }: SourceBreakdownCardsProps) {
  const { resolveLabel, getColor } = useSourceConfig();

  if (sources.length === 0) return null;

  return (
    <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${className}`}>
      {sources.map((src) => {
        const c = getColor(src.source);
        const accent = c.key !== "slate"
          ? { bg: c.bg, border: c.ring.replace("ring-", "border-"), text: c.text, bar: c.bar }
          : DEFAULT_ACCENT;
        const coveragePct = src.entityCount > 0 ? (src.withData / src.entityCount) * 100 : 0;

        return (
          <div
            key={src.source}
            className={`rounded-xl border p-4 transition-all hover:scale-[1.02] ${accent.bg} ${accent.border}`}
          >
            <div className="flex items-center gap-2 mb-3">
              <Database className={`w-4 h-4 ${accent.text}`} />
              <span className={`text-sm font-semibold ${accent.text}`}>{resolveLabel(src.source)}</span>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-muted-foreground">Entities</span>
                <span className="text-lg font-bold tabular-nums">{src.entityCount}</span>
              </div>

              {/* Coverage bar */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>Coverage</span>
                  <span className="font-medium tabular-nums">{coveragePct.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${accent.bar}`}
                    style={{ width: `${coveragePct}%` }}
                  />
                </div>
              </div>

              {/* Mini stats */}
              <div className="flex gap-3 text-[10px] pt-1">
                <span className="text-[#3D7C4F] tabular-nums">{src.withData} loaded</span>
                <span className="text-muted-foreground tabular-nums">{src.empty} empty</span>
              </div>

              {src.totalRows > 0 && (
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  {src.totalRows.toLocaleString()} total rows
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
