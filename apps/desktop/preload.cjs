'use strict'

/**
 * Sandboxed preload for the packaged window. Exposes only minimize /
 * maximize / close, paints silent download progress, and offers a small
 * install button after the installer is cached. The renderer never gets
 * Node or a BrowserWindow handle.
 * @module @deepseek-ai/dsh-desktop/preload
 */

const { contextBridge, ipcRenderer } = require('electron')

const CHANNEL = 'dsh-desktop:window'
const UPDATE_CHANNEL = 'dsh-desktop:update'
const UPDATE_ACTION_CHANNEL = 'dsh-desktop:update-action'
const PROGRESS_ID = 'dsh-desktop-update-progress'

contextBridge.exposeInMainWorld('dshDesktopWindow', {
  /**
   * Minimize the packaged window.
   * @returns nothing.
   */
  minimize() {
    ipcRenderer.send(CHANNEL, 'minimize')
  },
  /**
   * Maximize or restore the packaged window.
   * @returns nothing.
   */
  toggleMaximize() {
    ipcRenderer.send(CHANNEL, 'toggle-maximize')
  },
  /**
   * Close the packaged window.
   * @returns nothing.
   */
  close() {
    ipcRenderer.send(CHANNEL, 'close')
  },
})

/**
 * Mount or update the quiet title-bar download meter or install button.
 * @param view - progress payload from the main process.
 * @returns nothing.
 */
function renderUpdateProgress(view) {
  if (view == null || view.kind === 'hidden' || view.kind === undefined) {
    const hidden = document.getElementById(PROGRESS_ID)
    hidden?.removeAttribute('data-visible')
    hidden?.removeAttribute('data-kind')
    hidden?.setAttribute('aria-hidden', 'true')
    return
  }
  let root = document.getElementById(PROGRESS_ID)
  if (root === null) {
    root = document.createElement('div')
    root.id = PROGRESS_ID
    root.setAttribute('role', 'status')
    root.setAttribute('aria-live', 'polite')
    root.setAttribute('aria-atomic', 'true')
    for (const part of ['label', 'detail', 'percent']) {
      const node = document.createElement('span')
      node.dataset.part = part
      root.appendChild(node)
    }
    const action = document.createElement('button')
    action.type = 'button'
    action.dataset.part = 'action'
    action.addEventListener('click', () => {
      ipcRenderer.send(UPDATE_ACTION_CHANNEL, 'install')
    })
    root.appendChild(action)
    const track = document.createElement('span')
    track.dataset.part = 'track'
    const fill = document.createElement('span')
    fill.dataset.part = 'fill'
    track.appendChild(fill)
    root.appendChild(track)
    document.documentElement.appendChild(root)
  }
  root.setAttribute('data-visible', '')
  root.setAttribute('data-kind', view.kind)
  root.removeAttribute('aria-hidden')
  const label = typeof view.label === 'string' ? view.label : ''
  const detail = typeof view.detail === 'string' ? view.detail : ''
  const percent = typeof view.percent === 'number' ? view.percent : undefined
  setPartText(root, 'label', label)
  setPartText(root, 'detail', detail)
  setPartText(root, 'percent', percent === undefined ? '' : `${String(percent)}%`)
  setPartText(root, 'action', label)
  const action = root.querySelector('[data-part="action"]')
  if (action !== null) action.setAttribute('aria-label', label)
  root.setAttribute('aria-label', joinProgressAnnouncement(label, percent, detail))
  if (view.kind === 'ready') {
    root.removeAttribute('data-indeterminate')
    root.style.removeProperty('--dsh-desktop-update-ratio')
    return
  }
  if (percent === undefined) {
    root.setAttribute('data-indeterminate', '')
    root.style.removeProperty('--dsh-desktop-update-ratio')
    return
  }
  root.removeAttribute('data-indeterminate')
  root.style.setProperty('--dsh-desktop-update-ratio', String(percent / 100))
}

/**
 * Write one named span or button inside the chip.
 * @param root - chip root.
 * @param part - `label`, `detail`, `percent`, or `action`.
 * @param text - visible text.
 * @returns nothing.
 */
function setPartText(root, part, text) {
  const node = root.querySelector(`[data-part="${part}"]`)
  if (node !== null) node.textContent = text
}

/**
 * Spoken status that includes the byte count even when the chip hides it.
 * @param label - short verb or install label.
 * @param percent - whole percent, when known.
 * @param detail - byte count or version.
 * @returns a single announcement.
 */
function joinProgressAnnouncement(label, percent, detail) {
  const parts = [label]
  if (percent !== undefined) parts.push(`${String(percent)} percent`)
  if (detail !== '') parts.push(detail)
  return parts.join(', ')
}

ipcRenderer.on(UPDATE_CHANNEL, (_event, view) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      renderUpdateProgress(view)
    }, { once: true })
    return
  }
  renderUpdateProgress(view)
})
