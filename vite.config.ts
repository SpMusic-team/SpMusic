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
      // Exclude stale dependencies, scratch files, and Rust build output.
      // Watching target/debug while Cargo links app_lib.dll can make chokidar
      // throw EBUSY and stop the dev server mid-session.
      ignored: ['**/node_modules_old/**', '**/tmp-cover-explore/**', '**/src-tauri/target/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
