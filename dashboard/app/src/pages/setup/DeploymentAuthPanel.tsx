import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import type { DeploymentAuthMode, DeploymentAuthStatus, DeploymentOAuthStart } from "./types";

const MODE_LABELS: Record<DeploymentAuthMode, string> = {
  delegated_oauth: "Delegated OAuth",
  service_principal: "Service principal",
};

interface DeploymentAuthPanelProps {
  authStatus: DeploymentAuthStatus | null;
  selectedMode: DeploymentAuthMode;
  loading: boolean;
  error: string | null;
  onModeChange: (mode: DeploymentAuthMode) => void;
  onRefresh: () => void;
}

export function DeploymentAuthPanel({
  authStatus,
  selectedMode,
  loading,
  error,
  onModeChange,
  onRefresh,
}: DeploymentAuthPanelProps) {
  const [oauthStart, setOauthStart] = useState<DeploymentOAuthStart | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const startOAuth = async () => {
    setOauthBusy(true);
    setOauthError(null);
    try {
      const resp = await fetch("/api/deployments/oauth/start", { method: "POST" });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || `${resp.status} ${resp.statusText}`);
      setOauthStart(data);
    } catch (ex) {
      setOauthError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setOauthBusy(false);
    }
  };

  const pollOAuth = async () => {
    setOauthBusy(true);
    setOauthError(null);
    try {
      const resp = await fetch("/api/deployments/oauth/poll", { method: "POST" });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || `${resp.status} ${resp.statusText}`);
      setOauthStart(null);
      onRefresh();
    } catch (ex) {
      setOauthError(ex instanceof Error ? ex.message : String(ex));
    } finally {
      setOauthBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" style={{ color: "var(--bp-copper)" }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
              Authentication
            </h3>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed" style={{ color: "var(--bp-ink-tertiary)" }}>
            Choose the identity that will call Fabric. OAuth is best for first-run admin provisioning;
            service principal is best for repeatable unattended deployment.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md p-3 text-xs" style={{ border: "1px solid var(--bp-fault)", background: "var(--bp-fault-light)", color: "var(--bp-fault)" }}>
          {error}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {(["delegated_oauth", "service_principal"] as const).map((mode) => {
          const status = authStatus?.authModes?.[mode];
          const available = !!status?.available;
          const active = selectedMode === mode;
          return (
            <button
              type="button"
              key={mode}
              onClick={() => onModeChange(mode)}
              className="rounded-xl p-4 text-left transition-all"
              style={{
                border: active ? "1px solid var(--bp-copper)" : "1px solid var(--bp-border)",
                background: active ? "var(--bp-copper-light)" : "var(--bp-surface-1)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <KeyRound className="h-4 w-4" style={{ color: active ? "var(--bp-copper)" : "var(--bp-ink-muted)" }} />
                    <span className="text-sm font-semibold" style={{ color: "var(--bp-ink-primary)" }}>
                      {MODE_LABELS[mode]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: "var(--bp-ink-tertiary)" }}>
                    {status?.reason || "Backend has not reported this mode yet."}
                  </p>
                </div>
                {available ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: "var(--bp-operational)" }} />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--bp-caution)" }} />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedMode === "delegated_oauth" && (
        <div className="rounded-xl p-4" style={{ border: "1px dashed var(--bp-border-strong)", background: "var(--bp-surface-inset)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium" style={{ color: "var(--bp-ink-primary)" }}>
                Device-code sign-in
              </p>
              <p className="mt-1 text-[11px]" style={{ color: "var(--bp-ink-tertiary)" }}>
                Start the flow, complete it in Microsoft, then poll once sign-in is complete.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={startOAuth} disabled={oauthBusy} className="gap-1.5">
                {oauthBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                Start OAuth
              </Button>
              <Button variant="ghost" size="sm" onClick={pollOAuth} disabled={oauthBusy || !oauthStart}>
                Poll
              </Button>
            </div>
          </div>
          {oauthStart && (
            <div className="mt-3 rounded-lg p-3 text-xs" style={{ border: "1px solid var(--bp-border)", background: "var(--bp-surface-1)" }}>
              <p style={{ color: "var(--bp-ink-secondary)" }}>{oauthStart.message || "Use the code below to finish sign-in."}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span style={{ color: "var(--bp-ink-tertiary)" }}>Code</span>
                <strong className="text-base tracking-widest" style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-mono)" }}>
                  {oauthStart.userCode || "Pending"}
                </strong>
                {oauthStart.verificationUri && (
                  <a href={oauthStart.verificationUri} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--bp-copper)" }}>
                    Open verification page
                  </a>
                )}
              </div>
            </div>
          )}
          {oauthError && <p className="mt-2 text-xs" style={{ color: "var(--bp-fault)" }}>{oauthError}</p>}
        </div>
      )}

      {authStatus?.scopes?.length ? (
        <div className="flex flex-wrap gap-2">
          {authStatus.scopes.map((scope) => (
            <span key={scope} className="rounded-full px-2 py-1 text-[10px]" style={{ border: "1px solid var(--bp-border)", color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-mono)" }}>
              {scope}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
