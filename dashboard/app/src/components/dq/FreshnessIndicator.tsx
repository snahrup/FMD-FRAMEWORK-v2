import { Clock } from "lucide-react";

interface FreshnessIndicatorProps {
  timestamp: string | null;
  className?: string;
}

function timeAgo(ts: string): { text: string; level: "fresh" | "stale" | "critical" } {
  const now = Date.now();
  const then = new Date(ts).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  let text: string;
  if (diffMin < 1) text = "just now";
  else if (diffMin < 60) text = `${diffMin}m ago`;
  else if (diffHr < 24) text = `${diffHr}h ago`;
  else text = `${diffDay}d ago`;

  const level = diffHr < 6 ? "fresh" : diffHr < 24 ? "stale" : "critical";
  return { text, level };
}

const levelStyles = {
  fresh: "text-[#3D7C4F]",
  stale: "text-[#C27A1A]",
  critical: "text-[#B93A2A]",
};

const levelBg = {
  fresh: "bg-[#E7F3EB]",
  stale: "bg-[#FDF3E3]",
  critical: "bg-[#FBEAE8]",
};

export function FreshnessIndicator({ timestamp, className = "" }: FreshnessIndicatorProps) {
  if (!timestamp) {
    return (
      <span className={`inline-flex items-center gap-1 text-xs text-muted-foreground ${className}`}>
        <Clock className="w-3 h-3" /> —
      </span>
    );
  }

  const { text, level } = timeAgo(timestamp);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded ${levelStyles[level]} ${levelBg[level]} ${className}`}>
      <Clock className="w-3 h-3" />
      {text}
    </span>
  );
}
