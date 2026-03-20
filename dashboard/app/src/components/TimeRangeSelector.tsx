// ============================================================================
// TimeRangeSelector — Segmented time range toggle for dashboard filters
//
// Displays a set of time range buttons (1h, 6h, 24h, 7d) in a connected
// button group. Used by ExecutionMatrix and potentially other monitoring pages.
// ============================================================================

import { cn } from "@/lib/utils";
import type { TimeRange } from "@/hooks/useEngineStatus";

export interface TimeRangeSelectorProps {
  /** Currently selected time range */
  value: TimeRange;
  /** Callback when the user selects a different range */
  onChange: (range: TimeRange) => void;
  /** Available ranges to display (defaults to all four) */
  ranges?: TimeRange[];
  /** Additional className on the container */
  className?: string;
}

const DEFAULT_RANGES: TimeRange[] = ["1h", "6h", "24h", "7d"];

export function TimeRangeSelector({
  value,
  onChange,
  ranges = DEFAULT_RANGES,
  className,
}: TimeRangeSelectorProps) {
  return (
    <div
      className={cn(
        "flex items-center overflow-hidden",
        className
      )}
      style={{ background: "#EDEAE4", border: "1px solid rgba(0,0,0,0.08)", borderRadius: "6px", padding: "3px" }}
      data-testid="time-range-selector"
      role="group"
      aria-label="Time range"
    >
      {ranges.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          aria-pressed={t === value}
          className="px-2.5 py-1 text-xs font-medium transition-colors"
          style={
            t === value
              ? { background: "#FEFDFB", color: "#1C1917", border: "1px solid rgba(0,0,0,0.08)", borderRadius: "4px" }
              : { color: "#78716C", border: "1px solid transparent", borderRadius: "4px" }
          }
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export default TimeRangeSelector;
