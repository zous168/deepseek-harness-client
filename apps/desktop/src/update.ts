/**
 * Detect a newer packaged desktop release from GitHub Releases.
 * The check never throws to the boot path: a missing feed, a failed fetch, or
 * an equal version leaves the running window unchanged.
 * @module @deepseek-ai/dsh-desktop/update
 */

import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web'

/** Publishing repository whose GitHub Releases the window consults. */
export interface DesktopUpdateFeed {
  /** GitHub owner. */
  readonly owner: string
  /** Repository name. */
  readonly repo: string
}

/** One newer installer the user can authorize after a silent download. */
export interface DesktopUpdate {
  /** Semver from the release tag, without a `v` / `dsh-v` / `desktop-v` prefix. */
  readonly version: string
  /** Browser URL of that GitHub Release. */
  readonly url: string
  /** Release assets; the Windows NSIS `.exe` is selected at download time. */
  readonly assets: readonly DesktopGithubReleaseAsset[]
}

/** One GitHub Release asset the downloader may fetch. */
export interface DesktopGithubReleaseAsset {
  /** File name on the Release, such as `DeepSeek Harness-0.1.0-rc.9-win-x64.exe`. */
  readonly name: string
  /** HTTPS browser download URL. */
  readonly browser_download_url: string
  /** Declared byte length, when GitHub provided it. */
  readonly size?: number
}

/** One GitHub Releases list row the checker reads. */
export interface DesktopGithubRelease {
  /** Tag such as `desktop-v0.1.0-rc.8`. */
  readonly tag_name: string
  /** Browser URL. */
  readonly html_url: string
  /** True when the release is unpublished. */
  readonly draft?: boolean
  /** Attached files. */
  readonly assets?: readonly DesktopGithubReleaseAsset[]
}

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/
const TAG_PREFIXES = ['desktop-v', 'dsh-v', 'v'] as const
const RELEASES_TIMEOUT_MS = 8_000
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000
const USER_AGENT = 'DeepSeek-Harness-Desktop'

/**
 * Parse `owner/repo` or a github.com URL into an update feed.
 * @param value - env, pack identity, or origin URL.
 * @returns the feed, or `undefined` when the value is not a repository.
 */
export function parseDesktopUpdateRepo(value: string | undefined): DesktopUpdateFeed | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const github = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed)
  if (github?.[1] !== undefined && github[2] !== undefined) {
    return { owner: github[1], repo: github[2] }
  }
  const slash = /^([^/]+)\/([^/]+)$/.exec(trimmed)
  if (slash?.[1] !== undefined && slash[2] !== undefined) return { owner: slash[1], repo: slash[2] }
  return undefined
}

/**
 * Choose the feed written into a packed installer.
 * @param identity - env and origin candidates, most preferred first.
 * @returns the first parseable repository.
 */
export function desktopUpdateFeedFromIdentity(identity: {
  updateRepo?: string
  githubRepository?: string
  originUrl?: string
}): DesktopUpdateFeed | undefined {
  return parseDesktopUpdateRepo(identity.updateRepo)
    ?? parseDesktopUpdateRepo(identity.githubRepository)
    ?? parseDesktopUpdateRepo(identity.originUrl)
}

/**
 * Semver from a desktop or dsh release tag.
 * @param tag - `desktop-v1.2.3`, `dsh-v1.2.3`, `v1.2.3`, or `1.2.3`.
 * @returns the version, or `undefined` when the tag is not a desktop release.
 */
export function versionFromReleaseTag(tag: string): string | undefined {
  for (const prefix of TAG_PREFIXES) {
    if (!tag.startsWith(prefix)) continue
    const version = tag.slice(prefix.length)
    if (VERSION.test(version)) return version
  }
  return VERSION.test(tag) ? tag : undefined
}

/**
 * Order two versions by semver precedence, including prerelease fields.
 * @param left - one version.
 * @param right - the other version.
 * @returns negative when `left` is lower, positive when higher, zero when equal.
 */
export function compareDesktopVersions(left: string, right: string): number {
  const leftMatch = VERSION.exec(left)
  const rightMatch = VERSION.exec(right)
  if (leftMatch === null || rightMatch === null) return 0
  for (const index of [1, 2, 3] as const) {
    const delta = Number(leftMatch[index]) - Number(rightMatch[index])
    if (delta !== 0) return delta
  }
  const leftPre = leftMatch[4]
  const rightPre = rightMatch[4]
  if (leftPre === undefined || rightPre === undefined) {
    if (leftPre === rightPre) return 0
    return leftPre === undefined ? 1 : -1
  }
  const leftFields = leftPre.split('.')
  const rightFields = rightPre.split('.')
  for (let index = 0; index < Math.max(leftFields.length, rightFields.length); index += 1) {
    const leftField = leftFields[index]
    const rightField = rightFields[index]
    if (leftField === undefined) return -1
    if (rightField === undefined) return 1
    if (leftField === rightField) continue
    const leftNumeric = /^\d+$/.test(leftField)
    const rightNumeric = /^\d+$/.test(rightField)
    if (leftNumeric && rightNumeric) return Number(leftField) - Number(rightField)
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftField < rightField ? -1 : 1
  }
  return 0
}

