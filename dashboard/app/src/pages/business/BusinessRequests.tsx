// ============================================================================
// Business Requests — Data request form + history for Business Portal.
//
// Design system: Industrial Precision, Light Mode
// All styles use BP CSS custom properties (--bp-*)
// Data: /api/requests, /api/overview/sources
// ============================================================================

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  StatusRail,
  toRailStatus,
} from "@/components/business";
import {
  Send,
  Clock,
  CheckCircle,
  XCircle,
  MessageSquare,
  RefreshCw,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL || "";

// ── Types ──

interface DataRequest {
  id: number;
  title: string;
  source_name: string | null;
  description: string | null;
  justification: string | null;
  priority: string;
  status: string;
  admin_response: string | null;
  created_at: string;
  updated_at: string;
}

interface SourceOption {
  name: string;
  displayName: string;
}

// ── Helpers ──

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={`rounded ${className ?? ""}`}
      style={{
        background: "linear-gradient(90deg, var(--bp-surface-inset) 25%, var(--bp-surface-2) 50%, var(--bp-surface-inset) 75%)",
        backgroundSize: "200% 100%",
        animation: "bp-skeleton-shimmer 2s ease-in-out infinite",
      }}
    />
  );
}

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  in_review: "In Review",
  approved: "Approved",
  completed: "Completed",
  declined: "Declined",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  submitted: "bp-badge bp-badge-info",
  in_review: "bp-badge bp-badge-warning",
  approved: "bp-badge bp-badge-operational",
  completed: "bp-badge bp-badge-operational",
  declined: "bp-badge bp-badge-critical",
};

const STATUS_RAIL_MAP: Record<string, string> = {
  submitted: "neutral",
  in_review: "caution",
  approved: "operational",
  completed: "operational",
  declined: "fault",
};

const FILTER_OPTIONS = [
  { key: "all", label: "All" },
  { key: "submitted", label: "Submitted" },
  { key: "in_review", label: "In Review" },
  { key: "approved", label: "Approved" },
  { key: "completed", label: "Completed" },
  { key: "declined", label: "Declined" },
];

const PRIORITY_OPTIONS = ["low", "medium", "high"] as const;

// ── Main Component ──

