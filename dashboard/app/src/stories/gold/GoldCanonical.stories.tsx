import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { ProvenanceThread, StatsStrip, SlideOver } from "@/components/gold";

/* ─────────────────────────────────────────────────────────────────────────────
 * GoldCanonical — Visual Reference Stories
 *
 * The Canonical page's sub-components (DomainGrid, RelationshipMap,
 * DefinitionTab, ColumnsTab, etc.) are internal functions that cannot be
 * imported directly. These stories exercise the SHARED components in
 * Canonical-specific configurations and document the design token vocabulary
 * used across the page.
 * ───────────────────────────────────────────────────────────────────────── */

const meta = {
  title: "Gold Studio/Canonical",
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj;

/* ─── Shared badge styles ─── */

const badgeBase: React.CSSProperties = {
  fontFamily: "var(--bp-font-mono)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  padding: "2px 8px",
  borderRadius: 3,
  display: "inline-block",
};

const row: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
};

const label: React.CSSProperties = {
  fontFamily: "var(--bp-font-body)",
  fontSize: 12,
  color: "var(--bp-ink-tertiary)",
  width: 120,
  flexShrink: 0,
};

/* ─── Story 1: Provenance in Canonical Context ─── */

export const ProvenanceInCanonicalContext: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h3
        style={{
          fontFamily: "var(--bp-font-display)",
          fontSize: 16,
          color: "var(--bp-ink-primary)",
          margin: 0,
        }}
      >
        Canonical Provenance Phases (4-7)
      </h3>
      <p
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 13,
          color: "var(--bp-ink-secondary)",
          margin: 0,
        }}
      >
        In the Canonical page, entities progress through phases 4-7. Earlier
        phases (1-3) are completed in Specimen/Cluster stages.
      </p>

      {([4, 5, 6, 7] as const).map((phase) => {
        const labels: Record<number, string> = {
          4: "Phase 4 — Canonicalized: entity promoted from cluster to canonical definition",
          5: "Phase 5 — Gold Drafted: column mappings and transforms specified",
          6: "Phase 6 — Validated: reconciliation checks passed",
          7: "Phase 7 — Cataloged: approved and published to data catalog",
        };
        return (
          <div key={phase} style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <ProvenanceThread phase={phase} size="md" />
            <span
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 12,
                color: "var(--bp-ink-secondary)",
              }}
            >
              {labels[phase]}
            </span>
          </div>
        );
      })}
    </div>
  ),
};

/* ─── Story 2: Entity Type Badges ─── */

const TYPE_BG: Record<string, string> = {
  Fact: "rgba(180,86,36,0.10)",
  Dimension: "rgba(59,130,246,0.10)",
  Bridge: "rgba(139,92,246,0.10)",
  Reference: "rgba(107,114,128,0.10)",
  Aggregate: "rgba(16,185,129,0.10)",
};

const TYPE_FG: Record<string, string> = {
  Fact: "var(--bp-copper)",
  Dimension: "#3b82f6",
  Bridge: "#8b5cf6",
  Reference: "#6b7280",
  Aggregate: "#10b981",
};

export const EntityTypeBadges: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3
        style={{
          fontFamily: "var(--bp-font-display)",
          fontSize: 16,
          color: "var(--bp-ink-primary)",
          margin: 0,
        }}
      >
        Entity Type Badges
      </h3>
      <p
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 13,
          color: "var(--bp-ink-secondary)",
          margin: 0,
        }}
      >
        DomainGrid cards display one of these type badges. Colors match
        GoldCanonical&apos;s internal TYPE_BG map.
      </p>
      <div style={row}>
        {Object.keys(TYPE_BG).map((type) => (
          <span
            key={type}
            style={{
              ...badgeBase,
              background: TYPE_BG[type],
              color: TYPE_FG[type],
            }}
          >
            {type}
          </span>
        ))}
      </div>
    </div>
  ),
};

/* ─── Story 3: Status Badges ─── */

const STATUS_TOKENS: Record<string, { bg: string; fg: string }> = {
  Approved: {
    bg: "rgba(22,163,74,0.10)",
    fg: "var(--bp-operational-green)",
  },
  Draft: {
    bg: "rgba(180,86,36,0.10)",
    fg: "var(--bp-copper)",
  },
  "Pending Steward": {
    bg: "rgba(234,179,8,0.10)",
    fg: "var(--bp-caution-amber)",
  },
  Deprecated: {
    bg: "rgba(107,114,128,0.10)",
    fg: "var(--bp-dismissed)",
  },
};

