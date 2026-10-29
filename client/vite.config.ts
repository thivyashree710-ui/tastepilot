import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ root: __dirname, plugins: [react()], server: { proxy: { "/api": "http://localhost:8787" } }, build: { outDir: "dist" } });
