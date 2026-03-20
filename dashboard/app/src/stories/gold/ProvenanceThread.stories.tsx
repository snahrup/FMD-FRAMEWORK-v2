import type { Meta, StoryObj } from "@storybook/react";
import { ProvenanceThread } from "@/components/gold/ProvenanceThread";

const meta = {
  title: "Gold Studio/Provenance Thread",
  component: ProvenanceThread,
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta<typeof ProvenanceThread>;

export default meta;
type Story = StoryObj<typeof ProvenanceThread>;

/* ─── Medium size — one story per phase ─── */

export const Imported: Story = {
  args: { phase: 1, size: "md" },
};

export const Extracted: Story = {
  args: { phase: 2, size: "md" },
};

export const Clustered: Story = {
  args: { phase: 3, size: "md" },
};

export const Canonicalized: Story = {
  args: { phase: 4, size: "md" },
};

export const GoldDrafted: Story = {
  args: { phase: 5, size: "md" },
};

export const Validated: Story = {
  args: { phase: 6, size: "md" },
};

export const Cataloged: Story = {
  args: { phase: 7, size: "md" },
};

/* ─── Small size ─── */

export const SmallDefault: Story = {
  args: { phase: 3, size: "sm" },
};

export const SmallWithTooltip: Story = {
  args: { phase: 3, size: "sm", showTooltip: true },
};

/* ─── Structural ─── */

export const StructuralFullLifecycle: Story = {
  args: { phase: 7, size: "md" },
};
