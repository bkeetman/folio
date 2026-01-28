import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "var(--app-bg)",
          surface: "var(--app-surface)",
          panel: "var(--app-panel)",
          ink: "var(--app-ink)",
          inkMuted: "var(--app-ink-muted)",
          border: "var(--app-border)",
          accent: "var(--app-accent)",
          accentStrong: "var(--app-accent-strong)",
        },
      },
      boxShadow: {
        panel: "0 10px 20px rgba(20, 14, 10, 0.08)",
        soft: "0 8px 16px rgba(24, 18, 12, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;
