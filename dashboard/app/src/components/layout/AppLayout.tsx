import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Activity,
  Menu,
  Cable,
  FlaskConical,
  ScrollText,
  Wrench,
  Play,
  Cog,
  Grid3X3,
  Server,
  DatabaseZap,
  Database,
  Network,
  Library,
  Microscope,
  FileCheck,
  Eraser,
  History,
  Crown,
  Settings,
  Layers,
  Gem,
  FileCode,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackgroundTaskToast } from "@/components/BackgroundTaskToast";
import { useState, useEffect, useCallback, useMemo } from "react";
import { getHiddenPages } from "@/lib/pageVisibility";
import { usePersona } from "@/contexts/PersonaContext";
import {
  LayoutDashboard,
  Bell,
  HelpCircle,
  FileText,
} from "lucide-react";

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
    label: "Overview",
    items: [
      { icon: LayoutDashboard, label: "Overview", href: "/overview" },
    ],
  },
  {
    label: "Load",
    items: [
      { icon: Play, label: "Load Center", href: "/load-center" },
      { icon: Cable, label: "Source Manager", href: "/sources" },
    ],
  },
  {
    label: "Monitor",
    items: [
      { icon: Grid3X3, label: "Execution Matrix", href: "/matrix" },
      { icon: Activity, label: "Error Intelligence", href: "/errors" },
      { icon: ScrollText, label: "Execution Log", href: "/logs" },
    ],
  },
  {
    label: "Explore",
    items: [
      { icon: DatabaseZap, label: "SQL Explorer", href: "/sql-explorer" },
      { icon: FlaskConical, label: "Data Blender", href: "/blender" },
      { icon: Network, label: "Data Lineage", href: "/lineage" },
      { icon: Library, label: "Data Catalog", href: "/catalog" },
      { icon: Microscope, label: "Data Profiler", href: "/profile" },
    ],
  },
  {
    label: "Gold Studio",
    items: [
      { icon: Crown, label: "Ledger", href: "/gold/ledger" },
      { icon: Layers, label: "Clusters", href: "/gold/clusters" },
      { icon: Gem, label: "Canonical", href: "/gold/canonical" },
      { icon: FileCode, label: "Specifications", href: "/gold/specs" },
      { icon: ShieldCheck, label: "Validation", href: "/gold/validation" },
    ],
  },
  {
    label: "Quality",
    items: [
      { icon: FileCheck, label: "DQ Scorecard", href: "/labs/dq-scorecard" },
      { icon: Eraser, label: "Cleansing Rules", href: "/labs/cleansing" },
      { icon: History, label: "SCD Audit", href: "/labs/scd-audit" },
    ],
  },
  {
    label: "Admin",
    items: [
      { icon: Wrench, label: "Config Manager", href: "/config" },
      { icon: Server, label: "Environment Setup", href: "/setup" },
      { icon: Database, label: "Database Explorer", href: "/db-explorer" },
      { icon: Settings, label: "Settings", href: "/settings" },
    ],
  },
];

