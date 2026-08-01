import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // The service worker is disabled and actively uninstalls itself.
      //
      // It pinned phones to a stale precached bundle: after the first
      // redeploy, iOS kept serving the old app shell and its login request
      // failed before ever reaching the network, so no POST /api/auth/login
      // appeared in the server logs and every subsequent fix was invisible on
      // mobile while desktop (which revalidates far more eagerly) was fine.
      //
      // Offline support has no value for a live-camera viewer, so caching the
      // shell was pure liability. The manifest below still makes the app
      // installable and standalone on iOS, which is the part actually wanted.
      selfDestroying: true,
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
