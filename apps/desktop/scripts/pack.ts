/**
 * Assemble a native installer: rasterize the DeepSeek icon, deploy the CLI
 * runtime beside Electron, then run electron-builder.
 * @module @deepseek-ai/dsh-desktop/scripts/pack
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
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
    destination,
  ]
}

/** Paths the packaged Electron-as-Node host must resolve after deploy. */
export const DESKTOP_RUNTIME_REQUIRED_PATHS = [
  'lib/bin.js',
  'node_modules/@deepseek-ai/dsh-app-boot',
  'node_modules/@deepseek-ai/cordis-plugin-group',
  'node_modules/@deepseek-ai/cosmokit',
] as const

/**
 * Workspace package directories the desktop runtime can copy from this repo.
 * @param repoRoot - monorepo root.
 * @returns package name to source directory.
 */
export function desktopWorkspacePackageIndex(repoRoot: string): Map<string, string> {
  const roots: string[] = []
  for (const vendor of listImmediateDirectories(join(repoRoot, 'vendor'))) roots.push(vendor)
  for (const group of listImmediateDirectories(join(repoRoot, 'packages'))) {
    for (const pkg of listImmediateDirectories(group)) roots.push(pkg)
  }
  for (const app of listImmediateDirectories(join(repoRoot, 'apps'))) roots.push(app)
  roots.push(join(repoRoot, 'native', 'landlock-run'))
  for (const native of listImmediateDirectories(join(repoRoot, 'native', 'landlock-run', 'packages'))) {
    roots.push(native)
  }
  roots.push(join(repoRoot, 'website'), join(repoRoot, 'examples'), join(repoRoot, 'python', 'sdk-runtime'))
  const index = new Map<string, string>()
  for (const root of roots) {
    const manifestPath = join(root, 'package.json')
    if (!existsSync(manifestPath)) continue
    const name = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }).name
    if (name !== undefined && name !== '') index.set(name, root)
  }
  return index
}

/**
 * Copy workspace packages that legacy hoisted deploy or `link:` overrides omit.
 * Walks already-deployed manifests until the workspace dependency set is closed.
 * @param runtimeRoot - `apps/desktop/runtime`.
 * @param repoRoot - monorepo root.
 * @returns package names copied into `node_modules`.
 */
export function restoreDesktopWorkspaceClosure(runtimeRoot: string, repoRoot: string): string[] {
  const index = desktopWorkspacePackageIndex(repoRoot)
  const nodeModules = join(runtimeRoot, 'node_modules')
  const restored: string[] = []
  let changed = true
  while (changed) {
    changed = false
    for (const name of listInstalledPackageNames(nodeModules)) {
      const dest = join(nodeModules, ...name.split('/'))
      const manifestPath = join(dest, 'package.json')
      if (!existsSync(manifestPath)) continue
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as DesktopWorkspaceManifest
      for (const dependency of workspaceRuntimeDependencies(manifest)) {
        const source = index.get(dependency)
        if (source === undefined) continue
        const dependencyDest = join(nodeModules, ...dependency.split('/'))
        if (existsSync(join(dependencyDest, 'package.json'))) continue
        rmSync(dependencyDest, { recursive: true, force: true })
        mkdirSync(dirname(dependencyDest), { recursive: true })
        copyWorkspacePackage(source, dependencyDest)
        restored.push(dependency)
        changed = true
      }
    }
  }
  return restored
}

interface DesktopWorkspaceManifest {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

function workspaceRuntimeDependencies(manifest: DesktopWorkspaceManifest): string[] {
  const names = new Set(Object.keys(manifest.dependencies ?? {}))
  const meta = manifest.peerDependenciesMeta ?? {}
  for (const peer of Object.keys(manifest.peerDependencies ?? {})) {
    if (meta[peer]?.optional === true) continue
    names.add(peer)
  }
  return [...names]
}

/** Built entries Node resolves after deploy; skip source trees and stray links. */
const WORKSPACE_PACKAGE_RUNTIME_ENTRIES = ['package.json', 'lib', 'bin.js', 'bin.mjs', 'index.js'] as const

function copyWorkspacePackage(source: string, destination: string): void {
  mkdirSync(destination, { recursive: true })
  for (const name of WORKSPACE_PACKAGE_RUNTIME_ENTRIES) {
    const from = join(source, name)
    if (!existsSync(from)) continue
    cpSync(from, join(destination, name), { recursive: true, dereference: true })
  }
}

function listImmediateDirectories(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(directory, entry.name))
}

