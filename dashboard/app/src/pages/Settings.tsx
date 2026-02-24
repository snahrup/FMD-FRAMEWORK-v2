import { useState, useCallback } from "react";
import {
  Settings as SettingsIcon,
  FlaskConical,
  Sparkles,
  ClipboardCheck,
  Layers3,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { getLabsFlags, setLabsFlag, type LabsFlags } from "@/lib/featureFlags";

// ============================================================================
// LAB FEATURE DEFINITIONS
// ============================================================================

interface LabFeature {
  key: keyof LabsFlags;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const LAB_FEATURES: LabFeature[] = [
  {
    key: "cleansingRuleEditor",
    label: "Cleansing Rule Editor",
    description:
      "View and manage the JSON cleansing rules applied during Bronze → Silver transformation. Build rules visually instead of writing SQL inserts.",
    icon: Sparkles,
    color: "text-violet-500",
  },
  {
    key: "scdAuditView",
    label: "SCD Audit View",
    description:
      "Track inserts, updates, and deletes per Silver table per pipeline run. Surfaces the SCD Type 2 change tracking that the framework already logs.",
    icon: ClipboardCheck,
    color: "text-emerald-500",
  },
  {
    key: "goldMlvManager",
    label: "Gold Layer / MLV Manager",
    description:
      "View which Materialized Lakehouse Views exist in the Gold layer, what Silver tables they reference, and their current state.",
    icon: Layers3,
    color: "text-amber-500",
  },
  {
    key: "dqScorecard",
    label: "DQ Scorecard",
    description:
      "Data quality metrics per table — null rates, duplicate counts, cleansing rule pass/fail rates. Surfaces checks already run by the DQ cleansing notebook.",
    icon: ShieldCheck,
    color: "text-sky-500",
  },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function Settings() {
  const [flags, setFlags] = useState<LabsFlags>(getLabsFlags);

  const toggle = useCallback((key: keyof LabsFlags) => {
    const updated = setLabsFlag(key, !flags[key]);
    setFlags(updated);
  }, [flags]);

  const enabledCount = Object.values(flags).filter(Boolean).length;

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-5 h-5 text-muted-foreground" />
          <h1 className="font-display text-xl font-semibold tracking-tight">Settings</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 ml-8">
          Dashboard configuration and feature management
        </p>
      </div>

      {/* Labs Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <FlaskConical className="w-5 h-5 text-amber-500" />
          <div>
            <h2 className="font-display text-base font-semibold">Labs</h2>
            <p className="text-xs text-muted-foreground">
              Experimental features under active development. Enable them to add new pages to the sidebar.
            </p>
          </div>
          {enabledCount > 0 && (
            <span className="ml-auto text-[10px] font-semibold text-amber-500 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
              {enabledCount} enabled
            </span>
          )}
        </div>

        <div className="space-y-3">
          {LAB_FEATURES.map((feature) => {
            const enabled = flags[feature.key];
            return (
              <div
                key={feature.key}
                className={`rounded-lg border bg-card px-5 py-4 transition-all ${
                  enabled ? "border-primary/30 shadow-sm" : "border-border"
                }`}
              >
                <div className="flex items-start gap-4">
                  <feature.icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${feature.color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{feature.label}</h3>
                      {enabled && (
                        <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500 bg-emerald-500/10 rounded px-1.5 py-0.5">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {feature.description}
                    </p>
                  </div>
                  <button
                    onClick={() => toggle(feature.key)}
                    className="flex-shrink-0 cursor-pointer text-foreground/60 hover:text-foreground transition-colors"
                    title={enabled ? "Disable" : "Enable"}
                  >
                    {enabled ? (
                      <ToggleRight className="w-8 h-8 text-primary" />
                    ) : (
                      <ToggleLeft className="w-8 h-8" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[10px] text-muted-foreground/60 ml-8">
          Changes take effect immediately. Labs features appear under the "Labs" group in the sidebar.
        </p>
      </div>
    </div>
  );
}
