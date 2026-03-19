import type { Meta, StoryObj } from "@storybook/react";
import { GoldLoading, GoldEmpty, GoldError, GoldNoResults } from "@/components/gold/GoldStates";

const meta = {
  title: "Gold Studio/Shared States",
  tags: ["autodocs"],
  parameters: { layout: "centered" },
} satisfies Meta;

export default meta;

/* ─── GoldLoading ─── */

export const Loading: StoryObj = {
  render: () => <GoldLoading rows={4} label="Loading specimens" />,
};

export const LoadingMinimal: StoryObj = {
  render: () => <GoldLoading rows={2} />,
};

/* ─── GoldEmpty ─── */

export const Empty: StoryObj = {
  render: () => (
    <GoldEmpty
      noun="specimens"
      action={{ label: "Import specimens", onClick: () => console.log("Import clicked") }}
    />
  ),
};

export const EmptyNoAction: StoryObj = {
  render: () => <GoldEmpty noun="clusters" />,
};

/* ─── GoldError ─── */

export const Error: StoryObj = {
  render: () => (
    <GoldError
      message="Failed to load data"
      onRetry={() => console.log("Retry clicked")}
    />
  ),
};

export const ErrorMinimal: StoryObj = {
  render: () => <GoldError />,
};

/* ─── GoldNoResults ─── */

export const NoResults: StoryObj = {
  render: () => <GoldNoResults query="SALES_FACT" />,
};

export const NoResultsGeneric: StoryObj = {
  render: () => <GoldNoResults />,
};
