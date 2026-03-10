interface ColumnQualityBarProps {
  completeness: number;   // 0-100 — valid/non-null %
  nullPercent: number;     // 0-100
  invalidPercent?: number; // 0-100 — optional, derived from issues
  className?: string;
}

export function ColumnQualityBar({
  completeness,
  nullPercent,
  invalidPercent = 0,
  className = "",
}: ColumnQualityBarProps) {
  // Three segments: valid (green), null (gray), invalid (red)
  const valid = Math.max(0, completeness - invalidPercent);
  const invalid = invalidPercent;
  const empty = nullPercent;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex-1 h-2 rounded-full overflow-hidden bg-muted flex">
        {valid > 0 && (
          <div
            className="h-full bg-emerald-500 transition-all duration-500"
            style={{ width: `${valid}%` }}
            title={`Valid: ${valid.toFixed(1)}%`}
          />
        )}
        {invalid > 0 && (
          <div
            className="h-full bg-red-500 transition-all duration-500"
            style={{ width: `${invalid}%` }}
            title={`Invalid: ${invalid.toFixed(1)}%`}
          />
        )}
        {empty > 0 && (
          <div
            className="h-full bg-muted-foreground/20 transition-all duration-500"
            style={{ width: `${empty}%` }}
            title={`Null: ${empty.toFixed(1)}%`}
          />
        )}
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground w-10 text-right">
        {completeness.toFixed(0)}%
      </span>
    </div>
  );
}
