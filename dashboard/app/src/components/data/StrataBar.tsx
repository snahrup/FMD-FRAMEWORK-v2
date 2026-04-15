/**
 * StrataBar — Horizontal layer-presence visualization for medallion architecture.
 *
 * Shows an entity's presence / row count across LZ → Bronze → Silver → Gold
 * as proportional or equal segments with layer-specific coloring.
 *
 * Used in: RecordCounts, FlowExplorer, SourceManager, DataJourney.
 */

import { useMemo } from "react";

export interface StrataBarProps {
  /** Landing zone value (count or status flag) */
  lz?: number | null;
  /** Bronze layer value */
  bronze?: number | null;
  /** Silver layer value */
  silver?: number | null;
  /** Gold layer value */
  gold?: number | null;
  /**
   * 'count' = segment widths proportional to values.
   * 'status' = equal-width segments, color indicates presence/absence.
   */
  mode?: "count" | "status";
  /** Height: sm=4px, md=8px, lg=16px */
  size?: "sm" | "md" | "lg";
  /** Show layer labels below the bar */
  showLabels?: boolean;
  /** Optional className for the outer container */
  className?: string;
}

const LAYER_CONFIG = [
  { key: "lz", label: "LZ", color: "var(--bp-lz)", lightColor: "var(--bp-lz-light)" },
  { key: "bronze", label: "Bronze", color: "var(--bp-bronze)", lightColor: "var(--bp-bronze-light)" },
  { key: "silver", label: "Silver", color: "var(--bp-silver)", lightColor: "var(--bp-silver-light)" },
  { key: "gold", label: "Gold", color: "var(--bp-gold)", lightColor: "var(--bp-gold-light)" },
] as const;

const SIZE_MAP = { sm: 4, md: 8, lg: 16 } as const;

export default function StrataBar({
  lz,
  bronze,
  silver,
  gold,
  mode = "status",
  size = "md",
  showLabels = false,
  className = "",
}: StrataBarProps) {
  const values = useMemo(
    () => ({ lz: lz ?? null, bronze: bronze ?? null, silver: silver ?? null, gold: gold ?? null }),
    [lz, bronze, silver, gold],
  );

  const height = SIZE_MAP[size];
  const total = useMemo(() => {
    if (mode !== "count") return 0;
    return Object.values(values).reduce<number>(
      (sum, value) => sum + (typeof value === "number" && value > 0 ? value : 0),
      0,
    );
  }, [values, mode]);

  // Filter to layers that have data (for count mode, skip zero/null; for status mode, include all)
  const activeLayers = LAYER_CONFIG.filter((layer) => {
    const v = values[layer.key];
    return mode === "status" ? true : v !== null && v > 0;
  });

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", gap: showLabels ? 3 : 0 }}>
      <div
        style={{
          display: "flex",
          height,
          borderRadius: height / 2,
          overflow: "hidden",
          background: "var(--bp-surface-inset)",
          border: "1px solid var(--bp-border-subtle)",
          minWidth: 48,
        }}
      >
        {activeLayers.map((layer) => {
          const v = values[layer.key];
          const hasValue = v !== null && v > 0;
          const numericValue = typeof v === "number" ? v : 0;

          // Width calculation
          let widthPct: string;
          if (mode === "count" && total > 0) {
            widthPct = `${((hasValue ? numericValue : 0) / total) * 100}%`;
          } else {
            // Equal segments for status mode
            widthPct = `${100 / activeLayers.length}%`;
          }

          return (
            <div
              key={layer.key}
              title={`${layer.label}: ${hasValue ? numericValue.toLocaleString() : "—"}`}
              style={{
                width: widthPct,
                height: "100%",
                background: hasValue ? layer.color : layer.lightColor,
                opacity: hasValue ? 1 : 0.35,
                transition: "width 300ms ease, opacity 200ms ease",
              }}
            />
          );
        })}
      </div>

      {showLabels && (
        <div style={{ display: "flex", justifyContent: "space-between", paddingInline: 2 }}>
          {activeLayers.map((layer) => {
            const v = values[layer.key];
            const hasValue = v !== null && v > 0;
            return (
              <span
                key={layer.key}
                style={{
                  fontSize: 9,
                  fontFamily: "var(--bp-font-mono)",
                  fontFeatureSettings: "'tnum' 1",
                  color: hasValue ? "var(--bp-ink-secondary)" : "var(--bp-ink-muted)",
                  textAlign: "center",
                  flex: 1,
                }}
              >
                {layer.label}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
