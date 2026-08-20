import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkDesktopUpdate,
  compareDesktopVersions,
  desktopInstallerCachePath,
  desktopLinuxInstallerFileName,
  desktopMacInstallerFileName,
  desktopReleasesUrl,
  desktopUpdateFeedFromIdentity,
  desktopWindowsInstallerFileName,
  downloadDesktopInstaller,
  isTrustedDesktopDownloadUrl,
  newestDesktopUpdate,
  offerDesktopUpdate,
  parseDesktopUpdateRepo,
  readGitOriginUrl,
  resolveDesktopUpdateFeed,
  selectDesktopInstallerAsset,
  versionFromReleaseTag,
} from '../src/update.ts'

const WIN_ASSET = {
  name: 'DeepSeek Harness-0.1.0-rc.9-win-x64.exe',
  browser_download_url: 'https://github.com/zous168/deepseek-harness-client/releases/download/desktop-v0.1.0-rc.9/DeepSeek%20Harness-0.1.0-rc.9-win-x64.exe',
  size: 4,
}

describe('desktop update feed', () => {
  it('parses owner/repo and github.com origin URLs', () => {
    expect(parseDesktopUpdateRepo('zous168/deepseek-harness-client')).toEqual({
      owner: 'zous168',
      repo: 'deepseek-harness-client',
    })
    expect(parseDesktopUpdateRepo('https://github.com/zous168/deepseek-harness-client.git')).toEqual({
      owner: 'zous168',
      repo: 'deepseek-harness-client',
    })
    expect(parseDesktopUpdateRepo('')).toBeUndefined()
    expect(parseDesktopUpdateRepo('not-a-repo')).toBeUndefined()
  })

  it('prefers DSH_DESKTOP_UPDATE_REPO over GITHUB_REPOSITORY over origin', () => {
    expect(desktopUpdateFeedFromIdentity({
      updateRepo: 'acme/app',
      githubRepository: 'zous168/deepseek-harness-client',
      originUrl: 'https://github.com/other/origin.git',
    })).toEqual({ owner: 'acme', repo: 'app' })
    expect(desktopUpdateFeedFromIdentity({
      githubRepository: 'zous168/deepseek-harness-client',
      originUrl: 'https://github.com/other/origin.git',
    })).toEqual({ owner: 'zous168', repo: 'deepseek-harness-client' })
    expect(desktopUpdateFeedFromIdentity({
      originUrl: 'https://github.com/other/origin.git',
    })).toEqual({ owner: 'other', repo: 'origin' })
  })

  it('reads the env override, then the packaged extraResources file', () => {
    expect(resolveDesktopUpdateFeed({
      env: { DSH_DESKTOP_UPDATE_REPO: 'acme/app' },
      packaged: true,
      resourcesPath: '/resources',
      readFile: () => '{"owner":"packed","repo":"feed"}',
    })).toEqual({ owner: 'acme', repo: 'app' })
    expect(resolveDesktopUpdateFeed({
      env: {},
      packaged: true,
      resourcesPath: '/resources',
      readFile: path => path.endsWith('update-feed.json') ? '{"owner":"packed","repo":"feed"}' : undefined,
    })).toEqual({ owner: 'packed', repo: 'feed' })
    expect(resolveDesktopUpdateFeed({
      env: {},
      packaged: false,
      resourcesPath: '/unused',
      desktopRoot: '/desktop',
      originUrl: 'https://github.com/other/origin.git',
      readFile: () => undefined,
    })).toEqual({ owner: 'other', repo: 'origin' })
    expect(resolveDesktopUpdateFeed({
      env: { GITHUB_REPOSITORY: 'zous168/deepseek-harness-client' },
      packaged: false,
      resourcesPath: '/unused',
      readFile: () => undefined,
    })).toEqual({ owner: 'zous168', repo: 'deepseek-harness-client' })
  })

  it('reads a git origin URL and treats a failed remote lookup as missing', () => {
    expect(readGitOriginUrl('/repo', () => ({
      status: 0,
      stdout: 'https://github.com/zous168/deepseek-harness-client.git\n',
    }))).toBe('https://github.com/zous168/deepseek-harness-client.git')
    expect(readGitOriginUrl('/repo', () => ({ status: 1, stdout: '' }))).toBeUndefined()
  })
})

