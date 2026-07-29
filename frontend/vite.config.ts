import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-mark.svg"],
      manifest: {
        name: "CCAM",
        short_name: "CCAM",
        description: "Surveillance de caméras Reolink en direct, enregistrements et alertes IA.",
        theme_color: "#111315",
        background_color: "#111315",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-mark.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          {
            src: "/icon-mark.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/recordings": "http://localhost:3000",
      "/live": "http://localhost:1984",
    },
  },
});
