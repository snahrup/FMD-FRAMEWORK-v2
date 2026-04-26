import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Loader2, Play, Rocket, ShieldCheck } from "lucide-react";
import { DeploymentAuthPanel } from "./DeploymentAuthPanel";
import { DeploymentNameStep } from "./DeploymentNameStep";
import { DeploymentPreview, hasRequiredBlockedSteps } from "./DeploymentPreview";
import { DeploymentProgress, deploymentSucceeded } from "./DeploymentProgress";
import { DeploymentProof, proofPassed } from "./DeploymentProof";
import { DeploymentProfiles } from "./DeploymentProfiles";
import type {
  DeploymentAuthStatus,
  DeploymentExecuteResult,
  DeploymentPreviewResult,
  DeploymentProfileSummary,
  DeploymentProfilesResponse,
  DeploymentResourceNames,
  DeploymentStage,
  DeploymentStep,
  DeploymentValidationResult,
  EnvironmentConfig,
  SaveResult,
} from "./types";
import { DEFAULT_DEPLOYMENT_NAMES, EMPTY_CONFIG } from "./types";

const STAGES: { key: DeploymentStage; label: string; description: string }[] = [
  { key: "auth", label: "Auth", description: "Fabric identity" },
  { key: "names", label: "Names", description: "Resources" },
  { key: "preview", label: "Preview", description: "Dry run" },
  { key: "execute", label: "Execute", description: "Create or reuse" },
  { key: "validate", label: "Proof", description: "Validate" },
  { key: "activate", label: "Activate", description: "Use profile" },
];

interface ProvisionAllProps {
  onComplete: (config: EnvironmentConfig) => void;
}

function postJson<T>(path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (resp) => {
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) throw new Error(data.error || `${resp.status} ${resp.statusText}`);
    return data as T;
  });
}

function normalizeSteps(data: { steps?: DeploymentStep[]; plan?: { steps?: DeploymentStep[] } }): DeploymentStep[] {
  return data.steps || data.plan?.steps || [];
}

function buildPayload(names: DeploymentResourceNames) {
  return {
    profileKey: names.profileKey,
    displayName: names.displayName,
    authMode: names.authMode,
    capacity: {
      id: names.capacityId,
      displayName: names.capacityDisplayName,
    },
    workspaces: names.workspaces,
    lakehouses: names.lakehouses,
    database: names.database,
    items: names.items,
  };
}

function mergeEnvironmentConfig(result: DeploymentExecuteResult): EnvironmentConfig | null {
  const cfg = result.config as Partial<EnvironmentConfig> | undefined;
  if (!cfg) return null;
  return {
    ...EMPTY_CONFIG,
    ...cfg,
    workspaces: { ...EMPTY_CONFIG.workspaces, ...(cfg.workspaces || {}) },
    lakehouses: { ...EMPTY_CONFIG.lakehouses, ...(cfg.lakehouses || {}) },
    notebooks: { ...EMPTY_CONFIG.notebooks, ...(cfg.notebooks || {}) },
    pipelines: { ...EMPTY_CONFIG.pipelines, ...(cfg.pipelines || {}) },
    connections: { ...EMPTY_CONFIG.connections, ...(cfg.connections || {}) },
  };
}

function statusFromSteps(stage: DeploymentStage, activeStage: DeploymentStage, completed: Set<DeploymentStage>) {
  if (completed.has(stage)) return "done";
  if (stage === activeStage) return "active";
  return "todo";
}