describe('desktop release versions', () => {
  it('reads desktop-v, dsh-v, and v tags', () => {
    expect(versionFromReleaseTag('desktop-v0.1.0-rc.8')).toBe('0.1.0-rc.8')
    expect(versionFromReleaseTag('dsh-v0.1.0')).toBe('0.1.0')
    expect(versionFromReleaseTag('v1.2.3')).toBe('1.2.3')
    expect(versionFromReleaseTag('nightly')).toBeUndefined()
  })

  it('orders prereleases below the release they precede', () => {
    expect(compareDesktopVersions('0.1.0', '0.1.0-rc.8')).toBeGreaterThan(0)
    expect(compareDesktopVersions('0.1.0-rc.8', '0.1.0-rc.9')).toBeLessThan(0)
    expect(compareDesktopVersions('0.1.0-rc.8', '0.1.0-rc.8')).toBe(0)
  })

  it('selects the newest non-draft release newer than the running version', () => {
    expect(newestDesktopUpdate([
      { tag_name: 'desktop-v0.1.0-rc.8', html_url: 'https://example.test/rc8' },
      { tag_name: 'desktop-v0.1.0-rc.9', html_url: 'https://example.test/rc9' },
      { tag_name: 'desktop-v0.2.0', html_url: 'https://example.test/v2', draft: true },
      { tag_name: 'notes', html_url: 'https://example.test/notes' },
    ], '0.1.0-rc.8')).toEqual({
      version: '0.1.0-rc.9',
      url: 'https://example.test/rc9',
      assets: [],
    })
    expect(newestDesktopUpdate([
      { tag_name: 'desktop-v0.1.0-rc.8', html_url: 'https://example.test/rc8' },
    ], '0.1.0-rc.8')).toBeUndefined()
  })
})

describe('desktop update check', () => {
  it('builds the GitHub Releases URL and ignores a non-array payload', async () => {
    expect(desktopReleasesUrl({ owner: 'zous168', repo: 'deepseek-harness-client' }))
      .toBe('https://api.github.com/repos/zous168/deepseek-harness-client/releases?per_page=30')
    await expect(checkDesktopUpdate({
      currentVersion: '0.1.0-rc.8',
      feed: { owner: 'zous168', repo: 'deepseek-harness-client' },
      fetchReleases: async () => ({ message: 'Not Found' }),
    })).resolves.toBeUndefined()
  })

  it('downloads the Windows installer silently and installs only after authorization', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-update-'))
    const prompted: string[] = []
    const installed: string[] = []
    let downloaded = false
    await offerDesktopUpdate({
      currentVersion: '0.1.0-rc.8',
      skip: false,
      feed: { owner: 'zous168', repo: 'deepseek-harness-client' },
      cacheDir,
      platform: 'win32',
      fetchReleases: async () => [
        {
          tag_name: 'desktop-v0.1.0-rc.9',
          html_url: 'https://example.test/rc9',
          assets: [WIN_ASSET],
        },
      ],
      fetchBody: async () => {
        downloaded = true
        return new Uint8Array([1, 2, 3, 4])
      },
      promptInstall: async (update, _current, installerPath) => {
        prompted.push(update.version)
        expect(readFileSync(installerPath)).toEqual(Buffer.from([1, 2, 3, 4]))
        return true
      },
      install: async (installerPath) => {
        installed.push(installerPath)
      },
    })
    expect(downloaded).toBe(true)
    expect(prompted).toEqual(['0.1.0-rc.9'])
    expect(installed).toEqual([join(cacheDir, WIN_ASSET.name)])
  })

  it('does not prompt before a successful download and skips when asked', async () => {
    let prompted = false
    await offerDesktopUpdate({
      currentVersion: '0.1.0-rc.8',
      skip: false,
      feed: { owner: 'zous168', repo: 'deepseek-harness-client' },
      cacheDir: mkdtempSync(join(tmpdir(), 'dsh-desktop-update-miss-')),
      platform: 'win32',
      fetchReleases: async () => [
        { tag_name: 'desktop-v0.1.0-rc.9', html_url: 'https://example.test/rc9', assets: [] },
      ],
      promptInstall: async () => {
        prompted = true
        return true
      },
      install: async () => undefined,
    })
    expect(prompted).toBe(false)
    let fetched = false
    await offerDesktopUpdate({
      currentVersion: '0.1.0-rc.8',
      skip: true,
      feed: { owner: 'zous168', repo: 'deepseek-harness-client' },
      cacheDir: '/unused',
      fetchReleases: async () => {
        fetched = true
        return []
      },
      promptInstall: async () => true,
      install: async () => undefined,
    })
    expect(fetched).toBe(false)
    await offerDesktopUpdate({
      currentVersion: '0.1.0-rc.8',
      skip: false,
      feed: { owner: 'zous168', repo: 'deepseek-harness-client' },
      cacheDir: '/unused',
      fetchReleases: async () => {
        throw new Error('offline')
      },
      promptInstall: async () => true,
      install: async () => undefined,
    })
  })
})

