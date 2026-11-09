import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src-tauri/target']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  // The measurement harness under tools/ is plain ESM (.mjs). The TypeScript
  // block above matches only **/*.{ts,tsx}, so without this entry the whole
  // directory was silently unlinted: `npx eslint tools/...` exited 0 while
  // inspecting zero files.
  //
  // Scoped to the coverlane harness on purpose. The author's older scripts in
  // this directory (prepare*.mjs, ui-pairs.mjs, visible-pairs.mjs, ...) embed
  // browser-context code inside template literals, so `no-undef` reports
  // window/document there as errors; adopting them wholesale is a separate
  // cleanup that should not ride along with the cover-lane work.
  {
    files: ['tools/thumbnail-benchmark/coverlane-*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
])