export default function BusinessRequests() {
  // Form state
  const [title, setTitle] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [description, setDescription] = useState("");
  const [justification, setJustification] = useState("");
  const [priority, setPriority] = useState<string>("medium");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Data state
  const [requests, setRequests] = useState<DataRequest[]>([]);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");

  // ── Fetch ──

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/requests`);
      if (!res.ok) throw new Error("Failed to load requests");
      const data: DataRequest[] = await res.json();
      setRequests(data);
    } catch {
      // Silently fail on poll — initial load error handled elsewhere
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/overview/sources`);
      if (!res.ok) return;
      const data = await res.json();
      setSources(
        (data as Array<{ name: string; displayName?: string }>).map((s) => ({
          name: s.name,
          displayName: s.displayName || s.name,
        }))
      );
    } catch {
      // Sources are optional
    }
  }, []);

  useEffect(() => {
    fetchRequests();
    fetchSources();
    const timer = setInterval(fetchRequests, 30_000);
    return () => clearInterval(timer);
  }, [fetchRequests, fetchSources]);

  // ── Submit ──

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setFormError("Title is required");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API}/api/requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          source_name: sourceName || null,
          description: description.trim() || null,
          justification: justification.trim() || null,
          priority,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Submission failed" }));
        throw new Error(err.error || "Submission failed");
      }

      // Reset form
      setTitle("");
      setSourceName("");
      setDescription("");
      setJustification("");
      setPriority("medium");

      // Show success
      setSuccessMessage("Request submitted");
      setTimeout(() => setSuccessMessage(null), 3000);

      // Refresh list
      fetchRequests();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Filter ──

  const filteredRequests = useMemo(() => {
    if (statusFilter === "all") return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  // ── Render ──

  return (
    <div className="p-8 max-w-[1280px]">
      {/* Header */}
      <div className="flex items-baseline gap-4 mb-8">
        <h1
          className="bp-display text-[32px] leading-none"
          style={{ color: "var(--bp-ink-primary)" }}
        >
          Data Requests
        </h1>
        <button
          onClick={fetchRequests}
          className="ml-auto flex items-center gap-1.5 text-[12px] transition-colors"
          style={{ color: "var(--bp-ink-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--bp-copper)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--bp-ink-muted)")}
          aria-label="Refresh"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Two-column layout */}
      <div className="grid gap-8" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
        {/* ── Left: Request Form ── */}
        <div>
          <div
            className="text-[16px] font-semibold mb-4"
            style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
          >
            Request New Data
          </div>

          {/* Success banner */}
          {successMessage && (
            <div
              role="status"
              className="mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-[13px] transition-opacity"
              style={{
                background: "var(--bp-operational-light)",
                color: "var(--bp-operational)",
                fontFamily: "var(--bp-font-body)",
              }}
            >
              <CheckCircle className="h-4 w-4 shrink-0" />
              {successMessage}
            </div>
          )}

          {/* Form error */}
          {formError && (
            <div
              role="alert"
              className="mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-[13px]"
              style={{
                background: "var(--bp-fault-light)",
                color: "var(--bp-fault)",
                fontFamily: "var(--bp-font-body)",
              }}
            >
              <XCircle className="h-4 w-4 shrink-0" />
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="bp-card p-6">
            {/* Title */}
            <div className="mb-5">
              <label
                htmlFor="req-title"
                className="block text-[12px] font-medium mb-1.5 uppercase tracking-wider"
                style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-body)" }}
              >
                Title <span style={{ color: "var(--bp-fault)" }}>*</span>
              </label>
              <input
                id="req-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Weekly sales by region"
                required
                maxLength={200}
                className="w-full rounded-lg px-4 py-3 text-[14px] outline-none"
                style={{
                  background: "var(--bp-surface-inset)",
                  color: "var(--bp-ink-primary)",
                  fontFamily: "var(--bp-font-body)",
                  border: "none",
                }}
              />
            </div>

            {/* Source */}
            <div className="mb-5">
              <label
                htmlFor="req-source"
                className="block text-[12px] font-medium mb-1.5 uppercase tracking-wider"
                style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-body)" }}
              >
                Source
              </label>
              <select
                id="req-source"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                className="w-full rounded-lg px-4 py-3 text-[14px] outline-none cursor-pointer"
                style={{
                  background: "var(--bp-surface-inset)",
                  color: "var(--bp-ink-primary)",
                  fontFamily: "var(--bp-font-body)",
                  border: "none",
                }}
              >
                <option value="">Select a source...</option>
                {sources.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.displayName}
                  </option>
                ))}
                <option value="Other / Not sure">Other / Not sure</option>
              </select>
            </div>

            {/* Description */}
            <div className="mb-5">
              <label
                htmlFor="req-description"
                className="block text-[12px] font-medium mb-1.5 uppercase tracking-wider"
                style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-body)" }}
              >
                Description
              </label>
              <textarea
                id="req-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What data do you need and what format?"
                rows={4}
                className="w-full rounded-lg px-4 py-3 text-[14px] outline-none resize-none"
                style={{
                  background: "var(--bp-surface-inset)",
                  color: "var(--bp-ink-primary)",
                  fontFamily: "var(--bp-font-body)",
                  border: "none",
                }}
              />
            </div>

            {/* Justification */}
            <div className="mb-5">
              <label
                htmlFor="req-justification"
                className="block text-[12px] font-medium mb-1.5 uppercase tracking-wider"
                style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-body)" }}
              >
                Justification
              </label>
              <textarea
                id="req-justification"
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="How will this data be used?"
                rows={3}
                className="w-full rounded-lg px-4 py-3 text-[14px] outline-none resize-none"
                style={{
                  background: "var(--bp-surface-inset)",
                  color: "var(--bp-ink-primary)",
                  fontFamily: "var(--bp-font-body)",
                  border: "none",
                }}
              />
            </div>

            {/* Priority segmented control */}
            <div className="mb-6">
              <label
                className="block text-[12px] font-medium mb-1.5 uppercase tracking-wider"
                style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-body)" }}
              >
                Priority
              </label>
              <div
                className="inline-flex rounded-lg overflow-hidden"
                style={{ border: "1px solid var(--bp-border)" }}
                role="group"
                aria-label="Priority selection"
              >
                {PRIORITY_OPTIONS.map((opt) => {
                  const isActive = priority === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setPriority(opt)}
                      aria-pressed={isActive}
                      className="px-5 py-2 text-[13px] font-medium capitalize transition-colors"
                      style={{
                        background: isActive ? "var(--bp-copper)" : "var(--bp-surface-1)",
                        color: isActive ? "var(--bp-surface-1)" : "var(--bp-ink-secondary)",
                        fontFamily: "var(--bp-font-body)",
                        borderRight:
                          opt !== "high" ? "1px solid var(--bp-border)" : "none",
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting}
              className="bp-btn-primary flex items-center gap-2"
              style={{ opacity: submitting ? 0.6 : 1 }}
            >
              <Send className="h-4 w-4" />
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
          </form>
        </div>

        {/* ── Right: Request History ── */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <span
              className="text-[16px] font-semibold"
              style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
            >
              Your Requests
            </span>
            <span className="bp-badge">{requests.length}</span>
          </div>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            {FILTER_OPTIONS.map((opt) => {
              const isActive = statusFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setStatusFilter(opt.key)}
                  aria-pressed={isActive}
                  className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
                  style={{
                    background: isActive ? "var(--bp-copper)" : "var(--bp-surface-inset)",
                    color: isActive ? "var(--bp-surface-1)" : "var(--bp-ink-secondary)",
                    fontFamily: "var(--bp-font-body)",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Request list */}
          <div className="overflow-y-auto" style={{ maxHeight: "600px" }} aria-label="Request history">
            {loading ? (
              <div className="flex flex-col gap-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="bp-card p-4">
                    <Skeleton className="h-4 w-48 mb-3" />
                    <Skeleton className="h-3 w-24 mb-2" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                ))}
              </div>
            ) : filteredRequests.length === 0 ? (
              <div
                className="bp-card p-12 text-center"
                style={{ color: "var(--bp-ink-muted)" }}
              >
                <MessageSquare
                  className="h-10 w-10 mx-auto mb-3 opacity-40"
                  style={{ color: "var(--bp-ink-muted)" }}
                />
                <div
                  className="text-[14px] font-medium mb-1"
                  style={{ fontFamily: "var(--bp-font-body)" }}
                >
                  {statusFilter !== "all"
                    ? `No ${STATUS_LABELS[statusFilter]?.toLowerCase() ?? ""} requests`
                    : "No requests yet"}
                </div>
                <div className="text-[13px]">
                  {statusFilter !== "all"
                    ? "Try a different filter or submit a new request."
                    : "Submit your first data request using the form."}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredRequests.map((req) => (
                  <RequestCard key={req.id} request={req} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Request Card ──

function RequestCard({ request }: { request: DataRequest }) {
  const railStatus = toRailStatus(STATUS_RAIL_MAP[request.status] ?? "neutral");
  const badgeClass = STATUS_BADGE_CLASS[request.status] ?? "bp-badge";
  const statusLabel = STATUS_LABELS[request.status] ?? request.status;

  return (
    <div className="bp-card relative overflow-hidden">
      <StatusRail status={railStatus} />
      <div className="p-4 pl-5">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <span
            className="text-[14px] font-medium leading-snug"
            style={{ color: "var(--bp-ink-primary)", fontFamily: "var(--bp-font-body)" }}
          >
            {request.title}
          </span>
          <span className={badgeClass} style={{ flexShrink: 0 }}>
            {statusLabel}
          </span>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 mb-1">
          {request.source_name && (
            <span
              className="text-[12px]"
              style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-body)" }}
            >
              {request.source_name}
            </span>
          )}
          {request.source_name && (
            <span style={{ color: "var(--bp-border)" }}>{"\u00B7"}</span>
          )}
          <span
            className="text-[12px] capitalize"
            style={{ color: "var(--bp-ink-tertiary)", fontFamily: "var(--bp-font-body)" }}
          >
            {request.priority} priority
          </span>
        </div>

        {/* Date */}
        <div
          className="bp-mono text-[12px]"
          style={{ color: "var(--bp-ink-muted)" }}
        >
          <Clock className="h-3 w-3 inline-block mr-1" style={{ verticalAlign: "-1px" }} />
          {relativeTime(request.created_at)}
        </div>

        {/* Admin response */}
        {request.admin_response && (
          <div
            className="mt-3 rounded-lg px-3 py-2 text-[13px] italic"
            style={{
              background: "var(--bp-surface-inset)",
              color: "var(--bp-ink-secondary)",
              fontFamily: "var(--bp-font-body)",
            }}
          >
            <span
              className="not-italic font-medium text-[11px] uppercase tracking-wider block mb-1"
              style={{ color: "var(--bp-ink-tertiary)" }}
            >
              Response
            </span>
            {request.admin_response}
          </div>
        )}
      </div>
    </div>
  );
}
