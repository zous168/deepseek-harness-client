/**
 * Publish the packed desktop installer to GitHub Packages and attach it to a
 * GitHub Release. The npm package name uses the repository owner as scope
 * because GitHub Packages rejects a scope that does not match the owner.
 * @module scripts/release/publish-desktop-github-packages
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  desktopInstallerFileNames,
  desktopWindowsInstallerFileName,
  normalizeDesktopInstallerAssetName,
} from '../../apps/desktop/src/update.ts'
import { attempt, attemptEchoed } from './process.ts'

const repoRoot = resolve(import.meta.dirname, '../..')

/** Inputs the workflow supplies to the publish step. */
export interface DesktopGithubPublishRequest {
  /** True when the dispatch asked to publish. */
  readonly publish: boolean
  /** GitHub repository owner; becomes the npm scope. */
  readonly owner: string
  /** `owner/repo`. */
  readonly repository: string
  /** `tag` or `branch`. */
  readonly refType: string
  /** Tag or branch name. */
  readonly refName: string
  /** Packed installer directory (`apps/desktop/release`). */
  readonly from: string
}

/**
 * GitHub Packages npm name for this repository's desktop installer.
 * @param owner - GitHub owner.
 * @returns a scoped package name.
 */
export function githubPackagesDesktopName(owner: string): string {
  if (owner === '') throw new Error('desktop publish: GitHub owner is empty')
  return `@${owner}/dsh-desktop`
}

/**
 * Platform id encoded in an electron-builder artifact name.
 * @param installer - `DeepSeek.Harness-<version>-<id>.<ext>`.
 * @param version - repository version.
 * @returns `win-x64`, `mac-arm64`, `linux-x86_64`, or another packed id.
 */
export function desktopInstallerPlatformId(installer: string, version: string): string {
  const prefix = `DeepSeek.Harness-${version}-`
  const normalized = normalizeDesktopInstallerAssetName(installer)
  if (!normalized.startsWith(prefix)) {
    throw new Error(`desktop publish: ${installer} is not a DeepSeek Harness ${version} installer`)
  }
  const stem = normalized.slice(prefix.length)
  for (const ext of ['.exe', '.dmg', '.AppImage'] as const) {
    if (stem.endsWith(ext)) return stem.slice(0, -ext.length)
  }
  throw new Error(`desktop publish: ${installer} has no installer extension`)
}

/**
 * GitHub Packages npm name for one host-OS installer.
 * GitHub Packages rejects a tarball over 256 MiB, so each installer is its own package.
 * @param owner - GitHub owner.
 * @param platformId - `desktopInstallerPlatformId` result.
 * @returns a scoped package name.
 */
export function githubPackagesDesktopPlatformName(owner: string, platformId: string): string {
  if (owner === '') throw new Error('desktop publish: GitHub owner is empty')
  if (platformId === '') throw new Error('desktop publish: platform id is empty')
  return `@${owner}/dsh-desktop-${platformId}`
}

/**
 * electron-builder artifact name for the Windows NSIS installer.
 * @param version - repository version.
 * @returns the file name under `apps/desktop/release`.
 */
export function desktopWindowsInstallerName(version: string): string {
  return desktopWindowsInstallerFileName(version)
}

/**
 * Packed installer files present in a publish directory.
 * @param from - directory that received the pack artifacts.
 * @param version - repository version.
 * @returns existing installer file names, in publish order.
 */
export function listDesktopInstallers(from: string, version: string): string[] {
  return desktopInstallerFileNames(version).filter(name => existsSync(join(from, name)))
}

/**
 * Tags that may publish this version.
 * @param version - repository version.
 * @returns the accepted tag names.
 */
export function desktopPublishTags(version: string): readonly string[] {
  return [`dsh-v${version}`, `desktop-v${version}`]
}

/**
 * Refuse a publish dispatch that is not on a matching version tag.
 * @param request - workflow identity.
 * @param version - repository version.
 */
export function authorizeDesktopGithubPublish(request: DesktopGithubPublishRequest, version: string): void {
  if (!request.publish) return
  const tags = desktopPublishTags(version)
  if (request.refType === 'tag' && tags.includes(request.refName)) return
  throw new Error(`desktop publish: publication must run from tag ${tags.join(' or ')}`)
}

/**
 * `npm publish` argv. A prerelease must not take the `latest` dist-tag.
 * @param version - repository version.
 * @returns argv after `npm`.
 */
