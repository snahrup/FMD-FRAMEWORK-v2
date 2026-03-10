import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Activity,
  ShieldCheck,
  GitBranch,
  Menu,
  Cable,
  PanelLeftClose,
  PanelLeftOpen,
  FlaskConical,
  Gauge,
  ScrollText,
  Hash,
  Sparkles,
  ClipboardCheck,
  Layers3,
  Route,
  Play,
  Radio,
  Cog,
  Grid3X3,
  DatabaseZap,
  BarChart3,
  Microscope,
  Columns3,
  Clapperboard,
  Radar,
  ScanSearch,
  BookOpen,
  Shield,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { DeploymentOverlay } from "@/components/DeploymentOverlay";
import { BackgroundTaskToast } from "@/components/BackgroundTaskToast";
import { useState, useEffect, useCallback, useMemo } from "react";
import { getLabsFlags, anyLabsEnabled, type LabsFlags } from "@/lib/featureFlags";
import { getHiddenPages } from "@/lib/pageVisibility";

interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const CORE_GROUPS: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { icon: Grid3X3, label: "Execution Matrix", href: "/" },
      { icon: Cog, label: "Engine Control", href: "/engine" },
      { icon: Sparkles, label: "Validation", href: "/validation" },
      { icon: BarChart3, label: "Load Progress", href: "/load-progress" },
      { icon: Radio, label: "Live Monitor", href: "/live" },
      { icon: Gauge, label: "Control Plane", href: "/control" },
      { icon: Activity, label: "Error Intelligence", href: "/errors" },
      { icon: ScrollText, label: "Execution Log", href: "/logs" },
      { icon: Play, label: "Pipeline Runner", href: "/runner" },
      { icon: ClipboardCheck, label: "Pipeline Testing", href: "/notebook-debug" },
    ],
  },
  {
    label: "Data",
    items: [
      { icon: Cable, label: "Source Manager", href: "/sources" },
      { icon: Radar, label: "Impact Pulse", href: "/pulse" },
      { icon: FlaskConical, label: "Data Blender", href: "/blender" },
      { icon: Layers3, label: "Flow Explorer", href: "/flow" },
      { icon: Route, label: "Data Journey", href: "/journey" },
      { icon: Columns3, label: "Column Evolution", href: "/columns" },
      { icon: Microscope, label: "Data Profiler", href: "/profile" },
      { icon: ScanSearch, label: "Data Microscope", href: "/microscope" },
      { icon: Clapperboard, label: "Transformation Replay", href: "/replay" },
      { icon: Hash, label: "Record Counts", href: "/counts" },
      { icon: DatabaseZap, label: "SQL Explorer", href: "/sql-explorer" },
    ],
  },
  {
    label: "Governance",
    items: [
      { icon: GitBranch, label: "Data Lineage", href: "/lineage" },
      { icon: Shield, label: "Data Classification", href: "/classification" },
      { icon: BookOpen, label: "Data Catalog", href: "/catalog" },
      { icon: Zap, label: "Impact Analysis", href: "/impact" },
    ],
  },
  {
    label: "Admin",
    items: [
      { icon: ShieldCheck, label: "Admin", href: "/admin" },
      { icon: LayoutDashboard, label: "Environment Setup", href: "/setup" },
    ],
  },
];

