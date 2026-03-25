import { useEffect, useRef, useState } from "react";

interface GovernanceScoreProps {
  classificationPct: number;
  validationPassed: number;
  validationTotal: number;
  purviewStatus: "synced" | "ready" | "pending";
}

/**
 * Composite governance metric ring.
 * Score = weighted average of classification coverage (40%), validation pass rate (40%), Purview readiness (20%).
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

  // Animated value
  const [displayed, setDisplayed] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const start = displayed;
    const diff = composite - start;
    const duration = 1000;
    const t0 = performance.now();

    function tick(now: number) {
      const progress = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(start + diff * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composite]);

  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (displayed / 100) * circumference;

  const scoreColor =
    displayed >= 80 ? "var(--bp-operational)" :
    displayed >= 50 ? "var(--bp-caution)" :
    "var(--bp-fault)";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="88" height="88" viewBox="0 0 88 88">
        {/* Background track */}
        <circle
          cx="44" cy="44" r={radius}
          fill="none"
          stroke="var(--bp-border)"
          strokeWidth="4"
        />
        {/* Score arc */}
        <circle
          cx="44" cy="44" r={radius}
          fill="none"
          stroke={scoreColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 44 44)"
          style={{ transition: "stroke-dashoffset 1s var(--ease-claude)" }}
        />
        {/* Center score */}
        <text
          x="44" y="40"
          textAnchor="middle" dominantBaseline="central"
          fill="var(--bp-ink-primary)"
          fontSize="20" fontWeight="700"
          fontFamily="var(--bp-font-display)"
          className="tabular-nums"
        >
          {displayed}
        </text>
        <text
          x="44" y="56"
          textAnchor="middle" dominantBaseline="central"
          fill="var(--bp-ink-muted)"
          fontSize="8"
          fontFamily="var(--bp-font-body)"
        >
          GOVERNANCE
        </text>
      </svg>
    </div>
  );
}
