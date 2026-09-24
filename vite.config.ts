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
          // Vite/Rollup internals (lazy-import preloader, CommonJS interop) are
          // shared by every chunk; left alone they land in whichever manual chunk
          // imports them first, which was "three".
          if (id.includes("vite/preload-helper") || id.includes("commonjsHelpers")) return "react";

          if (id.includes("node_modules")) {
            // React gets its own chunk. Without this, Rollup hoisted React into the
            // "three" chunk (three.js depends on it), so every page downloaded the
            // ~1 MB 3D engine just to get React.
            if (/node_modules\/(react|react-dom|scheduler|@babel\/runtime)\//.test(id)) return "react";

            // 1. Isolate the 3D engine; only the quote page (lazy-loaded) uses it.
            if (/node_modules\/(three|@react-three|three-stdlib|troika-[^/]+)\//.test(id)) return "three";
            
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