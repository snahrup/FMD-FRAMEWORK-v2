import type { Meta, StoryObj } from "@storybook/react";
import type { ReactElement } from "react";
import { action } from "storybook/actions";
import {
  CheckCircle2,
  Circle,
  RefreshCw,
  Minus,
  AlertTriangle,
  XCircle,
  Clock,
  Loader2,
  Shield,
} from "lucide-react";

/* ── helpers ── */

const wrap = (Story: () => ReactElement) => (
  <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
    <Story />
  </div>
);

const Badge = ({
  label,
  color,
  bg,
  icon,
  dotted,
}: {
  label: string;
  color: string;
  bg: string;
  icon?: React.ReactNode;
  dotted?: boolean;
}) => (
  <span
    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
    style={{
      color,
      background: bg,
      fontFamily: "var(--bp-font-body)",
      border: dotted ? `1px dashed ${color}` : undefined,
    }}
  >
    {icon}
    {label}
  </span>
);

const thStyle: React.CSSProperties = {
  fontFamily: "var(--bp-font-body)",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--bp-ink-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "8px 12px",
  borderBottom: "1px solid var(--bp-border)",
  textAlign: "left",
};

const tdStyle: React.CSSProperties = {
  fontFamily: "var(--bp-font-body)",
  fontSize: 13,
  color: "var(--bp-ink-primary)",
  padding: "10px 12px",
  borderBottom: "1px solid var(--bp-border)",
};

const mono: React.CSSProperties = {
  fontFamily: "var(--bp-font-mono)",
  fontSize: 12,
};

const sectionTitle: React.CSSProperties = {
  fontFamily: "var(--bp-font-display)",
  fontSize: 15,
  fontWeight: 600,
  color: "var(--bp-ink-primary)",
  marginBottom: 12,
};

/* ── meta ── */

const meta = {
  title: "Gold Studio/Gold Validation",
  tags: ["autodocs"],
  decorators: [wrap],
} satisfies Meta;

export default meta;

/* ─── Story 1: Spec Status Badges ─── */

export const SpecStatusBadges: StoryObj = {
  render: () => (
    <div>
      <h3 style={sectionTitle}>Spec Status Badges</h3>
      <div className="flex flex-wrap gap-3 items-center">
        <Badge
          label="Validated"
          color="var(--bp-operational-green)"
          bg="var(--bp-operational-light)"
          icon={<CheckCircle2 size={12} />}
        />
        <Badge
          label="Draft"
          color="var(--bp-ink-muted)"
          bg="rgba(168,162,158,0.10)"
          icon={<Circle size={12} strokeDasharray="3 2" />}
          dotted
        />
        <Badge
          label="Needs Revalidation"
          color="var(--bp-caution-amber)"
          bg="var(--bp-caution-light)"
          icon={<RefreshCw size={12} className="animate-spin" style={{ animationDuration: "3s" }} />}
        />
        <Badge
          label="Deprecated"
          color="var(--bp-ink-muted)"
          bg="rgba(168,162,158,0.10)"
          icon={<Minus size={12} />}
        />
      </div>
    </div>
  ),
};

/* ─── Story 2: Run Status Badges ─── */

export const RunStatusBadges: StoryObj = {
  render: () => (
    <div>
      <h3 style={sectionTitle}>Run Status Badges</h3>
      <div className="flex flex-wrap gap-3 items-center">
        <Badge label="Passed" color="var(--bp-operational-green)" bg="var(--bp-operational-light)" icon={<CheckCircle2 size={12} />} />
        <Badge label="Warning" color="var(--bp-caution-amber)" bg="var(--bp-caution-light)" icon={<AlertTriangle size={12} />} />
        <Badge label="Failed" color="var(--bp-fault-red)" bg="var(--bp-fault-light)" icon={<XCircle size={12} />} />
        <Badge label="Queued" color="var(--bp-ink-muted)" bg="rgba(168,162,158,0.10)" icon={<Clock size={12} />} />
        <Badge label="Running" color="var(--bp-copper)" bg="var(--bp-copper-soft)" icon={<Loader2 size={12} className="animate-spin" />} />
      </div>
    </div>
  ),
};

