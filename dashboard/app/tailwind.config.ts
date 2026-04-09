import type { Config } from "tailwindcss";

const config: Config = {
  theme: {
    screens: {
      se: { max: "375px" },
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
    },
  },
};

export default config;