/**
 * Newest non-draft release newer than the running version.
 * @param releases - GitHub Releases list.
 * @param currentVersion - `app.getVersion()`.
 * @returns the newest newer release, or `undefined`.
 */
export function newestDesktopUpdate(
  releases: readonly DesktopGithubRelease[],
  currentVersion: string,
): DesktopUpdate | undefined {
  let newest: DesktopUpdate | undefined
  for (const release of releases) {
    if (release.draft === true) continue
    const version = versionFromReleaseTag(release.tag_name)
    if (version === undefined) continue
    if (compareDesktopVersions(version, currentVersion) <= 0) continue
    if (newest === undefined || compareDesktopVersions(version, newest.version) > 0) {
      newest = { version, url: release.html_url, assets: release.assets ?? [] }
    }
  }
  return newest
}

/**
 * Locate the GitHub repository the window should query.
 * Preference: `DSH_DESKTOP_UPDATE_REPO`, then the stamped feed file, then
 * `GITHUB_REPOSITORY`, then `origin`.
 * @param options - env, packaged extraResources, checkout file, and origin.
 * @returns the feed, or `undefined` to skip the check.
 */
export function resolveDesktopUpdateFeed(options: {
  env?: NodeJS.ProcessEnv
  packaged: boolean
  resourcesPath: string
  desktopRoot?: string
  originUrl?: string
  readFile?: (path: string) => string | undefined
}): DesktopUpdateFeed | undefined {
  const env = options.env ?? process.env
  const fromOverride = parseDesktopUpdateRepo(env.DSH_DESKTOP_UPDATE_REPO)
  if (fromOverride !== undefined) return fromOverride
  const read = options.readFile ?? readUpdateFeedFile
  const packaged = options.packaged
    ? read(join(options.resourcesPath, 'update-feed.json'))
    : undefined
  const checkout = options.desktopRoot === undefined
    ? undefined
    : read(join(options.desktopRoot, 'update-feed.json'))
  const fromFile = parseUpdateFeedJson(packaged ?? checkout)
  if (fromFile !== undefined) return fromFile
  return parseDesktopUpdateRepo(env.GITHUB_REPOSITORY)
    ?? parseDesktopUpdateRepo(options.originUrl)
}

/**
 * `origin` URL of a git checkout used to infer the update feed.
 * @param cwd - repository root.
 * @param run - replaceable `git remote get-url origin`.
 * @returns the remote URL, or `undefined` when git is unavailable.
 */
export function readGitOriginUrl(
  cwd: string,
  run: (directory: string) => { status: number | null; stdout: string } = gitOrigin,
): string | undefined {
  const result = run(cwd)
  if (result.status !== 0) return undefined
  const url = result.stdout.trim()
  return url === '' ? undefined : url
}

/**
 * GitHub Releases list URL for one feed.
 * @param feed - publishing repository.
 * @returns the API URL.
 */
export function desktopReleasesUrl(feed: DesktopUpdateFeed): string {
  return `https://api.github.com/repos/${feed.owner}/${feed.repo}/releases?per_page=30`
}

/**
 * Fetch GitHub Releases and return a newer installer when one exists.
 * @param options - running version, feed, and replaceable fetch.
 * @returns the newest newer release, or `undefined`.
 */
export async function checkDesktopUpdate(options: {
  currentVersion: string
  feed: DesktopUpdateFeed
  fetchReleases?: (url: string) => Promise<unknown>
}): Promise<DesktopUpdate | undefined> {
  const fetchReleases = options.fetchReleases ?? fetchGithubReleases
  const payload = await fetchReleases(desktopReleasesUrl(options.feed))
  if (!Array.isArray(payload)) return undefined
  const releases: DesktopGithubRelease[] = []
  for (const row of payload) {
    if (typeof row !== 'object' || row === null) continue
    const record = row as { tag_name?: unknown; html_url?: unknown; draft?: unknown; assets?: unknown }
    if (typeof record.tag_name !== 'string' || typeof record.html_url !== 'string') continue
    releases.push({
      tag_name: record.tag_name,
      html_url: record.html_url,
      draft: record.draft === true,
      assets: parseReleaseAssets(record.assets),
    })
  }
  return newestDesktopUpdate(releases, options.currentVersion)
}

/**
 * Windows NSIS file name published by `desktop:pack`.
 * @param version - semver from the release tag.
 * @returns the artifact name under the GitHub Release.
 */
