// Quality Tier Badge — Gold / Silver / Bronze with metallic gradient styling.

import { cn } from "@/lib/utils";

export type QualityTier = "gold" | "silver" | "bronze" | "unscored";

const TIER_CLASS: Record<QualityTier, string> = {
  gold:     "bp-badge bp-tier-gold",
  silver:   "bp-badge bp-tier-silver",
  bronze:   "bp-badge bp-tier-bronze",
  unscored: "bp-badge bp-badge-info",
};

const TIER_LABEL: Record<QualityTier, string> = {
  gold:     "Gold",
  silver:   "Silver",
  bronze:   "Bronze",
  unscored: "Unscored",
};

export function QualityTierBadge({ tier }: { tier: QualityTier }) {
  return (
    <span className={cn(TIER_CLASS[tier])}>
      {TIER_LABEL[tier]}
    </span>
  );
}

/** Derive tier from quality score (0-100) */
export function scoreToTier(score: number | null | undefined): QualityTier {
  if (score == null || score < 0) return "unscored";
  if (score >= 90) return "gold";
  if (score >= 70) return "silver";
  if (score >= 40) return "bronze";
  return "unscored";
}
