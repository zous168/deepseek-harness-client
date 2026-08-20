/**
 * Real-process half of the Win32 dialog driver: spawn the dialog child
 * process (source or built plane) and close a dialog thread's windows. The
 * module itself loads everywhere (the import chain from native-picker.ts is
 * static); what stays win32-only is koffi, imported dynamically inside the
 * bindings' functions. The driver's logic is tested against fakes of this
 * surface instead.
 */

import { spawn, type StdioOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Win32DialogWorkerData } from './win32-dialog-worker.ts'

/**
 * Environment for the dialog child. `ELECTRON_RUN_AS_NODE` is required when
 * the child executable is still an Electron binary.
 * @param title - dialog title forwarded as `DSH_DIALOG_TITLE`.
 * @returns the child environment.
 */
export function dialogWorkerEnv(title: string): NodeJS.ProcessEnv {
  return { ...process.env, DSH_DIALOG_TITLE: title, ELECTRON_RUN_AS_NODE: '1' }
}

/**
 * Node binary that should run the dialog child. Prefers the desktop launcher's
 * `DSH_NODE_EXECUTABLE` so an Electron window does not spawn a second app.
 * @param env - environment that may carry the launcher's Node path.
 * @returns an existing executable path.
 */
export function resolveDialogWorkerExecPath(env: NodeJS.ProcessEnv = process.env): string {
  for (const candidate of [env.DSH_NODE_EXECUTABLE, env.npm_node_execpath]) {
    if (candidate !== undefined && candidate !== '' && existsSync(candidate)) return candidate
  }
  return process.execPath
}

/**
 * Spawn the dialog child process. Built consumers launch the bundled CJS
 * entry next to this module under plain node; unbuilt (source) consumers
 * bootstrap tsx first, mirroring the dsh CLI's source launch. The dialog is
 * the child's first window, so Windows activates it without a foreground
 * call.
 * @param data - the child payload (dialog title).
 * @returns the spawned child process.
 */
export function spawnDialogWorker(data: Win32DialogWorkerData): ReturnType<typeof spawn> {
  const env = dialogWorkerEnv(data.title)
  const execPath = resolveDialogWorkerExecPath(env)
  const stdio: StdioOptions = ['ignore', 'inherit', 'inherit', 'ipc']
  /* v8 ignore next 3 -- the built-output arm: tests always run unbuilt (src/) */
  if (!import.meta.url.endsWith('.ts')) {
    return spawn(execPath, [fileURLToPath(new URL('./worker.cjs', import.meta.url))], { env, stdio, windowsHide: true })
  }
  return spawn(execPath, ['--import', import.meta.resolve('tsx/esm'), fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], { env, stdio, windowsHide: true })
}

export { closeThreadWindows } from './win32-dialog-bindings.ts'
