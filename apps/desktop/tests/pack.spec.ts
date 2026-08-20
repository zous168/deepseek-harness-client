import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  desktopBuilderManifest,
  desktopBuilderOptions,
  desktopDeployArgs,
  desktopRepoRoot,
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
      '--config.link-workspace-packages=true',
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
    expect(desktopBuilderOptions({
      desktopRoot: '/repo/apps/desktop',
      runtimeRoot: '/repo/apps/desktop/runtime',
      electronDist: '/repo/node_modules/electron/dist',
    })).toEqual({
      projectDir: '/repo/apps/desktop',
      publish: 'never',
      config: {
        electronDist: '/repo/node_modules/electron/dist',
        extraResources: [
          { from: '/repo/apps/desktop/runtime', to: 'runtime' },
        ],
      },
    })
    expect(desktopBuilderOptions({
      desktopRoot: '/repo/apps/desktop',
      runtimeRoot: '/repo/apps/desktop/runtime',
      electronDist: '/repo/node_modules/electron/dist',
      updateFeedPath: '/repo/apps/desktop/update-feed.json',
    }).config).toMatchObject({
      extraResources: [
        { from: '/repo/apps/desktop/runtime', to: 'runtime' },
        { from: '/repo/apps/desktop/update-feed.json', to: 'update-feed.json' },
      ],
    })
  })

  it('pins the Windows per-machine NSIS options and the macOS and Linux targets', () => {
    const yml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/\nnsis:\n(?:  .+\n)*  perMachine: true\n/)
    expect(yml).toMatch(/\nnsis:\n(?:  .+\n)*  selectPerMachineByDefault: true\n/)
    expect(yml).toMatch(/\nmac:\n(?:  .+\n)*    - dmg\n/)
    expect(yml).toMatch(/\nlinux:\n(?:  .+\n)*    - AppImage\n/)
    expect(yml).toMatch(/^executableName: DeepSeekHarness$/m)
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
