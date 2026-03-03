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
  fresh: "text-emerald-400",
  stale: "text-amber-400",
  critical: "text-red-400",
};

const levelBg = {
  fresh: "bg-emerald-400/10",
  stale: "bg-amber-400/10",
  critical: "bg-red-400/10",
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
