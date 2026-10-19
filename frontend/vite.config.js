import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three") || id.includes("node_modules/@react-three")) return "three-world";
          if (id.includes("node_modules/framer-motion") || id.includes("node_modules/motion")) return "motion";
          if (id.includes("node_modules/gsap")) return "gsap";
        },
      },
    },
  },
});
