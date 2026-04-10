import type { CSSProperties } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { ArrowRight, GitBranch, Sparkles } from "lucide-react";

export interface FocusedLineageStage {
  key: "source" | "landing" | "bronze" | "silver" | "gold";
  label: string;
  status: string;
  columnCount: number;
  highlight: string;
  note: string;
  deltaFromPrevious?: string;
}

interface FocusedLineagePathProps {
  stages: FocusedLineageStage[];
  activeStage: FocusedLineageStage["key"];
  onSelectStage: (stage: FocusedLineageStage["key"]) => void;
}

function statusAccent(status: string): { border: string; glow: string; bg: string } {
  const normalized = status.toLowerCase();
  if (["loaded", "success", "complete", "completed", "succeeded"].includes(normalized)) {
    return {
      border: "rgba(45,106,79,0.26)",
      glow: "rgba(45,106,79,0.18)",
      bg: "linear-gradient(180deg, rgba(45,106,79,0.12) 0%, rgba(255,255,255,0.98) 100%)",
    };
  }
  if (["error", "failed", "warning", "aborted"].includes(normalized)) {
    return {
      border: "rgba(185,58,42,0.24)",
      glow: "rgba(185,58,42,0.12)",
      bg: "linear-gradient(180deg, rgba(185,58,42,0.10) 0%, rgba(255,255,255,0.98) 100%)",
    };
  }
  return {
    border: "rgba(180,86,36,0.18)",
    glow: "rgba(180,86,36,0.10)",
    bg: "linear-gradient(180deg, rgba(180,86,36,0.08) 0%, rgba(255,255,255,0.98) 100%)",
  };
}

export function FocusedLineagePath({
  stages,
  activeStage,
  onSelectStage,
}: FocusedLineagePathProps) {
  return (
    <section
      className="rounded-[28px] border p-4 md:p-5"
      style={{
        borderColor: "rgba(180,86,36,0.14)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(244,242,237,0.96) 100%)",
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px]" style={{ background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>
            <GitBranch className="h-3.5 w-3.5" />
            Focused path
          </div>
          <h3 className="mt-3 text-[22px]" style={{ fontFamily: "var(--bp-font-display)", color: "var(--bp-ink-primary)" }}>
            Follow one chain at a time
          </h3>
          <p className="mt-1 text-sm" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.6 }}>
            This view is intentionally narrow: it shows where the selected entity starts, what each layer added, and exactly where an operator should investigate next.
          </p>
        </div>
        <div className="rounded-full px-3 py-1 text-[11px]" style={{ background: "rgba(91,84,76,0.08)", color: "var(--bp-ink-secondary)" }}>
          Tap any stage to inspect its evidence
        </div>
      </div>

      <div className="mt-5 rounded-[24px] border p-4 md:p-5" style={{ borderColor: "rgba(180,86,36,0.12)", background: "radial-gradient(circle at top, rgba(180,86,36,0.08) 0%, rgba(255,255,255,0.96) 52%, rgba(244,242,237,0.98) 100%)" }}>
        <div className="grid gap-3 lg:grid-cols-[repeat(5,minmax(0,1fr))]">
          {stages.map((stage, index) => {
            const accent = statusAccent(stage.status);
            const isActive = activeStage === stage.key;
            return (
              <div key={stage.key} className="relative">
                {index < stages.length - 1 ? (
                  <div className="pointer-events-none absolute left-[calc(100%-8px)] top-1/2 hidden w-8 -translate-y-1/2 items-center justify-center lg:flex">
                    <ArrowRight className="h-4 w-4" style={{ color: "var(--bp-ink-muted)" }} />
                  </div>
                ) : null}
                {index < stages.length - 1 && stage.deltaFromPrevious ? (
                  <div className="mb-2 hidden text-center lg:block">
                    <span className="rounded-full px-2.5 py-1 text-[10px]" style={{ background: "rgba(91,84,76,0.08)", color: "var(--bp-ink-secondary)" }}>
                      {stage.deltaFromPrevious}
                    </span>
                  </div>
                ) : null}
                <button
                  type="button"
                  className={cn(
                    "gs-stagger-card flex h-full w-full flex-col rounded-[22px] border px-4 py-4 text-left transition-all duration-200",
                    isActive ? "translate-y-[-2px]" : "hover:translate-y-[-2px]",
                  )}
                  style={{
                    '--i': Math.min(index, 15),
                    borderColor: isActive ? accent.border : "rgba(91,84,76,0.12)",
                    background: isActive ? accent.bg : "rgba(255,255,255,0.88)",
                    boxShadow: isActive ? `0 22px 40px ${accent.glow}` : "none",
                  } as CSSProperties}
                  onClick={() => onSelectStage(stage.key)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)" }}>
                        {stage.key}
                      </div>
                      <div className="mt-1 text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                        {stage.label}
                      </div>
                    </div>
                    <StatusBadge status={stage.status || "unknown"} size="sm" />
                  </div>
                  <div className="mt-4 text-[28px] leading-none" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)" }}>
                    {stage.columnCount}
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-mono)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
                    columns
                  </div>
                  <div className="mt-4 rounded-2xl px-3 py-2" style={{ background: "rgba(91,84,76,0.05)" }}>
                    <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--bp-copper)" }}>
                      <Sparkles className="h-3.5 w-3.5" />
                      {stage.highlight}
                    </div>
                    <p className="mt-1 text-[12px]" style={{ color: "var(--bp-ink-secondary)", lineHeight: 1.55 }}>
                      {stage.note}
                    </p>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
