/**
 * Resolve the DeepSeek whale mark used as the packaged window and installer icon.
 * @module @deepseek-ai/dsh-desktop/icon
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This package root: `src/` and `lib/` both sit one level under `apps/desktop`. */
const DESKTOP_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Absolute path of the DeepSeek whale icon for the current artifact layout.
 * Prefers the raster PNG used by electron-builder; falls back to the SVG source
 * when the raster has not been generated yet.
 * @param root - package root, replaceable by tests.
 * @returns an existing icon path.
 */
export function resolveDesktopIcon(root: string = DESKTOP_ROOT): string {
  const png = join(root, 'icons', 'icon.png')
  if (existsSync(png)) return png
  const svg = join(root, 'icons', 'icon.svg')
  if (existsSync(svg)) return svg
  throw new Error(`dsh desktop: missing DeepSeek icon under ${join(root, 'icons')}`)
}
