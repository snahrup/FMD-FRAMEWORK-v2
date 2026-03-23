import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import type { WizardStep, StepDef } from "../types";

interface StepIndicatorProps {
  steps: StepDef[];
  currentStep: WizardStep;
  completedSteps: Set<WizardStep>;
}

export function StepIndicator({ steps, currentStep, completedSteps }: StepIndicatorProps) {
  return (
    <div className="flex items-center gap-1">
      {steps.map((s, i) => {
        const isActive = s.step === currentStep;
        const isDone = completedSteps.has(s.step);
        return (
          <div key={s.step} className="flex items-center">
            {i > 0 && (
              <div
                className="w-8 h-px mx-1"
                style={{
                  background: isDone || isActive ? 'var(--bp-copper)' : 'var(--bp-border)',
                }}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all"
                style={{
                  background: isDone
                    ? 'var(--bp-copper-light)'
                    : isActive
                    ? 'var(--bp-copper)'
                    : 'var(--bp-surface-inset)',
                  color: isDone
                    ? 'var(--bp-copper)'
                    : isActive
                    ? 'var(--bp-surface-1)'
                    : 'var(--bp-ink-muted)',
                  border: isDone
                    ? '1px solid var(--bp-copper)'
                    : isActive
                    ? '1px solid var(--bp-copper)'
                    : '1px solid var(--bp-border)',
                }}
              >
                {isDone ? <Check className="h-3 w-3" /> : s.step}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium hidden sm:inline",
                )}
                style={{
                  color: isActive ? 'var(--bp-ink-primary)' : 'var(--bp-ink-muted)',
                  fontFamily: 'var(--bp-font-body)',
                }}
              >
                {s.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
