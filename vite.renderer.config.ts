import { defineConfig } from "vite";
import checker from "vite-plugin-checker";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import wgslRollup from "@use-gpu/wgsl-loader/rollup";

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait(),
    react(),
    checker({
      typescript: true,
    }),
    wgslRollup(),
  ],
  optimizeDeps: {
    // Don't try to optimize the native module
    exclude: ["ultralogi-rs"],
  },
  build: {
    rollupOptions: {
      // Mark as external - will be resolved at runtime
      external: ["ultralogi-rs"],
    },
  },
});
