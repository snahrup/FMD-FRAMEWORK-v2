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
                className={cn(
                  "w-8 h-px mx-1",
                  isDone || isActive ? "bg-emerald-500/60" : "bg-border/40",
                )}
              />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-all",
                  isDone && "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40",
                  isActive && !isDone && "bg-blue-500/20 text-blue-400 border border-blue-500/40",
                  !isDone && !isActive && "bg-muted/40 text-muted-foreground/50 border border-border/40",
                )}
              >
                {isDone ? <Check className="h-3 w-3" /> : s.step}
              </div>
              <span
                className={cn(
                  "text-[10px] font-medium hidden sm:inline",
                  isActive ? "text-foreground" : "text-muted-foreground/60",
                )}
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
