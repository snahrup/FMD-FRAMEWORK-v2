// Slide-Over Panel — Reusable right-edge drawer with optional tabs and fixed footer.

import { useEffect, useCallback, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SlideOverTab {
  id: string;
  label: string;
}

interface SlideOverProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  tabs?: SlideOverTab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  /** Entity type badges, provenance threads, source labels — rendered between title and tabs */
  metadata?: ReactNode;
  /** Badges, status indicators, provenance thread */
  headerRight?: ReactNode;
  /** Contextual action button pinned to bottom */
  footer?: ReactNode;
  /** Panel width: default=70%, wide=88%, full=100% */
  width?: "default" | "wide" | "full";
  children: ReactNode;
}

const WIDTH_MAP: Record<NonNullable<SlideOverProps["width"]>, string> = {
  default: "70%",
  wide: "88%",
  full: "100%",
};

export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  metadata,
  tabs,
  activeTab,
  onTabChange,
  headerRight,
  footer,
  width = "default",
  children,
}: SlideOverProps) {
  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, handleKeyDown]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-50 transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        style={{ background: "rgba(0,0,0,0.3)" }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className={cn(
          "fixed top-0 right-0 bottom-0 z-50 flex flex-col transition-transform duration-300",
          open ? "translate-x-0" : "translate-x-full"
        )}
        style={{
          width: WIDTH_MAP[width],
          maxWidth: "100vw",
          background: "var(--bp-surface-1)",
          borderLeft: "1px solid var(--bp-border)",
        }}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div
          className="shrink-0 px-5 pt-4 pb-3"
          style={{ borderBottom: "1px solid var(--bp-border)" }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2
                style={{
                  fontFamily: "var(--bp-font-display)",
                  fontSize: 20,
                  color: "var(--bp-ink-primary)",
                }}
              >
                {title}
              </h2>
              {subtitle && (
                <p
                  className="mt-0.5 truncate"
                  style={{
                    fontFamily: "var(--bp-font-body)",
                    fontSize: 13,
                    color: "var(--bp-ink-tertiary)",
                  }}
                >
                  {subtitle}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {headerRight}
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1.5 transition-colors hover:bg-black/[0.04]"
                style={{ color: "var(--bp-ink-muted)" }}
                aria-label="Close panel"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Metadata row */}
          {metadata && (
            <div className="flex items-center gap-2 flex-wrap mt-2">
              {metadata}
            </div>
          )}

          {/* Tab strip */}
          {tabs && tabs.length > 0 && (
            <nav className="flex gap-0.5 mt-3 -mb-3">
              {tabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onTabChange?.(tab.id)}
                    className={cn(
                      "pb-2 px-2.5 text-center transition-colors relative",
                      isActive
                        ? "text-[var(--bp-copper)]"
                        : "text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-secondary)]"
                    )}
                    style={{
                      fontFamily: "var(--bp-font-body)",
                      fontWeight: 500,
                      fontSize: 12,
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
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4" style={{ background: "var(--bp-surface-1)" }}>{children}</div>

        {/* Fixed footer */}
        {footer && (
          <div
            className="shrink-0 px-5 py-3"
            style={{ borderTop: "1px solid var(--bp-border)" }}
          >
            {footer}
          </div>
        )}
      </div>
    </>
  );
}