/* ─── Story 3: Sensitivity Badges ─── */

export const SensitivityBadges: StoryObj = {
  render: () => (
    <div>
      <h3 style={sectionTitle}>Sensitivity Badges</h3>
      <div className="flex flex-wrap gap-3 items-center">
        <Badge label="Public" color="var(--bp-operational-green)" bg="var(--bp-operational-light)" />
        <Badge label="Internal" color="var(--bp-info)" bg="var(--bp-info-light)" />
        <Badge label="Confidential" color="var(--bp-caution-amber)" bg="var(--bp-caution-light)" icon={<Shield size={12} />} />
        <Badge label="Restricted" color="var(--bp-fault-red)" bg="var(--bp-fault-light)" icon={<Shield size={12} />} />
      </div>
    </div>
  ),
};

/* ─── Story 4: Endorsement Badges ─── */

export const EndorsementBadges: StoryObj = {
  render: () => (
    <div>
      <h3 style={sectionTitle}>Endorsement Badges</h3>
      <div className="flex flex-wrap gap-3 items-center">
        <Badge label="Certified" color="var(--bp-operational-green)" bg="var(--bp-operational-light)" icon={<CheckCircle2 size={12} />} />
        <Badge label="Promoted" color="var(--bp-copper)" bg="var(--bp-copper-soft)" />
        <span
          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
          style={{ color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-body)" }}
        >
          Unendorsed
        </span>
      </div>
    </div>
  ),
};

/* ─── Story 5: Coverage Status Badges ─── */

export const CoverageStatusBadges: StoryObj = {
  render: () => (
    <div>
      <h3 style={sectionTitle}>Coverage Status Badges</h3>
      <div className="flex flex-wrap gap-3 items-center">
        <Badge label="Not Analyzed" color="var(--bp-ink-muted)" bg="rgba(168,162,158,0.10)" />
        <Badge label="Analyzed" color="var(--bp-copper)" bg="var(--bp-copper-soft)" />
        <Badge label="Partially Covered" color="var(--bp-caution-amber)" bg="var(--bp-caution-light)" />
        <Badge label="Fully Covered" color="var(--bp-info)" bg="var(--bp-info-light)" />
        <Badge label="Recreated" color="var(--bp-operational-green)" bg="var(--bp-operational-light)" />
        <Badge
          label="Reconciled"
          color="var(--bp-operational-green)"
          bg="var(--bp-operational-light)"
          icon={<CheckCircle2 size={12} />}
        />
      </div>
    </div>
  ),
};

/* ─── Story 6: Validation Rules Table ─── */

const rules = [
  { rule: "Row count tolerance \u2264 5%", type: "Critical", expected: "1,204,338", actual: "1,198,012", passed: true },
  { rule: "No NULL primary keys", type: "Critical", expected: "0 nulls", actual: "47 nulls", passed: false },
  { rule: "Schema drift check", type: "Warning", expected: "62 columns", actual: "62 columns", passed: true },
  { rule: "Referential integrity (MITMAS \u2192 MITFAC)", type: "Warning", expected: "0 orphans", actual: "0 orphans", passed: true },
  { rule: "Freshness within 24h", type: "Advisory", expected: "\u2264 24h", actual: "6h 14m", passed: true },
];

const typeBadge = (t: string) => {
  const map: Record<string, { color: string; bg: string }> = {
    Critical: { color: "var(--bp-fault-red)", bg: "var(--bp-fault-light)" },
    Warning: { color: "var(--bp-caution-amber)", bg: "var(--bp-caution-light)" },
    Advisory: { color: "var(--bp-info)", bg: "var(--bp-info-light)" },
  };
  const s = map[t] ?? map.Advisory;
  return <Badge label={t} color={s.color} bg={s.bg} />;
};

export const ValidationRulesTable: StoryObj = {
  render: () => (
    <div>
      <h3 style={sectionTitle}>Validation Rules &mdash; MITMAS (Finance)</h3>
      <div style={{ background: "var(--bp-surface-1)", borderRadius: 8, border: "1px solid var(--bp-border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Rule</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Expected</th>
              <th style={thStyle}>Actual</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.rule}>
                <td style={tdStyle}>{r.rule}</td>
                <td style={tdStyle}>{typeBadge(r.type)}</td>
                <td style={{ ...tdStyle, ...mono }}>{r.expected}</td>
                <td style={{ ...tdStyle, ...mono }}>{r.actual}</td>
                <td style={tdStyle}>
                  {r.passed ? (
                    <CheckCircle2 size={16} style={{ color: "var(--bp-operational-green)" }} />
                  ) : (
                    <XCircle size={16} style={{ color: "var(--bp-fault-red)" }} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ),
};

/* ─── Story 7: Reconciliation Table ─── */

const reconRows = [
  { metric: "Row Count", legacy: "1,204,338", gold: "1,198,012", delta: "-0.53%", status: "within_tolerance" },
  { metric: "Sum Revenue", legacy: "$42,891,204", gold: "$43,102,887", delta: "+0.49%", status: "review" },
  { metric: "Avg Unit Cost", legacy: "$14.32", gold: "$14.31", delta: "-0.07%", status: "within_tolerance" },
  { metric: "Distinct Customers", legacy: "8,412", gold: "7,986", delta: "-5.06%", status: "out_of_range" },
];

const statusIcon = (s: string) => {
  if (s === "within_tolerance") return <CheckCircle2 size={16} style={{ color: "var(--bp-operational-green)" }} />;
  if (s === "review") return <AlertTriangle size={16} style={{ color: "var(--bp-caution-amber)" }} />;
  return <XCircle size={16} style={{ color: "var(--bp-fault-red)" }} />;
};

export const ReconciliationTable: StoryObj = {
  render: () => (
    <div>
      <h3 style={sectionTitle}>Reconciliation &mdash; GL_TRANSACTIONS (Finance)</h3>
      <div style={{ background: "var(--bp-surface-1)", borderRadius: 8, border: "1px solid var(--bp-border)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Metric</th>
              <th style={thStyle}>Legacy Value</th>
              <th style={thStyle}>Gold Value</th>
              <th style={thStyle}>Delta</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {reconRows.map((r) => (
              <tr key={r.metric}>
                <td style={tdStyle}>{r.metric}</td>
                <td style={{ ...tdStyle, ...mono }}>{r.legacy}</td>
                <td style={{ ...tdStyle, ...mono }}>{r.gold}</td>
                <td style={{ ...tdStyle, ...mono, color: r.delta.startsWith("-") ? "var(--bp-fault-red)" : "var(--bp-operational-green)" }}>
                  {r.delta}
                </td>
                <td style={tdStyle}>{statusIcon(r.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ),
};

/* ─── Story 8: Coverage Progress Bar ─── */

export const CoverageProgressBar: StoryObj = {
  render: () => (
    <div
      style={{
        background: "var(--bp-surface-1)",
        borderRadius: 8,
        border: "1px solid var(--bp-border)",
        padding: 20,
      }}
    >
      <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--bp-font-display)", fontSize: 14, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
          Recreation Readiness
        </span>
        <span style={{ fontFamily: "var(--bp-font-mono)", fontSize: 12, color: "var(--bp-ink-secondary)" }}>
          14/20 reports covered (70%)
        </span>
      </div>
      <div
        style={{
          height: 10,
          borderRadius: 6,
          background: "var(--bp-surface-inset)",
          overflow: "hidden",
          display: "flex",
        }}
      >
        <div style={{ width: "55%", background: "var(--bp-operational-green)", borderRadius: "6px 0 0 6px" }} />
        <div style={{ width: "15%", background: "var(--bp-caution-amber)" }} />
      </div>
      <div className="flex gap-4" style={{ marginTop: 8 }}>
        <span className="flex items-center gap-1" style={{ fontSize: 11, color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-body)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--bp-operational-green)", display: "inline-block" }} />
          Fully Covered (11)
        </span>
        <span className="flex items-center gap-1" style={{ fontSize: 11, color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-body)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--bp-caution-amber)", display: "inline-block" }} />
          Partial (3)
        </span>
        <span className="flex items-center gap-1" style={{ fontSize: 11, color: "var(--bp-ink-muted)", fontFamily: "var(--bp-font-body)" }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--bp-surface-inset)", display: "inline-block", border: "1px solid var(--bp-border)" }} />
          Not Covered (6)
        </span>
      </div>
    </div>
  ),
};

/* ─── Story 9: Waiver Card ─── */

export const WaiverCard: StoryObj = {
  render: () => (
    <div
      style={{
        background: "var(--bp-caution-light)",
        borderRadius: 8,
        border: "1px solid var(--bp-caution-amber)",
        padding: 20,
      }}
    >
      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
        <AlertTriangle size={16} style={{ color: "var(--bp-caution-amber)" }} />
        <span style={{ fontFamily: "var(--bp-font-display)", fontSize: 14, fontWeight: 600, color: "var(--bp-ink-primary)" }}>
          Active Waiver
        </span>
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "6px 12px", margin: 0 }}>
        {([
          ["Reason", "Legacy report uses undocumented custom SQL aggregation; exact replication deferred to Phase 2"],
          ["Approver", "S. Nahrup (Data Architecture)"],
          ["Filed", "2026-03-14"],
          ["Checks Waived", "Row count tolerance, Sum Revenue reconciliation"],
        ] as const).map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ fontFamily: "var(--bp-font-body)", fontSize: 12, fontWeight: 600, color: "var(--bp-ink-muted)" }}>{k}</dt>
            <dd style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-primary)", margin: 0 }}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  ),
};

/* ─── Story 10: Recreation Checklist ─── */

const checklistItems = [
  { label: "Source tables mapped to Gold spec", done: true },
  { label: "Column lineage verified", done: true, heuristic: true },
  { label: "Aggregation logic documented", done: true },
  { label: "Filter predicates reconciled", done: false, heuristic: true },
  { label: "Output format validated against legacy report", done: false },
];

export const RecreationChecklist: StoryObj = {
  render: () => (
    <div
      style={{
        background: "var(--bp-surface-1)",
        borderRadius: 8,
        border: "1px solid var(--bp-border)",
        padding: 20,
      }}
    >
      <h3 style={{ ...sectionTitle, marginBottom: 14 }}>Recreation Checklist &mdash; Production Yield Report</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {checklistItems.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            {item.done ? (
              <CheckCircle2 size={16} style={{ color: "var(--bp-operational-green)", flexShrink: 0 }} />
            ) : (
              <Circle size={16} style={{ color: "var(--bp-ink-muted)", flexShrink: 0 }} />
            )}
            <span
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 13,
                color: item.done ? "var(--bp-ink-primary)" : "var(--bp-ink-secondary)",
              }}
            >
              {item.label}
            </span>
            {item.heuristic && (
              <span
                className="inline-flex items-center rounded px-1.5 py-0 text-[10px] font-semibold uppercase"
                style={{
                  color: "var(--bp-caution-amber)",
                  background: "var(--bp-caution-light)",
                  fontFamily: "var(--bp-font-body)",
                  letterSpacing: "0.03em",
                  lineHeight: "18px",
                }}
              >
                Heuristic
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  ),
};
