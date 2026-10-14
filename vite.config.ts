import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      input: {
        app: path.resolve(__dirname, './index.html'),
        demoPlayer: path.resolve(__dirname, './demo-player.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Two directories inside the repo must never be watched: the stale
      // `node_modules_old/` tree (not matched by Vite's default
      // `**/node_modules/**` ignore, tens of thousands of files) and the local
      // scratch folder. Editors and tools publish files through short-lived
      // temp dirs, and watching them makes chokidar throw EBUSY, which kills
      // the dev server mid-session.
      ignored: ['**/node_modules_old/**', '**/tmp-cover-explore/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
