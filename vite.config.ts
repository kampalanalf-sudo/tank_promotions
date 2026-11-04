import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    host: "0.0.0.0",
    allowedHosts: [".e2b.app"],
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: true } },
  },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"], setupFiles: ["tests/setup.ts"], restoreMocks: true },
});
