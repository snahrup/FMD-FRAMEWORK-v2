import type { Preview } from "@storybook/react";
import "../src/index.css";

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: "bp-canvas",
      values: [
        { name: "bp-canvas", value: "#F4F2ED" },
        { name: "bp-surface-1", value: "#FEFDFB" },
        { name: "white", value: "#ffffff" },
      ],
    },
    layout: "padded",
  },
};

export default preview;
