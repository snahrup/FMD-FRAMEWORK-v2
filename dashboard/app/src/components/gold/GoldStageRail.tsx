import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

type StageStatus = "not_started" | "in_progress" | "needs_attention" | "ready" | "completed";

interface StageItem {
  id: string;
  label: string;
  path: string;
  hint: string;
  summary?: string;
  detail?: string;
  status?: StageStatus;
}

const STATUS_STYLE: Record<StageStatus, { label: string; color: string; bg: string; border: string }> = {
  not_started: {
    label: "Not started",
    color: "var(--bp-ink-tertiary)",
    bg: "var(--bp-surface-inset)",
    border: "var(--bp-border)",
  },
  in_progress: {
    label: "In progress",
    color: "var(--bp-copper)",
    bg: "rgba(180,86,36,0.08)",
    border: "rgba(180,86,36,0.16)",
  },
  needs_attention: {
    label: "Needs attention",
    color: "var(--bp-caution-amber)",
    bg: "rgba(194,122,26,0.10)",
    border: "rgba(194,122,26,0.18)",
  },
  ready: {
    label: "Ready",
    color: "var(--bp-info, #2563eb)",
    bg: "rgba(59,130,246,0.10)",
    border: "rgba(59,130,246,0.18)",
  },
  completed: {
    label: "Completed",
    color: "var(--bp-operational-green)",
    bg: "rgba(61,124,79,0.10)",
    border: "rgba(61,124,79,0.18)",
  },
};

export function GoldStageRail({
  items,
  activeId,
  search = "",
}: {
  items: StageItem[];
  activeId: string;
  search?: string;
}) {
  return (
    <nav
      className="grid gap-2 px-6 pb-2 sm:grid-cols-2 xl:grid-cols-6"
      style={{ borderBottom: "1px solid var(--bp-border)" }}
    >
      {items.map((item, index) => {
        const isActive = item.id === activeId;
        const status = STATUS_STYLE[item.status ?? "not_started"];
        const summary = isActive ? item.summary ?? item.hint : item.hint;
        return (
          <Link
            key={item.id}
            to={`${item.path}${search}`}
            className={cn("rounded-lg px-3 py-2.5 transition-all", isActive ? "text-[var(--bp-copper)]" : "text-[var(--bp-ink-muted)] hover:text-[var(--bp-ink-secondary)]")}
            style={{
              border: `1px solid ${isActive ? "rgba(180,86,36,0.22)" : "var(--bp-border)"}`,
              background: isActive ? "rgba(180,86,36,0.05)" : "var(--bp-surface-1)",
            }}
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span
                style={{
                  fontFamily: "var(--bp-font-mono)",
                  fontSize: 10,
                  color: isActive ? "var(--bp-copper)" : "var(--bp-ink-tertiary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span
                className="rounded-full px-2 py-0.5"
                style={{
                  fontFamily: "var(--bp-font-body)",
                  fontSize: 10,
                  color: status.color,
                  background: status.bg,
                  border: `1px solid ${status.border}`,
                }}
              >
                {status.label}
              </span>
            </div>
            <div
              style={{
                fontFamily: "var(--bp-font-body)",
                fontWeight: isActive ? 700 : 600,
                fontSize: 14,
                color: isActive ? "var(--bp-ink-primary)" : "var(--bp-ink-secondary)",
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 11,
                color: "var(--bp-ink-tertiary)",
                marginTop: 4,
                lineHeight: 1.35,
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: isActive ? 2 : 1,
                overflow: "hidden",
              }}
            >
              {summary}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}
