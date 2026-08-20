/**
 * Launch the packaged Electron window over the web profile.
 * @module @deepseek-ai/dsh/desktop-launch
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'

const DESKTOP_PACKAGE = '@deepseek-ai/dsh-desktop'

/** Replaceable Electron spawn used by tests. */
export interface DesktopProcessSpawner {
  /**
   * Spawn the Electron main process with inherited stdio.
   * @param command - Electron executable.
   * @param args - argv after the executable, starting at the desktop main script.
   * @param env - child environment.
   * @param cwd - invoking directory.
   * @returns the child process.
   */
  spawn(command: string, args: readonly string[], env: NodeJS.ProcessEnv, cwd: string): ChildProcess
}

/** Paths the launcher needs to start Electron. */
export interface DesktopLaunchPlan {
  /** Absolute Electron executable. */
  electron: string
  /** Absolute desktop main script (`lib/main.js`). */
  main: string
}

/** Module lookup used to find the desktop package and its Electron binary. */
export interface DesktopModuleLookup {
  /**
   * Resolve a package subpath from the CLI package.
   * @param id - specifier such as `@deepseek-ai/dsh-desktop/package.json`.
   * @returns the absolute resolved path.
   */
  resolve(id: string): string
  /**
   * Load `electron` from the desktop package (it exports the binary path).
   * @returns the absolute Electron executable.
   */
  electron(): string
}

/**
 * Resolve the workspace desktop package's Electron binary and built main script.
 * @param lookup - module lookup, replaceable by tests.
 * @returns the executable and main-script paths.
 */
export function resolveDesktopLaunch(lookup: DesktopModuleLookup = workspaceDesktopLookup()): DesktopLaunchPlan {
  let electron: string
  try {
    electron = lookup.electron()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`dsh desktop: Electron is not installed (${reason}); from a checkout run pnpm install && pnpm run build`)
  }
  if (typeof electron !== 'string' || electron === '') {
    throw new Error('dsh desktop: the electron package did not export an executable path')
  }
  let manifest: string
  try {
    manifest = lookup.resolve(`${DESKTOP_PACKAGE}/package.json`)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`dsh desktop: ${DESKTOP_PACKAGE} is not installed (${reason})`)
  }
  const main = join(dirname(manifest), 'lib', 'main.js')
  if (!existsSync(main)) {
    throw new Error(`dsh desktop: built main is missing ${main}; run pnpm run build first`)
  }
  return { electron, main }
}

/**
 * Build the Electron argv: the desktop main script, then launcher patches and
 * leftover web-app flags.
 * @param plan - resolved Electron paths.
 * @param input - patches and leftover arguments from `dsh desktop`.
 * @returns argv after the Electron executable.
 */
export function desktopElectronArgv(
  plan: DesktopLaunchPlan,
  input: { patches: readonly string[]; args: readonly string[] },
): string[] {
  const argv = [plan.main]
  for (const patch of input.patches) argv.push('--patch', patch)
  argv.push(...input.args)
  return argv
}

const defaultSpawner: DesktopProcessSpawner = {
  spawn(command, args, env, cwd) {
    return spawn(command, [...args], { env, cwd, stdio: 'inherit' })
  },
}

/**
 * Spawn Electron and wait until the packaged window process exits.
 * The child receives `DSH_NODE_EXECUTABLE` set to this process's Node so
 * the window can boot the web host and its Win32 folder-dialog worker under
 * real Node instead of a second Electron app.
 * @param options - launch environment, patches, leftover args, and test hooks.
 * @returns nothing; the process exit code follows the Electron child.
 */
export async function runDesktop(options: {
  patches: readonly string[]
  args: readonly string[]
  lookup?: DesktopModuleLookup
  spawner?: DesktopProcessSpawner
  env?: NodeJS.ProcessEnv
  cwd?: string
}): Promise<void> {
  const plan = resolveDesktopLaunch(options.lookup)
  const child = (options.spawner ?? defaultSpawner).spawn(
    plan.electron,
    desktopElectronArgv(plan, options),
    { ...options.env ?? process.env, DSH_NODE_EXECUTABLE: process.execPath },
    options.cwd ?? process.cwd(),
  )
  const code = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (exitCode, signal) => {
      if (signal !== null) {
        resolve(signal === 'SIGINT' ? 130 : 1)
        return
      }
      resolve(exitCode ?? 1)
    })
  })
  if (code !== 0) process.exitCode = code
}

/**
 * Lookup anchored at this CLI package so the workspace desktop package resolves.
 * @returns the production module lookup.
 */
function workspaceDesktopLookup(): DesktopModuleLookup {
  const fromCli = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)))
  return {
    resolve: (id: string) => fromCli.resolve(id),
    electron: () => {
      const desktopManifest = fromCli.resolve(`${DESKTOP_PACKAGE}/package.json`)
      const fromDesktop = createRequire(desktopManifest)
      return fromDesktop('electron') as string
    },
  }
}