function listInstalledPackageNames(nodeModules: string): string[] {
  if (!existsSync(nodeModules)) return []
  const names: string[] = []
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (entry.name.startsWith('@')) {
      for (const pkg of readdirSync(join(nodeModules, entry.name), { withFileTypes: true })) {
        if (pkg.isDirectory()) names.push(`${entry.name}/${pkg.name}`)
      }
      continue
    }
    names.push(entry.name)
  }
  return names
}

/**
 * Electron binary name inside `electron/dist` for this pack host.
 * @param platform - `process.platform` unless a test names one.
 * @returns the file or app bundle electron-builder renames.
 */
export function desktopElectronDistEntry(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'electron.exe'
  if (platform === 'darwin') return 'Electron.app'
  return 'electron'
}

/**
 * Refuse an unpacked Electron dist that electron-builder cannot rename.
 * @param electronDist - `electron/dist`.
 * @param platform - pack host platform.
 * @returns nothing.
 */
export function assertElectronDist(
  electronDist: string,
  platform: NodeJS.Platform = process.platform,
): void {
  const entry = desktopElectronDistEntry(platform)
  if (!existsSync(join(electronDist, entry))) {
    throw new Error(`desktop:pack: Electron dist is missing ${entry}`)
  }
}

/**
 * Refuse a deploy tree that cannot boot `dsh web`.
 * Workspace links are not enough: electron-builder copies extraResources by
 * value, so a linked `@deepseek-ai/dsh-app-boot` vanishes from the installer.
 * @param runtimeRoot - `apps/desktop/runtime`.
 * @returns nothing.
 */
export function assertDesktopRuntime(runtimeRoot: string): void {
  for (const relative of DESKTOP_RUNTIME_REQUIRED_PATHS) {
    if (!existsSync(join(runtimeRoot, relative))) {
      throw new Error(`desktop:pack: deployed runtime is missing ${relative}`)
    }
  }
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
 * Packaged `extraResources/runtime` path for this Electron platform.
 * electron-builder FileMatcher drops `node_modules` from extraResources, so
 * {@link copyDesktopRuntime} writes this tree in `afterPack`.
 * @param appOutDir - unpacked app directory (`AfterPackContext.appOutDir`).
 * @param electronPlatformName - `win32`, `darwin`, or `linux`.
 * @returns the runtime directory the packaged host resolves.
 */
export function desktopPackagedRuntimeRoot(appOutDir: string, electronPlatformName: string): string {
  const resourcesDir = electronPlatformName === 'darwin'
    ? join(appOutDir, 'Contents', 'Resources')
    : join(appOutDir, 'resources')
  return join(resourcesDir, 'runtime')
}

/**
 * Copy the deployed CLI tree into the unpacked app, dereferencing links.
 * @param runtimeRoot - `apps/desktop/runtime`.
 * @param packagedRuntimeRoot - {@link desktopPackagedRuntimeRoot}.
 * @returns nothing.
 */
export function copyDesktopRuntime(runtimeRoot: string, packagedRuntimeRoot: string): void {
  rmSync(packagedRuntimeRoot, { recursive: true, force: true })
  cpSync(runtimeRoot, packagedRuntimeRoot, { recursive: true, dereference: true })
  assertDesktopRuntime(packagedRuntimeRoot)
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
  const extraResources = []
  if (options.updateFeedPath !== undefined) {
    extraResources.push({ from: options.updateFeedPath, to: 'update-feed.json' })
  }
  return {
    projectDir: options.desktopRoot,
    publish: 'never',
    config: {
      electronDist: options.electronDist,
      extraResources,
      afterPack: async (context) => {
        copyDesktopRuntime(
          options.runtimeRoot,
          desktopPackagedRuntimeRoot(context.appOutDir, context.electronPlatformName),
        )
      },
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
  assertElectronDist(electronDist)
  rmSync(runtimeRoot, { recursive: true, force: true })
  runPnpm(desktopDeployArgs(runtimeRoot), repoRoot)
  restoreDesktopWorkspaceClosure(runtimeRoot, repoRoot)
  assertDesktopRuntime(runtimeRoot)
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
