import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { SlideOver } from "@/components/gold/SlideOver";
import { ProvenanceThread } from "@/components/gold/ProvenanceThread";

const meta = {
  title: "Gold Studio/Slide Over",
  component: SlideOver,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  argTypes: {
    onClose: { action: "onClose" },
    onTabChange: { action: "onTabChange" },
  },
  decorators: [
    (Story) => (
      <div style={{ minHeight: 400, position: "relative" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SlideOver>;

export default meta;
type Story = StoryObj<typeof SlideOver>;

export const Default: Story = {
  args: {
    open: true,
    title: "CUSTOMERS",
    subtitle: "Structural \u00b7 RDL \u00b7 12 entities",
    children: (
      <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)" }}>
        <p>Entity details, column list, lineage graph, and reconciliation data would render here.</p>
      </div>
    ),
  },
};

export const WithMetadata: Story = {
  args: {
    open: true,
    title: "SALES_FACT",
    subtitle: "M3 ERP",
    metadata: (
      <div className="flex items-center gap-3">
        <ProvenanceThread phase={4} size="sm" />
        <span
          style={{
            fontFamily: "var(--bp-font-mono)",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            padding: "2px 8px",
            borderRadius: 3,
            background: "rgba(180,86,36,0.10)",
            color: "var(--bp-copper)",
          }}
        >
          Transactional
        </span>
      </div>
    ),
    children: (
      <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)" }}>
        <p>Canonicalization in progress. 4 of 7 phases complete.</p>
        <p style={{ marginTop: 12 }}>Source columns: 38 &middot; Mapped: 31 &middot; Pending review: 7</p>
      </div>
    ),
  },
};

export const WithTabs: Story = {
  render: function WithTabsRender(args) {
    const [activeTab, setActiveTab] = useState("overview");
    return (
      <div style={{ minHeight: 400, position: "relative" }}>
        <SlideOver
          {...args}
          open={true}
          title="Entity Detail"
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "columns", label: "Columns" },
            { id: "lineage", label: "Lineage" },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onClose={() => console.log("Close")}
        >
          <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)" }}>
            {activeTab === "overview" && <p>Overview: 38 columns, 12,400 rows, last loaded 2h ago.</p>}
            {activeTab === "columns" && <p>Column list with types, nullability, and mapping status.</p>}
            {activeTab === "lineage" && <p>Lineage graph showing source-to-gold transformation chain.</p>}
          </div>
        </SlideOver>
      </div>
    );
  },
};

export const WithFooter: Story = {
  args: {
    open: true,
    title: "CUSTOMERS",
    subtitle: "Ready for approval",
    children: (
      <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)" }}>
        <p>All columns mapped. Validation checks passed. Ready to promote to Gold specification.</p>
      </div>
    ),
    footer: (
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
          Cancel
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
          Approve &amp; Promote
        </button>
      </div>
    ),
  },
};

export const Closed: Story = {
  args: {
    open: false,
    title: "Hidden Panel",
    children: <p>This content should not be visible.</p>,
  },
};
