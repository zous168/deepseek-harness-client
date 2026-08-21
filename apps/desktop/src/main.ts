/**
 * Electron main process for the packaged desktop window.
 * Boots the existing web profile as a child and loads its loopback URL.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { argvAfterMain, desktopInputFromArgv } from './argv.ts'
import { resolveHostPlan, startHost, type StartedHost } from './host.ts'
import { resolveDesktopIcon } from './icon.ts'
import {
  offerDesktopUpdate,
  readGitOriginUrl,
  resolveDesktopUpdateFeed,
  type DesktopDownloadProgress,
  type DesktopUpdate,
} from './update.ts'
import {
  DESKTOP_UPDATE_ACTION_IPC,
  DESKTOP_UPDATE_IPC,
  DESKTOP_WINDOW_IPC,
  WINDOW_TITLE,
  applyDesktopTaskbarProgress,
  applyDesktopWindowAction,
  desktopBrowserWindowOptions,
  desktopUpdateProgressView,
  desktopUpdateReadyView,
  desktopWindowChromeCss,
  desktopWindowControlsScript,
  resolveDesktopPreload,
  type DesktopUpdateProgressView,
} from './window.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))

let host: StartedHost | undefined
let lastDesktopUpdateChrome: DesktopUpdateProgressView = { kind: 'hidden', label: '' }
let desktopUpdateChromeSent = false
let resolveDesktopInstall: ((accepted: boolean) => void) | undefined

ipcMain.on(DESKTOP_WINDOW_IPC, (event, action: unknown) => {
  const sender = BrowserWindow.fromWebContents(event.sender)
  if (sender === null) return
  applyDesktopWindowAction(sender, action)
})

ipcMain.on(DESKTOP_UPDATE_ACTION_IPC, (_event, action: unknown) => {
  if (action !== 'install' || resolveDesktopInstall === undefined) return
  const resolve = resolveDesktopInstall
  resolveDesktopInstall = undefined
  resolve(true)
})

/**
 * Inject drag CSS and window buttons after each document load.
 * @param target - the packaged window.
 * @returns nothing.
 */
async function applyWindowChrome(target: BrowserWindow): Promise<void> {
  if (target.isDestroyed()) return
  await target.webContents.insertCSS(desktopWindowChromeCss())
  await target.webContents.executeJavaScript(desktopWindowControlsScript())
  if (!desktopUpdateChromeSent || target.isDestroyed()) return
  target.webContents.send(DESKTOP_UPDATE_IPC, lastDesktopUpdateChrome)
}

async function createWindow(url: string): Promise<BrowserWindow> {
  const created = new BrowserWindow(desktopBrowserWindowOptions(resolveDesktopIcon(), {
    dark: nativeTheme.shouldUseDarkColors,
    preload: resolveDesktopPreload(),
  }))
  created.on('page-title-updated', (event) => {
    event.preventDefault()
    created.setTitle(WINDOW_TITLE)
  })
  created.webContents.on('did-finish-load', () => {
    void applyWindowChrome(created)
  })
  await created.loadURL(url)
  await applyWindowChrome(created)
  created.show()
  return created
}

/**
 * Paint installer download progress in this window and on the process icon.
 * @param target - packaged window.
 * @param progress - bytes received, or `undefined` to hide.
 * @returns nothing.
 */
function publishDesktopUpdateChrome(target: BrowserWindow, view: DesktopUpdateProgressView): void {
  desktopUpdateChromeSent = true
  lastDesktopUpdateChrome = view
  if (target.isDestroyed()) return
  target.webContents.send(DESKTOP_UPDATE_IPC, view)
}

/**
 * Paint installer download progress in this window and on the process icon.
 * @param target - packaged window.
 * @param progress - bytes received, or `undefined` to hide.
 * @returns nothing.
 */
function publishDesktopUpdateProgress(
  target: BrowserWindow,
  progress: DesktopDownloadProgress | undefined,
): void {
  applyDesktopTaskbarProgress(target, progress)
  publishDesktopUpdateChrome(target, desktopUpdateProgressView(progress))
}

/**
 * Show a small title-bar install button and wait for a click.
 * Ignoring the button leaves the cached installer for the next launch.
 * @param update - detected installer.
 * @returns true when the user clicked the button.
 */
async function promptDesktopInstall(update: DesktopUpdate): Promise<boolean> {
  const target = BrowserWindow.getAllWindows()[0]
  if (target === undefined) return false
  applyDesktopTaskbarProgress(target, undefined)
  publishDesktopUpdateChrome(target, desktopUpdateReadyView(update.version))
  return await new Promise<boolean>((resolve) => {
    resolveDesktopInstall = resolve
  })
}

/**
 * Launch the downloaded NSIS installer and quit so it can replace this window.
 * @param installerPath - cached `.exe`.
 * @returns nothing.
 */
async function installDesktopUpdate(installerPath: string): Promise<void> {
  const error = await shell.openPath(installerPath)
  if (error !== '') throw new Error(error)
  stopHost()
  app.quit()
}

function stopHost(): void {
  const child = host?.child
  host = undefined
  if (child !== undefined && child.exitCode === null && child.signalCode === null) {
    child.kill()
  }
}

function desktopBootFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function boot(): Promise<void> {
  const input = desktopInputFromArgv(argvAfterMain(process.argv, app.isPackaged))
  host = await startHost(resolveHostPlan({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    electronExecutable: process.execPath,
    cwd: process.cwd(),
    input,
  }))
  const created = await createWindow(host.url)
  const originUrl = app.isPackaged ? undefined : readGitOriginUrl(resolve(desktopRoot, '..', '..'))
  void offerDesktopUpdate({
    currentVersion: app.getVersion(),
    skip: input.args.includes('--no-update-check'),
    feed: resolveDesktopUpdateFeed({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      ...(app.isPackaged ? {} : { desktopRoot }),
      ...(originUrl === undefined ? {} : { originUrl }),
    }),
    cacheDir: join(app.getPath('userData'), 'updates'),
    platform: process.platform,
    arch: process.arch,
    onProgress: (progress) => {
      publishDesktopUpdateProgress(created, progress)
    },
    promptInstall: promptDesktopInstall,
    install: installDesktopUpdate,
  })
}

app.whenReady().then(() => {
  void boot().catch((error: unknown) => {
    const reason = desktopBootFailureMessage(error)
    console.error(reason)
    dialog.showErrorBox(WINDOW_TITLE, reason)
    stopHost()
    app.exit(1)
  })
}).catch((error: unknown) => {
  const reason = desktopBootFailureMessage(error)
  console.error(reason)
  app.exit(1)
})

app.on('window-all-closed', () => {
  stopHost()
  app.quit()
})

app.on('before-quit', () => {
  stopHost()
})
