/**
 * Frameless packaged-window chrome: no OS title bar, injected drag regions,
 * and injected window buttons over the existing Web UI.
 * @module @deepseek-ai/dsh-desktop/window
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Fixed window title; the loaded Web UI must not replace it. */
export const WINDOW_TITLE = 'DeepSeek Harness'

/** Light sidebar fill `--dsw-static-neutral-bluish-50`. */
export const TITLE_BAR_LIGHT = '#f9fafb'

/** Dark sidebar fill `--dsw-static-neutral-bluish-900`. */
export const TITLE_BAR_DARK = '#1b1b1c'

/** IPC channel the sandboxed preload uses for window buttons. */
export const DESKTOP_WINDOW_IPC = 'dsh-desktop:window'

/** This package root: `src/` and `lib/` both sit one level under `apps/desktop`. */
const DESKTOP_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Constructor fields the desktop shell always sets on `BrowserWindow`. */
export interface DesktopWindowOptions {
  width: number
  height: number
  minWidth: number
  minHeight: number
  title: string
  icon: string
  show: false
  frame: false
  autoHideMenuBar: true
  thickFrame: true
  backgroundColor: string
  webPreferences: {
    sandbox: true
    contextIsolation: true
    nodeIntegration: false
    preload: string
  }
}

/** Window methods the IPC handler may call. */
export interface DesktopWindowCommands {
  minimize(): void
  maximize(): void
  unmaximize(): void
  isMaximized(): boolean
  close(): void
}

/**
 * Absolute path of the sandboxed preload that exposes window-button IPC.
 * @param root - package root, replaceable by tests.
 * @returns an existing preload path.
 */
export function resolveDesktopPreload(root: string = DESKTOP_ROOT): string {
  const preload = join(root, 'preload.cjs')
  if (!existsSync(preload)) {
    throw new Error(`dsh desktop: missing window preload at ${preload}`)
  }
  return preload
}

/**
 * Frameless `BrowserWindow` constructor options for one desktop launch.
 * `frame: false` removes the OS title bar. Resize stays on `thickFrame`.
 * Window buttons are injected after load and talk through {@link DESKTOP_WINDOW_IPC}.
 * @param icon - absolute DeepSeek icon path.
 * @param options - theme and preload path, replaceable by tests.
 * @returns options passed to `new BrowserWindow`.
 */
export function desktopBrowserWindowOptions(
  icon: string,
  options: { dark: boolean; preload: string },
): DesktopWindowOptions {
  return {
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: WINDOW_TITLE,
    icon,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    thickFrame: true,
    backgroundColor: options.dark ? TITLE_BAR_DARK : TITLE_BAR_LIGHT,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: options.preload,
    },
  }
}

/**
 * Apply one window-button action received over {@link DESKTOP_WINDOW_IPC}.
 * Unknown actions are ignored: the preload is trusted, the wire is not.
 * @param win - the window that sent the action.
 * @param action - `minimize`, `toggle-maximize`, or `close`.
 * @returns nothing.
 */
export function applyDesktopWindowAction(win: DesktopWindowCommands, action: unknown): void {
  switch (action) {
    case 'minimize':
      win.minimize()
      return
    case 'toggle-maximize':
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return
    case 'close':
      win.close()
      return
    default:
      return
  }
}

/**
 * CSS injected into the loaded Web UI so the frameless window can be moved.
 * A dedicated top strip covers the blank-hero column (the session `header` is
 * `display: none` there). Visible header / logo-row descendants also drag:
 * `-webkit-app-region` is not inherited, and Windows ignores a fully
 * transparent hit target. Interactive controls stay `no-drag`.
 * @returns a stylesheet body.
 */
export function desktopWindowChromeCss(): string {
  return [
    '#dsh-desktop-drag-region {',
    '  position: fixed; top: 0; right: 0; left: 0; z-index: 1; height: 36px;',
    '  -webkit-app-region: drag; background-color: rgba(0, 0, 0, 0.01);',
    '}',
    'header, [class*="logoRow"] {',
    '  position: relative; z-index: 2; -webkit-app-region: drag;',
    '  background-color: inherit;',
    '}',
    'header *, [class*="logoRow"] * { -webkit-app-region: drag; }',
    'header [class*="titleRow"], header [class*="titleCluster"], header [class*="tabs"] {',
    '  background-color: inherit;',
    '}',
    'header :is(button, a, input, [role="button"], [role="tab"]),',
    'header :is(button, a, input, [role="button"], [role="tab"]) *,',
    '[class*="logoRow"] button, [class*="logoRow"] button * { -webkit-app-region: no-drag; }',
    /* Conversation `.header` sets `padding: 12px 28px 0 20px` (class beats `header`). */
    'header[class*="header"] { padding-inline-end: 150px; }',
    '#dsh-desktop-window-controls {',
    '  position: fixed; top: 0; right: 0; z-index: 3;',
    '  display: flex; height: 36px; -webkit-app-region: no-drag;',
    '}',
    '#dsh-desktop-window-controls button {',
    '  width: 46px; height: 36px; margin: 0; padding: 0; border: 0;',
    '  background: transparent; color: var(--dsw-alias-label-primary, currentColor);',
    '  cursor: pointer;',
    '}',
    '#dsh-desktop-window-controls button:hover { background: var(--dsw-alias-fill-hover, rgba(127,127,127,.18)); }',
    '#dsh-desktop-window-controls button[data-action="close"]:hover { background: #e81123; color: #fff; }',
  ].join('\n')
}

/**
 * Page script that mounts the top drag strip and the minimize / maximize /
 * close cluster. Idempotent so Client navigations can run it again.
 * @returns a script body for `executeJavaScript`.
 */
export function desktopWindowControlsScript(): string {
  return `(() => {
  if (document.getElementById('dsh-desktop-drag-region') === null) {
    const drag = document.createElement('div')
    drag.id = 'dsh-desktop-drag-region'
    drag.setAttribute('aria-hidden', 'true')
    document.documentElement.appendChild(drag)
  }
  const api = globalThis.dshDesktopWindow
  if (api === undefined || document.getElementById('dsh-desktop-window-controls') !== null) return
  const root = document.createElement('div')
  root.id = 'dsh-desktop-window-controls'
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', 'Window')
  for (const [action, label, glyph] of [
    ['minimize', 'Minimize', '—'],
    ['toggle-maximize', 'Maximize', '□'],
    ['close', 'Close', '✕'],
  ]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.action = action
    button.setAttribute('aria-label', label)
    button.textContent = glyph
    button.addEventListener('click', () => {
      if (action === 'minimize') api.minimize()
      else if (action === 'toggle-maximize') api.toggleMaximize()
      else api.close()
    })
    root.appendChild(button)
  }
  document.documentElement.appendChild(root)
})()`
}
