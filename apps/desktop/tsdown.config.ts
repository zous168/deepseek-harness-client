import { defineConfig } from 'tsdown'

/**
 * The desktop shell ships the Electron main process as one ESM entry.
 * Declarations come from `tsc -b` (dts: false), matching apps/cli.
 */
export default defineConfig({
  entry: ['lib/types/main.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  deps: { neverBundle: ['electron'] },
})