function buildLabsGroup(flags: LabsFlags): NavGroup | null {
  const items: NavItem[] = [];
  if (flags.cleansingRuleEditor) items.push({ icon: Sparkles, label: "Cleansing Rules", href: "/labs/cleansing" });
  if (flags.scdAuditView) items.push({ icon: ClipboardCheck, label: "SCD Audit", href: "/labs/scd-audit" });
  if (flags.goldMlvManager) items.push({ icon: Layers3, label: "Gold / MLV", href: "/labs/gold-mlv" });
  if (flags.dqScorecard) items.push({ icon: ShieldCheck, label: "DQ Scorecard", href: "/labs/dq-scorecard" });
  return items.length > 0 ? { label: "Labs", items } : null;
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [labsFlags, setLabsFlags] = useState<LabsFlags>(getLabsFlags);
  const [hiddenPages, setHiddenPages] = useState<string[]>([]);

  // Listen for flag changes from the Settings page
  const onLabsChanged = useCallback((e: Event) => {
    const detail = (e as CustomEvent<LabsFlags>).detail;
    setLabsFlags(detail);
  }, []);

  // Listen for page visibility changes from the Admin gateway
  const onVisibilityChanged = useCallback((e: Event) => {
    const detail = (e as CustomEvent<string[]>).detail;
    setHiddenPages(detail);
  }, []);

  useEffect(() => {
    window.addEventListener("fmd-labs-changed", onLabsChanged);
    window.addEventListener("fmd-page-visibility-changed", onVisibilityChanged);
    return () => {
      window.removeEventListener("fmd-labs-changed", onLabsChanged);
      window.removeEventListener("fmd-page-visibility-changed", onVisibilityChanged);
    };
  }, [onLabsChanged, onVisibilityChanged]);

  // Fetch hidden pages on mount
  useEffect(() => {
    getHiddenPages().then(setHiddenPages);
  }, []);

  // Build sidebar groups with optional Labs section, filtered by hiddenPages
  const sidebarGroups = useMemo(() => {
    const groups: NavGroup[] = CORE_GROUPS.map((g) => ({
      ...g,
      items: g.items.filter((item) => !hiddenPages.includes(item.href)),
    })).filter((g) => g.items.length > 0);
    const labsGroup = buildLabsGroup(labsFlags);
    if (labsGroup) {
      groups.splice(groups.length - 1, 0, labsGroup);
    }
    return groups;
  }, [labsFlags, hiddenPages]);

  const sidebarWidth = isCollapsed ? "w-16" : "w-64";
  const mainMargin = isCollapsed ? "md:ml-16" : "md:ml-64";

  const NavContent = () => (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
      <div className={cn("flex-1 min-h-0 overflow-y-auto", cn("p-4", !isCollapsed && "p-6"))}>
        <div className={cn("flex items-center gap-2 mb-8", isCollapsed && "justify-center mb-6")}>
          <div className="h-8 w-8 rounded-[var(--radius-md)] flex items-center justify-center overflow-hidden flex-shrink-0">
             <img src="/icons/fabric.svg" alt="Fabric" className="h-8 w-8" />
          </div>
          {!isCollapsed && (
            <div>
              <h1 className="font-display font-semibold text-sm leading-none tracking-tight">FMD Data</h1>
              <span className="text-[10px] text-sidebar-foreground/60 font-medium tracking-wider uppercase">Pipeline Control</span>
            </div>
          )}
        </div>

        <nav className="space-y-4">
          {sidebarGroups.map((group) => (
            <div key={group.label}>
              {isCollapsed ? (
                <div className="h-px bg-sidebar-border mx-2 mb-2" />
              ) : (
                <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = location.pathname === item.href;
                  return (
                    <Link key={item.href} to={item.href} title={isCollapsed ? item.label : undefined}>
                      <div className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)] text-sm transition-all group relative overflow-hidden cursor-pointer",
                        "duration-[var(--duration-fast)]",
                        isCollapsed && "justify-center px-2",
                        isActive
                          ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-[var(--shadow-sm)]"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      )}>
                        <item.icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-sidebar-primary-foreground" : "text-sidebar-foreground/60 group-hover:text-sidebar-accent-foreground")} />
                        {!isCollapsed && item.label}
                        {isActive && (
                          <div className="absolute inset-0 bg-white/10 mix-blend-overlay pointer-events-none" />
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      <div className={cn("mt-auto p-4 border-t border-sidebar-border", isCollapsed && "p-2")}>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className={cn(
            "flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all text-xs w-full cursor-pointer justify-end",
            isCollapsed && "justify-center px-2"
          )}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background text-foreground font-sans">
      {/* Deployment overlay disabled — only needed during active NB_SETUP_FMD runs */}
      {/* <DeploymentOverlay /> */}

      {/* Desktop Sidebar */}
      <aside className={cn("hidden md:block fixed inset-y-0 z-50 transition-all duration-200", sidebarWidth)}>
        <NavContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-[4px]" onClick={() => setIsMobileOpen(false)} />
          <div className="fixed inset-y-0 left-0 w-64 z-50 animate-[slideIn_0.25s_var(--ease-claude)]">
            <NavContent />
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className={cn("flex-1 flex flex-col min-h-screen transition-all duration-200", mainMargin)}>
        <header className="sticky top-0 z-40 h-12 bg-background/80 backdrop-blur-md border-b border-border flex items-center justify-between px-6">
           <div className="flex items-center gap-4">
             <Button variant="ghost" size="icon" className="md:hidden h-8 w-8" onClick={() => setIsMobileOpen(true)}>
               <Menu className="h-4 w-4" />
             </Button>
             <div className="flex items-center gap-2 text-xs text-muted-foreground">
               <div className="h-1.5 w-1.5 rounded-full status-running animate-[pulse-status_2s_ease-in-out_infinite]" />
               <span className="font-medium text-foreground text-sm">System Operational</span>
               <span className="mx-2 text-border">|</span>
               <span className="font-mono text-[10px]">Last updated: just now</span>
             </div>
           </div>

           <div className="flex items-center gap-2">
             <ThemeToggle />
             <Button variant="outline" size="sm" className="hidden sm:flex gap-2 h-8 text-xs border-amber-300/50 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100/50 dark:hover:bg-amber-950/30">
               <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
               <span className="font-semibold">DEV · MVP</span>
             </Button>
           </div>
        </header>

        <div className="flex-1 cowork-grid">
          <div className={cn(
            "w-full animate-[fadeIn_0.25s_var(--ease-claude)]",
            (location.pathname === "/flow" || location.pathname === "/blender" || location.pathname === "/journey" || location.pathname === "/columns" || location.pathname === "/sankey" || location.pathname === "/pulse")
              ? "p-0 h-full"
              : "p-6 md:p-8 max-w-7xl mx-auto"
          )}>
            {children}
          </div>
        </div>
      </main>

      {/* Background task progress — persists across page navigation */}
      <BackgroundTaskToast />
    </div>
  );
}
