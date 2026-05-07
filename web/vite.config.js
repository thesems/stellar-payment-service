import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const backendTarget = "http://localhost:3001";
const webRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  build: {
    outDir: path.resolve(webRoot, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/account": backendTarget,
      "/health": backendTarget,
      "/tx": backendTarget,
      "/swap": backendTarget,
    },
  },
});
