// Gold Studio Layout — Shared wrapper with title bar and tab navigation for all Gold pages.

import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

interface GoldStudioLayoutProps {
  activeTab: "ledger" | "clusters" | "canonical" | "specs" | "validation";
  children: ReactNode;
  /** Right-aligned action buttons */
  actions?: ReactNode;
}

const TABS = [
  { id: "ledger", label: "Ledger", path: "/gold/ledger" },
  { id: "clusters", label: "Clusters", path: "/gold/clusters" },
  { id: "canonical", label: "Canonical", path: "/gold/canonical" },
  { id: "specs", label: "Specifications", path: "/gold/specs" },
  { id: "validation", label: "Validation", path: "/gold/validation" },
] as const;

export function GoldStudioLayout({ activeTab, children, actions }: GoldStudioLayoutProps) {
  const location = useLocation();

  return (
    <div className="min-h-screen" style={{ background: "var(--bp-canvas)" }}>
      {/* Sticky header: title + tabs */}
      <div
        className="sticky top-0 z-10"
        style={{ background: "var(--bp-canvas)" }}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3">
          <h1
            style={{
              fontFamily: "var(--bp-font-display)",
              fontSize: 24,
              letterSpacing: "-0.02em",
              color: "var(--bp-ink-primary)",
            }}
          >
            GOLD STUDIO
          </h1>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>

        {/* Tab strip */}
        <nav
          className="flex px-6 gap-1"
          style={{ borderBottom: "1px solid var(--bp-border)" }}
        >
          {TABS.map((tab) => {
            const isActive =
              tab.id === activeTab || location.pathname === tab.path;
            return (
              <Link
                key={tab.id}
                to={tab.path}
                className={cn(
                  "pb-2.5 px-3 text-center transition-colors relative",
                  isActive
                    ? "text-[var(--bp-copper)]"
                    : "text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-secondary)]"
                )}
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontWeight: 500,
                  fontSize: 13,
                }}
              >
                {tab.label}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-0 right-0"
                    style={{
                      height: 2,
                      background: "var(--bp-copper)",
                      borderRadius: "1px 1px 0 0",
                    }}
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Page content */}
      <div>{children}</div>
    </div>
  );
}
