import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  ExternalLink,
  GitBranch,
  ListChecks,
  MapPinned,
  MonitorDot,
  RefreshCcw,
  Workflow,
type LucideIcon,
} from "lucide-react";

type DagsterViewId = "overview" | "runs" | "catalog" | "jobs" | "automation" | "lineage" | "deployment";

interface DagsterStatus {
  available: boolean;
  baseUrl: string;
  graphqlUrl: string;
  checkedAt: string;
  message?: string;
}

interface DagsterView {
  id: DagsterViewId;
  label: string;
  eyebrow: string;
  description: string;
  route: string;
  dagsterPath: string;
  icon: LucideIcon;
}

const DAGSTER_BASE_FALLBACK = "http://127.0.0.1:3006";

const DAGSTER_VIEWS: DagsterView[] = [
  {
    id: "overview",
    label: "Overview",
    eyebrow: "Control plane",
    description: "Runtime diagnostics for recent activity, definitions, and run health.",
    route: "/dagster",
    dagsterPath: "/overview",
    icon: MonitorDot,
  },
  {
    id: "runs",
    label: "Runs",
    eyebrow: "History",
    description: "Inspect launched runs, status transitions, retries, and failure receipts.",
    route: "/dagster/runs",
    dagsterPath: "/runs",
    icon: ListChecks,
  },
  {
    id: "catalog",
    label: "Catalog",
    eyebrow: "Definitions",
    description: "Browse the runtime catalog of assets and execution definitions.",
    route: "/dagster/catalog",
    dagsterPath: "/assets",
    icon: Boxes,
  },
  {
    id: "jobs",
    label: "Jobs",
    eyebrow: "Launch surface",
    description: "Open the job catalog and launchpad for the FMD medallion orchestration jobs.",
    route: "/dagster/jobs",
    dagsterPath: "/jobs",
    icon: Workflow,
  },
  {
    id: "automation",
    label: "Automation",
    eyebrow: "Schedules",
    description: "Review schedules, sensors, and automation health as those are added.",
    route: "/dagster/automation",
    dagsterPath: "/automation",
    icon: CalendarClock,
  },
  {
    id: "lineage",
    label: "Lineage",
    eyebrow: "Graph",
    description: "Open the execution graph for cross-asset dependency investigation.",
    route: "/dagster/lineage",
    dagsterPath: "/asset-graph",
    icon: GitBranch,
  },
  {
    id: "deployment",
    label: "Deployment",
    eyebrow: "Code location",
    description: "Confirm the FMD orchestration deployment and code location loaded cleanly.",
    route: "/dagster/deployment",
    dagsterPath: "/locations",
    icon: MapPinned,
  },
];

const DAGSTER_ROUTE_ALIASES: Record<string, DagsterViewId> = {
  "": "overview",
  overview: "overview",
  runs: "runs",
  catalog: "catalog",
  assets: "catalog",
  jobs: "jobs",
  automation: "automation",
  schedules: "automation",
  sensors: "automation",
  lineage: "lineage",
  "asset-graph": "lineage",
  deployment: "deployment",
  locations: "deployment",
};

function viewFromPath(pathname: string): DagsterView {
  const [, , viewSegment] = pathname.split("/");
  const id = DAGSTER_ROUTE_ALIASES[viewSegment ?? ""] ?? "overview";
  return DAGSTER_VIEWS.find((view) => view.id === id) ?? DAGSTER_VIEWS[0];
}