export function desktopWindowsInstallerFileName(version: string): string {
  return `DeepSeek Harness-${version}-win-x64.exe`
}

/**
 * macOS DMG file name published by `desktop:pack` on that architecture.
 * @param version - semver from the release tag.
 * @param arch - `arm64` or `x64`.
 * @returns the artifact name under the GitHub Release.
 */
export function desktopMacInstallerFileName(version: string, arch: 'arm64' | 'x64'): string {
  return `DeepSeek Harness-${version}-mac-${arch}.dmg`
}

/**
 * Linux AppImage file name published by `desktop:pack` on that architecture.
 * @param version - semver from the release tag.
 * @param arch - `arm64` or `x64`.
 * @returns the artifact name under the GitHub Release.
 */
export function desktopLinuxInstallerFileName(version: string, arch: 'arm64' | 'x64'): string {
  return `DeepSeek Harness-${version}-linux-${arch}.AppImage`
}

/**
 * Installer file names a publish directory may contain.
 * @param version - repository version.
 * @returns Windows NSIS, macOS DMG, and Linux AppImage names.
 */
export function desktopInstallerFileNames(version: string): readonly string[] {
  return [
    desktopWindowsInstallerFileName(version),
    desktopMacInstallerFileName(version, 'arm64'),
    desktopMacInstallerFileName(version, 'x64'),
    desktopLinuxInstallerFileName(version, 'x64'),
    desktopLinuxInstallerFileName(version, 'arm64'),
  ]
}

/**
 * Installer file name for the running window's platform.
 * @param version - selected release version.
 * @param platform - `process.platform`.
 * @param arch - `process.arch`.
 * @returns the expected asset name, or `undefined` when this platform has none.
 */
export function desktopInstallerFileNameForPlatform(
  version: string,
  platform: NodeJS.Platform,
  arch: string,
): string | undefined {
  if (platform === 'win32') return desktopWindowsInstallerFileName(version)
  if (arch !== 'arm64' && arch !== 'x64') return undefined
  if (platform === 'darwin') return desktopMacInstallerFileName(version, arch)
  if (platform === 'linux') return desktopLinuxInstallerFileName(version, arch)
  return undefined
}

/**
 * True when the URL is an HTTPS GitHub download the installer may fetch.
 * @param url - asset `browser_download_url`.
 * @returns whether the host is github.com or a githubusercontent host.
 */
export function isTrustedDesktopDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
      && (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.githubusercontent.com'))
  } catch {
    return false
  }
}

/**
 * Select the installer asset for the running platform.
 * @param assets - Release assets.
 * @param version - selected release version.
 * @param platform - `process.platform`.
 * @param arch - `process.arch`.
 * @returns the trusted asset, or `undefined`.
 */
export function selectDesktopInstallerAsset(
  assets: readonly DesktopGithubReleaseAsset[],
  version: string,
  platform: NodeJS.Platform,
  arch: string = process.arch,
): DesktopGithubReleaseAsset | undefined {
  const expected = desktopInstallerFileNameForPlatform(version, platform, arch)
  if (expected === undefined) return undefined
  return assets.find((asset) => {
    return asset.name === expected && isTrustedDesktopDownloadUrl(asset.browser_download_url)
  })
}

/**
 * Cache path for one downloaded installer.
 * @param cacheDir - `userData/updates`.
 * @param fileName - trusted asset name.
 * @returns the destination path, or `undefined` when the name is not a basename.
 */
export function desktopInstallerCachePath(cacheDir: string, fileName: string): string | undefined {
  if (basename(fileName) !== fileName || fileName === '' || fileName === '.' || fileName === '..') {
    return undefined
  }
  return join(cacheDir, fileName)
}

/**
 * Download the installer, or reuse a complete cached file.
 * The download never prompts; callers ask for install authorization afterward.
 * @param options - URL, destination, and replaceable I/O.
 * @returns the cached path, or `undefined` when the download cannot be trusted.
 */
export async function downloadDesktopInstaller(options: {
  url: string
  destination: string
  expectedSize?: number
  fetchBody?: (url: string) => Promise<Uint8Array | NodeWebReadableStream<Uint8Array> | undefined>
}): Promise<string | undefined> {
  if (!isTrustedDesktopDownloadUrl(options.url)) return undefined
  await mkdir(dirname(options.destination), { recursive: true })
  if (await installerAlreadyCached(options.destination, options.expectedSize)) {
    await markDesktopInstallerExecutable(options.destination)
    return options.destination
  }
  const fetchBody = options.fetchBody ?? fetchInstallerBody
  const body = await fetchBody(options.url)
  if (body === undefined) return undefined
  const part = `${options.destination}.part`
  await rm(part, { force: true })
  try {
    if (body instanceof Uint8Array) {
      if (options.expectedSize !== undefined && body.byteLength !== options.expectedSize) return undefined
      await writeCachedInstaller(part, body)
    } else {
      await pipeline(Readable.fromWeb(body), createWriteStream(part))
      if (options.expectedSize !== undefined) {
        const info = await stat(part)
        if (info.size !== options.expectedSize) return undefined
      }
    }
    await rm(options.destination, { force: true })
    await rename(part, options.destination)
    await markDesktopInstallerExecutable(options.destination)
    return options.destination
  } finally {
    await rm(part, { force: true })
  }
}