export function ProvisionAll({ onComplete }: ProvisionAllProps) {
  const [activeStage, setActiveStage] = useState<DeploymentStage>("auth");
  const [completedStages, setCompletedStages] = useState<Set<DeploymentStage>>(new Set());
  const [names, setNames] = useState<DeploymentResourceNames>(DEFAULT_DEPLOYMENT_NAMES);
  const [authStatus, setAuthStatus] = useState<DeploymentAuthStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<DeploymentProfileSummary[]>([]);
  const [activeProfileKey, setActiveProfileKey] = useState<string | undefined>();
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [previewSteps, setPreviewSteps] = useState<DeploymentStep[]>([]);
  const [executeSteps, setExecuteSteps] = useState<DeploymentStep[]>([]);
  const [proof, setProof] = useState<DeploymentValidationResult | null>(null);
  const [propagation, setPropagation] = useState<SaveResult[]>([]);
  const [busy, setBusy] = useState<"preview" | "execute" | "validate" | "activate" | "profile" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultConfig, setResultConfig] = useState<EnvironmentConfig | null>(null);

  const loadAuth = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const resp = await fetch("/api/deployments/auth/status");
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || `${resp.status} ${resp.statusText}`);
      setAuthStatus(data);
      setNames((current) => ({ ...current, authMode: data.activeMode || current.authMode }));
    } catch (ex) {
      setAuthError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    try {
      const resp = await fetch("/api/deployments");
      const data = (await resp.json()) as DeploymentProfilesResponse;
      if (!resp.ok || (data as { error?: string }).error) throw new Error((data as { error?: string }).error || `${resp.status} ${resp.statusText}`);
      setProfiles(data.profiles || []);
      setActiveProfileKey(data.activeProfileKey);
    } catch {
      setProfiles([]);
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAuth();
    loadProfiles();
  }, [loadAuth, loadProfiles]);

  const canPreview = names.profileKey.trim() && names.displayName.trim() && names.capacityId.trim();
  const previewBlocked = hasRequiredBlockedSteps(previewSteps);
  const executeReady = previewSteps.length > 0 && !previewBlocked;
  const deployed = deploymentSucceeded(executeSteps);
  const validated = proofPassed(proof);

  const markStage = (stage: DeploymentStage) => {
    setCompletedStages((current) => new Set([...current, stage]));
  };

  const runPreview = async () => {
    setBusy("preview");
    setError(null);
    setProof(null);
    setExecuteSteps([]);
    setPropagation([]);
    try {
      const data = await postJson<DeploymentPreviewResult>("/api/deployments/preview", buildPayload(names));
      setPreviewSteps(normalizeSteps(data));
      markStage("preview");
      setActiveStage("execute");
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(null);
    }
  };

  const runExecute = async () => {
    setBusy("execute");
    setError(null);
    try {
      const data = await postJson<DeploymentExecuteResult>("/api/deployments/execute", buildPayload(names));
      setExecuteSteps(normalizeSteps(data));
      setPropagation(data.propagation || []);
      const nextConfig = mergeEnvironmentConfig(data);
      if (nextConfig) setResultConfig(nextConfig);
      markStage("execute");
      setActiveStage("validate");
      loadProfiles();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(null);
    }
  };

  const runValidate = async () => {
    setBusy("validate");
    setError(null);
    try {
      const data = await postJson<DeploymentValidationResult>(`/api/deployments/${encodeURIComponent(names.profileKey)}/validate`);
      setProof(data);
      markStage("validate");
      if (data.ok) setActiveStage("activate");
      loadProfiles();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(null);
    }
  };

  const runActivate = async () => {
    setBusy("activate");
    setError(null);
    try {
      const data = await postJson<DeploymentExecuteResult>(`/api/deployments/${encodeURIComponent(names.profileKey)}/activate`);
      const nextConfig = mergeEnvironmentConfig(data) || resultConfig;
      setPropagation(data.propagation || propagation);
      markStage("activate");
      loadProfiles();
      if (nextConfig) onComplete(nextConfig);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(null);
    }
  };

  const openProfile = async (profileKey: string) => {
    setBusy("profile");
    setError(null);
    try {
      const resp = await fetch(`/api/deployments/${encodeURIComponent(profileKey)}`);
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || `${resp.status} ${resp.statusText}`);
      const profile = data.profile || data;
      setNames((current) => ({
        ...current,
        profileKey: profile.profileKey || profile.ProfileKey || profileKey,
        displayName: profile.displayName || profile.DisplayName || current.displayName,
        authMode: profile.authMode || profile.AuthMode || current.authMode,
        capacityId: profile.capacityId || profile.CapacityId || current.capacityId,
        capacityDisplayName: profile.capacityName || profile.CapacityName || current.capacityDisplayName,
      }));
      setPreviewSteps(data.preview?.steps || data.resourcePlan?.steps || []);
      setExecuteSteps(data.steps || []);
      setProof(data.validationProof || data.proof || null);
      setActiveStage("execute");
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setBusy(null);
    }
  };

  const stageIndex = useMemo(() => STAGES.findIndex((stage) => stage.key === activeStage), [activeStage]);

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl p-6" style={{ border: "1px solid var(--bp-border)", background: "linear-gradient(135deg, var(--bp-copper-light), var(--bp-surface-1) 55%, var(--bp-surface-inset))" }}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]" style={{ border: "1px solid var(--bp-border)", color: "var(--bp-copper)", background: "var(--bp-surface-1)" }}>
              <Rocket className="h-3.5 w-3.5" />
              Fabric one-click deployment
            </div>
            <h2 style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-display)", fontSize: 28 }}>
              Guided Fabric setup with preview, proof, and activation gates
            </h2>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--bp-ink-secondary)" }}>
              Name every resource, dry-run the Fabric plan, execute only when required blockers are gone,
              then validate before activating the profile. This screen only shows config propagation targets
              returned by the backend.
            </p>
          </div>
          <div className="rounded-xl p-4 text-sm" style={{ border: "1px solid var(--bp-border)", background: "rgba(255,255,255,0.45)" }}>
            <div className="flex items-center gap-2" style={{ color: deployed ? "var(--bp-operational)" : "var(--bp-ink-muted)" }}>
              <ShieldCheck className="h-4 w-4" />
              <span>{deployed ? "Deployment succeeded" : "Awaiting deployment"}</span>
            </div>
            <div className="mt-2 flex items-center gap-2" style={{ color: validated ? "var(--bp-operational)" : "var(--bp-ink-muted)" }}>
              <CheckCircle2 className="h-4 w-4" />
              <span>{validated ? "Proof checks passed" : "Proof not complete"}</span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-2 md:grid-cols-6">
        {STAGES.map((stage, index) => {
          const status = statusFromSteps(stage.key, activeStage, completedStages);
          return (
            <button
              type="button"
              key={stage.key}
              onClick={() => setActiveStage(stage.key)}
              className={cn("rounded-xl p-3 text-left transition-all", index <= stageIndex ? "opacity-100" : "opacity-70")}
              style={{
                border: status === "active" ? "1px solid var(--bp-copper)" : "1px solid var(--bp-border)",
                background: status === "active" ? "var(--bp-copper-light)" : "var(--bp-surface-1)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px]" style={{ background: status === "done" ? "var(--bp-operational)" : status === "active" ? "var(--bp-copper)" : "var(--bp-border)", color: "white" }}>
                  {status === "done" ? "✓" : index + 1}
                </span>
                <span className="text-xs font-semibold" style={{ color: "var(--bp-ink-primary)" }}>{stage.label}</span>
              </div>
              <p className="mt-1 text-[10px]" style={{ color: "var(--bp-ink-muted)" }}>{stage.description}</p>
            </button>
          );
        })}
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg p-3 text-xs" style={{ border: "1px solid var(--bp-fault)", background: "var(--bp-fault-light)", color: "var(--bp-fault)" }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="rounded-2xl p-5" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
          {activeStage === "auth" && (
            <DeploymentAuthPanel
              authStatus={authStatus}
              selectedMode={names.authMode}
              loading={authLoading}
              error={authError}
              onModeChange={(authMode) => setNames((current) => ({ ...current, authMode }))}
              onRefresh={loadAuth}
            />
          )}
          {activeStage === "names" && <DeploymentNameStep value={names} onChange={setNames} />}
          {activeStage === "preview" && <DeploymentPreview steps={previewSteps} />}
          {activeStage === "execute" && <DeploymentProgress steps={executeSteps.length ? executeSteps : previewSteps} propagation={propagation} />}
          {activeStage === "validate" && <DeploymentProof proof={proof} />}
          {activeStage === "activate" && (
            <div className="space-y-4">
              <DeploymentProof proof={proof} />
              <DeploymentProgress steps={executeSteps} propagation={propagation} />
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--bp-border-subtle)" }}>
            <p className="text-xs" style={{ color: "var(--bp-ink-muted)" }}>
              Current profile: <span style={{ fontFamily: "var(--bp-font-mono)", color: "var(--bp-ink-primary)" }}>{names.profileKey || "not named"}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setActiveStage("names")}>Edit names</Button>
              <Button onClick={runPreview} disabled={!canPreview || busy === "preview"} className="gap-1.5">
                {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Preview
              </Button>
              <Button onClick={runExecute} disabled={!executeReady || busy === "execute"} className="gap-1.5 bp-btn-primary">
                {busy === "execute" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Execute
              </Button>
              <Button variant="outline" onClick={runValidate} disabled={!deployed || busy === "validate"} className="gap-1.5">
                {busy === "validate" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Validate
              </Button>
              <Button variant="outline" onClick={runActivate} disabled={!deployed || !validated || busy === "activate"}>
                Activate
              </Button>
            </div>
          </div>
        </div>

        <aside className="rounded-2xl p-5" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-inset)" }}>
          <DeploymentProfiles
            profiles={profiles}
            activeProfileKey={activeProfileKey}
            loading={profilesLoading || busy === "profile"}
            onRefresh={loadProfiles}
            onOpenProfile={openProfile}
          />
        </aside>
      </div>
    </div>
  );
}
