import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  argvAfterMain,
  desktopHostArgv,
  desktopInputFromArgv,
} from '../src/argv.ts'
import { resolveHostPlan, startHost, type HostProcessSpawner } from '../src/host.ts'
import { resolveDesktopIcon } from '../src/icon.ts'
import { parseWebReadyUrl } from '../src/url.ts'
import {
  TITLE_BAR_DARK,
  TITLE_BAR_LIGHT,
  WINDOW_TITLE,
  applyDesktopWindowAction,
  desktopBrowserWindowOptions,
  desktopWindowChromeCss,
  desktopWindowControlsScript,
  resolveDesktopPreload,
} from '../src/window.ts'

describe('desktop argv', () => {
  it('forces --no-open and an OS-assigned port when the caller named neither', () => {
    expect(desktopHostArgv({ patches: [], args: [] })).toEqual(['web', '--port', '0', '--no-open'])
  })

  it('keeps --no-update-check off the inner web argv', () => {
    expect(desktopHostArgv({ patches: [], args: ['--no-update-check'] })).toEqual(['web', '--port', '0', '--no-open'])
  })

  it('forwards patches and keeps an explicit port without duplicating --no-open', () => {
    expect(desktopHostArgv({
      patches: ['extra.yml'],
      args: ['--port', '8080', '--no-open', '--trusted-host', 'example.test'],
    })).toEqual([
      'web', '--patch', 'extra.yml', '--port', '8080', '--trusted-host', 'example.test', '--no-open',
    ])
  })

  it('accepts --port= and collects --patch forms from Electron leftover argv', () => {
    expect(desktopInputFromArgv(['--patch', 'a.yml', '--patch=b.yml', '--port=9'])).toEqual({
      patches: ['a.yml', 'b.yml'],
      args: ['--port=9'],
    })
    expect(() => desktopInputFromArgv(['--patch'])).toThrow('dsh desktop: --patch needs a path')
    expect(() => desktopInputFromArgv(['--patch='])).toThrow('dsh desktop: --patch needs a path')
  })

  it('drops Electron binary and main-script tokens', () => {
    expect(argvAfterMain(['electron', 'lib/main.js', '--port', '8'])).toEqual(['--port', '8'])
    expect(argvAfterMain(['electron.exe', 'H:/app/src/main.ts'])).toEqual([])
    expect(argvAfterMain(['electron', '.', '--port', '8'])).toEqual(['--port', '8'])
    expect(argvAfterMain(['DeepSeek Harness.exe', '--port', '8'], true)).toEqual(['--port', '8'])
  })
})

describe('web ready URL', () => {
  it('reads the canonical URL and ignores a LAN annotation', () => {
    expect(parseWebReadyUrl('dsh web: http://127.0.0.1:4567\n')).toBe('http://127.0.0.1:4567')
    expect(parseWebReadyUrl('dsh web: http://127.0.0.1:4567 (LAN: http://192.168.1.5:4567)'))
      .toBe('http://127.0.0.1:4567')
    expect(parseWebReadyUrl('dsh web: opening the default browser; pass --no-open to disable')).toBeUndefined()
  })
})

describe('desktop icon', () => {
  it('resolves the DeepSeek whale mark from the package icons directory', () => {
    const icon = resolveDesktopIcon()
    expect(icon.replaceAll('\\', '/')).toMatch(/icons\/icon\.(png|svg)$/)
  })

  it('prefers the raster PNG when both marks exist and fails when neither does', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-icon-'))
    mkdirSync(join(root, 'icons'))
    writeFileSync(join(root, 'icons', 'icon.svg'), '<svg />')
    expect(resolveDesktopIcon(root)).toBe(join(root, 'icons', 'icon.svg'))
    writeFileSync(join(root, 'icons', 'icon.png'), 'png')
    expect(resolveDesktopIcon(root)).toBe(join(root, 'icons', 'icon.png'))
    expect(() => resolveDesktopIcon(join(root, 'missing'))).toThrow('missing DeepSeek icon')
  })
})

describe('frameless window chrome', () => {
  it('opens with no OS title bar and a sandboxed window-button preload', () => {
    const preload = resolveDesktopPreload()
    expect(preload.replaceAll('\\', '/')).toMatch(/preload\.cjs$/)
    const options = desktopBrowserWindowOptions('/icon.png', { dark: true, preload })
    expect(options).toMatchObject({
      title: WINDOW_TITLE,
      show: false,
      frame: false,
      thickFrame: true,
      backgroundColor: TITLE_BAR_DARK,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload,
      },
    })
    expect(options).not.toHaveProperty('titleBarOverlay')
    expect(desktopBrowserWindowOptions('/icon.png', { dark: false, preload }).backgroundColor)
      .toBe(TITLE_BAR_LIGHT)
  })

  it('injects a top drag strip plus descendant drag on existing header chrome', () => {
    const css = desktopWindowChromeCss()
    expect(css).toContain('#dsh-desktop-drag-region')
    expect(css).toContain('header *')
    expect(css).toContain('-webkit-app-region: drag')
    expect(css).toContain('-webkit-app-region: no-drag')
    expect(css).toContain('header[class*="header"]')
    expect(css).toContain('padding-inline-end: 150px')
    expect(css).toContain('#dsh-desktop-window-controls')
    expect(desktopWindowControlsScript()).toContain('dsh-desktop-drag-region')
    expect(desktopWindowControlsScript()).toContain('dshDesktopWindow')
  })

  it('routes injected window-button actions and ignores an unknown action', () => {
    const win = {
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      isMaximized: vi.fn(() => false),
      close: vi.fn(),
    }
    applyDesktopWindowAction(win, 'minimize')
    applyDesktopWindowAction(win, 'toggle-maximize')
    win.isMaximized.mockReturnValue(true)
    applyDesktopWindowAction(win, 'toggle-maximize')
    applyDesktopWindowAction(win, 'close')
    applyDesktopWindowAction(win, 'explode')
    expect(win.minimize).toHaveBeenCalledOnce()
    expect(win.maximize).toHaveBeenCalledOnce()
    expect(win.unmaximize).toHaveBeenCalledOnce()
    expect(win.close).toHaveBeenCalledOnce()
  })
})

