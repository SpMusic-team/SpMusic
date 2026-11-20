// Vite config used ONLY by tools/perf-regression harnesses, for the MAIN worktree.
//
// Problems solved here, both found by actually running the harness.
//
// 1) The default repo config cannot start reliably while another agent writes
//    under tools/perf-regression/versions/: Vite 8's watcher walks into those
//    short-lived `.run-version.mjs.*.tmpdir/*.tmp` trees, a locked temp file
//    throws EBUSY, and the dev server dies ~0.5s after reporting "ready".
//    Widening `server.watch.ignored` fixes it.
//
//    MUST be launched with `--configLoader runner`. With the default `bundle`
//    loader Vite first esbuild-bundles THIS FILE into
//    `./.vite.perf.config.mts.<pid>.<uuid>.tmpdir/vite.perf.config.mts.tmp`,
//    and its own watcher then hits EBUSY on that path and kills the server.
//    `runner` processes the config in place and creates no watched temp tree.
//
//    Historical worktrees do NOT need this file: they contain neither
//    tools/perf-regression/ nor src-tauri/target/, so their own checked-in
//    vite.config.ts starts cleanly. The harness prefers a worktree's own config
//    and only falls back to this one for the main worktree.
//
// 2) `root` is the process working directory, never this file's directory, so
//    `--config` can only ever contribute watch exclusions and the alias — never
//    the source root. The harness still verifies independently that the served
//    modules match the worktree's git blobs (lib/verify-origin.mjs).
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Server root is the process working directory: whatever tree we launched in.
const root = process.cwd()

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    // The harness always passes an explicit free port; never silently drift.
    strictPort: true,
    watch: {
      ignored: [
        '**/node_modules_old/**',
        '**/tmp-cover-explore/**',
        '**/src-tauri/target/**',
        // Harness/agent scratch that must never be watched (the EBUSY crashes).
        '**/tools/perf-regression/**',
        '**/.codex-tmp-folder-ui-dist/**',
        '**/*.tmpdir/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },
})