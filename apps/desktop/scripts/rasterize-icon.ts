/**
 * Rasterize the DeepSeek whale SVG to the 512 PNG electron-builder consumes.
 * @module @deepseek-ai/dsh-desktop/scripts/rasterize-icon
 */

import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg, initWasm } from '@resvg/resvg-wasm'

const root = fileURLToPath(new URL('..', import.meta.url))
const svgPath = join(root, 'icons', 'icon.svg')
const pngPath = join(root, 'icons', 'icon.png')

/**
 * Write `icons/icon.png` from the checked-in DeepSeek whale SVG.
 * @returns nothing.
 */
export async function rasterizeDesktopIcon(): Promise<void> {
  const wasmPath = fileURLToPath(new URL('index_bg.wasm', import.meta.resolve('@resvg/resvg-wasm')))
  await initWasm(await readFile(wasmPath))
  const svg = await readFile(svgPath)
  const renderer = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } })
  await writeFile(pngPath, renderer.render().asPng())
}

if (import.meta.main) {
  await rasterizeDesktopIcon()
}
