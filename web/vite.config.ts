/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Tailwind v4 runs through @tailwindcss/vite; an empty object stops vite from discovering a stray postcss.config.js up the tree.
  css: { postcss: {} },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "logo.svg"],
      manifest: {
        name: "Bites",
        short_name: "Bites",
        description: "Point. Snap. Know.",
        theme_color: "#FF5A1F",
        background_color: "#FFFFFF",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: { navigateFallback: "/index.html", runtimeCaching: [] },
    }),
  ],
  server: { proxy: { "/api": "http://localhost:8787" } },
  test: {
    environment: "jsdom",
    setupFiles: ["fake-indexeddb/auto", "@testing-library/jest-dom/vitest"],
  },
});
