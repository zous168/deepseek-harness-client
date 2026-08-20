/**
 * Desktop-shell argument grammar: the same web-app flags, plus the forced
 * `--no-open` that keeps the host from launching a second browser window and
 * `--no-update-check`, which the shell consumes and never forwards.
 * @module @deepseek-ai/dsh-desktop/argv
 */

/** Host argv that boots the web profile inside the packaged window. */
export interface DesktopHostArgv {
  /** Forwarded `--patch` paths, in argument order. */
  patches: string[]
  /** Remaining web-app arguments after desktop-owned flags. */
  args: string[]
}

/**
 * Parse leftover desktop tokens into launcher patches and web-app arguments.
 * @param argv - tokens after the Electron binary and main script.
 * @returns patches and leftover web-app arguments.
 */
export function desktopInputFromArgv(argv: readonly string[]): DesktopHostArgv {
  const patches: string[] = []
  const args: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === undefined) continue
    if (argument === '--patch') {
      const value = argv[index + 1]
      if (value === undefined || value === '') {
        throw new Error('dsh desktop: --patch needs a path')
      }
      patches.push(value)
      index += 1
      continue
    }
    if (argument.startsWith('--patch=')) {
      const value = argument.slice('--patch='.length)
      if (value === '') throw new Error('dsh desktop: --patch needs a path')
      patches.push(value)
      continue
    }
    args.push(argument)
  }
  return { patches, args }
}

/**
 * Arguments after Electron's own tokens and this package's main script.
 * A packaged executable has no script token, so user flags start at argv[1].
 * An unpackaged launch has the app path or `main.js` at argv[1].
 * @param argv - full Electron `process.argv`.
 * @param packaged - `app.isPackaged`; when omitted, inferred from the main-script token.
 * @returns leftover desktop arguments.
 */
export function argvAfterMain(argv: readonly string[], packaged = false): string[] {
  const mainIndex = argv.findIndex((argument) => {
    return argument.endsWith('main.js') || argument.endsWith('main.ts')
  })
  if (mainIndex !== -1) return [...argv.slice(mainIndex + 1)]
  return [...argv.slice(packaged ? 1 : 2)]
}

/**
 * Build the inner `dsh web` argv for one desktop launch.
 * `--no-open` is always present and is not duplicated when the caller already
 * named it. `--no-update-check` stays on the Electron argv and is stripped
 * here. `--port 0` is added only when the caller did not name a port, so the
 * OS assigns a free port and two desktop windows do not collide.
 * @param input - launcher patches and leftover desktop arguments.
 * @returns argv after the Node executable, starting at `web`.
 */
export function desktopHostArgv(input: DesktopHostArgv): string[] {
  const argv = ['web']
  for (const patch of input.patches) {
    argv.push('--patch', patch)
  }
  const args = input.args.filter(argument => argument !== '--no-open' && argument !== '--no-update-check')
  argv.push(...args)
  if (!hasPortFlag(args)) argv.push('--port', '0')
  argv.push('--no-open')
  return argv
}

/**
 * True when `args` already names `--port` with a following value.
 * @param args - leftover desktop arguments.
 * @returns whether a port override is already present.
 */
function hasPortFlag(args: readonly string[]): boolean {
  for (const argument of args) {
    if (argument === '--port' || argument.startsWith('--port=')) return true
  }
  return false
}
