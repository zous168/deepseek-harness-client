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

/** IPC channel the main process uses to paint installer download progress. */
export const DESKTOP_UPDATE_IPC = 'dsh-desktop:update'

/** IPC channel the preload uses when the user accepts the ready installer. */
export const DESKTOP_UPDATE_ACTION_IPC = 'dsh-desktop:update-action'

/** Overlay id the preload mounts while a silent installer download is running. */
export const DESKTOP_UPDATE_PROGRESS_ID = 'dsh-desktop-update-progress'

/** Title-bar button shown after the installer is cached. */
export const DESKTOP_UPDATE_INSTALL_LABEL = '安装更新'

/** Renderer payload for one download-progress or ready-to-install paint. */
export interface DesktopUpdateProgressView {
  /** `hidden` removes the chrome. `ready` replaces the meter with the install button. */
  readonly kind: 'hidden' | 'progress' | 'ready'
  /** Whole percent when the total is known. */
  readonly percent?: number
  /** Spoken status, or the install-button label when `kind` is `ready`. */
  readonly label: string
  /** Spoken byte count or the ready version. */
  readonly detail?: string
}

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

/** Only empty handles marked with this attribute become Electron drag surfaces. */
export const DESKTOP_APP_DRAG_ATTR = 'data-dsh-app-drag'

/** Injected top-strip handle while the page has no chrome `[data-dsh-app-drag]`. */
export const DESKTOP_APP_DRAG_FALLBACK_ID = 'dsh-desktop-drag-fallback'

/** Interactive widgets that must receive clicks if they sit on a drag handle. */
const DESKTOP_NO_DRAG_CONTROLS = [
  'button', 'a', 'input', 'textarea', 'select',
  '[role="button"]', '[role="tab"]', '[role="menuitem"]',
  '[role="switch"]', '[role="checkbox"]', '[role="slider"]',
  '[role="textbox"]', '[role="combobox"]', '[role="listbox"]',
  '[contenteditable="true"]',
].join(', ')

/** Portaled overlays and any dialog; used by CSS `:has` and the inject script. */
const DESKTOP_OVERLAY_SELECTOR = [
  '[aria-modal="true"]',
  '[role="dialog"]',
  'body > [role="presentation"]',
].join(', ')

/**
 * CSS injected into the loaded Web UI so the frameless window can be moved.
 * Drag is only `[data-dsh-app-drag]` handles — never a header, hero column, or
 * other content box. While the framework-free boot page is visible, or the
 * page has not opted in a chrome handle, the shell injects one top-strip
 * fallback and marks the boot wordmark. Chrome handles replace that fallback.
 * Controls on a handle stay `no-drag`. Electron hit-tests `-webkit-app-region`
 * independently of overlay paint, so any matching overlay turns those handles
 * off. A leftover sibling overlay strip is removed on inject.
 * @returns a stylesheet body.
 */