/**
 * Check for a newer installer, download it silently, then ask for install authorization.
 * Fetch, download, and prompt failures are swallowed so boot still shows the window.
 * @param options - skip flag, feed, cache, and replaceable I/O.
 * @returns nothing.
 */
export async function offerDesktopUpdate(options: {
  currentVersion: string
  skip: boolean
  feed: DesktopUpdateFeed | undefined
  cacheDir: string
  platform?: NodeJS.Platform
  arch?: string
  fetchReleases?: (url: string) => Promise<unknown>
  fetchBody?: (url: string) => Promise<Uint8Array | NodeWebReadableStream<Uint8Array> | undefined>
  promptInstall: (update: DesktopUpdate, currentVersion: string, installerPath: string) => Promise<boolean>
  install: (installerPath: string) => Promise<void>
}): Promise<void> {
  if (options.skip || options.feed === undefined) return
  const update = await checkDesktopUpdate({
    currentVersion: options.currentVersion,
    feed: options.feed,
    ...(options.fetchReleases === undefined ? {} : { fetchReleases: options.fetchReleases }),
  }).catch(() => undefined)
  if (update === undefined) return
  const asset = selectDesktopInstallerAsset(
    update.assets,
    update.version,
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  )
  if (asset === undefined) return
  const destination = desktopInstallerCachePath(options.cacheDir, asset.name)
  if (destination === undefined) return
  const installerPath = await downloadDesktopInstaller({
    url: asset.browser_download_url,
    destination,
    ...(asset.size === undefined ? {} : { expectedSize: asset.size }),
    ...(options.fetchBody === undefined ? {} : { fetchBody: options.fetchBody }),
  }).catch(() => undefined)
  if (installerPath === undefined) return
  const accepted = await options.promptInstall(update, options.currentVersion, installerPath).catch(() => false)
  if (!accepted) return
  await options.install(installerPath).catch(() => undefined)
}

function parseReleaseAssets(raw: unknown): DesktopGithubReleaseAsset[] {
  if (!Array.isArray(raw)) return []
  const assets: DesktopGithubReleaseAsset[] = []
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue
    const record = row as { name?: unknown; browser_download_url?: unknown; size?: unknown }
    if (typeof record.name !== 'string' || typeof record.browser_download_url !== 'string') continue
    const asset: DesktopGithubReleaseAsset = {
      name: record.name,
      browser_download_url: record.browser_download_url,
    }
    if (typeof record.size === 'number') {
      assets.push({ ...asset, size: record.size })
      continue
    }
    assets.push(asset)
  }
  return assets
}

async function installerAlreadyCached(destination: string, expectedSize: number | undefined): Promise<boolean> {
  try {
    const info = await stat(destination)
    if (!info.isFile()) return false
    return expectedSize === undefined || info.size === expectedSize
  } catch {
    return false
  }
}

async function markDesktopInstallerExecutable(destination: string): Promise<void> {
  if (!destination.endsWith('.AppImage')) return
  await chmod(destination, 0o755)
}

async function writeCachedInstaller(path: string, body: Uint8Array): Promise<void> {
  await writeFile(path, body)
}

async function fetchInstallerBody(url: string): Promise<Uint8Array | NodeWebReadableStream<Uint8Array> | undefined> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': USER_AGENT,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  })
  if (!response.ok || response.body === null) return undefined
  return response.body as NodeWebReadableStream<Uint8Array>
}

function parseUpdateFeedJson(raw: string | undefined): DesktopUpdateFeed | undefined {
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as { owner?: unknown; repo?: unknown }
    if (typeof record.owner !== 'string' || typeof record.repo !== 'string') return undefined
    return parseDesktopUpdateRepo(`${record.owner}/${record.repo}`)
  } catch {
    // Invalid JSON is treated as a missing feed so GITHUB_REPOSITORY / origin can still apply.
    return undefined
  }
}

function readUpdateFeedFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf8')
}

function gitOrigin(cwd: string): { status: number | null; stdout: string } {
  return spawnSync('git', ['remote', 'get-url', 'origin'], { cwd, encoding: 'utf8' })
}

async function fetchGithubReleases(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(RELEASES_TIMEOUT_MS),
  })
  if (!response.ok) return undefined
  return await response.json()
}
