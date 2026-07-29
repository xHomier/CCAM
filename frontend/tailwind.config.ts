import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#111315",
        surface: "#1B1E21",
        surface2: "#212427",
        border: "#2A2D31",
        text: "#F2F3F4",
        muted: "#9CA3AF",
        accent: "#FF7A1A",
        "accent-hover": "#FF8F3D",
        "accent-muted": "#3A2716",
        success: "#3DD68C",
        warning: "#F5B94D",
        danger: "#F0554A",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      borderRadius: {
        xl: "0.875rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
