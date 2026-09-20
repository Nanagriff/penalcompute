/**
 * Phase 6: one self-contained HTML file for WhatsApp and USB distribution.
 * Everything inlined, no service worker, feedback UI compiled out.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { BUILD_DATE } from "./vite.config";

export default defineConfig({
  base: "./",
  define: {
    __BUILD_DATE__: JSON.stringify(BUILD_DATE),
    __SINGLE_FILE__: "true",
  },
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: "dist-single",
    target: "es2019",
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    reportCompressedSize: true,
  },
});