describe('desktop installer download', () => {
  it('selects the trusted Windows, macOS, or Linux installer asset for this platform', () => {
    const macAsset = {
      name: desktopMacInstallerFileName('0.1.0-rc.9', 'arm64'),
      browser_download_url: 'https://github.com/zous168/deepseek-harness-client/releases/download/desktop-v0.1.0-rc.9/DeepSeek%20Harness-0.1.0-rc.9-mac-arm64.dmg',
    }
    const linuxAsset = {
      name: desktopLinuxInstallerFileName('0.1.0-rc.9', 'x64'),
      browser_download_url: 'https://github.com/zous168/deepseek-harness-client/releases/download/desktop-v0.1.0-rc.9/DeepSeek%20Harness-0.1.0-rc.9-linux-x86_64.AppImage',
    }
    expect(desktopWindowsInstallerFileName('0.1.0-rc.9')).toBe(WIN_ASSET.name)
    expect(selectDesktopInstallerAsset([WIN_ASSET], '0.1.0-rc.9', 'win32', 'x64')).toEqual(WIN_ASSET)
    expect(selectDesktopInstallerAsset([macAsset], '0.1.0-rc.9', 'darwin', 'arm64')).toEqual(macAsset)
    expect(selectDesktopInstallerAsset([linuxAsset], '0.1.0-rc.9', 'linux', 'x64')).toEqual(linuxAsset)
    expect(selectDesktopInstallerAsset([WIN_ASSET], '0.1.0-rc.9', 'darwin', 'arm64')).toBeUndefined()
    expect(selectDesktopInstallerAsset([macAsset], '0.1.0-rc.9', 'linux', 'x64')).toBeUndefined()
    expect(selectDesktopInstallerAsset([{
      ...WIN_ASSET,
      browser_download_url: 'https://evil.example/installer.exe',
    }], '0.1.0-rc.9', 'win32', 'x64')).toBeUndefined()
    expect(isTrustedDesktopDownloadUrl(WIN_ASSET.browser_download_url)).toBe(true)
    expect(isTrustedDesktopDownloadUrl('http://github.com/acme/app/a.exe')).toBe(false)
    expect(desktopInstallerCachePath('/cache', '../escape.exe')).toBeUndefined()
  })

  it('reuses a complete cached installer and rejects a size mismatch', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-cache-'))
    const destination = join(cacheDir, WIN_ASSET.name)
    writeFileSync(destination, Buffer.from([1, 2, 3, 4]))
    await expect(downloadDesktopInstaller({
      url: WIN_ASSET.browser_download_url,
      destination,
      expectedSize: 4,
      fetchBody: async () => {
        throw new Error('should reuse cache')
      },
    })).resolves.toBe(destination)
    await expect(downloadDesktopInstaller({
      url: WIN_ASSET.browser_download_url,
      destination: join(cacheDir, 'fresh.exe'),
      expectedSize: 8,
      fetchBody: async () => new Uint8Array([1, 2, 3, 4]),
    })).resolves.toBeUndefined()
  })

  it('marks a downloaded AppImage executable on POSIX', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-appimage-'))
    const destination = join(cacheDir, desktopLinuxInstallerFileName('0.1.0-rc.9', 'x64'))
    await expect(downloadDesktopInstaller({
      url: 'https://github.com/zous168/deepseek-harness-client/releases/download/desktop-v0.1.0-rc.9/DeepSeek%20Harness-0.1.0-rc.9-linux-x86_64.AppImage',
      destination,
      fetchBody: async () => new Uint8Array([1, 2, 3, 4]),
    })).resolves.toBe(destination)
    if (process.platform === 'win32') return
    expect(statSync(destination).mode & 0o111).not.toBe(0)
  })
})
