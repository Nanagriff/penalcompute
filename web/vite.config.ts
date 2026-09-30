import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

/** Read the engine's version constants without importing the engine into the build config. */
function engineVersions() {
  const src = readFileSync(new URL("./src/engine/version.ts", import.meta.url), "utf8");
  const pick = (name: string) => src.match(new RegExp(`${name} = "([^"]+)"`))?.[1] ?? "unknown";
  return { engine: pick("ENGINE_VERSION"), ruleset: pick("RULESET_VERSION") };
}

const API = "http://127.0.0.1:8001";
const API_PROXY = { "/feedback": API, "/usage": API, "/admin": API };

export const BUILD_DATE = new Date().toISOString().slice(0, 19) + "Z";

/** Emit /version.json at build so the app can tell when its cached build is behind (Task 3.5). */
export function versionJson(): Plugin {
  return {
    name: "version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ ...engineVersions(), buildDate: BUILD_DATE }, null, 2) + "\n",
      });
    },
  };
}

export default defineConfig({
  base: "/",
  define: {
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    __SINGLE_FILE__: "false",
  },
  plugins: [
    react(),
    versionJson(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "robots.txt", "icon.svg", "apple-touch-icon.png",
        "icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png",
      ],
      manifest: {
        id: "/",
        name: "Sentence Computation",
        short_name: "Computation",
        description: "Ghana Prisons Service sentence computation register.",
        lang: "en",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f3ece1",
        theme_color: "#4a2c17",
        // Android wants 192 and 512 in both purposes; "maskable" keeps the crest
        // inside the safe zone when the launcher crops to a circle.
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        globIgnores: ["version.json"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/feedback/, /^\/usage/, /^\/admin/, /^\/version\.json/],
        runtimeCaching: [
          { urlPattern: /\/version\.json$/, handler: "NetworkOnly" },
        ],
      },
    }),
  ],
  build: {
    target: "es2019",
    sourcemap: false,
  },
  // local development and preview only: nginx does this in production
  server: { proxy: API_PROXY },
  preview: { proxy: API_PROXY, port: 4173, strictPort: true },
});