function formatCheckedAt(value?: string): string {
  if (!value) return "Not checked yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently checked";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

export default function DagsterConsole() {
  const location = useLocation();
  const navigate = useNavigate();
  const activeView = useMemo(() => viewFromPath(location.pathname), [location.pathname]);
  const [status, setStatus] = useState<DagsterStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [browserReachable, setBrowserReachable] = useState<boolean | null>(null);

  useEffect(() => {
    if (location.pathname === "/dagster/overview") {
      navigate("/dagster", { replace: true });
    }
  }, [location.pathname, navigate]);

  useEffect(() => {
    let cancelled = false;
    const loadStatus = async () => {
      setIsChecking(true);
      setStatusError(null);
      try {
        const response = await fetch("/api/dagster/status");
        if (!response.ok) {
          throw new Error(`Status check returned ${response.status}`);
        }
        const payload = (await response.json()) as DagsterStatus;
        if (!cancelled) {
          setStatus(payload);
        }
      } catch (error) {
        if (!cancelled) {
          setStatusError(error instanceof Error ? error.message : "Runtime status check failed");
          setStatus(null);
        }
      } finally {
        if (!cancelled) {
          setIsChecking(false);
        }
      }
    };

    loadStatus();
    const interval = window.setInterval(loadStatus, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    setFrameLoaded(false);
  }, [activeView.id]);

  const baseUrl = status?.baseUrl || DAGSTER_BASE_FALLBACK;
  const embedSeparator = activeView.dagsterPath.includes("?") ? "&" : "?";
  const iframeSrc = `${baseUrl}${activeView.dagsterPath}${embedSeparator}fmd_embed=1`;
  const directDagsterUrl = `${baseUrl}${activeView.dagsterPath}`;
  const canAttemptEmbed = browserReachable !== false;
  const isDagsterReachable = status?.available || browserReachable === true;
  const statusTone = isDagsterReachable ? "online" : status ? "offline" : statusError ? "unknown" : "checking";
  const ActiveIcon = activeView.icon;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 2500);

    setBrowserReachable(null);
    fetch(baseUrl, {
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    })
      .then(() => {
        if (!cancelled) {
          setBrowserReachable(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBrowserReachable(false);
        }
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [baseUrl]);

  return (
    <main className="dagster-console gs-page-enter">
      <section className="dagster-console__hero">
        <div className="dagster-console__hero-copy">
          <div className="dagster-console__kicker">
            <GitBranch size={14} />
            Advanced runtime diagnostics
          </div>
          <h1>Inspect FMD execution without leaving the dashboard.</h1>
          <p>
            This advanced view is for run history, graph investigation, job definitions,
            deployment checks, and automation diagnostics. Day-to-day users should stay in
            Canvas, Load Center, and Mission Control.
          </p>
        </div>

        <aside className="dagster-console__status bp-card" aria-label="Runtime status">
          <div className={`dagster-console__status-pill dagster-console__status-pill--${statusTone}`}>
            <span />
            {isDagsterReachable ? "Runtime online" : status ? "Runtime offline" : "Checking runtime"}
          </div>
          <div className="dagster-console__status-row">
            <span>UI endpoint</span>
            <a href={baseUrl} target="_blank" rel="noreferrer">{baseUrl}</a>
          </div>
          <div className="dagster-console__status-row">
            <span>GraphQL</span>
            <code>{status?.graphqlUrl || `${baseUrl}/graphql`}</code>
          </div>
          <div className="dagster-console__status-row">
            <span>Last check</span>
            <strong>{isChecking ? "Checking..." : formatCheckedAt(status?.checkedAt)}</strong>
          </div>
          <div className="dagster-console__status-row">
            <span>Browser</span>
            <strong>
              {browserReachable === true
                ? "Can reach runtime"
                : browserReachable === false
                  ? "Cannot reach runtime"
                  : "Checking frame access"}
            </strong>
          </div>
          {!isDagsterReachable && (status?.message || statusError) && (
            <div className="dagster-console__status-note">
              {status?.message || statusError}
            </div>
          )}
        </aside>
      </section>

      <section className="dagster-console__workspace dagster-console__workspace--single">
        <nav className="dagster-console__views dagster-console__views--horizontal" aria-label="Runtime diagnostic pages">
          {DAGSTER_VIEWS.map((view) => {
            const Icon = view.icon;
            const active = activeView.id === view.id;
            return (
              <button
                key={view.id}
                type="button"
                onClick={() => navigate(view.route)}
                className={`dagster-console__view ${active ? "dagster-console__view--active" : ""}`}
              >
                <span className="dagster-console__view-icon"><Icon size={16} /></span>
                <span>
                  <strong>{view.label}</strong>
                  <small>{view.eyebrow}</small>
                </span>
              </button>
            );
          })}
        </nav>
        <div className="dagster-console__frame-card bp-card">
          <div className="dagster-console__frame-header">
            <div>
              <div className="dagster-console__frame-kicker">
                <ActiveIcon size={15} />
                {activeView.eyebrow}
              </div>
              <h2>{activeView.label}</h2>
              <p>{activeView.description}</p>
            </div>
            <div className="dagster-console__frame-actions">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="dagster-console__button dagster-console__button--secondary"
              >
                <RefreshCcw size={14} />
                Refresh page
              </button>
              <a
                href={directDagsterUrl}
                target="_blank"
                rel="noreferrer"
                className="dagster-console__button dagster-console__button--primary"
              >
                <ExternalLink size={14} />
                Open diagnostics
              </a>
            </div>
          </div>

          {!isDagsterReachable && status && (
            <div className="dagster-console__offline">
              <AlertTriangle size={16} />
              <span>The runtime diagnostics service is not responding right now. Start the local service, then refresh this page.</span>
            </div>
          )}

          <div className="dagster-console__iframe-wrap">
            {!frameLoaded && canAttemptEmbed && (
              <div className="dagster-console__frame-loading">
                <span />
                Loading embedded runtime {activeView.label.toLowerCase()}...
              </div>
            )}
            {canAttemptEmbed ? (
              <iframe
                title={`Runtime ${activeView.label}`}
                src={iframeSrc}
                className="dagster-console__iframe"
                onLoad={() => setFrameLoaded(true)}
              />
            ) : (
              <div className="dagster-console__empty-frame">
                <Workflow size={34} />
                <h3>Runtime diagnostics are not running on this machine</h3>
                <p>
                  This FMD section embeds the local diagnostics service at {baseUrl}. The section is wired
                  correctly, but there is no local service responding yet.
                </p>
                <pre>{`cd C:\\Users\\snahrup\\CascadeProjects\\FMD_ORCHESTRATOR
.\\scripts\\install.ps1
.\\scripts\\start_dagster_dev.ps1 -Port 3006 -FrameworkPath C:\\Users\\snahrup\\CascadeProjects\\FMD_FRAMEWORK_runtime-rewrite`}</pre>
                <a href={baseUrl} target="_blank" rel="noreferrer">Open diagnostics directly</a>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