export const StatusBadges: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3
        style={{
          fontFamily: "var(--bp-font-display)",
          fontSize: 16,
          color: "var(--bp-ink-primary)",
          margin: 0,
        }}
      >
        Status Badges
      </h3>
      <p
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 13,
          color: "var(--bp-ink-secondary)",
          margin: 0,
        }}
      >
        Entity approval status shown on DomainGrid cards and in the
        DetailSlideOver header.
      </p>
      <div style={row}>
        {Object.entries(STATUS_TOKENS).map(([status, { bg, fg }]) => (
          <span key={status} style={{ ...badgeBase, background: bg, color: fg }}>
            {status}
          </span>
        ))}
      </div>
    </div>
  ),
};

/* ─── Story 4: Key Designation Badges ─── */

const KEY_TOKENS: Record<string, { bg: string; fg: string }> = {
  PK: { bg: "rgba(180,86,36,0.10)", fg: "var(--bp-copper)" },
  BK: { bg: "rgba(234,179,8,0.10)", fg: "var(--bp-warm-gold)" },
  FK: { bg: "rgba(59,130,246,0.10)", fg: "#3b82f6" },
  None: { bg: "rgba(107,114,128,0.08)", fg: "var(--bp-ink-muted)" },
};

export const KeyDesignationBadges: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3
        style={{
          fontFamily: "var(--bp-font-display)",
          fontSize: 16,
          color: "var(--bp-ink-primary)",
          margin: 0,
        }}
      >
        Key Designation Badges
      </h3>
      <p
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 13,
          color: "var(--bp-ink-secondary)",
          margin: 0,
        }}
      >
        Displayed in the Columns tab of the DetailSlideOver to indicate column
        key roles.
      </p>
      <div style={row}>
        {Object.entries(KEY_TOKENS).map(([key, { bg, fg }]) => (
          <span key={key} style={{ ...badgeBase, background: bg, color: fg }}>
            {key}
          </span>
        ))}
      </div>
    </div>
  ),
};

/* ─── Story 5: Classification Badges ─── */

const CLASSIFICATION_TOKENS: Record<string, { bg: string; fg: string }> = {
  PII: { bg: "rgba(239,68,68,0.10)", fg: "#ef4444" },
  Confidential: { bg: "rgba(234,179,8,0.10)", fg: "var(--bp-caution-amber)" },
  Internal: { bg: "rgba(59,130,246,0.10)", fg: "#3b82f6" },
  Public: { bg: "rgba(22,163,74,0.10)", fg: "var(--bp-operational-green)" },
};

export const ClassificationBadges: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3
        style={{
          fontFamily: "var(--bp-font-display)",
          fontSize: 16,
          color: "var(--bp-ink-primary)",
          margin: 0,
        }}
      >
        Classification Badges
      </h3>
      <p
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 13,
          color: "var(--bp-ink-secondary)",
          margin: 0,
        }}
      >
        Data sensitivity classification shown in the Columns tab and the
        Classification tab of the DetailSlideOver.
      </p>
      <div style={row}>
        {Object.entries(CLASSIFICATION_TOKENS).map(([cls, { bg, fg }]) => (
          <span key={cls} style={{ ...badgeBase, background: bg, color: fg }}>
            {cls}
          </span>
        ))}
      </div>
    </div>
  ),
};

/* ─── Story 6: StatsStrip in Canonical Context ─── */

export const StatsStripCanonical: Story = {
  render: () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3
        style={{
          fontFamily: "var(--bp-font-display)",
          fontSize: 16,
          color: "var(--bp-ink-primary)",
          margin: 0,
        }}
      >
        Stats Strip — Canonical Page
      </h3>
      <StatsStrip
        items={[
          { label: "Canonical Entities", value: 47 },
          { label: "Dimensions", value: 28 },
          { label: "Facts", value: 12, highlight: true },
          { label: "Bridges", value: 7 },
          { label: "Approved", value: 38 },
          { label: "Draft", value: 6 },
          { label: "Pending Steward", value: 3, highlight: true },
        ]}
      />
    </div>
  ),
};

/* ─── Story 7: SlideOver with Definition-Tab Content ─── */

const DETAIL_TABS = [
  { id: "definition", label: "Definition" },
  { id: "columns", label: "Columns" },
  { id: "lineage", label: "Lineage" },
  { id: "reconciliation", label: "Reconciliation" },
  { id: "classification", label: "Classification" },
  { id: "history", label: "History" },
  { id: "notes", label: "Notes" },
];

