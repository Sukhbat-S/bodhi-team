import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // selfDestroying (2026-06-12): the workbox precache served a STALE bundle
      // across server restarts and hard reloads — on a local single-user app
      // that rebuilds constantly, the SW is pure hazard (it wedged /entities
      // on a mid-wave build for an hour, silently). This mode ships a
      // self-destroying SW that unregisters existing installs on every
      // client, then no-ops. Revisit only if offline support ever matters.
      selfDestroying: true,
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: false, // we use our own public/manifest.json
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg}"],
      },
      devOptions: {
        enabled: false, // only active in production builds
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
