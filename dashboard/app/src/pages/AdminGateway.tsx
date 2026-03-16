import { useState, useEffect, useCallback, useRef } from "react";
import {
  Lock,
  Eye,
  EyeOff,
  Cog,
  Rocket,
  ShieldCheck,
  LayoutGrid,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Server,
} from "lucide-react";
import {
  getHiddenPages,
  updateHiddenPages,
  verifyAdminPassword,
} from "@/lib/pageVisibility";
import { GeneralTab } from "@/pages/Settings";
import DeploymentManager from "@/pages/settings/DeploymentManager";
import AdminGovernance from "@/pages/AdminGovernance";
import { SetupSettings } from "@/pages/setup/SetupSettings";
import type { EnvironmentConfig } from "@/pages/setup/types";
import { EMPTY_CONFIG } from "@/pages/setup/types";

// ── All navigable pages (matches CORE_GROUPS in AppLayout) ──

const ALL_PAGES = [
  { href: "/", label: "Execution Matrix", group: "Operations" },
  { href: "/engine", label: "Engine Control", group: "Operations" },
  { href: "/validation", label: "Validation", group: "Operations" },
  { href: "/live", label: "Live Monitor", group: "Operations" },
  { href: "/control", label: "Control Plane", group: "Operations" },
  { href: "/errors", label: "Error Intelligence", group: "Operations" },
  { href: "/logs", label: "Execution Log", group: "Operations" },
  { href: "/runner", label: "Pipeline Runner", group: "Operations" },
  { href: "/notebook-debug", label: "Pipeline Testing", group: "Operations" },
  { href: "/load-progress", label: "Load Progress", group: "Operations" },
  { href: "/sources", label: "Source Manager", group: "Data" },
  { href: "/blender", label: "Data Blender", group: "Data" },
  { href: "/flow", label: "Flow Explorer", group: "Data" },
  { href: "/journey", label: "Data Journey", group: "Data" },
  { href: "/counts", label: "Record Counts", group: "Data" },
  { href: "/data-manager", label: "Data Manager", group: "Data" },
  { href: "/sql-explorer", label: "SQL Explorer", group: "Data" },
  { href: "/lineage", label: "Data Lineage", group: "Insights" },
  { href: "/classification", label: "Data Classification", group: "Insights" },
  { href: "/catalog", label: "Data Catalog", group: "Insights" },
  { href: "/profile", label: "Data Profiler", group: "Insights" },
  { href: "/columns", label: "Column Evolution", group: "Insights" },
  { href: "/microscope", label: "Data Microscope", group: "Insights" },
  { href: "/sankey", label: "Sankey Flow", group: "Insights" },
  { href: "/replay", label: "Transformation Replay", group: "Insights" },
  { href: "/pulse", label: "Impact Pulse", group: "Insights" },
  { href: "/impact", label: "Impact Analysis", group: "Insights" },
  { href: "/labs/dq-scorecard", label: "DQ Scorecard", group: "Quality" },
  { href: "/labs/cleansing", label: "Cleansing Rules", group: "Quality" },
  { href: "/labs/scd-audit", label: "SCD Audit", group: "Quality" },
  { href: "/labs/gold-mlv", label: "Gold MLV Manager", group: "Quality" },
  { href: "/test-audit", label: "Test Audit", group: "Testing" },
  { href: "/test-swarm", label: "Test Swarm", group: "Testing" },
  { href: "/mri", label: "MRI", group: "Testing" },
  { href: "/admin", label: "Admin & Governance", group: "Admin" },
  { href: "/config", label: "Config Manager", group: "Admin" },
  { href: "/notebook-config", label: "Notebook Config", group: "Admin" },
  { href: "/settings", label: "Settings", group: "Admin" },
  { href: "/setup", label: "Environment Setup", group: "Admin" },
  { href: "/db-explorer", label: "Database Explorer", group: "Admin" },
];

// ── Tab definitions ──

type AdminTab = "environment" | "pages" | "general" | "deployment" | "governance";

const TABS: { id: AdminTab; label: string; icon: typeof Cog }[] = [
  { id: "environment", label: "Environment", icon: Server },
  { id: "pages", label: "Page Visibility", icon: LayoutGrid },
  { id: "general", label: "General", icon: Cog },
  { id: "deployment", label: "Deployment", icon: Rocket },
  { id: "governance", label: "Governance", icon: ShieldCheck },
];

// ============================================================================
// PAGE VISIBILITY TAB
// ============================================================================

