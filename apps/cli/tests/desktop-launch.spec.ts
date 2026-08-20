import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  desktopElectronArgv,
  resolveDesktopLaunch,
  runDesktop,
  type DesktopModuleLookup,
  type DesktopProcessSpawner,
} from '../src/desktop-launch.ts'

const plan = { electron: '/opt/electron', main: '/app/lib/main.js' }

function desktopLookupWithMain(main = 'export {}\n'): DesktopModuleLookup & { main: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-launch-'))
  mkdirSync(join(root, 'lib'))
  writeFileSync(join(root, 'package.json'), '{}\n')
  const mainPath = join(root, 'lib', 'main.js')
  writeFileSync(mainPath, main)
  return {
    main: mainPath,
    resolve: (id) => {
      if (id === '@deepseek-ai/dsh-desktop/package.json') return join(root, 'package.json')
      throw new Error(`unexpected ${id}`)
    },
    electron: () => '/pkg/electron/dist/electron',
  }
}

describe('desktop launch', () => {
  it('forwards patches and leftover web flags after the main script', () => {
    expect(desktopElectronArgv(plan, { patches: ['a.yml'], args: ['--port', '8'] }))
      .toEqual(['/app/lib/main.js', '--patch', 'a.yml', '--port', '8'])
  })

  it('resolves Electron and the desktop main from the lookup, and explains a miss', () => {
    const lookup = desktopLookupWithMain()
    expect(resolveDesktopLaunch(lookup)).toEqual({
      electron: '/pkg/electron/dist/electron',
      main: lookup.main,
    })
    expect(() => resolveDesktopLaunch({
      resolve: () => '/unused',
      electron: () => { throw new Error('not found') },
    })).toThrow('Electron is not installed')
    expect(() => resolveDesktopLaunch({
      resolve: () => { throw new Error('missing desktop') },
      electron: () => '/electron',
    })).toThrow('@deepseek-ai/dsh-desktop is not installed')
    expect(() => resolveDesktopLaunch({
      resolve: () => '/pkg/desktop/package.json',
      electron: () => '',
    })).toThrow('did not export an executable path')
    expect(() => resolveDesktopLaunch({
      resolve: () => join(mkdtempSync(join(tmpdir(), 'dsh-desktop-empty-')), 'package.json'),
      electron: () => '/electron',
    })).toThrow('built main is missing')
  })

  it('forwards this process Node as DSH_NODE_EXECUTABLE', async () => {
    const previous = process.exitCode
    const child = new EventEmitter()
    let env: NodeJS.ProcessEnv | undefined
    const lookup = desktopLookupWithMain()
    const running = runDesktop({
      patches: [],
      args: [],
      lookup,
      env: { PATH: '/bin' },
      spawner: {
        spawn(_command, _args, childEnv) {
          env = childEnv
          return child as ReturnType<DesktopProcessSpawner['spawn']>
        },
      },
    })
    child.emit('exit', 0, null)
    await running
    expect(env?.DSH_NODE_EXECUTABLE).toBe(process.execPath)
    process.exitCode = previous
  })

  it('propagates the Electron exit code and maps SIGINT to 130', async () => {
    const previous = process.exitCode
    const child = new EventEmitter()
    const spawner: DesktopProcessSpawner = {
      spawn: () => child as ReturnType<DesktopProcessSpawner['spawn']>,
    }
    const lookup = desktopLookupWithMain()
    const running = runDesktop({ patches: [], args: [], lookup, spawner })
    child.emit('exit', 2, null)
    await running
    expect(process.exitCode).toBe(2)

    process.exitCode = previous
    const interrupted = new EventEmitter()
    const interruptedRun = runDesktop({
      patches: [],
      args: [],
      lookup,
      spawner: { spawn: () => interrupted as ReturnType<DesktopProcessSpawner['spawn']> },
    })
    interrupted.emit('exit', null, 'SIGINT')
    await interruptedRun
    expect(process.exitCode).toBe(130)
    process.exitCode = previous
  })
})
