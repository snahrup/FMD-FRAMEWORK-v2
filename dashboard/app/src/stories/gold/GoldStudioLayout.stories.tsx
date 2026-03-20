import type { Meta, StoryObj } from "@storybook/react";
import { MemoryRouter } from "react-router-dom";
import { GoldStudioLayout } from "@/components/gold/GoldStudioLayout";

const meta = {
  title: "Gold Studio/Layout Shell",
  component: GoldStudioLayout,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={["/gold/ledger"]}>
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof GoldStudioLayout>;

export default meta;
type Story = StoryObj<typeof GoldStudioLayout>;

export const Default: Story = {
  args: {
    activeTab: "ledger",
    children: (
      <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)", padding: "24px 0" }}>
        <p>Gold Ledger page content renders here. The layout provides the GOLD STUDIO header, domain selector, and tab navigation.</p>
        <p style={{ marginTop: 12, color: "var(--bp-ink-muted)", fontSize: 12 }}>
          Domain data loads from /api/gold-studio/domains. Without a running backend, the domain selector is hidden gracefully.
        </p>
      </div>
    ),
  },
};

export const WithActions: Story = {
  args: {
    activeTab: "ledger",
    actions: (
      <button
        type="button"
        style={{
          fontFamily: "var(--bp-font-body)",
          fontSize: 13,
          padding: "6px 14px",
          border: "1px solid var(--bp-border)",
          borderRadius: 4,
          background: "var(--bp-surface-1)",
          color: "var(--bp-ink-primary)",
          cursor: "pointer",
        }}
      >
        Import Specimens
      </button>
    ),
    children: (
      <div style={{ fontFamily: "var(--bp-font-body)", fontSize: 13, color: "var(--bp-ink-secondary)", padding: "24px 0" }}>
        <p>Ledger content with an Import action button in the header area.</p>
      </div>
    ),
  },
};
