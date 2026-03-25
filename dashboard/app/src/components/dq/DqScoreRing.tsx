import { useEffect, useState } from "react";
import { RadialBarChart, RadialBar, ResponsiveContainer } from "recharts";

interface DqScoreRingProps {
  score: number;       // 0-100
  label: string;
  size?: number;       // px — 80 or 120
  trend?: "up" | "down" | "flat";
  className?: string;
}

function scoreColor(score: number): string {
  if (score >= 90) return "#3D7C4F"; // BP green
  if (score >= 70) return "#C27A1A"; // BP amber
  return "#B93A2A";                   // BP red
}

function scoreGlow(score: number): string {
  if (score >= 90) return "0 0 20px rgba(61,124,79,0.3)";
  if (score >= 70) return "0 0 20px rgba(194,122,26,0.2)";
  return "0 0 20px rgba(185,58,42,0.3)";
}

const trendArrow = {
  up: "\u2191",
  down: "\u2193",
  flat: "\u2192",
};

const trendColor = {
  up: "text-[#3D7C4F]",
  down: "text-[#B93A2A]",
  flat: "text-muted-foreground",
};

export function DqScoreRing({
  score,
  label,
  size = 120,
  trend,
  className = "",
}: DqScoreRingProps) {
  const [animatedScore, setAnimatedScore] = useState(0);

  useEffect(() => {
    // Animate from 0 to score
    const duration = 800;
    const t0 = performance.now();
    let raf: number;

    const tick = (now: number) => {
      const progress = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setAnimatedScore(score * eased);
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const color = scoreColor(score);
  const data = [
    { name: "bg", value: 100, fill: "rgba(128,128,128,0.1)" },
    { name: "score", value: animatedScore, fill: color },
  ];

  const isLarge = size >= 100;
  const fontSize = isLarge ? "text-2xl" : "text-lg";
  const labelSize = isLarge ? "text-[10px]" : "text-[9px]";

  return (
    <div className={`relative flex flex-col items-center ${className}`}>
      <div className="relative" style={{ width: size, height: size, boxShadow: scoreGlow(score), borderRadius: "50%" }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            cx="50%"
            cy="50%"
            innerRadius="75%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            data={data}
            barSize={size >= 100 ? 10 : 7}
          >
            <RadialBar
              dataKey="value"
              cornerRadius={5}
              background={false}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-bold tabular-nums ${fontSize}`} style={{ color }}>
            {Math.round(animatedScore)}
          </span>
        </div>
      </div>
      <span className={`mt-1.5 font-medium uppercase tracking-wider text-muted-foreground ${labelSize}`}>
        {label}
      </span>
      {trend && (
        <span className={`text-xs font-bold ${trendColor[trend]}`}>
          {trendArrow[trend]}
        </span>
      )}
    </div>
  );
}