export function desktopWindowChromeCss(): string {
  const handle = `[${DESKTOP_APP_DRAG_ATTR}]`
  const whenOverlay = (suffix: string) => [
    `html[data-dsh-desktop-overlay] ${suffix}`,
    ...DESKTOP_OVERLAY_SELECTOR.split(', ').map(sel => `html:has(${sel}) ${suffix}`),
  ].join(', ')
  return [
    `${handle} { -webkit-app-region: drag; }`,
    `${handle} :is(${DESKTOP_NO_DRAG_CONTROLS}),`,
    `${handle} :is(${DESKTOP_NO_DRAG_CONTROLS}) * {`,
    '  -webkit-app-region: no-drag;',
    '}',
    `${whenOverlay(handle)} { -webkit-app-region: no-drag; }`,
    `#${DESKTOP_APP_DRAG_FALLBACK_ID} {`,
    '  position: fixed; top: 0; right: 150px; left: 0; z-index: 1; height: 36px;',
    '}',
    /* Conversation `.header` sets `padding: 12px 28px 0 20px` (class beats `header`). */
    'header[class*="header"] { padding-inline-end: 150px; }',
    '#dsh-desktop-window-controls {',
    '  position: fixed; top: 0; right: 0; z-index: 2;',
    '  display: flex; height: 36px; -webkit-app-region: no-drag;',
    '}',
    '#dsh-desktop-window-controls button {',
    '  width: 46px; height: 36px; margin: 0; padding: 0; border: 0;',
    '  background: transparent; color: var(--dsw-alias-label-primary, currentColor);',
    '  cursor: pointer;',
    '}',
    '#dsh-desktop-window-controls button:hover { background: var(--dsw-alias-fill-hover, rgba(127,127,127,.18)); }',
    '#dsh-desktop-window-controls button[data-action="close"]:hover { background: #e81123; color: #fff; }',
    `#${DESKTOP_UPDATE_PROGRESS_ID} {`,
    '  position: fixed; top: 8px; right: 150px; z-index: 3;',
    '  display: none; align-items: center; gap: 6px;',
    '  height: 20px; pointer-events: none; -webkit-app-region: no-drag;',
    '  color: var(--dsw-alias-label-secondary, var(--dsw-alias-label-primary, inherit));',
    '  font: var(--dsw-font-xs-13, 12px/16px var(--dsw-font-family, inherit));',
    '}',
    `#${DESKTOP_UPDATE_PROGRESS_ID}[data-visible] { display: flex; }`,
    `#${DESKTOP_UPDATE_PROGRESS_ID} [data-part="label"],`,
    `#${DESKTOP_UPDATE_PROGRESS_ID} [data-part="detail"] { display: none; }`,
    `#${DESKTOP_UPDATE_PROGRESS_ID} [data-part="action"] { display: none; }`,
    `#${DESKTOP_UPDATE_PROGRESS_ID}[data-kind="ready"] [data-part="percent"],`,
    `#${DESKTOP_UPDATE_PROGRESS_ID}[data-kind="ready"] [data-part="track"] { display: none; }`,
    `#${DESKTOP_UPDATE_PROGRESS_ID}[data-kind="ready"] [data-part="action"] {`,
    '  display: inline-flex; align-items: center; height: 22px; padding: 0 8px;',
    '  pointer-events: auto; -webkit-app-region: no-drag; cursor: pointer;',
    '  border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.28));',
    '  border-radius: 8px; background: transparent; color: inherit; font: inherit;',
    '}',
    `#${DESKTOP_UPDATE_PROGRESS_ID}[data-kind="ready"] [data-part="action"]:hover {`,
    '  background: var(--dsw-alias-fill-hover, rgba(127,127,127,.18));',
    '}',
    `#${DESKTOP_UPDATE_PROGRESS_ID} [data-part="percent"] {`,
    '  flex: none; font-variant-numeric: tabular-nums;',
    '}',
    `#${DESKTOP_UPDATE_PROGRESS_ID} [data-part="track"] {`,
    '  flex: none; width: 40px; height: 2px; overflow: hidden; border-radius: 999px;',
    '  background: var(--dsw-alias-fill-hover, rgba(127,127,127,.22));',
    '}',
    `#${DESKTOP_UPDATE_PROGRESS_ID} [data-part="fill"] {`,
    '  display: block; height: 100%; width: 100%; transform-origin: left center;',
    '  transform: scaleX(var(--dsh-desktop-update-ratio, 0));',
    '  background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary, #4d6bfe));',
    '  transition: transform var(--ds-transition-duration-fast, .1s) var(--ds-ease-in-out, cubic-bezier(.4,0,.2,1));',
    '}',
    '@keyframes dsh-desktop-update-indeterminate {',
    '  from { transform: translateX(-120%) scaleX(.28); }',
    '  to { transform: translateX(220%) scaleX(.28); }',
    '}',
    `#${DESKTOP_UPDATE_PROGRESS_ID}[data-indeterminate] [data-part="fill"] {`,
    '  animation: dsh-desktop-update-indeterminate 1.2s var(--ds-ease-in-out, cubic-bezier(.4,0,.2,1)) infinite;',
    '}',
    '@media (prefers-reduced-motion: reduce) {',
    `  #${DESKTOP_UPDATE_PROGRESS_ID} [data-part="fill"] { transition: none; }`,
    `  #${DESKTOP_UPDATE_PROGRESS_ID}[data-indeterminate] [data-part="fill"] {`,
    '    animation: none; transform: scaleX(.28);',
    '  }',
    '}',
  ].join('\n')
}

/**
 * Format a byte count using the unit of `scaleBytes` so both ends of a
 * progress pair share one unit.
 * @param bytes - value to show.
 * @param scaleBytes - the larger count that picks B / KB / MB.
 * @returns a short size string.
 */