// Business Portal navigation — focused set for non-technical users
const BUSINESS_GROUPS: NavGroup[] = [
  {
    label: "Portal",
    items: [
      { icon: LayoutDashboard, label: "Overview", href: "/overview" },
      { icon: Bell, label: "Alerts", href: "/alerts" },
      { icon: Cable, label: "Sources", href: "/sources-portal" },
      { icon: Library, label: "Catalog", href: "/catalog-portal" },
      { icon: FileText, label: "Requests", href: "/requests" },
      { icon: HelpCircle, label: "Help", href: "/help" },
    ],
  },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { isBusiness, togglePersona } = usePersona();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [hiddenPages, setHiddenPages] = useState<string[]>([]);

  // Listen for page visibility changes from the Admin gateway
  const onVisibilityChanged = useCallback((e: Event) => {
    const detail = (e as CustomEvent<string[]>).detail;
    setHiddenPages(detail);
  }, []);

  useEffect(() => {
    window.addEventListener("fmd-page-visibility-changed", onVisibilityChanged);
    return () => {
      window.removeEventListener("fmd-page-visibility-changed", onVisibilityChanged);
    };
  }, [onVisibilityChanged]);

  // Fetch hidden pages on mount
  useEffect(() => {
    getHiddenPages().then(setHiddenPages);
  }, []);

  // Build sidebar groups filtered by persona + hiddenPages.
  // Business mode shows the focused Business Portal nav.
  // Engineering mode shows the full CORE_GROUPS with hidden-page filtering.
  const sidebarGroups = useMemo(() => {
    const groups = isBusiness ? BUSINESS_GROUPS : CORE_GROUPS;
    return groups.map((g) => ({
      ...g,
      items: g.items.filter((item) => !hiddenPages.includes(item.href)),
    })).filter((g) => g.items.length > 0);
  }, [hiddenPages, isBusiness]);

  const sidebarWidth = "w-64";
  const mainMargin = "md:ml-64";

  // ── Business Portal sidebar — matches wireframe exactly ──
  const BPNavContent = () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bp-canvas)",
        borderRight: "1px solid var(--bp-border)",
        fontFamily: "var(--bp-font-body)",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "24px 24px 24px", borderBottom: "1px solid var(--bp-border)", marginBottom: 8 }}>
        <div style={{ fontFamily: "var(--bp-font-display)", fontSize: 28, color: "var(--bp-ink-primary)", lineHeight: 1 }}>
          FMD
        </div>
        <div style={{ fontSize: 11, fontWeight: 500, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px", textTransform: "uppercase", marginTop: 4 }}>
          Business Portal
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
        {sidebarGroups.map((group) => (
          <div key={group.label}>
            {group.items.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <Link key={item.href} to={item.href} style={{ textDecoration: "none" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 24px",
                      fontSize: 14,
                      fontWeight: isActive ? 500 : 400,
                      color: isActive ? "var(--bp-copper)" : "var(--bp-ink-secondary)",
                      position: "relative",
                      cursor: "pointer",
                      transition: "color 0.15s, background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.color = "var(--bp-ink-primary)";
                        e.currentTarget.style.background = "var(--bp-surface-2)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.color = "var(--bp-ink-secondary)";
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    {/* Copper left rail on active */}
                    {isActive && (
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 6,
                          bottom: 6,
                          width: 3,
                          background: "var(--bp-copper)",
                          borderRadius: "0 2px 2px 0",
                        }}
                      />
                    )}
                    <item.icon style={{ width: 18, height: 18, flexShrink: 0 }} />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: Business/Engineering segmented toggle */}
      <div style={{ padding: "16px 24px", borderTop: "1px solid var(--bp-border)" }}>
        <div
          style={{
            display: "flex",
            background: "var(--bp-surface-inset)",
            borderRadius: 6,
            padding: 3,
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <span
            style={{
              flex: 1,
              textAlign: "center",
              padding: "6px 8px",
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--bp-ink-primary)",
              background: "var(--bp-surface-1)",
              border: "1px solid var(--bp-border)",
              transition: "all 0.15s",
            }}
          >
            Business
          </span>
          <span
            onClick={togglePersona}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "6px 8px",
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--bp-ink-tertiary)",
              border: "1px solid transparent",
              transition: "all 0.15s",
            }}
          >
            Engineering
          </span>
        </div>
      </div>
    </div>
  );

  // ── Engineering Console sidebar — mirrors Business Portal style ──
  const EngNavContent = () => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--bp-canvas)",
        borderRight: "1px solid var(--bp-border)",
        fontFamily: "var(--bp-font-body)",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "24px 24px 24px", borderBottom: "1px solid var(--bp-border)", marginBottom: 8 }}>
        <div style={{ fontFamily: "var(--bp-font-display)", fontSize: 28, color: "var(--bp-ink-primary)", lineHeight: 1 }}>
          FMD
        </div>
        <div style={{ fontSize: 11, fontWeight: 500, color: "var(--bp-ink-tertiary)", letterSpacing: "0.5px", textTransform: "uppercase", marginTop: 4 }}>
          Engineering Console
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: "8px 0", overflowY: "auto" }}>
        {sidebarGroups.map((group) => (
          <div key={group.label}>
            <div style={{ padding: "12px 24px 4px", fontSize: 10, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase", color: "var(--bp-ink-muted)" }}>
              {group.label}
            </div>
            {group.items.map((item) => {
              const isActive = location.pathname === item.href;
              return (
                <Link key={item.href} to={item.href} style={{ textDecoration: "none" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 24px",
                      fontSize: 14,
                      fontWeight: isActive ? 500 : 400,
                      color: isActive ? "var(--bp-copper)" : "var(--bp-ink-secondary)",
                      position: "relative",
                      cursor: "pointer",
                      transition: "color 0.15s, background 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.color = "var(--bp-ink-primary)";
                        e.currentTarget.style.background = "var(--bp-surface-2)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive) {
                        e.currentTarget.style.color = "var(--bp-ink-secondary)";
                        e.currentTarget.style.background = "transparent";
                      }
                    }}
                  >
                    {/* Copper left rail on active */}
                    {isActive && (
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 6,
                          bottom: 6,
                          width: 3,
                          background: "var(--bp-copper)",
                          borderRadius: "0 2px 2px 0",
                        }}
                      />
                    )}
                    <item.icon style={{ width: 18, height: 18, flexShrink: 0 }} />
                    {item.label}
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer: Engineering/Business segmented toggle */}
      <div style={{ padding: "16px 24px", borderTop: "1px solid var(--bp-border)" }}>
        <div
          style={{
            display: "flex",
            background: "var(--bp-surface-inset)",
            borderRadius: 6,
            padding: 3,
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <span
            onClick={togglePersona}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "6px 8px",
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--bp-ink-tertiary)",
              border: "1px solid transparent",
              transition: "all 0.15s",
            }}
          >
            Business
          </span>
          <span
            style={{
              flex: 1,
              textAlign: "center",
              padding: "6px 8px",
              borderRadius: 4,
              cursor: "pointer",
              color: "var(--bp-ink-primary)",
              background: "var(--bp-surface-1)",
              border: "1px solid var(--bp-border)",
              transition: "all 0.15s",
            }}
          >
            Engineering
          </span>
        </div>
      </div>
    </div>
  );

  const NavContent = isBusiness ? BPNavContent : EngNavContent;

  return (
    <div
      className="flex min-h-screen"
      style={{ background: "var(--bp-canvas)", color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
    >
      {/* Desktop Sidebar */}
      <aside className={cn("hidden md:block fixed inset-y-0 z-50 transition-all duration-200", sidebarWidth)}>
        <NavContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-[4px]" role="button" tabIndex={0} onClick={() => setIsMobileOpen(false)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsMobileOpen(false); } }} />
          <div className="fixed inset-y-0 left-0 w-64 z-50 animate-[slideIn_0.25s_var(--ease-claude)]">
            <NavContent />
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className={cn("flex-1 flex flex-col min-h-screen transition-all duration-200", mainMargin)}>
        {/* Mobile hamburger — both personas */}
        <div className="md:hidden sticky top-0 z-40 h-12 flex items-center px-4" style={{ background: "var(--bp-canvas)" }}>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsMobileOpen(true)}>
            <Menu className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1">
          <div className={cn(
            "w-full animate-[fadeIn_0.25s_var(--ease-claude)]",
            (location.pathname === "/flow" || location.pathname === "/blender" || location.pathname === "/journey")
              ? "p-0 h-full"
              : isBusiness
                ? "" /* Business pages handle their own padding/max-width */
                : "p-6"
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
