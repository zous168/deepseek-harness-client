'use strict'

/**
 * Sandboxed preload for the packaged window. Exposes only minimize /
 * maximize / close; the renderer never gets Node or a BrowserWindow handle.
 * @module @deepseek-ai/dsh-desktop/preload
 */

const { contextBridge, ipcRenderer } = require('electron')

const CHANNEL = 'dsh-desktop:window'

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
