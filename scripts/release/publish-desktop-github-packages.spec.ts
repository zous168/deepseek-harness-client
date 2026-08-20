import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  authorizeDesktopGithubPublish,
  desktopPublishTags,
  desktopNpmPublishArgs,
  desktopWindowsInstallerName,
  githubPackagesDesktopManifest,
  githubPackagesDesktopName,
  listDesktopInstallers,
} from './publish-desktop-github-packages.ts'

describe('desktop GitHub Packages publish', () => {
  it('scopes the package to the repository owner', () => {
    expect(githubPackagesDesktopName('zous168')).toBe('@zous168/dsh-desktop')
    expect(() => githubPackagesDesktopName('')).toThrow('GitHub owner is empty')
  })

  it('accepts the dsh and desktop tags for the repository version', () => {
    expect(desktopPublishTags('0.1.0-rc.8')).toEqual(['dsh-v0.1.0-rc.8', 'desktop-v0.1.0-rc.8'])
    expect(desktopWindowsInstallerName('0.1.0-rc.8')).toBe('DeepSeek Harness-0.1.0-rc.8-win-x64.exe')
    const from = mkdtempSync(join(tmpdir(), 'dsh-desktop-publish-'))
    writeFileSync(join(from, 'DeepSeek Harness-0.1.0-rc.8-mac-arm64.dmg'), 'dmg')
    expect(listDesktopInstallers(from, '0.1.0-rc.8')).toEqual([
      'DeepSeek Harness-0.1.0-rc.8-mac-arm64.dmg',
    ])
  })

  it('authorizes publish only from a matching version tag', () => {
    const base = {
      owner: 'zous168',
      repository: 'zous168/deepseek-harness-client',
      from: '/release',
    }
    expect(() => authorizeDesktopGithubPublish({ ...base, publish: false, refType: 'branch', refName: 'master' }, '0.1.0-rc.8')).not.toThrow()
    expect(() => authorizeDesktopGithubPublish({ ...base, publish: true, refType: 'tag', refName: 'dsh-v0.1.0-rc.8' }, '0.1.0-rc.8')).not.toThrow()
    expect(() => authorizeDesktopGithubPublish({ ...base, publish: true, refType: 'tag', refName: 'desktop-v0.1.0-rc.8' }, '0.1.0-rc.8')).not.toThrow()
    expect(() => authorizeDesktopGithubPublish({ ...base, publish: true, refType: 'branch', refName: 'master' }, '0.1.0-rc.8'))
      .toThrow('must run from tag')
    expect(() => authorizeDesktopGithubPublish({ ...base, publish: true, refType: 'tag', refName: 'dsh-v0.0.1' }, '0.1.0-rc.8'))
      .toThrow('must run from tag')
  })

  it('publishes prereleases under the next dist-tag', () => {
    expect(desktopNpmPublishArgs('0.1.0-rc.8')).toEqual(['publish', '--tag', 'next'])
    expect(desktopNpmPublishArgs('0.1.0')).toEqual(['publish'])
  })

  it('writes a GitHub Packages manifest that ships only the installer', () => {
    expect(githubPackagesDesktopManifest({
      owner: 'zous168',
      repository: 'zous168/deepseek-harness-client',
      version: '0.1.0-rc.8',
      installers: [
        'DeepSeek Harness-0.1.0-rc.8-win-x64.exe',
        'DeepSeek Harness-0.1.0-rc.8-mac-arm64.dmg',
      ],
    })).toEqual({
      name: '@zous168/dsh-desktop',
      version: '0.1.0-rc.8',
      description: 'Desktop installers for the DeepSeek Harness window',
      publishConfig: { registry: 'https://npm.pkg.github.com' },
      repository: {
        type: 'git',
        url: 'git+https://github.com/zous168/deepseek-harness-client.git',
      },
      files: [
        'DeepSeek Harness-0.1.0-rc.8-win-x64.exe',
        'DeepSeek Harness-0.1.0-rc.8-mac-arm64.dmg',
      ],
      license: 'MIT',
    })
  })
})
