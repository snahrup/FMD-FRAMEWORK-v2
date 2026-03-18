// Provenance Thread — 7-dot progression showing entity phase through the Gold pipeline.

import { cn } from "@/lib/utils";

// Inject keyframe styles once at module scope (not per-render)
const STYLE_ID = "provenance-thread-styles";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes provenance-pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.3); }
    }
    .provenance-pulse {
      animation: provenance-pulse 2s ease-in-out infinite;
    }
  `;
  document.head.appendChild(style);
}

interface ProvenanceThreadProps {
  /** Current phase (1=Imported through 7=Cataloged) */
  phase: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Size variant */
  size?: "sm" | "md";
}

const PHASE_LABELS = [
  "Imported",
  "Extracted",
  "Clustered",
  "Canonicalized",
  "Gold Drafted",
  "Validated",
  "Cataloged",
] as const;

const GOLD_COMPLETE = "#C2952B";

export function ProvenanceThread({ phase, size = "sm" }: ProvenanceThreadProps) {
  const dotSize = size === "sm" ? 6 : 8;
  const totalWidth = size === "sm" ? 160 : 200;
  const isComplete = phase === 7;

  return (
    <div
      className="inline-flex flex-col items-center"
      style={{ width: totalWidth }}
    >
      {/* Dots and lines */}
      <div className="flex items-center w-full justify-between">
        {PHASE_LABELS.map((_, i) => {
          const step = i + 1;
          const isPast = step < phase;
          const isCurrent = step === phase;
          const isFuture = step > phase;

          return (
            <div key={i} className="flex items-center" style={{ flex: i < 6 ? 1 : 0 }}>
              {/* Dot */}
              <div
                className={cn(
                  "rounded-full shrink-0",
                  isCurrent && !isComplete && "provenance-pulse"
                )}
                style={{
                  width: dotSize,
                  height: dotSize,
                  background:
                    isComplete
                      ? GOLD_COMPLETE
                      : isPast || isCurrent
                        ? "var(--bp-copper)"
                        : "transparent",
                  border: isFuture && !isComplete
                    ? "1px solid rgba(0,0,0,0.15)"
                    : "none",
                }}
              />
              {/* Connecting line */}
              {i < 6 && (
                <div
                  className="flex-1"
                  style={{
                    height: 1,
                    background:
                      isComplete
                        ? GOLD_COMPLETE
                        : step < phase
                          ? "var(--bp-copper)"
                          : "rgba(0,0,0,0.10)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Labels — md only */}
      {size === "md" && (
        <div className="flex w-full justify-between mt-1.5">
          {PHASE_LABELS.map((label, i) => {
            const step = i + 1;
            const isActive = step <= phase;
            return (
              <span
                key={i}
                className="text-center leading-tight"
                style={{
                  fontFamily: "var(--bp-font-mono)",
                  fontSize: 10,
                  letterSpacing: "0.03em",
                  color: isComplete
                    ? GOLD_COMPLETE
                    : isActive
                      ? "var(--bp-copper)"
                      : "var(--bp-ink-muted)",
                  width: `${100 / 7}%`,
                }}
              >
                {label}
              </span>
            );
          })}
        </div>
      )}

    </div>
  );
}
