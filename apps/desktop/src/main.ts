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
  type DesktopUpdate,
} from './update.ts'
import {
  DESKTOP_WINDOW_IPC,
  WINDOW_TITLE,
  applyDesktopWindowAction,
  desktopBrowserWindowOptions,
  desktopWindowChromeCss,
  desktopWindowControlsScript,
  resolveDesktopPreload,
} from './window.ts'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))

let host: StartedHost | undefined

ipcMain.on(DESKTOP_WINDOW_IPC, (event, action: unknown) => {
  const sender = BrowserWindow.fromWebContents(event.sender)
  if (sender === null) return
  applyDesktopWindowAction(sender, action)
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
  created.show()
  return created
}

/**
 * Ask whether to run a silently downloaded installer.
 * @param update - detected installer.
 * @param currentVersion - running `app.getVersion()`.
 * @returns true when the user authorized install.
 */
async function promptDesktopInstall(update: DesktopUpdate, currentVersion: string): Promise<boolean> {
  if (BrowserWindow.getAllWindows().length === 0) return false
  const choice = await dialog.showMessageBox({
    type: 'info',
    title: WINDOW_TITLE,
    message: `A newer ${WINDOW_TITLE} is ready to install.`,
    detail: `This window: ${currentVersion}\nAvailable: ${update.version}\nInstalling will close this window.`,
    buttons: ['Later', 'Install'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  return choice.response === 1
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
  await createWindow(host.url)
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
