import type { Meta, StoryObj } from "@storybook/react";
import { StatsStrip } from "@/components/gold/StatsStrip";

const meta = {
  title: "Gold Studio/Stats Strip",
  component: StatsStrip,
  tags: ["autodocs"],
  parameters: { layout: "padded" },
} satisfies Meta<typeof StatsStrip>;

export default meta;
type Story = StoryObj<typeof StatsStrip>;

export const Default: Story = {
  args: {
    items: [
      { label: "Specimens", value: 14 },
      { label: "Tables Extracted", value: 87 },
      { label: "Columns Cataloged", value: "1,240" },
      { label: "Unresolved Clusters", value: 6, highlight: true },
      { label: "Canonical Approved", value: 34 },
      { label: "Gold Specs", value: 22 },
      { label: "Certification Rate", value: "64%" },
    ],
  },
};

export const Loading: Story = {
  args: {
    items: [
      { label: "Specimens", value: "\u2014" },
      { label: "Tables Extracted", value: "\u2014" },
      { label: "Columns Cataloged", value: "\u2014" },
      { label: "Unresolved Clusters", value: "\u2014" },
      { label: "Canonical Approved", value: "\u2014" },
      { label: "Gold Specs", value: "\u2014" },
      { label: "Certification Rate", value: "\u2014" },
    ],
  },
};

export const ClickableStats: Story = {
  args: {
    items: [
      { label: "Specimens", value: 14, onClick: () => console.log("Navigate to specimens") },
      { label: "Unresolved Clusters", value: 6, highlight: true, onClick: () => console.log("Navigate to clusters") },
      { label: "Canonical Approved", value: 34 },
      { label: "Gold Specs", value: 22 },
    ],
  },
};

export const FewItems: Story = {
  args: {
    items: [
      { label: "Specimens", value: 14 },
      { label: "Canonical Approved", value: 34 },
      { label: "Certification Rate", value: "64%" },
    ],
  },
};