function PageVisibilityTab({ password }: { password: string }) {
  const [hiddenPages, setHiddenPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    mountedRef.current = true;
    getHiddenPages()
      .then((pages) => {
        if (mountedRef.current) {
          setHiddenPages(pages);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mountedRef.current) setLoading(false);
      });
    return () => {
      mountedRef.current = false;
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  const toggle = useCallback((href: string) => {
    setHiddenPages((prev) =>
      prev.includes(href) ? prev.filter((p) => p !== href) : [...prev, href]
    );
    setSaved(false);
  }, []);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateHiddenPages(hiddenPages, password);
      if (!mountedRef.current) return;
      setSaved(true);
      savedTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setSaved(false);
      }, 3000);
    } catch (e: any) {
      if (!mountedRef.current) return;
      setError(e.message || "Failed to save");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [hiddenPages, password, saving]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs">Loading page visibility...</span>
      </div>
    );
  }

  const groups = [...new Set(ALL_PAGES.map((p) => p.group))];

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="font-display text-base font-semibold">Page Visibility</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Toggle which pages appear in the sidebar. Hidden pages are still accessible via direct URL.
        </p>
      </div>

      {groups.map((group) => (
        <div key={group}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
            {group}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ALL_PAGES.filter((p) => p.group === group).map((page) => {
              const isHidden = hiddenPages.includes(page.href);
              return (
                <button
                  key={page.href}
                  onClick={() => toggle(page.href)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all cursor-pointer ${
                    isHidden
                      ? "border-border/50 bg-card text-muted-foreground/50"
                      : "border-primary/20 bg-primary/5 text-foreground"
                  }`}
                >
                  {isHidden ? (
                    <EyeOff className="w-3.5 h-3.5 text-muted-foreground/40" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 text-primary" />
                  )}
                  <span className={isHidden ? "line-through" : ""}>{page.label}</span>
                  <span className="ml-auto text-[9px] font-mono text-muted-foreground/40">
                    {page.href}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {saved && (
          <span className="text-xs text-emerald-500 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Saved
          </span>
        )}
        {error && (
          <span className="text-xs text-red-400 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> {error}
          </span>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/50">
        {hiddenPages.length} page{hiddenPages.length !== 1 ? "s" : ""} hidden.
        Changes apply to all users immediately.
      </p>
    </div>
  );
}

// ============================================================================
// ENVIRONMENT TAB (SetupSettings with config loading)
// ============================================================================

const API = "/api";

function EnvironmentTab() {
  const [config, setConfig] = useState<EnvironmentConfig>(EMPTY_CONFIG);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`${API}/setup/current-config`);
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`);
        let data: any;
        try {
          data = await resp.json();
        } catch {
          throw new Error("Server returned non-JSON response");
        }
        if (cancelled) return;
        if (data.config) {
          setConfig({ ...EMPTY_CONFIG, ...data.config });
        }
      } catch (ex) {
        if (cancelled) return;
        setLoadError(ex instanceof Error ? ex.message : String(ex));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span className="text-xs">Loading current configuration...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h2 className="font-display text-base font-semibold">Environment</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Select Fabric resources from live API. "Save &amp; Propagate" writes to all config targets.
        </p>
      </div>
      {loadError && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
          Could not load current config: {loadError}. Starting with empty configuration.
        </div>
      )}
      <SetupSettings config={config} onConfigChange={setConfig} />
    </div>
  );
}

// ============================================================================
// PASSWORD GATE
// ============================================================================

function PasswordGate({ onAuth }: { onAuth: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!pw.trim()) return;
    setLoading(true);
    setError(false);
    const ok = await verifyAdminPassword(pw);
    setLoading(false);
    if (ok) {
      onAuth(pw);
    } else {
      setError(true);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-80 space-y-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Lock className="w-5 h-5 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="font-display text-lg font-semibold">Admin Access</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Enter the admin password to continue.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <input
            type="password"
            value={pw}
            onChange={(e) => { setPw(e.target.value); setError(false); }}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="Password"
            autoFocus
            className={`w-full px-3 py-2.5 rounded-lg border bg-card text-sm outline-none transition-colors ${
              error
                ? "border-red-400/50 focus:border-red-400"
                : "border-border focus:border-primary"
            }`}
          />
          {error && (
            <p className="text-xs text-red-400 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Invalid password
            </p>
          )}
          <button
            onClick={submit}
            disabled={loading || !pw.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
            {loading ? "Verifying..." : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN ADMIN GATEWAY
// ============================================================================

export default function AdminGateway() {
  const [password, setPassword] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("environment");

  if (!password) {
    return <PasswordGate onAuth={setPassword} />;
  }

  return (
    <div className="flex gap-6 min-h-0">
      {/* Left sub-nav */}
      <div className="w-44 flex-shrink-0">
        <div className="flex items-center gap-2 mb-4 px-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          <h1 className="font-display text-sm font-semibold tracking-tight text-muted-foreground">
            Admin
          </h1>
        </div>
        <nav className="space-y-0.5">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-card border border-transparent"
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab content — keep data-fetching tabs mounted to prevent loading flash on re-visit */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className={activeTab === "environment" ? "" : "hidden"}><EnvironmentTab /></div>
        <div className={activeTab === "pages" ? "" : "hidden"}><PageVisibilityTab password={password} /></div>
        {activeTab === "general" && <GeneralTab />}
        {activeTab === "deployment" && <DeploymentManager />}
        {activeTab === "governance" && <AdminGovernance />}
      </div>
    </div>
  );
}