export function desktopNpmPublishArgs(version: string): string[] {
  return version.includes('-') ? ['publish', '--tag', 'next'] : ['publish']
}

/**
 * Manifest written into the GitHub Packages tarball.
 * @param options - owner, version, and installer file name.
 * @returns package.json fields for `npm publish`.
 */
export function githubPackagesDesktopManifest(options: {
  owner: string
  repository: string
  version: string
  installer: string
}): Record<string, unknown> {
  const platformId = desktopInstallerPlatformId(options.installer, options.version)
  return {
    name: githubPackagesDesktopPlatformName(options.owner, platformId),
    version: options.version,
    description: `DeepSeek Harness ${platformId} installer`,
    publishConfig: { registry: 'https://npm.pkg.github.com' },
    repository: {
      type: 'git',
      url: `git+https://github.com/${options.repository}.git`,
    },
    files: [options.installer],
    license: 'MIT',
  }
}

/**
 * Publish the installer tarball and create or update the GitHub Release.
 * @param request - workflow inputs.
 */
export function publishDesktopGithubPackages(request: DesktopGithubPublishRequest): void {
  const version = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version
  authorizeDesktopGithubPublish(request, version)
  if (!request.publish) return

  const installers = listDesktopInstallers(request.from, version)
  if (installers.length === 0) {
    throw new Error(`desktop publish: no installer found under ${request.from}`)
  }
  const installerPaths = installers.map(name => join(request.from, name))
  for (const installerPath of installerPaths) {
    const bytes = readFileSync(installerPath)
    if (bytes.length === 0) throw new Error(`desktop publish: ${installerPath} is empty`)
  }

  const tag = request.refName
  const title = `DeepSeek Harness ${version}`
  const names = installers.map(name => basename(name)).join(', ')
  const packageNames = installers.map(name => (
    githubPackagesDesktopPlatformName(request.owner, desktopInstallerPlatformId(name, version))
  ))
  const existing = attempt('gh', ['release', 'view', tag, '--json', 'tagName'])
  if (existing.status === 0) {
    const uploaded = attemptEchoed('gh', ['release', 'upload', tag, ...installerPaths, '--clobber'])
    if (uploaded.status !== 0) {
      throw new Error(`desktop publish: gh release upload failed:\n${uploaded.stdout}${uploaded.stderr}`)
    }
  } else {
    const created = attemptEchoed('gh', [
      'release', 'create', tag, ...installerPaths,
      '--title', title,
      ...(version.includes('-') ? ['--prerelease'] : []),
      '--notes', `Desktop installers ${names}. GitHub Packages publishes each as ${packageNames.join(', ')}.`,
    ])
    if (created.status !== 0) {
      throw new Error(`desktop publish: gh release create failed:\n${created.stdout}${created.stderr}`)
    }
  }

  for (const [index, installerPath] of installerPaths.entries()) {
    const installer = installers[index]
    if (installer === undefined) continue
    const staging = mkdtempSync(join(tmpdir(), 'dsh-desktop-gh-packages-'))
    try {
      writeFileSync(
        join(staging, 'package.json'),
        `${JSON.stringify(githubPackagesDesktopManifest({
          owner: request.owner,
          repository: request.repository,
          version,
          installer,
        }), null, 2)}\n`,
      )
      cpSync(installerPath, join(staging, installer))
      const published = attemptEchoed('npm', desktopNpmPublishArgs(version), {
        cwd: staging,
        env: process.env,
      })
      if (published.status !== 0) {
        throw new Error(`desktop publish: npm publish ${installer} failed:\n${published.stdout}${published.stderr}`)
      }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
}

if (import.meta.main) {
  const parsed = parseArgs({
    options: {
      publish: { type: 'boolean', default: false },
      from: { type: 'string' },
    },
  })
  const from = parsed.values.from
  if (from === undefined || from === '') throw new Error('desktop publish: --from is required')
  const owner = process.env.GITHUB_REPOSITORY_OWNER ?? ''
  const repository = process.env.GITHUB_REPOSITORY ?? ''
  publishDesktopGithubPackages({
    publish: parsed.values.publish === true,
    owner,
    repository,
    refType: process.env.GITHUB_REF_TYPE ?? '',
    refName: process.env.GITHUB_REF_NAME ?? '',
    from: resolve(from),
  })
}
