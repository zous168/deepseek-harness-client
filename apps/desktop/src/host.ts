/**
 * Spawn the existing web profile as the desktop window's host and wait for its
 * printed ready URL. The packaged window loads that loopback HTTP URL; it does
 * not serve dist over `file://`.
 * @module @deepseek-ai/dsh-desktop/host
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopHostArgv, type DesktopHostArgv } from './argv.ts'
import { parseWebReadyUrl } from './url.ts'

/** How the desktop shell locates and starts the web host. */
export interface HostLaunchPlan {
  /** Executable that runs the host (checkout Node, or Electron-as-Node when packaged). */
  command: string
  /** Arguments after {@link command}, starting at the CLI entry or `web`. */
  args: string[]
  /** Working directory inherited by the host (the invoking directory). */
  cwd: string
  /**
   * Environment for the child. Unpackaged launches forward `DSH_NODE_EXECUTABLE`
   * so the Win32 folder-dialog worker can spawn under real Node. Packaged
   * launches set `ELECTRON_RUN_AS_NODE=1` so the Electron binary can run the
   * CLI entry as Node.
   */
  env: NodeJS.ProcessEnv
}

/** One live web host plus the URL the window must load. */
export interface StartedHost {
  /** Child process of the web profile. */
  child: ChildProcess
  /** Canonical loopback URL printed on the `dsh web:` ready line. */
  url: string
}

/** Replaceable process spawning for tests. */
export interface HostProcessSpawner {
  /**
   * Spawn the host with piped stdout so the ready line can be parsed.
   * @param command - executable.
   * @param args - argv after the executable.
   * @param cwd - working directory.
   * @param env - child environment.
   * @returns the child process.
   */
  spawn(command: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess
}

/** Default deadline for the web-app ready line. */
const HOST_READY_TIMEOUT_MS = 60_000

/** This package root: `src/` and `lib/` both sit one level under `apps/desktop`. */
const DESKTOP_ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * First existing Node binary among explicit and inherited candidates.
 * @param paths - absolute executables, most preferred first.
 * @returns the first path that exists, or `undefined`.
 */
function firstExistingExecutable(...paths: Array<string | undefined>): string | undefined {
  for (const path of paths) {
    if (path !== undefined && path !== '' && existsSync(path)) return path
  }
  return undefined
}

/**
 * Locate the web host for a source checkout or a packaged extraResources tree.
 * @param options - launch layout.
 * @returns the command and argv that boot `dsh web`.
 */
export function resolveHostPlan(options: {
  /** True inside an electron-builder artifact. */
  packaged: boolean
  /** `process.resourcesPath` when packaged; ignored otherwise. */
  resourcesPath: string
  /** Absolute package root of `@deepseek-ai/dsh-desktop`. */
  desktopRoot?: string
  /** Node executable used for an unpackaged checkout. */
  nodeExecutable?: string
  /** Electron executable used with `ELECTRON_RUN_AS_NODE` when packaged. */
  electronExecutable?: string
  /** Invoking directory, which becomes the host cwd and default workspace. */
  cwd: string
  /** Desktop argv that become inner `dsh web` flags. */
  input: DesktopHostArgv
  /** Child environment. Launches always set `ELECTRON_RUN_AS_NODE`. */
  env?: NodeJS.ProcessEnv
}): HostLaunchPlan {
  const desktopRoot = options.desktopRoot ?? DESKTOP_ROOT
  const inner = desktopHostArgv(options.input)
  const inherited = options.env ?? process.env
  if (options.packaged) {
    const bin = join(options.resourcesPath, 'runtime', 'lib', 'bin.js')
    if (!existsSync(bin)) {
      throw new Error(`dsh desktop: packaged runtime is missing ${bin}; rebuild with pnpm run desktop:pack`)
    }
    const electron = options.electronExecutable ?? process.execPath
    return {
      command: electron,
      args: [bin, ...inner],
      cwd: options.cwd,
      env: { ...inherited, ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  const cliBin = join(dirname(desktopRoot), 'cli', 'lib', 'bin.js')
  if (!existsSync(cliBin)) {
    throw new Error(`dsh desktop: built CLI is missing ${cliBin}; run pnpm run build first`)
  }
  const node = firstExistingExecutable(
    options.nodeExecutable,
    inherited.DSH_NODE_EXECUTABLE,
    inherited.npm_node_execpath,
  ) ?? process.execPath
  return {
    command: node,
    args: [cliBin, ...inner],
    cwd: options.cwd,
    env: { ...inherited, DSH_NODE_EXECUTABLE: node },
  }
}

const defaultSpawner: HostProcessSpawner = {
  spawn(command, args, cwd, env) {
    return spawn(command, [...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  },
}

/**
 * Start the web host and resolve when it prints a ready URL.
 * @param plan - command produced by {@link resolveHostPlan}.
 * @param options - timeout and spawn replacements for tests.
 * @returns the child and the URL the window loads.
 */
export function startHost(
  plan: HostLaunchPlan,
  options: {
    timeoutMs?: number
    spawner?: HostProcessSpawner
  } = {},
): Promise<StartedHost> {
  const timeoutMs = options.timeoutMs ?? HOST_READY_TIMEOUT_MS
  const spawner = options.spawner ?? defaultSpawner
  const child = spawner.spawn(plan.command, plan.args, plan.cwd, plan.env)
  return new Promise((resolve, reject) => {
    let settled = false
    let buffer = ''
    const timer = setTimeout(() => {
      finish(new Error(`dsh desktop: web host did not print a ready URL within ${String(timeoutMs)}ms`))
    }, timeoutMs)

    function finish(error: Error): void
    function finish(result: StartedHost): void
    function finish(result: Error | StartedHost): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
      if (result instanceof Error) {
        if (child.exitCode === null && child.signalCode === null) child.kill()
        reject(result)
        return
      }
      resolve(result)
    }

    function onData(chunk: Buffer | string): void {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      process.stdout.write(text)
      buffer += text
      const lines = buffer.split(/\r?\n/u)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const url = parseWebReadyUrl(line)
        if (url !== undefined) {
          finish({ child, url })
          return
        }
      }
    }

    function onError(error: Error): void {
      finish(error)
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null): void {
      const status = signal === null ? `exit ${String(code)}` : `signal ${signal}`
      finish(new Error(`dsh desktop: web host ended before printing a ready URL (${status})`))
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}
