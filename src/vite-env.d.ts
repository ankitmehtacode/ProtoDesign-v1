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
    // Preserving your proxy for the backend
    proxy: {
      '/api': {
        target: 'http://localhost:3001', // Check if your backend runs on 3001 or 3000
        changeOrigin: true,
        secure: false,
      }
    }
  },
  build: {
    // 1. Minification: 'terser' is slightly smaller than 'esbuild', but 'esbuild' is 100x faster.
    // We stick to 'esbuild' for robustness and speed, but enable all optimizations.
    minify: 'esbuild',
    cssCodeSplit: true, // Keep CSS separate for better caching
    
    // 2. Chunking Strategy (The "Secret Sauce")
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes("node_modules")) {
            
            // A. CORE REACT (Critical Path)
            // These must load ASAP for the app to boot.
            if (
              id.includes("react") ||
              id.includes("react-dom") ||
              id.includes("react-router-dom")
            ) {
              return "vendor-react";
            }

            // B. ANIMATIONS (Heavy Lifters)
            // We bundle these together so they can be cached separately.
            // If you change your UI but not animations, users don't redownload this 100KB+.
            if (
              id.includes("framer-motion") ||
              id.includes("gsap") ||
              id.includes("@studio-freight/lenis")
            ) {
              return "vendor-animations";
            }

            // C. UI COMPONENTS (Shadcn/Radix)
            // These are small but numerous. Grouping them helps browser request limits.
            if (
              id.includes("@radix-ui") ||
              id.includes("lucide-react") ||
              id.includes("clsx") ||
              id.includes("tailwind-merge")
            ) {
              return "vendor-ui";
            }

            // D. EVERYTHING ELSE
            return "vendor-utils";
          }
        },
      },
    },
    
    // 3. Performance warnings
    chunkSizeWarningLimit: 1000, // Increased from 500kb since we know we have heavy 3D assets
  },
});