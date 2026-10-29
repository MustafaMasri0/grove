import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Tauri expects a fixed dev port and no browser auto-open.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    // monaco-editor's "exports" map appends .js to every subpath, which breaks
    // CSS imports; point straight at its ESM tree instead.
    alias: { "monaco-esm": fileURLToPath(new URL("./node_modules/monaco-editor/esm/vs", import.meta.url)) },
  },
  // The dev optimizer pre-bundles `?worker` imports without their default export.
  optimizeDeps: { exclude: ["monaco-esm/editor/editor.worker.js", "monaco-esm/editor/editor.worker.js?worker"] },
  server: { port: 1420, strictPort: true },
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 4000,
    // File icons stay separate files, fetched only when shown, instead of
    // hundreds of data URLs held in the bundle.
    assetsInlineLimit: (file: string) => (file.replace(/\\/g, "/").includes("/assets/charmed/") ? false : undefined),
  },
  test: { environment: "node" },
});
