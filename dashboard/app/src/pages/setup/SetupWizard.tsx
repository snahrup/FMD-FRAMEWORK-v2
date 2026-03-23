import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StepIndicator } from "./components/StepIndicator";
import { CapacityStep } from "./steps/CapacityStep";
import { WorkspaceStep } from "./steps/WorkspaceStep";
import { ConnectionStep } from "./steps/ConnectionStep";
import { LakehouseStep } from "./steps/LakehouseStep";
import { DatabaseStep } from "./steps/DatabaseStep";
import { ReviewStep } from "./steps/ReviewStep";
import type {
  EnvironmentConfig,
  WizardStep,
} from "./types";
import { WIZARD_STEPS as STEPS } from "./types";

interface SetupWizardProps {
  config: EnvironmentConfig;
  onConfigChange: (config: EnvironmentConfig) => void;
}

export function SetupWizard({ config, onConfigChange }: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [completedSteps, setCompletedSteps] = useState<Set<WizardStep>>(new Set());

  const updateConfig = useCallback(
    (partial: Partial<EnvironmentConfig>) => {
      onConfigChange({ ...config, ...partial });
    },
    [config, onConfigChange],
  );

  const markComplete = (s: WizardStep) => {
    setCompletedSteps((prev) => new Set([...prev, s]));
  };

  const goNext = () => {
    markComplete(step);
    if (step < 6) setStep((step + 1) as WizardStep);
  };

  const goBack = () => {
    if (step > 1) setStep((step - 1) as WizardStep);
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 1:
        return !!config.capacity;
      case 2:
        return !!config.workspaces.data_dev; // At minimum, data workspace required
      case 3:
        return true; // Connections are optional
      case 4:
        return !!config.lakehouses.LH_DATA_LANDINGZONE; // At minimum, LZ required
      case 5:
        return true; // DB is optional (can be added later)
      case 6:
        return true;
      default:
        return false;
    }
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center justify-center">
        <StepIndicator steps={STEPS} currentStep={step} completedSteps={completedSteps} />
      </div>

      {/* Current step content */}
      <div className="min-h-[300px]">
        {step === 1 && (
          <CapacityStep
            value={config.capacity}
            onChange={(cap) => updateConfig({ capacity: cap })}
          />
        )}

        {step === 2 && (
          <WorkspaceStep
            workspaces={config.workspaces}
            capacityId={config.capacity?.id || null}
            onChange={(key, value) =>
              updateConfig({
                workspaces: { ...config.workspaces, [key]: value },
              })
            }
          />
        )}

        {step === 3 && (
          <ConnectionStep
            connections={config.connections}
            onChange={(key, value) =>
              updateConfig({
                connections: { ...config.connections, [key]: value },
              })
            }
          />
        )}

        {step === 4 && (
          <LakehouseStep
            lakehouses={config.lakehouses}
            dataWorkspaceId={config.workspaces.data_dev?.id || null}
            onChange={(key, value) =>
              updateConfig({
                lakehouses: { ...config.lakehouses, [key]: value },
              })
            }
          />
        )}

        {step === 5 && (
          <DatabaseStep
            value={config.database}
            configWorkspaceId={config.workspaces.config?.id || null}
            onChange={(db) => updateConfig({ database: db })}
          />
        )}

        {step === 6 && <ReviewStep config={config} />}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4" style={{ borderTop: '1px solid var(--bp-border-subtle)' }}>
        <Button
          variant="ghost"
          onClick={goBack}
          disabled={step === 1}
          className="gap-1.5"
        >
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>

        <span className="text-xs" style={{ color: 'var(--bp-ink-muted)' }}>
          Step {step} of {STEPS.length}
        </span>

        {step < 6 ? (
          <Button onClick={goNext} disabled={!canProceed()} className="gap-1.5">
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <div /> // Review step has its own save button
        )}
      </div>
    </div>
  );
}
