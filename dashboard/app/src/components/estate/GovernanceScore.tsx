import { useEffect, useRef, useState } from "react";

interface GovernanceScoreProps {
  classificationPct: number;
  validationPassed: number;
  validationTotal: number;
  purviewStatus: "synced" | "ready" | "pending";
}

/**
 * Composite governance metric ring.
 * Score = weighted average: classification 40% + validation pass-rate 40% + Purview readiness 20%.
 * Uses requestAnimationFrame for smooth eased counter animation.
 */
export function GovernanceScore({
  classificationPct,
  validationPassed,
  validationTotal,
  purviewStatus,
}: GovernanceScoreProps) {
  const validationPct = validationTotal > 0 ? (validationPassed / validationTotal) * 100 : 0;
  const purviewPct = purviewStatus === "synced" ? 100 : purviewStatus === "ready" ? 50 : 0;
  const composite = Math.round(classificationPct * 0.4 + validationPct * 0.4 + purviewPct * 0.2);

  // Animated counter
  const [displayed, setDisplayed] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = displayed;
    const diff = composite - start;
    const duration = 1000;
    const t0 = performance.now();

    function tick(now: number) {
      const progress = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
      setDisplayed(Math.round(start + diff * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composite]);

  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (displayed / 100) * circumference;

  const scoreColor =
    displayed >= 70 ? "var(--bp-operational)" :
    displayed >= 40 ? "var(--bp-caution)" :
    "var(--bp-fault)";

  // Breakdown bars for the three sub-metrics
  const breakdown = [
    { label: "Classification", pct: classificationPct, weight: "40%" },
    { label: "Validation", pct: Math.round(validationPct), weight: "40%" },
    { label: "Purview", pct: Math.round(purviewPct), weight: "20%" },
  ];

  return (
    <div className="flex items-center gap-4">
      {/* Ring */}
      <div className="flex-shrink-0">
        <svg width="76" height="76" viewBox="0 0 76 76">
          <circle
            cx="38" cy="38" r={radius}
            fill="none"
            stroke="var(--bp-border)"
            strokeWidth="3.5"
          />
          <circle
            cx="38" cy="38" r={radius}
            fill="none"
            stroke={scoreColor}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 38 38)"
            style={{ transition: "stroke-dashoffset 1s var(--ease-claude)" }}
          />
          <text
            x="38" y="35"
            textAnchor="middle" dominantBaseline="central"
            fill="var(--bp-ink-primary)"
            fontSize="18" fontWeight="700"
            fontFamily="var(--bp-font-display)"
            className="tabular-nums"
          >
            {displayed}
          </text>
          <text
            x="38" y="49"
            textAnchor="middle" dominantBaseline="central"
            fill="var(--bp-ink-muted)"
            fontSize="7"
            fontFamily="var(--bp-font-body)"
            letterSpacing="0.5"
          >
            SCORE
          </text>
        </svg>
      </div>

      {/* Breakdown */}
      <div className="flex-1 space-y-2">
        {breakdown.map((item) => (
          <div key={item.label}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--bp-ink-tertiary)" }}>
                {item.label}
              </span>
              <span className="text-[9px] tabular-nums" style={{ color: "var(--bp-ink-secondary)" }}>
                {item.pct}%
              </span>
            </div>
            <div className="h-[2px] rounded-full overflow-hidden" style={{ background: "var(--bp-border)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${item.pct}%`,
                  background: item.pct >= 70 ? "var(--bp-operational)" : item.pct >= 40 ? "var(--bp-caution)" : "var(--bp-fault)",
                  transition: "width 0.8s var(--ease-claude)",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
