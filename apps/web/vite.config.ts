import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
export default defineConfig({
  root: path.resolve("apps/web"),
  plugins: [react(), tailwind()],
  build: { outDir: path.resolve("dist/web"), emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000", "/s": "http://localhost:3000" },
  },
});