describe('host launch plan', () => {
  it('runs the built CLI under the launcher Node from a checkout', () => {
    const parent = mkdtempSync(join(tmpdir(), 'dsh-desktop-plan-'))
    const desktopRoot = join(parent, 'desktop')
    mkdirSync(desktopRoot)
    const cliBin = join(parent, 'cli', 'lib', 'bin.js')
    mkdirSync(join(parent, 'cli', 'lib'), { recursive: true })
    writeFileSync(cliBin, 'export {}\n')
    const plan = resolveHostPlan({
      packaged: false,
      resourcesPath: '/unused',
      desktopRoot,
      nodeExecutable: process.execPath,
      cwd: '/workspace',
      input: { patches: [], args: [] },
      env: { PATH: '/bin' },
    })
    expect(plan).toEqual({
      command: process.execPath,
      args: [cliBin, 'web', '--port', '0', '--no-open'],
      cwd: '/workspace',
      env: { PATH: '/bin', DSH_NODE_EXECUTABLE: process.execPath },
    })
  })

  it('reads DSH_NODE_EXECUTABLE from the inherited environment', () => {
    const parent = mkdtempSync(join(tmpdir(), 'dsh-desktop-env-node-'))
    const desktopRoot = join(parent, 'desktop')
    mkdirSync(desktopRoot)
    const cliBin = join(parent, 'cli', 'lib', 'bin.js')
    mkdirSync(join(parent, 'cli', 'lib'), { recursive: true })
    writeFileSync(cliBin, 'export {}\n')
    const plan = resolveHostPlan({
      packaged: false,
      resourcesPath: '/unused',
      desktopRoot,
      cwd: '/workspace',
      input: { patches: [], args: [] },
      env: { DSH_NODE_EXECUTABLE: process.execPath },
    })
    expect(plan.command).toBe(process.execPath)
    expect(plan.env.DSH_NODE_EXECUTABLE).toBe(process.execPath)
  })

  it('runs the packaged CLI through Electron-as-Node', () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'dsh-desktop-runtime-'))
    const bin = join(resourcesPath, 'runtime', 'lib', 'bin.js')
    mkdirSync(join(resourcesPath, 'runtime', 'lib'), { recursive: true })
    writeFileSync(bin, 'export {}\n')
    const plan = resolveHostPlan({
      packaged: true,
      resourcesPath,
      electronExecutable: '/opt/DeepSeek Harness',
      cwd: '/home/me',
      input: { patches: ['p.yml'], args: ['--host', '127.0.0.1'] },
      env: { HOME: '/home/me' },
    })
    expect(plan.command).toBe('/opt/DeepSeek Harness')
    expect(plan.args).toEqual([bin, 'web', '--patch', 'p.yml', '--host', '127.0.0.1', '--port', '0', '--no-open'])
    expect(plan.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('fails loud when the matching CLI artifact is absent', () => {
    expect(() => resolveHostPlan({
      packaged: false,
      resourcesPath: '/unused',
      desktopRoot: join(tmpdir(), 'dsh-desktop-missing'),
      cwd: tmpdir(),
      input: { patches: [], args: [] },
    })).toThrow('built CLI is missing')
    expect(() => resolveHostPlan({
      packaged: true,
      resourcesPath: join(tmpdir(), 'dsh-desktop-empty-runtime'),
      cwd: tmpdir(),
      input: { patches: [], args: [] },
    })).toThrow('packaged runtime is missing')
  })
})

describe('startHost', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves on the ready line, echoes stdout, and rejects a silent exit', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const ready = createFakeChild()
    const started = startHost({
      command: 'node',
      args: ['web'],
      cwd: tmpdir(),
      env: {},
    }, {
      timeoutMs: 1_000,
      spawner: { spawn: () => ready.child },
    })
    ready.emitStdout('noise\ndsh web: http://127.0.0.1:9 (LAN: http://10.0.0.2:9)\n')
    await expect(started).resolves.toMatchObject({ url: 'http://127.0.0.1:9' })
    expect(write).toHaveBeenCalled()

    const dead = createFakeChild()
    const failed = startHost({
      command: 'node',
      args: ['web'],
      cwd: tmpdir(),
      env: {},
    }, {
      timeoutMs: 1_000,
      spawner: { spawn: () => dead.child },
    })
    dead.child.emit('exit', 1, null)
    await expect(failed).rejects.toThrow('ended before printing a ready URL (exit 1)')
  })
})

function createFakeChild(): {
  child: ReturnType<HostProcessSpawner['spawn']>
  emitStdout: (text: string) => void
} {
  const stdout = new EventEmitter() as EventEmitter & {
    setEncoding: (encoding: BufferEncoding) => void
    off: (event: string, listener: (...args: unknown[]) => void) => EventEmitter
  }
  stdout.setEncoding = () => undefined
  const child = new EventEmitter() as ReturnType<HostProcessSpawner['spawn']>
  Object.assign(child, {
    stdout,
    exitCode: null,
    signalCode: null,
    kill: () => true,
  })
  return {
    child,
    emitStdout(text) {
      stdout.emit('data', text)
    },
  }
}
