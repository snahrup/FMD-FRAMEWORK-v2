import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";

function SafeAreaUtilitiesDemo() {
  return (
    <div
      className="min-h-screen bg-[var(--bp-canvas)] text-[var(--bp-ink-primary)]"
      style={
        {
          "--safe-area-inset-top": "28px",
          "--safe-area-inset-right": "16px",
          "--safe-area-inset-bottom": "34px",
          "--safe-area-inset-left": "16px",
        } as CSSProperties
      }
    >
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-between rounded-[32px] border border-[var(--bp-border)] bg-[var(--bp-surface-1)]">
        <header className="pt-safe-top px-safe border-b border-[var(--bp-border)] bg-[var(--bp-copper-soft)]">
          <div className="rounded-b-[24px] bg-[var(--bp-copper-light)] px-4 py-3 text-h3">
            Safe area top and horizontal padding
          </div>
        </header>

        <main className="flex-1 px-safe py-6 text-body">
          <div className="rounded-xl border border-dashed border-[var(--bp-border-strong)] bg-[var(--bp-surface-inset)] p-4">
            This story overrides the safe-area CSS variables so the `pt-safe-top`,
            `px-safe`, and `pb-safe-bottom` utilities render visibly in Storybook.
          </div>
        </main>

        <footer className="px-safe pb-safe-bottom border-t border-[var(--bp-border)] bg-[var(--bp-copper-soft)]">
          <div className="rounded-t-[24px] bg-[var(--bp-copper-light)] px-4 py-3 text-small">
            Safe area bottom padding
          </div>
        </footer>
      </div>
    </div>
  );
}

const meta = {
  title: "Mobile/Safe Area Utilities",
  component: SafeAreaUtilitiesDemo,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof SafeAreaUtilitiesDemo>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Preview: Story = {};
