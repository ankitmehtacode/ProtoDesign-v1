import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 8080,
      proxy: {
          '/api': {
              target: 'http://localhost:3001',
              changeOrigin: true,
          }
      }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            // 1. Isolate the massive 3D engine strictly by itself
            if (id.includes("three")) return "three";
            
            // 2. Isolate the animation engines strictly by themselves
            if (id.includes("framer-motion")) return "framer-motion";
            if (id.includes("gsap")) return "gsap";
            
            // By dropping the "vendor-ui" and "vendor-react" grouping, 
            // we eliminate the circular loop completely. Vite handles the rest.
          }
        },
      },
    },
    // 3D apps are naturally large, this safely raises the warning ceiling
    chunkSizeWarningLimit: 1500, 
  },
});