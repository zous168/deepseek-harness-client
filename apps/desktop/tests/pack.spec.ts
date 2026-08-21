import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertDesktopRuntime,
  assertElectronDist,
  copyDesktopRuntime,
  desktopBuilderManifest,
  desktopBuilderOptions,
  desktopDeployArgs,
  desktopElectronDistEntry,
  desktopPackagedRuntimeRoot,
  desktopRepoRoot,
  pruneDesktopRuntimeSourceMaps,
  restoreDesktopWorkspaceClosure,
  writeDesktopUpdateFeedFile,
} from '../scripts/pack.ts'

describe('desktop pack', () => {
  it('resolves the workspace root two levels above apps/desktop', () => {
    expect(desktopRepoRoot('H:/repo/apps/desktop').replaceAll('\\', '/')).toBe('H:/repo')
  })

  it('deploys the CLI with the pnpm 10+ workspace flags and without --prod', () => {
    expect(desktopDeployArgs('/repo/apps/desktop/runtime')).toEqual([
      'deploy',
      '--filter',
      '@deepseek-ai/dsh',
      '--legacy',
      '--config.auto-install-peers=false',
      '--config.node-linker=hoisted',
      '/repo/apps/desktop/runtime',
    ])
  })

  it('moves electron into devDependencies for electron-builder', () => {
    expect(desktopBuilderManifest({
      name: '@deepseek-ai/dsh-desktop',
      dependencies: { electron: '^37.3.1' },
      devDependencies: { 'electron-builder': '^26.0.12' },
    })).toEqual({
      name: '@deepseek-ai/dsh-desktop',
      devDependencies: { 'electron-builder': '^26.0.12', electron: '^37.3.1' },
    })
    expect(() => desktopBuilderManifest({ name: '@deepseek-ai/dsh-desktop' }))
      .toThrow('missing dependencies.electron')
  })

  it('points electron-builder at extraResources and forbids implicit publish', () => {
    const withoutFeed = desktopBuilderOptions({
      desktopRoot: '/repo/apps/desktop',
      runtimeRoot: '/repo/apps/desktop/runtime',
      electronDist: '/repo/node_modules/electron/dist',
    })
    expect(withoutFeed).toMatchObject({
      projectDir: '/repo/apps/desktop',
      publish: 'never',
      config: {
        electronDist: '/repo/node_modules/electron/dist',
        extraResources: [],
      },
    })
    const config = withoutFeed.config
    if (typeof config !== 'object' || config === null) {
      throw new Error('builder config must be an object')
    }
    expect(typeof config.afterPack).toBe('function')
    expect(desktopBuilderOptions({
      desktopRoot: '/repo/apps/desktop',
      runtimeRoot: '/repo/apps/desktop/runtime',
      electronDist: '/repo/node_modules/electron/dist',
      updateFeedPath: '/repo/apps/desktop/update-feed.json',
    }).config).toMatchObject({
      extraResources: [
        { from: '/repo/apps/desktop/update-feed.json', to: 'update-feed.json' },
      ],
    })
  })

  it('places the packaged runtime under Resources on macOS and resources elsewhere', () => {
    expect(desktopPackagedRuntimeRoot('/out/DeepSeek Harness.app', 'darwin').replaceAll('\\', '/'))
      .toBe('/out/DeepSeek Harness.app/Contents/Resources/runtime')
    expect(desktopPackagedRuntimeRoot('/out/win-unpacked', 'win32').replaceAll('\\', '/'))
      .toBe('/out/win-unpacked/resources/runtime')
  })

  it('copies the deployed runtime into the unpacked app and re-asserts boot files', () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-runtime-src-'))
    const packagedRoot = join(mkdtempSync(join(tmpdir(), 'dsh-desktop-runtime-dst-')), 'runtime')
    mkdirSync(join(runtimeRoot, 'lib'), { recursive: true })
    mkdirSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh-app-boot'), { recursive: true })
    mkdirSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cordis-plugin-group'), { recursive: true })
    mkdirSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cosmokit'), { recursive: true })
    writeFileSync(join(runtimeRoot, 'lib', 'bin.js'), 'export {}\n')
    copyDesktopRuntime(runtimeRoot, packagedRoot)
    expect(readFileSync(join(packagedRoot, 'lib', 'bin.js'), 'utf8')).toBe('export {}\n')
    expect(() => assertDesktopRuntime(packagedRoot)).not.toThrow()
  })

  it('pins the Windows per-machine NSIS options and the macOS and Linux targets', () => {
    const yml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/\nnsis:\n(?:  .+\n)*  include: installer.nsh\n/)
    expect(yml).toMatch(/\nnsis:\n(?:  .+\n)*  perMachine: true\n/)
    expect(yml).toMatch(/\nnsis:\n(?:  .+\n)*  selectPerMachineByDefault: true\n/)
    expect(yml).toMatch(/\nmac:\n(?:  .+\n)*    - dmg\n/)
    expect(yml).toMatch(/\nlinux:\n(?:  .+\n)*    - AppImage\n/)
    expect(yml).toMatch(/^executableName: DeepSeekHarness$/m)
    expect(yml).not.toMatch(/publisherName/)
  })

  it('removes the installed tree in place instead of renaming it under the temp directory', () => {
    const nsh = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'installer.nsh'), 'utf8')
    expect(nsh).toMatch(/!macro customRemoveFiles\n  SetOutPath \$TEMP\n  RMDir \/r \$INSTDIR\n!macroend\n/)
  })

  it('deletes source maps from the deployed runtime and keeps the executed JavaScript', () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-runtime-prune-'))
    const nested = join(runtimeRoot, 'node_modules', '@scope', 'pkg', 'esm')
    mkdirSync(nested, { recursive: true })
    for (const name of ['index.js', 'index.js.map', 'index.d.ts', 'index.d.ts.map', 'style.css.map']) {
      writeFileSync(join(nested, name), '{}\n')
    }
    expect(pruneDesktopRuntimeSourceMaps(runtimeRoot)).toBe(3)
    expect(existsSync(join(nested, 'index.js'))).toBe(true)
    expect(existsSync(join(nested, 'index.d.ts'))).toBe(true)
    expect(existsSync(join(nested, 'index.js.map'))).toBe(false)
    expect(existsSync(join(nested, 'index.d.ts.map'))).toBe(false)
    expect(existsSync(join(nested, 'style.css.map'))).toBe(false)
    expect(pruneDesktopRuntimeSourceMaps(join(runtimeRoot, 'absent'))).toBe(0)
  })

  it('closes only DeepSeekHarness.exe and ignores window titles and install-dir prefixes', () => {
    const nsh = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'installer.nsh'), 'utf8')
    expect(nsh).toContain('!macro customCheckAppRunning')
    expect(nsh).toContain('IMAGENAME eq ${APP_EXECUTABLE_FILENAME}')
    expect(nsh).toContain('findstr.exe')
    expect(nsh).toContain('/B /I /C:"\\"${APP_EXECUTABLE_FILENAME}\\""')
    expect(nsh).not.toContain("StartsWith('$INSTDIR'")
    expect(nsh).not.toMatch(/FindWindow/)
    expect(nsh).not.toMatch(/nsProcess::/)
  })

  it('names the Electron dist entry electron-builder renames', () => {
    expect(desktopElectronDistEntry('win32')).toBe('electron.exe')
    expect(desktopElectronDistEntry('darwin')).toBe('Electron.app')
    expect(desktopElectronDistEntry('linux')).toBe('electron')
  })

  it('refuses an unpacked Electron dist that is missing the binary', () => {
    const electronDist = mkdtempSync(join(tmpdir(), 'dsh-desktop-electron-dist-'))
    expect(() => assertElectronDist(electronDist, 'win32')).toThrow('missing electron.exe')
    writeFileSync(join(electronDist, 'electron.exe'), '')
    expect(() => assertElectronDist(electronDist, 'win32')).not.toThrow()
  })

  it('refuses a deployed runtime that cannot resolve the CLI boot package', () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-runtime-assert-'))
    expect(() => assertDesktopRuntime(runtimeRoot)).toThrow('missing lib/bin.js')
    mkdirSync(join(runtimeRoot, 'lib'), { recursive: true })
    writeFileSync(join(runtimeRoot, 'lib', 'bin.js'), 'export {}\n')
    expect(() => assertDesktopRuntime(runtimeRoot)).toThrow('missing node_modules/@deepseek-ai/dsh-app-boot')
    mkdirSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh-app-boot'), { recursive: true })
    expect(() => assertDesktopRuntime(runtimeRoot)).toThrow('missing node_modules/@deepseek-ai/cordis-plugin-group')
    mkdirSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cordis-plugin-group'), { recursive: true })
    expect(() => assertDesktopRuntime(runtimeRoot)).toThrow('missing node_modules/@deepseek-ai/cosmokit')
    mkdirSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cosmokit'), { recursive: true })
    expect(() => assertDesktopRuntime(runtimeRoot)).not.toThrow()
  })

  it('uses a product description on the desktop package, not the implementation note', () => {
    const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')) as {
      description: string
      author: string
    }
    expect(manifest.description).toBe('DeepSeek Harness desktop application')
    expect(manifest.author).toBe('zous168')
    expect(manifest.description).not.toMatch(/loopback|web profile/i)
  })

  it('copies workspace packages that the deployed tree imports but did not materialize', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-workspace-'))
    const cosmokit = join(repoRoot, 'vendor', 'cosmokit')
    mkdirSync(cosmokit, { recursive: true })
    writeFileSync(join(cosmokit, 'package.json'), `${JSON.stringify({ name: '@deepseek-ai/cosmokit' })}\n`)
    writeFileSync(join(cosmokit, 'index.js'), 'export {}\n')
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-runtime-close-'))
    const cordis = join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cordis')
    mkdirSync(cordis, { recursive: true })
    writeFileSync(join(cordis, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/cordis',
      dependencies: { '@deepseek-ai/cosmokit': 'workspace:^' },
    })}\n`)
    expect(restoreDesktopWorkspaceClosure(runtimeRoot, repoRoot)).toEqual(['@deepseek-ai/cosmokit'])
    expect(readFileSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cosmokit', 'index.js'), 'utf8'))
      .toBe('export {}\n')
    mkdirSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cosmokit', 'stale'), { recursive: true })
    rmSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cosmokit', 'package.json'), { force: true })
    expect(restoreDesktopWorkspaceClosure(runtimeRoot, repoRoot)).toEqual(['@deepseek-ai/cosmokit'])
    expect(existsSync(join(runtimeRoot, 'node_modules', '@deepseek-ai', 'cosmokit', 'package.json'))).toBe(true)
  })

  it('writes the stamped update-feed.json the installer copies into extraResources', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dsh-desktop-feed-')), 'update-feed.json')
    writeDesktopUpdateFeedFile(path, { owner: 'zous168', repo: 'deepseek-harness-client' })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      owner: 'zous168',
      repo: 'deepseek-harness-client',
    })
  })
})
