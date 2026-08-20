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
import { desktopInstallerFileNames, desktopWindowsInstallerFileName } from '../../apps/desktop/src/update.ts'
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
 * Manifest written into the GitHub Packages tarball.
 * @param options - owner, version, and installer file name.
 * @returns package.json fields for `npm publish`.
 */
export function githubPackagesDesktopManifest(options: {
  owner: string
  repository: string
  version: string
  installers: readonly string[]
}): Record<string, unknown> {
  return {
    name: githubPackagesDesktopName(options.owner),
    version: options.version,
    description: 'Desktop installers for the DeepSeek Harness window',
    publishConfig: { registry: 'https://npm.pkg.github.com' },
    repository: {
      type: 'git',
      url: `git+https://github.com/${options.repository}.git`,
    },
    files: [...options.installers],
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

  const staging = mkdtempSync(join(tmpdir(), 'dsh-desktop-gh-packages-'))
  try {
    writeFileSync(
      join(staging, 'package.json'),
      `${JSON.stringify(githubPackagesDesktopManifest({
        owner: request.owner,
        repository: request.repository,
        version,
        installers,
      }), null, 2)}\n`,
    )
    for (const [index, installerPath] of installerPaths.entries()) {
      const name = installers[index]
      if (name === undefined) continue
      cpSync(installerPath, join(staging, name))
    }
    const published = attemptEchoed('npm', ['publish'], {
      cwd: staging,
      env: process.env,
    })
    if (published.status !== 0) {
      throw new Error(`desktop publish: npm publish failed:\n${published.stdout}${published.stderr}`)
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }

  const tag = request.refName
  const title = `DeepSeek Harness ${version}`
  const names = installers.map(name => basename(name)).join(', ')
  const existing = attempt('gh', ['release', 'view', tag, '--json', 'tagName'])
  if (existing.status === 0) {
    const uploaded = attemptEchoed('gh', ['release', 'upload', tag, ...installerPaths, '--clobber'])
    if (uploaded.status !== 0) {
      throw new Error(`desktop publish: gh release upload failed:\n${uploaded.stdout}${uploaded.stderr}`)
    }
    return
  }
  const created = attemptEchoed('gh', [
    'release', 'create', tag, ...installerPaths,
    '--title', title,
    '--notes', `Desktop installers ${names}. The same bytes are published to GitHub Packages as ${githubPackagesDesktopName(request.owner)}.`,
  ])
  if (created.status !== 0) {
    throw new Error(`desktop publish: gh release create failed:\n${created.stdout}${created.stderr}`)
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
