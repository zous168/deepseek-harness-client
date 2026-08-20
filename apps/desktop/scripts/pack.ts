/**
 * Assemble a native installer: rasterize the DeepSeek icon, deploy the CLI
 * runtime beside Electron, then run electron-builder.
 * @module @deepseek-ai/dsh-desktop/scripts/pack
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type CliOptions } from 'electron-builder'
import {
  desktopUpdateFeedFromIdentity,
  readGitOriginUrl,
  type DesktopUpdateFeed,
} from '../src/update.ts'
import { rasterizeDesktopIcon } from './rasterize-icon.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const runtimeRoot = resolve(desktopRoot, 'runtime')

/** One desktop package.json as pack rewrites it for electron-builder. */
export interface DesktopPackManifest {
  /** Runtime dependencies. Absent when electron was the only entry. */
  dependencies?: Record<string, string>
  /** Pack-time tools plus the Electron binary electron-builder requires here. */
  devDependencies?: Record<string, string>
  [key: string]: unknown
}

/**
 * Repository root that owns the workspace lockfile.
 * @param packageRoot - `apps/desktop`.
 * @returns the monorepo root.
 */
export function desktopRepoRoot(packageRoot: string): string {
  return resolve(packageRoot, '..', '..')
}

/**
 * `pnpm deploy` argv that materializes `@deepseek-ai/dsh` for extraResources.
 * `--legacy` is required on pnpm 10+. `--prod` is omitted because the CLI lists
 * web-host packages as direct devDependencies, and a prod deploy then drops
 * those same packages from the web-app closure the window needs.
 * @param destination - deploy target directory.
 * @returns argv after `pnpm`.
 */
export function desktopDeployArgs(destination: string): string[] {
  return [
    'deploy',
    '--filter',
    '@deepseek-ai/dsh',
    '--legacy',
    '--config.auto-install-peers=false',
    '--config.node-linker=hoisted',
    '--config.link-workspace-packages=true',
    destination,
  ]
}

/**
 * Move `electron` into `devDependencies` so electron-builder accepts the manifest.
 * Checkout `dsh desktop` still resolves Electron from `dependencies`.
 * @param manifest - parsed `apps/desktop/package.json`.
 * @returns a shallow copy safe to write for the builder step.
 */
export function desktopBuilderManifest(manifest: DesktopPackManifest): DesktopPackManifest {
  const electron = manifest.dependencies?.electron
  if (electron === undefined) {
    throw new Error('desktop:pack: apps/desktop/package.json is missing dependencies.electron')
  }
  const dependencies = { ...manifest.dependencies }
  delete dependencies.electron
  const rewritten: DesktopPackManifest = {
    ...manifest,
    devDependencies: { ...manifest.devDependencies, electron },
  }
  if (Object.keys(dependencies).length > 0) rewritten.dependencies = dependencies
  else delete rewritten.dependencies
  return rewritten
}

/**
 * electron-builder options: local Electron dist, no auto-publish, CLI runtime beside the app.
 * @param options - pack layout.
 * @returns the `build()` argument.
 */
export function desktopBuilderOptions(options: {
  /** `apps/desktop`. */
  desktopRoot: string
  /** Deployed `@deepseek-ai/dsh` tree. */
  runtimeRoot: string
  /** Unpacked Electron directory (`electron/dist`). */
  electronDist: string
  /** Pack-time GitHub Releases feed, copied to `extraResources/update-feed.json`. */
  updateFeedPath?: string
}): CliOptions {
  const extraResources = [{ from: options.runtimeRoot, to: 'runtime' }]
  if (options.updateFeedPath !== undefined) {
    extraResources.push({ from: options.updateFeedPath, to: 'update-feed.json' })
  }
  return {
    projectDir: options.desktopRoot,
    publish: 'never',
    config: {
      electronDist: options.electronDist,
      extraResources,
    },
  }
}

/**
 * Persist the GitHub Releases feed beside the desktop package for extraResources.
 * @param path - `apps/desktop/update-feed.json`.
 * @param feed - publishing repository.
 * @returns nothing.
 */
export function writeDesktopUpdateFeedFile(path: string, feed: DesktopUpdateFeed): void {
  writeFileSync(path, `${JSON.stringify(feed, null, 2)}\n`)
}

function runPnpm(args: readonly string[], cwd: string): void {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('desktop:pack: npm_execpath is unavailable; invoke through a package script')
  }
  const result = spawnSync(process.execPath, [packageManager, ...args], { cwd, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
  }
}

/**
 * Rasterize the icon, deploy the CLI runtime, and write the native installer.
 * @returns nothing.
 */
export async function packDesktopInstaller(): Promise<void> {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  const repoRoot = desktopRepoRoot(desktopRoot)
  const electronDist = resolve(
    dirname(createRequire(resolve(desktopRoot, 'package.json')).resolve('electron/package.json')),
    'dist',
  )
  const manifestPath = resolve(desktopRoot, 'package.json')
  const updateFeedPath = resolve(desktopRoot, 'update-feed.json')
  const original = readFileSync(manifestPath, 'utf8')
  const feed = desktopUpdateFeedFromIdentity({
    updateRepo: process.env.DSH_DESKTOP_UPDATE_REPO,
    githubRepository: process.env.GITHUB_REPOSITORY,
    originUrl: readGitOriginUrl(repoRoot),
  })
  await rasterizeDesktopIcon()
  rmSync(runtimeRoot, { recursive: true, force: true })
  runPnpm(desktopDeployArgs(runtimeRoot), repoRoot)
  if (feed !== undefined) writeDesktopUpdateFeedFile(updateFeedPath, feed)
  writeFileSync(manifestPath, `${JSON.stringify(desktopBuilderManifest(JSON.parse(original) as DesktopPackManifest), null, 2)}\n`)
  try {
    await build(desktopBuilderOptions({
      desktopRoot,
      runtimeRoot,
      electronDist,
      ...(feed === undefined ? {} : { updateFeedPath }),
    }))
  } finally {
    writeFileSync(manifestPath, original)
  }
}

if (import.meta.main) {
  await packDesktopInstaller()
}
