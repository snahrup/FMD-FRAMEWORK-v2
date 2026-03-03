import { Database } from "lucide-react";

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

const SOURCE_ACCENTS: Record<string, { bg: string; border: string; text: string; bar: string }> = {
  MES: {
    bg: "bg-sky-500/5",
    border: "border-sky-500/20",
    text: "text-sky-400",
    bar: "bg-sky-500",
  },
  ETQ: {
    bg: "bg-amber-500/5",
    border: "border-amber-500/20",
    text: "text-amber-400",
    bar: "bg-amber-500",
  },
  "M3 Cloud": {
    bg: "bg-purple-500/5",
    border: "border-purple-500/20",
    text: "text-purple-400",
    bar: "bg-purple-500",
  },
  M3: {
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/20",
    text: "text-emerald-400",
    bar: "bg-emerald-500",
  },
};

const DEFAULT_ACCENT = {
  bg: "bg-muted/10",
  border: "border-border",
  text: "text-muted-foreground",
  bar: "bg-muted-foreground",
};

export function SourceBreakdownCards({ sources, className = "" }: SourceBreakdownCardsProps) {
  if (sources.length === 0) return null;

  return (
    <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${className}`}>
      {sources.map((src) => {
        const accent = SOURCE_ACCENTS[src.source] || DEFAULT_ACCENT;
        const coveragePct = src.entityCount > 0 ? (src.withData / src.entityCount) * 100 : 0;

        return (
          <div
            key={src.source}
            className={`rounded-xl border p-4 transition-all hover:scale-[1.02] ${accent.bg} ${accent.border}`}
          >
            <div className="flex items-center gap-2 mb-3">
              <Database className={`w-4 h-4 ${accent.text}`} />
              <span className={`text-sm font-semibold ${accent.text}`}>{src.source}</span>
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
                <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${accent.bar}`}
                    style={{ width: `${coveragePct}%` }}
                  />
                </div>
              </div>

              {/* Mini stats */}
              <div className="flex gap-3 text-[10px] pt-1">
                <span className="text-emerald-400 tabular-nums">{src.withData} loaded</span>
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
