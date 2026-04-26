import { Button } from "@/components/ui/button";
import { CheckCircle2, Clock3, Loader2, RefreshCw } from "lucide-react";
import type { DeploymentProfileSummary } from "./types";

interface DeploymentProfilesProps {
  profiles: DeploymentProfileSummary[];
  activeProfileKey?: string;
  loading: boolean;
  onRefresh: () => void;
  onOpenProfile: (profileKey: string) => void;
}

function statusColor(status: DeploymentProfileSummary["status"]) {
  if (status === "active" || status === "validated" || status === "deployed") return "var(--bp-operational)";
  if (status === "failed") return "var(--bp-fault)";
  if (status === "deploying" || status === "planned") return "var(--bp-copper)";
  return "var(--bp-ink-muted)";
}

export function DeploymentProfiles({ profiles, activeProfileKey, loading, onRefresh, onOpenProfile }: DeploymentProfilesProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>Deployment profiles</h3>
          <p className="mt-1 text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>
            History comes from the deployment API. Activation still requires a successful deployment in the guided flow.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {profiles.length === 0 ? (
        <div className="rounded-xl p-8 text-center text-sm" style={{ border: "1px dashed var(--bp-border-strong)", color: "var(--bp-ink-muted)" }}>
          No deployment profiles reported yet.
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map((profile) => {
            const active = activeProfileKey === profile.profileKey || profile.status === "active";
            const color = statusColor(profile.status);
            return (
              <button
                type="button"
                key={profile.profileKey}
                onClick={() => onOpenProfile(profile.profileKey)}
                className="rounded-xl p-4 text-left transition-all"
                style={{ border: active ? "1px solid var(--bp-operational)" : "1px solid var(--bp-border)", background: active ? "var(--bp-operational-light)" : "var(--bp-surface-1)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {active ? <CheckCircle2 className="h-4 w-4" style={{ color }} /> : <Clock3 className="h-4 w-4" style={{ color }} />}
                      <p className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>{profile.displayName}</p>
                    </div>
                    <p className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)" }}>
                      {profile.profileKey}
                    </p>
                  </div>
                  <span className="rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.12em]" style={{ border: "1px solid var(--bp-border)", color }}>
                    {profile.status}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-[10px]" style={{ color: "var(--bp-ink-tertiary)" }}>
                  {profile.capacityName && <span>Capacity: {profile.capacityName}</span>}
                  {profile.authMode && <span>Auth: {profile.authMode}</span>}
                  {profile.updatedAt && <span>Updated: {profile.updatedAt}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
