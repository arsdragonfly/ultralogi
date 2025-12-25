import { defineConfig } from "vite";

// https://vitejs.dev/config
export default defineConfig({
  optimizeDeps: {
    exclude: ["ultralogi-rs"],
  },
  build: {
    rollupOptions: {
      external: ["ultralogi-rs"],
    },
  },
});
