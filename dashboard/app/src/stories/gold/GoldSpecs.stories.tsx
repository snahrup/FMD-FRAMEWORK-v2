import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ProvenanceThread, StatsStrip } from "@/components/gold";

/* ─────────────────────────────────────────────────────────────────────────────
 * GoldSpecs — Visual Reference Stories
 *
 * The GoldSpecs page is a full page component with internal sub-components
 * (OverviewTab, SqlTab, ColumnsTab, etc.) that cannot be imported directly.
 * These stories exercise the KEY SUB-PATTERNS in isolation: spec row cards,
 * validation badges, type badges, detail tab layouts, and empty/loading states.
 * ───────────────────────────────────────────────────────────────────────── */

const meta = {
  title: "Gold Studio/Specs",
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj;

/* ─── shared style helpers (mirrors GoldSpecs.tsx internals) ─── */

const mono = { fontFamily: "var(--bp-font-mono)", fontSize: 11 } as const;
const body = (sz: number) => ({ fontFamily: "var(--bp-font-body)", fontSize: sz } as const);
const display = (sz: number) => ({ fontFamily: "var(--bp-font-display)", fontSize: sz } as const);

const badgeBase: React.CSSProperties = {
  fontFamily: "var(--bp-font-mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "2px 8px",
  borderRadius: 3,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

const STATUS_RAIL: Record<string, string> = {
  validated: "var(--bp-operational-green)",
  draft: "var(--bp-copper)",
  needs_revalidation: "var(--bp-caution-amber)",
  failed: "var(--bp-fault-red)",
  deprecated: "var(--bp-ink-muted)",
};

const VALIDATION_BADGE: Record<string, { label: string; bg: string; color: string; icon: string }> = {
  pass:               { label: "Pass",         bg: "rgba(61,124,79,0.12)",  color: "var(--bp-operational-green)", icon: "\u2713" },
  pending:            { label: "Pending",      bg: "rgba(194,122,26,0.12)", color: "var(--bp-caution-amber)",     icon: "\u25CC" },
  failed:             { label: "Failed",       bg: "rgba(185,58,42,0.12)",  color: "var(--bp-fault-red)",         icon: "\u2717" },
  needs_revalidation: { label: "Needs Reval.", bg: "rgba(180,86,36,0.12)",  color: "var(--bp-copper)",            icon: "\u21BB" },
};

/* ─── mock data ─── */

const MOCK_SPECS: Array<{
  id: number; name: string; type: string; domain: string; source_count: number;
  validation_status: string; status: string; phase: 1|2|3|4|5|6|7;
  version: number; column_count: number; refresh_strategy: string;
}> = [
  { id: 1, name: "DIM_Customer_Master", type: "MLV", domain: "Sales & Distribution", source_count: 2, validation_status: "pass", status: "validated", phase: 7, version: 3, column_count: 34, refresh_strategy: "Incremental" },
  { id: 2, name: "FACT_Production_Yield", type: "MLV", domain: "Production", source_count: 3, validation_status: "pending", status: "draft", phase: 5, version: 1, column_count: 48, refresh_strategy: "Full" },
  { id: 3, name: "DIM_Item_Master", type: "View", domain: "Supply Chain", source_count: 2, validation_status: "needs_revalidation", status: "needs_revalidation", phase: 6, version: 4, column_count: 67, refresh_strategy: "Hybrid" },
  { id: 4, name: "FACT_QC_Inspection_Results", type: "MLV", domain: "Quality", source_count: 1, validation_status: "failed", status: "failed", phase: 4, version: 2, column_count: 22, refresh_strategy: "Full" },
  { id: 5, name: "DIM_Supplier_Legacy", type: "Snapshot", domain: "Finance", source_count: 1, validation_status: "pending", status: "deprecated", phase: 3, version: 8, column_count: 19, refresh_strategy: "Full" },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * Story 1: SpecRowStates — 5 spec cards demonstrating all status rails
 * ═══════════════════════════════════════════════════════════════════════ */

export const SpecRowStates: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ ...display(16), color: "var(--bp-ink-primary)", margin: 0 }}>
        Spec Row Cards — All Status Rails
      </h3>
      <p style={{ ...body(13), color: "var(--bp-ink-secondary)", margin: 0 }}>
        Each card shows a 3px left rail colored by spec status: validated (green),
        draft (copper), needs revalidation (amber), failed (red), deprecated (muted).
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {MOCK_SPECS.map((s) => {
          const badge = VALIDATION_BADGE[s.validation_status] ?? VALIDATION_BADGE.pending;
          return (
            <button
              key={s.id}
              type="button"
              className="w-full text-left flex items-center rounded-lg transition-colors hover:bg-black/[0.03] relative overflow-hidden"
              style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", cursor: "pointer" }}
            >
              {/* status rail */}
              <span
                className="absolute left-0 top-0 bottom-0 rounded-l-lg"
                style={{ width: 3, background: STATUS_RAIL[s.status] ?? "var(--bp-ink-muted)" }}
              />
              <div className="flex-1 min-w-0 pl-4 pr-3 py-2.5">
                {/* line 1 */}
                <div className="flex items-center gap-3">
                  <span className="truncate" style={{ ...display(14) }}>{s.name}</span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5"
                    style={{ ...mono, background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}
                  >
                    {s.type}
                  </span>
                  <span className="shrink-0" style={{ ...body(12), color: "var(--bp-ink-secondary)" }}>{s.domain}</span>
                  <span className="shrink-0" style={{ ...body(12), color: "var(--bp-ink-muted)" }}>
                    {s.source_count} source{s.source_count !== 1 ? "s" : ""}
                  </span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 inline-flex items-center gap-1"
                    style={{ fontSize: 11, fontFamily: "var(--bp-font-body)", background: badge.bg, color: badge.color }}
                  >
                    <span className={s.validation_status === "needs_revalidation" ? "needs-reval-spin" : ""}>{badge.icon}</span> {badge.label}
                  </span>
                  <div className="shrink-0 ml-auto"><ProvenanceThread phase={s.phase} size="sm" /></div>
                </div>
                {/* line 2 */}
                <div className="flex items-center gap-4 mt-0.5" style={{ ...mono, color: "var(--bp-ink-muted)" }}>
                  <span>v{s.version}</span>
                  <span>{s.column_count} cols</span>
                  <span>{s.refresh_strategy}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <style>{`
        @keyframes reval-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .needs-reval-spin { display: inline-block; animation: reval-spin 2s linear infinite; }
      `}</style>
    </div>
  ),
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Story 2: ValidationBadges — All 4 validation states inline
 * ═══════════════════════════════════════════════════════════════════════ */

export const ValidationBadges: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ ...display(16), color: "var(--bp-ink-primary)", margin: 0 }}>Validation Badges</h3>
      <p style={{ ...body(13), color: "var(--bp-ink-secondary)", margin: 0 }}>
        Shown on each spec row card and in the Overview tab detail.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {Object.entries(VALIDATION_BADGE).map(([key, b]) => (
          <span
            key={key}
            style={{ ...badgeBase, background: b.bg, color: b.color }}
          >
            <span className={key === "needs_revalidation" ? "needs-reval-spin" : ""}>{b.icon}</span> {b.label}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes reval-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .needs-reval-spin { display: inline-block; animation: reval-spin 2s linear infinite; }
      `}</style>
    </div>
  ),
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Story 3: TypeBadges — MLV, View, Aggregate, Snapshot
 * ═══════════════════════════════════════════════════════════════════════ */

export const TypeBadges: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ ...display(16), color: "var(--bp-ink-primary)", margin: 0 }}>Type Badges</h3>
      <p style={{ ...body(13), color: "var(--bp-ink-secondary)", margin: 0 }}>
        Spec object type shown inline on each row card. Copper mono badge.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        {["MLV", "View", "Aggregate", "Snapshot"].map((t) => (
          <span
            key={t}
            style={{ ...badgeBase, background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  ),
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Story 4: SpecDetailOverview — Mock Overview tab layout
 * ═══════════════════════════════════════════════════════════════════════ */

const LabelEl = ({ children }: { children: string }) => (
  <span style={{ ...body(11), color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{children}</span>
);

const FieldEl = ({ label, value, useMono }: { label: string; value: string; useMono?: boolean }) => (
  <div>
    <LabelEl>{label}</LabelEl>
    <p style={{ marginTop: 2, ...(useMono ? { ...mono, color: "var(--bp-ink-primary)" } : { ...body(13), color: "var(--bp-ink-primary)" }) }}>
      {value}
    </p>
  </div>
);

export const SpecDetailOverview: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ ...display(16), color: "var(--bp-ink-primary)", margin: 0 }}>Overview Tab — Detail Panel</h3>
      <div
        className="rounded-lg"
        style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", padding: 20, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <FieldEl label="Target" value="GOLD_DIM_Customer_Master" />
        <FieldEl label="Object Type" value="Materialized Lake View" />
        <FieldEl
          label="Description"
          value="Canonical customer dimension reconciling OCUSMA (M3 ERP) and Customer (MES) into a single SCD Type-2 entity for all Gold-layer reporting."
        />
        <FieldEl label="Grain" value="One row per CustomerNumber + effective date range" />
        <FieldEl label="Primary Keys" value="CustomerNumber, EffectiveFrom" useMono />
        <div>
          <LabelEl>Source Canonical</LabelEl>
          <span
            className="mt-1 rounded px-2 py-0.5 inline-block"
            style={{ ...body(12), background: "var(--bp-surface-inset)", border: "1px solid var(--bp-border)", color: "var(--bp-ink-secondary)" }}
          >
            CUSTOMERS (canonical)
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LabelEl>Refresh</LabelEl>
          <span style={{ ...badgeBase, background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>Incremental</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LabelEl>Validation</LabelEl>
          <span style={{ ...badgeBase, background: VALIDATION_BADGE.pass.bg, color: VALIDATION_BADGE.pass.color }}>
            {VALIDATION_BADGE.pass.icon} {VALIDATION_BADGE.pass.label}
          </span>
          <span style={{ ...body(12), color: "var(--bp-ink-muted)" }}>Last run 2026-03-18T14:22:00Z</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LabelEl>Version</LabelEl>
          <span style={{ ...mono, color: "var(--bp-ink-primary)" }}>v3</span>
        </div>
      </div>
    </div>
  ),
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Story 5: SqlTabDarkTheme — SQL code block with dark theme
 * ═══════════════════════════════════════════════════════════════════════ */

const SAMPLE_SQL = `SELECT
    c.CustomerNumber,
    c.CustomerName,
    c.Country,
    c.SalesRegion,
    m.LastShipDate,
    m.TotalOrders,
    COALESCE(c.CreditLimit, 0) AS CreditLimit,
    CASE WHEN m.LastShipDate > DATEADD(month, -6, GETDATE())
         THEN 'Active' ELSE 'Dormant' END AS ActivityStatus
FROM Silver.OCUSMA c
LEFT JOIN Silver.MES_Customer m
    ON c.CustomerNumber = m.CustNo
WHERE c.IsDeleted = 0
ORDER BY c.CustomerNumber`;

export const SqlTabDarkTheme: Story = {
  render: function SqlRender() {
    const [copied, setCopied] = useState(false);
    const lines = SAMPLE_SQL.split("\n");
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ ...display(16), color: "var(--bp-ink-primary)", margin: 0 }}>SQL Tab — Dark Code Block</h3>
        <div className="relative rounded-lg overflow-hidden" style={{ background: "#2B2A27" }}>
          <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
            <button
              type="button"
              className="rounded px-1.5 py-1 text-xs transition-colors hover:bg-white/10"
              style={{ color: "#E8E6E3" }}
              onClick={() => { navigator.clipboard.writeText(SAMPLE_SQL); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre
            className="overflow-auto p-4 pr-20"
            style={{ fontFamily: "var(--bp-font-mono)", fontSize: 13, color: "#E8E6E3", lineHeight: 1.6, maxHeight: 480 }}
          >
            {lines.map((l, i) => (
              <div key={i} className="flex">
                <span className="select-none w-8 shrink-0 text-right mr-4" style={{ color: "rgba(232,230,227,0.3)" }}>{i + 1}</span>
                <span>{l}</span>
              </div>
            ))}
          </pre>
        </div>
      </div>
    );
  },
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Story 6: ColumnsTable — 8 columns with PK/BK/FK, included/excluded
 * ═══════════════════════════════════════════════════════════════════════ */

const MOCK_COLUMNS: Array<{
  name: string; target_name: string; data_type: string;
  key_type?: "PK" | "BK" | "FK"; source_expression: string;
  included: boolean; exclude_reason?: string;
}> = [
  { name: "CustomerNumber",   target_name: "CustomerNumber",   data_type: "nvarchar(20)",  key_type: "PK", source_expression: "c.OKCUNO",        included: true },
  { name: "EffectiveFrom",    target_name: "EffectiveFrom",    data_type: "datetime2",     key_type: "PK", source_expression: "c.OKRGDT",        included: true },
  { name: "CustomerName",     target_name: "CustomerName",     data_type: "nvarchar(100)", key_type: "BK", source_expression: "c.OKCUNM",        included: true },
  { name: "SalesRegion",      target_name: "SalesRegion",      data_type: "nvarchar(10)",              source_expression: "c.OKSREG",        included: true },
  { name: "CreditLimit",      target_name: "CreditLimit",      data_type: "decimal(15,2)",             source_expression: "COALESCE(c.OKCRLM, 0)", included: true },
  { name: "ItemGroup",        target_name: "ItemGroup",        data_type: "nvarchar(15)",  key_type: "FK", source_expression: "c.OKITGR",        included: true },
  { name: "InternalFlag",     target_name: "InternalFlag",     data_type: "bit",                       source_expression: "c.OKSTAT",        included: false, exclude_reason: "Internal system flag, no business value" },
  { name: "LegacyRowVersion", target_name: "LegacyRowVersion", data_type: "timestamp",                 source_expression: "c.ROWVERSION",    included: false, exclude_reason: "Watermark column, excluded from Gold" },
];

export const ColumnsTable: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ ...display(16), color: "var(--bp-ink-primary)", margin: 0 }}>Columns Tab — Key Types & Include/Exclude</h3>
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--bp-border)" }}>
        <table className="w-full text-left" style={{ ...body(12) }}>
          <thead>
            <tr style={{ color: "var(--bp-ink-muted)", background: "var(--bp-surface-inset)", borderBottom: "1px solid var(--bp-border)" }}>
              {["Column", "Target", "Type", "Key", "Source Expression", ""].map((h) => (
                <th key={h} className="pb-2 pt-2 px-3 font-medium" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_COLUMNS.map((c) => (
              <tr key={c.name} className={c.included ? "" : "opacity-50"} style={{ borderBottom: "1px solid var(--bp-border)" }}>
                <td className="py-2 px-3" style={{ ...mono, textDecoration: c.included ? "none" : "line-through" }} title={c.exclude_reason}>{c.name}</td>
                <td className="py-2 px-3" style={mono}>{c.target_name}</td>
                <td className="py-2 px-3" style={mono}>{c.data_type}</td>
                <td className="py-2 px-3">
                  {c.key_type && (
                    <span className="rounded px-1 py-0.5" style={{ ...mono, background: "rgba(180,86,36,0.08)", color: "var(--bp-copper)" }}>{c.key_type}</span>
                  )}
                </td>
                <td className="py-2 px-3" style={{ ...mono, color: "var(--bp-ink-secondary)" }}>{c.source_expression}</td>
                <td className="py-2 px-3">
                  {c.included
                    ? <span className="rounded px-1.5 py-0.5" style={{ fontSize: 10, background: "rgba(61,124,79,0.10)", color: "var(--bp-operational-green)" }}>Included</span>
                    : <span className="rounded px-1.5 py-0.5" style={{ fontSize: 10, background: "rgba(185,58,42,0.08)", color: "var(--bp-fault-red)" }} title={c.exclude_reason}>Excluded</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  ),
};

/* ═══════════════════════════════════════════════════════════════════════════
 * Story 7: EmptyAndLoadingStates — Spinner + no-results
 * ═══════════════════════════════════════════════════════════════════════ */

export const EmptyAndLoadingStates: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      <h3 style={{ ...display(16), color: "var(--bp-ink-primary)", margin: 0 }}>Empty & Loading States</h3>

      {/* Loading */}
      <div className="rounded-lg" style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", padding: 24 }}>
        <p style={{ ...body(11), color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 12 }}>Loading State</p>
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div
            className="gold-specs-spinner"
            style={{
              width: 28,
              height: 28,
              border: "2.5px solid var(--bp-border)",
              borderTopColor: "var(--bp-copper)",
              borderRadius: "50%",
              margin: "0 auto 12px",
            }}
          />
          <p style={{ ...body(14), color: "var(--bp-ink-muted)", margin: 0 }}>Loading specs...</p>
        </div>
      </div>

      {/* No results */}
      <div className="rounded-lg" style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", padding: 24 }}>
        <p style={{ ...body(11), color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 12 }}>No Results State</p>
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <p style={{ ...body(14), color: "var(--bp-ink-muted)", margin: 0 }}>No specs match your filters.</p>
        </div>
      </div>

      {/* Empty — zero specs */}
      <div className="rounded-lg" style={{ background: "var(--bp-surface-1)", border: "1px solid var(--bp-border)", padding: 24 }}>
        <p style={{ ...body(11), color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 12 }}>Empty State (No Specs)</p>
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div style={{ fontSize: 32, marginBottom: 8, color: "var(--bp-ink-muted)", opacity: 0.4 }}>&#9670;</div>
          <p style={{ ...display(15), color: "var(--bp-ink-secondary)", margin: "0 0 4px" }}>No Gold Specs Yet</p>
          <p style={{ ...body(13), color: "var(--bp-ink-muted)", margin: 0 }}>
            Create your first spec from a canonical entity in the Canonical page.
          </p>
        </div>
      </div>

      {/* Stats strip at zero */}
      <div>
        <p style={{ ...body(11), color: "var(--bp-ink-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Stats Strip — Zero State</p>
        <StatsStrip items={[
          { label: "Gold Specs", value: 0 },
          { label: "Ready to Deploy", value: 0 },
          { label: "Pending Validation", value: 0 },
          { label: "Needs Revalidation", value: 0 },
          { label: "Deprecated", value: 0 },
        ]} />
      </div>

      <style>{`
        @keyframes gold-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .gold-specs-spinner { animation: gold-spin 0.8s linear infinite; }
      `}</style>
    </div>
  ),
};