export function desktopDownloadSizeLabel(bytes: number, scaleBytes: number = bytes): string {
  if (scaleBytes < 1024) return `${Math.round(bytes)} B`
  if (scaleBytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  if (scaleBytes < 10 * 1024 * 1024) return `${mb.toFixed(1)} MB`
  return `${Math.round(mb)} MB`
}

/**
 * Quiet title-bar meter for a silent installer download.
 * The session stays on screen; only percent is painted.
 * @param progress - bytes received, or `undefined` to hide.
 * @returns a renderer payload.
 */
export function desktopUpdateProgressView(progress: {
  received: number
  total?: number
} | undefined): DesktopUpdateProgressView {
  if (progress === undefined) return { kind: 'hidden', label: '' }
  if (progress.total === undefined || progress.total <= 0) {
    return {
      kind: 'progress',
      label: 'Update',
      detail: desktopDownloadSizeLabel(progress.received),
    }
  }
  const percent = Math.min(100, Math.floor((progress.received / progress.total) * 100))
  return {
    kind: 'progress',
    percent,
    label: 'Update',
    detail: `${desktopDownloadSizeLabel(progress.received, progress.total)} of ${desktopDownloadSizeLabel(progress.total)}`,
  }
}

/**
 * Title-bar install button after a silent download finishes.
 * The session stays on screen until the user clicks it.
 * @param version - ready installer version.
 * @returns a renderer payload.
 */
export function desktopUpdateReadyView(version: string): DesktopUpdateProgressView {
  return { kind: 'ready', label: DESKTOP_UPDATE_INSTALL_LABEL, detail: version }
}

/**
 * Taskbar progress for one download-progress event.
 * @param progress - bytes received, or `undefined` to clear the process icon.
 * @returns `setProgressBar` arguments.
 */
export function desktopTaskbarProgress(progress: {
  received: number
  total?: number
} | undefined): { value: number; mode?: 'normal' | 'indeterminate' } {
  if (progress === undefined) return { value: -1 }
  if (progress.total === undefined || progress.total <= 0) {
    return { value: 0, mode: 'indeterminate' }
  }
  return { value: Math.min(1, progress.received / progress.total), mode: 'normal' }
}

/**
 * Drive `BrowserWindow.setProgressBar` from download bytes.
 * @param win - packaged window.
 * @param progress - bytes received, or `undefined` to clear.
 * @returns nothing.
 */
export function applyDesktopTaskbarProgress(
  win: { setProgressBar(value: number, options?: { mode: 'normal' | 'indeterminate' }): void },
  progress: { received: number; total?: number } | undefined,
): void {
  const next = desktopTaskbarProgress(progress)
  if (next.mode === undefined) {
    win.setProgressBar(-1)
    return
  }
  win.setProgressBar(next.value, { mode: next.mode })
}

/**
 * Page script that mounts the minimize / maximize / close cluster, keeps
 * `html[data-dsh-desktop-overlay]` in sync with any dialog or body overlay,
 * and keeps a top-strip drag fallback while the boot page is visible.
 * Overlay sync is idempotent so Client navigations can run it again.
 * @returns a script body for `executeJavaScript`.
 */
export function desktopWindowControlsScript(): string {
  return `(() => {
  document.getElementById('dsh-desktop-drag-region')?.remove()
  const overlaySel = ${JSON.stringify(DESKTOP_OVERLAY_SELECTOR)}
  const dragAttr = ${JSON.stringify(DESKTOP_APP_DRAG_ATTR)}
  const fallbackId = ${JSON.stringify(DESKTOP_APP_DRAG_FALLBACK_ID)}
  const syncOverlay = () => {
    document.documentElement.toggleAttribute(
      'data-dsh-desktop-overlay',
      document.querySelector(overlaySel) !== null,
    )
  }
  const syncFallback = () => {
    const boot = document.querySelector('[data-dsh-boot]')
    if (boot !== null) {
      const title = boot.querySelector('[data-dsh-boot-wordmark]')
        ?? boot.querySelector(':scope > * > :first-child')
      if (title !== null) title.setAttribute(dragAttr, '')
    }
    const chromeHandle = [...document.querySelectorAll('[' + dragAttr + ']')].some(el => (
      el.id !== fallbackId && el.closest('[data-dsh-boot]') === null
    ))
    const fallback = document.getElementById(fallbackId)
    if (chromeHandle) {
      fallback?.remove()
      return
    }
    if (fallback !== null) return
    const strip = document.createElement('div')
    strip.id = fallbackId
    strip.setAttribute(dragAttr, '')
    strip.setAttribute('aria-hidden', 'true')
    document.documentElement.appendChild(strip)
  }
  const sync = () => {
    syncOverlay()
    syncFallback()
  }
  if (globalThis.__dshDesktopOverlaySync === undefined) {
    globalThis.__dshDesktopOverlaySync = sync
    new MutationObserver(sync).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['role', 'aria-modal'],
    })
  }
  sync()
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
