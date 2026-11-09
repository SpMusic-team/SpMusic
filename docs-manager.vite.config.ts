import path from "node:path"
import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(repositoryRoot, "src"),
    },
  },
  build: {
    outDir: "dist-docs-manager",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(repositoryRoot, "docs-manager.html"),
    },
  },
})
