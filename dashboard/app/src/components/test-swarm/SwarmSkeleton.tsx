/**
 * Skeleton loading state for the TestSwarm page.
 * Mirrors the real layout: KPI row → timeline → chart → iterations.
 */

import { cn } from "@/lib/utils";

function Bone({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-[var(--radius)] bg-muted/40", className)} />
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-4 flex items-start gap-3">
      <Bone className="w-9 h-9 rounded-[var(--radius)] shrink-0" />
      <div className="flex-1 space-y-2">
        <Bone className="h-3 w-16" />
        <Bone className="h-6 w-12" />
      </div>
    </div>
  );
}

export default function SwarmSkeleton() {
  return (
    <div className="space-y-6" style={{ contain: "layout style" }}>
      {/* KPI header */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Bone className="h-4 w-32" />
          <Bone className="h-6 w-24 rounded-full" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>

      {/* Timeline + Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Timeline */}
        <div className="lg:col-span-3 rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-6 space-y-4">
          <Bone className="h-3 w-24" />
          <div className="flex items-center justify-center gap-3 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Bone className="w-10 h-10 rounded-full" />
                {i < 4 && <Bone className="w-12 h-0.5" />}
              </div>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div className="lg:col-span-2 rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-6 space-y-4">
          <Bone className="h-3 w-20" />
          <Bone className="h-[180px] w-full rounded-[var(--radius)]" />
        </div>
      </div>

      {/* Gauge + Heatmap row */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-6 flex items-center justify-center">
          <Bone className="w-[140px] h-[140px] rounded-full" />
        </div>
        <div className="lg:col-span-3 rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-6 space-y-3">
          <Bone className="h-3 w-24" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Bone className="h-4 w-40" />
              <div className="flex gap-1">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Bone key={j} className="w-7 h-5 rounded-[3px]" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Iteration cards */}
      <div className="space-y-3">
        <Bone className="h-3 w-28" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-[var(--radius-lg)] border border-border/30 bg-card backdrop-blur-sm p-4 flex items-center gap-4">
            <Bone className="w-8 h-8 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Bone className="h-4 w-48" />
              <Bone className="h-3 w-72" />
            </div>
            <Bone className="h-4 w-16" />
            <Bone className="h-4 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