export const SlideOverDefinition: Story = {
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 500, position: "relative" }}>
        <Story />
      </div>
    ),
  ],
  render: function SlideOverDefinitionRender() {
    const [activeTab, setActiveTab] = useState("definition");

    return (
      <SlideOver
        open={true}
        onClose={() => console.log("Close")}
        title="CUSTOMERS"
        subtitle="Dimension entity — M3 ERP, MES"
        metadata={
          <div className="flex items-center gap-3">
            <ProvenanceThread phase={6} size="sm" showTooltip />
            <span
              style={{
                ...badgeBase,
                background: TYPE_BG.Dimension,
                color: TYPE_FG.Dimension,
              }}
            >
              Dimension
            </span>
            <span
              style={{
                ...badgeBase,
                background: STATUS_TOKENS.Approved.bg,
                color: STATUS_TOKENS.Approved.fg,
              }}
            >
              Approved
            </span>
          </div>
        }
        tabs={DETAIL_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 13,
                padding: "6px 14px",
                border: "1px solid var(--bp-border)",
                borderRadius: 4,
                background: "transparent",
                color: "var(--bp-ink-secondary)",
                cursor: "pointer",
              }}
            >
              Reject
            </button>
            <button
              type="button"
              style={{
                fontFamily: "var(--bp-font-body)",
                fontSize: 13,
                padding: "6px 14px",
                border: "none",
                borderRadius: 4,
                background: "var(--bp-copper)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              Promote to Catalog
            </button>
          </div>
        }
      >
        {activeTab === "definition" && (
          <div
            style={{
              fontFamily: "var(--bp-font-body)",
              fontSize: 13,
              color: "var(--bp-ink-secondary)",
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div>
              <div style={{ ...label, width: "auto", marginBottom: 4 }}>Business Definition</div>
              <p style={{ margin: 0 }}>
                Canonical customer entity reconciling records from M3 ERP (OCUSMA)
                and MES (Customer) sources. Serves as the single source of truth
                for customer identity across all Gold-layer reporting.
              </p>
            </div>
            <div style={{ display: "flex", gap: 24 }}>
              <div>
                <div style={{ ...label, width: "auto", marginBottom: 4 }}>Source Count</div>
                <span style={{ fontFamily: "var(--bp-font-display)", fontSize: 18, color: "var(--bp-ink-primary)" }}>2</span>
              </div>
              <div>
                <div style={{ ...label, width: "auto", marginBottom: 4 }}>Columns</div>
                <span style={{ fontFamily: "var(--bp-font-display)", fontSize: 18, color: "var(--bp-ink-primary)" }}>34</span>
              </div>
              <div>
                <div style={{ ...label, width: "auto", marginBottom: 4 }}>Rows (est.)</div>
                <span style={{ fontFamily: "var(--bp-font-display)", fontSize: 18, color: "var(--bp-ink-primary)" }}>12,400</span>
              </div>
              <div>
                <div style={{ ...label, width: "auto", marginBottom: 4 }}>Steward</div>
                <span style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-primary)" }}>S. Nahrup</span>
              </div>
            </div>
            <div>
              <div style={{ ...label, width: "auto", marginBottom: 4 }}>Domain</div>
              <span
                style={{
                  ...badgeBase,
                  background: "rgba(180,86,36,0.08)",
                  color: "var(--bp-copper)",
                }}
              >
                Sales &amp; Distribution
              </span>
            </div>
            <div>
              <div style={{ ...label, width: "auto", marginBottom: 4 }}>Grain</div>
              <p style={{ margin: 0 }}>One row per unique customer ID (CustomerNumber)</p>
            </div>
          </div>
        )}
        {activeTab === "columns" && (
          <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            <p>Column list with key designations, types, nullability, and classification badges.</p>
          </div>
        )}
        {activeTab === "lineage" && (
          <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            <p>Lineage graph showing source tables to canonical column mappings.</p>
          </div>
        )}
        {activeTab === "reconciliation" && (
          <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            <p>Column reconciliation matrix: source columns vs. canonical columns with match scores.</p>
          </div>
        )}
        {activeTab === "classification" && (
          <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            <p>Data classification summary: PII fields, sensitivity levels, compliance notes.</p>
          </div>
        )}
        {activeTab === "history" && (
          <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            <p>Change history: schema changes, steward approvals, status transitions.</p>
          </div>
        )}
        {activeTab === "notes" && (
          <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            <p>Steward notes and review comments attached to this canonical entity.</p>
          </div>
        )}
      </SlideOver>
    );
  },
};
